-- Review artifact, NOT an applied migration. Run only on an approved isolated baseline.
-- Promote through the existing migration workflow after explicit schema approval.
begin;
set local lock_timeout = '5s';
lock table public.events in share row exclusive mode;
do $$ begin
  if to_regprocedure('public.can_edit_content()') is null or to_regprocedure('public.hsv_v3_capabilities()') is null then
    raise exception 'HSV v3 prerequisites missing';
  end if;
  if to_regnamespace('attendance_private') is not null then raise exception 'Already applied or partial attendance schema; do not replay'; end if;
end $$;

create schema attendance_private;
revoke all on schema attendance_private from public, anon, authenticated;
alter table public.events add column attendance_config jsonb;
alter table public.events add column default_invitation_id uuid references public.event_guests(id) on delete set null;

create function attendance_private.location_source(e public.events) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_array(e.location_method,e.maps_url,e.place_id,e.venue_name,e.address,e.latitude,e.longitude)
$$;
create function attendance_private.validate_event() returns trigger language plpgsql security definer set search_path='' as $$
declare c jsonb:=new.attendance_config; a timestamptz; b timestamptz;
begin
  if new.default_invitation_id is not null and not exists(select 1 from public.event_guests where id=new.default_invitation_id and event_id=new.id) then
    raise exception 'Thiệp mặc định không thuộc sự kiện.' using errcode='23514';
  end if;
  if c is null then return new; end if;
  if jsonb_typeof(c) <> 'object' or c - array['enabled','radius_m','qr_seconds','latitude','longitude','pin_confirmed','pin_source','round_one','round_two'] <> '{}'::jsonb
    or not c ?& array['enabled','radius_m','qr_seconds','latitude','longitude','pin_confirmed','pin_source','round_one','round_two']
    or jsonb_typeof(c->'enabled') <> 'boolean' or jsonb_typeof(c->'pin_confirmed') <> 'boolean'
    or jsonb_typeof(c->'radius_m') <> 'number' or jsonb_typeof(c->'qr_seconds') <> 'number'
    or (c->>'radius_m')::numeric not between 10 and 1000 or (c->>'radius_m')::numeric <> trunc((c->>'radius_m')::numeric)
    or (c->>'qr_seconds')::numeric not between 3 and 60 or (c->>'qr_seconds')::numeric <> trunc((c->>'qr_seconds')::numeric)
    or jsonb_typeof(c->'pin_source') <> 'string' or length(c->>'pin_source') > 5000
    or jsonb_typeof(c->'round_one') <> 'string' or jsonb_typeof(c->'round_two') <> 'string'
    or (c->'latitude' <> 'null'::jsonb and (jsonb_typeof(c->'latitude') <> 'number' or (c->>'latitude')::numeric not between -85 and 85))
    or (c->'longitude' <> 'null'::jsonb and (jsonb_typeof(c->'longitude') <> 'number' or (c->>'longitude')::numeric not between -180 and 180)) then
    raise exception 'Cấu hình điểm danh không hợp lệ.' using errcode='23514';
  end if;
  if (c->>'enabled')::boolean and new.event_type='invitation' then
    if not (c->>'pin_confirmed')::boolean or c->'latitude'='null'::jsonb or c->'longitude'='null'::jsonb
      or (c->>'pin_source')::jsonb is distinct from attendance_private.location_source(new) then
      raise exception 'Kiểm tra và xác nhận ghim cho địa điểm hiện tại.' using errcode='23514';
    end if;
    a:=(c->>'round_one')::timestamptz; b:=(c->>'round_two')::timestamptz;
    if a is null or b is null or not isfinite(a) or not isfinite(b)
      or a<new.starts_at or b<new.starts_at or a+interval '15 minutes'>new.ends_at or b+interval '15 minutes'>new.ends_at
      or a+interval '15 minutes'>b then
      raise exception 'Hai đợt phải dài 15 phút, không chồng nhau và nằm trong thời gian sự kiện.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger attendance_event_validation before insert or update on public.events
for each row execute function attendance_private.validate_event();

-- Extend the audited save transaction; never refresh recipient snapshots or media.
do $$ declare original text; changed text; needle text; begin
  original:=pg_get_functiondef('public.save_event(jsonb,uuid[],uuid,timestamptz)'::regprocedure);
  if position('if not public.can_edit_content()' in original)=0 or position('p_expected_updated_at is distinct from old_event.updated_at' in original)=0 then
    raise exception 'Unexpected save_event authorization/concurrency baseline';
  end if;
  needle:='v := jsonb_populate_record(null::public.events,p_event);';
  if position(needle in original)=0 or position('music_path,event_type,theme)' in original)=0
    or position('v.music_path,v.event_type,v.theme) returning' in original)=0
    or position('return public.event_payload_v110(v);' in original)=0 then raise exception 'Unexpected v3 save_event baseline'; end if;
  changed:=replace(original,needle,needle||$patch$
    v.attendance_config:=case when p_event ? 'attendance_config' then nullif(p_event->'attendance_config','null'::jsonb) else old_event.attendance_config end;
    v.default_invitation_id:=case when p_event ? 'default_invitation_id' then (p_event->>'default_invitation_id')::uuid else old_event.default_invitation_id end;
    v.status:=coalesce(old_event.status,'draft');
  $patch$);
  changed:=replace(changed,'music_path,event_type,theme)','music_path,event_type,theme,attendance_config,default_invitation_id)');
  changed:=replace(changed,'v.music_path,v.event_type,v.theme) returning','v.music_path,v.event_type,v.theme,v.attendance_config,v.default_invitation_id) returning');
  changed:=replace(changed,'update public.events set event_type=','update public.events set attendance_config=v.attendance_config,default_invitation_id=v.default_invitation_id,event_type=');
  -- Removing the default guest can SET NULL on the event and update its revision.
  changed:=replace(changed,'return public.event_payload_v110(v);','select * into v from public.events where id=v.id; return public.event_payload_v110(v);');
  execute changed;
end $$;
create or replace function public.event_payload_v110(e public.events) returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(e)||jsonb_build_object(
    'agenda',coalesce((select jsonb_agg(to_jsonb(a) order by a.time,a.sort_order) from public.event_agenda_items a where a.event_id=e.id),'[]'::jsonb),
    'default_invitation_alias',(select eg.primary_alias from public.event_guests eg join public.invitation_aliases a on a.event_guest_id=eg.id and a.event_id=e.id and a.alias=eg.primary_alias where eg.id=e.default_invitation_id and eg.event_id=e.id limit 1))
$$;

create table attendance_private.records (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  invitation_id uuid references public.event_guests(id) on delete set null,
  browser_id uuid not null,
  key_hash bytea not null,
  full_name text not null check(length(btrim(full_name)) between 2 and 120),
  student_id text not null check(student_id ~ '^[A-Z0-9][A-Z0-9._-]{2,29}$'),
  round_one_at timestamptz, round_two_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(event_id,browser_id), unique(event_id,student_id),
  check(round_one_at is not null or round_two_at is not null)
);
create table attendance_private.edits (
  id bigint generated always as identity primary key,
  record_id uuid not null references attendance_private.records(id) on delete cascade,
  changed_at timestamptz not null default clock_timestamp(),
  old_name text not null, old_student_id text not null, new_name text not null, new_student_id text not null
);
create table attendance_private.tokens (
  event_id uuid not null references public.events(id) on delete cascade,
  round integer not null check(round in (1,2)), slot timestamptz not null,
  config_hash text not null,
  token text not null unique default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
  expires_at timestamptz not null,
  primary key(event_id,round,slot,config_hash)
);
alter table attendance_private.records enable row level security;
alter table attendance_private.edits enable row level security;
alter table attendance_private.tokens enable row level security;
revoke all on all tables in schema attendance_private from public,anon,authenticated;

create function attendance_private.round_at(e public.events, t timestamptz) returns integer
language sql stable set search_path='' as $$
 select case when e.status='published' and e.event_type='invitation' and coalesce((e.attendance_config->>'enabled')::boolean,false)
  then case when t >= (e.attendance_config->>'round_one')::timestamptz and t < (e.attendance_config->>'round_one')::timestamptz+interval '15 minutes' then 1
    when t >= (e.attendance_config->>'round_two')::timestamptz and t < (e.attendance_config->>'round_two')::timestamptz+interval '15 minutes' then 2 end end
$$;
create function attendance_private.result(r attendance_private.records) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',r.id,'event_id',r.event_id,'invitation_id',r.invitation_id,'full_name',r.full_name,'student_id',r.student_id,
   'round_one_at',r.round_one_at,'round_two_at',r.round_two_at,'count',(r.round_one_at is not null)::integer+(r.round_two_at is not null)::integer,'updated_at',r.updated_at)
$$;
create function public.attendance_capabilities() returns jsonb language sql immutable set search_path='' as $$select '{"version":1}'::jsonb$$;
create function public.attendance_status(p_code text,p_alias text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events; t timestamptz:=clock_timestamp(); r integer; eligible boolean;
begin
  select * into e from public.events where code=p_code and status='published';
  eligible:=found and e.event_type='invitation' and coalesce((e.attendance_config->>'enabled')::boolean,false)
    and exists(select 1 from public.invitation_aliases a join public.event_guests g on g.id=a.event_guest_id and g.event_id=a.event_id where a.event_id=e.id and a.alias=p_alias and g.kind='group');
  if not eligible then return jsonb_build_object('eligible',false,'server_time',t,'round',null,'closes_at',null); end if;
  r:=attendance_private.round_at(e,t);
  return jsonb_build_object('eligible',true,'server_time',t,'round',r,'closes_at',case when r is not null then (e.attendance_config->>case r when 1 then 'round_one' else 'round_two' end)::timestamptz+interval '15 minutes' end,
    'radius_m',e.attendance_config->'radius_m','latitude',e.attendance_config->'latitude','longitude',e.attendance_config->'longitude');
end $$;
create function public.attendance_display(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events; t timestamptz; r integer; opened timestamptz; slot_start timestamptz; expiry timestamptz; seconds integer; token_value text; fingerprint text;
begin
  if not public.can_edit_content() then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into e from public.events where code=p_code for share;
  if not found then raise exception 'Not found'; end if;
  t:=clock_timestamp(); r:=attendance_private.round_at(e,t);
  if r is null then return jsonb_build_object('title',e.title,'server_time',t,'round',null,'token',null,'config',e.attendance_config); end if;
  seconds:=(e.attendance_config->>'qr_seconds')::integer;
  opened:=(e.attendance_config->>case r when 1 then 'round_one' else 'round_two' end)::timestamptz;
  slot_start:=opened+floor(extract(epoch from t-opened)/seconds)*seconds*interval '1 second';
  expiry:=least(slot_start+seconds*interval '1 second',opened+interval '15 minutes'); fingerprint:=md5(e.attendance_config::text);
  delete from attendance_private.tokens where event_id=e.id and expires_at<t-interval '2 hours';
  insert into attendance_private.tokens(event_id,round,slot,config_hash,expires_at) values(e.id,r,slot_start,fingerprint,expiry) on conflict do nothing;
  select token into token_value from attendance_private.tokens where event_id=e.id and round=r and slot=slot_start and config_hash=fingerprint;
  return jsonb_build_object('title',e.title,'server_time',t,'round',r,'token','HSV1:'||token_value,'expires_at',expiry,'closes_at',opened+interval '15 minutes','qr_seconds',seconds);
end $$;
create function public.attendance_submit(p_code text,p_alias text,p_browser_id uuid,p_secret text,p_name text,p_student_id text,p_token text,p_position jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events; g uuid; r attendance_private.records; t timestamptz; round_number integer; c jsonb;
  lat double precision; lng double precision; accuracy double precision; age double precision; distance double precision; fix_time timestamptz;
begin
  if p_browser_id is null or p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then return '{"ok":false}'::jsonb; end if;
  select * into e from public.events where code=p_code for share;
  if not found then return '{"ok":false}'::jsonb; end if;
  perform pg_advisory_xact_lock(hashtextextended(e.id::text||p_browser_id::text,0));
  t:=clock_timestamp(); round_number:=attendance_private.round_at(e,t); c:=e.attendance_config;
  if round_number is null then return '{"ok":false}'::jsonb; end if;
  select eg.id into g from public.invitation_aliases a join public.event_guests eg on eg.id=a.event_guest_id and eg.event_id=a.event_id
    where a.event_id=e.id and a.alias=p_alias and eg.kind='group';
  if g is null then return '{"ok":false}'::jsonb; end if;
  if not exists(select 1 from attendance_private.tokens where event_id=e.id and round=round_number and token=substring(p_token from 6)
    and p_token like 'HSV1:%' and config_hash=md5(c::text) and t>=slot and t<expires_at+interval '1 second') then return '{"ok":false}'::jsonb; end if;
  lat:=(p_position->>'latitude')::double precision; lng:=(p_position->>'longitude')::double precision; accuracy:=(p_position->>'accuracy')::double precision;
  fix_time:=(p_position->>'captured_at')::timestamptz; age:=extract(epoch from t-fix_time);
  if lat is null or lng is null or accuracy is null or age is null or not isfinite(fix_time) or lat not between -90 and 90 or lng not between -180 and 180
    or accuracy not between 0.000001 and least(50,(c->>'radius_m')::double precision/2) or age not between -5 and 30 then return '{"ok":false}'::jsonb; end if;
  distance:=6371000*2*asin(least(1,sqrt(power(sin(radians(lat-(c->>'latitude')::double precision)/2),2)
    +cos(radians(lat))*cos(radians((c->>'latitude')::double precision))*power(sin(radians(lng-(c->>'longitude')::double precision)/2),2))));
  if distance>(c->>'radius_m')::double precision then return '{"ok":false}'::jsonb; end if;
  p_name:=btrim(p_name); p_student_id:=upper(btrim(p_student_id));
  if p_name is null or length(p_name) not between 2 and 120 or p_student_id is null or p_student_id !~ '^[A-Z0-9][A-Z0-9._-]{2,29}$' then return '{"ok":false}'::jsonb; end if;
  -- Serialize only the browser's successful binding path. Unique MSSV protects cross-browser races.
  select * into r from attendance_private.records where event_id=e.id and browser_id=p_browser_id for update;
  if found then
    if r.key_hash<>sha256(convert_to(p_secret,'UTF8')) or r.student_id<>p_student_id or r.full_name<>p_name
      or (round_number=1 and r.round_one_at is not null) or (round_number=2 and r.round_two_at is not null) then return '{"ok":false}'::jsonb; end if;
    update attendance_private.records set round_one_at=case when round_number=1 then t else round_one_at end,
      round_two_at=case when round_number=2 then t else round_two_at end,updated_at=t where id=r.id returning * into r;
  else
    insert into attendance_private.records(event_id,invitation_id,browser_id,key_hash,full_name,student_id,round_one_at,round_two_at)
      values(e.id,g,p_browser_id,sha256(convert_to(p_secret,'UTF8')),p_name,p_student_id,case when round_number=1 then t end,case when round_number=2 then t end) returning * into r;
  end if;
  return jsonb_build_object('ok',true,'round',round_number,'record',attendance_private.result(r));
exception when unique_violation or check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return '{"ok":false}'::jsonb;
end $$;
create function public.attendance_own(p_code text,p_browser_id uuid,p_secret text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r attendance_private.records;
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then return null; end if;
  select x.* into r from attendance_private.records x join public.events e on e.id=x.event_id
    where e.code=p_code and x.browser_id=p_browser_id and x.key_hash=sha256(convert_to(p_secret,'UTF8'));
  if not found then return null; end if;
  return attendance_private.result(r);
end $$;
create function public.attendance_edit(p_code text,p_browser_id uuid,p_secret text,p_name text,p_student_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r attendance_private.records;
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then return '{"ok":false}'::jsonb; end if;
  select x.* into r from attendance_private.records x join public.events e on e.id=x.event_id
    where e.code=p_code and x.browser_id=p_browser_id and x.key_hash=sha256(convert_to(p_secret,'UTF8')) for update of x;
  if not found then return '{"ok":false}'::jsonb; end if;
  p_name:=btrim(p_name); p_student_id:=upper(btrim(p_student_id));
  if p_name is null or length(p_name) not between 2 and 120 or p_student_id is null or p_student_id !~ '^[A-Z0-9][A-Z0-9._-]{2,29}$' then return '{"ok":false}'::jsonb; end if;
  if r.full_name is distinct from p_name or r.student_id is distinct from p_student_id then
    insert into attendance_private.edits(record_id,old_name,old_student_id,new_name,new_student_id) values(r.id,r.full_name,r.student_id,p_name,p_student_id);
    update attendance_private.records set full_name=p_name,student_id=p_student_id,updated_at=clock_timestamp() where id=r.id returning * into r;
  end if;
  return jsonb_build_object('ok',true,'record',attendance_private.result(r));
exception when unique_violation or check_violation then return '{"ok":false}'::jsonb;
end $$;
create function public.attendance_results(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.can_edit_content() then raise exception 'Forbidden' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(attendance_private.result(r)||jsonb_build_object('history',coalesce((select jsonb_agg(to_jsonb(h)-'record_id' order by h.changed_at,h.id) from attendance_private.edits h where h.record_id=r.id),'[]'::jsonb)) order by r.created_at,r.id)
    from attendance_private.records r join public.events e on e.id=r.event_id where e.code=p_code),'[]'::jsonb);
end $$;
revoke all on all functions in schema attendance_private from public,anon,authenticated;
revoke all on function public.attendance_capabilities(),public.attendance_status(text,text),public.attendance_display(text),
  public.attendance_submit(text,text,uuid,text,text,text,text,jsonb),public.attendance_own(text,uuid,text),public.attendance_edit(text,uuid,text,text,text),public.attendance_results(text)
  from public,anon,authenticated;
grant execute on function public.attendance_capabilities(),public.attendance_status(text,text),public.attendance_submit(text,text,uuid,text,text,text,text,jsonb),
  public.attendance_own(text,uuid,text),public.attendance_edit(text,uuid,text,text,text) to anon,authenticated;
grant execute on function public.attendance_display(text),public.attendance_results(text) to authenticated;
commit;
