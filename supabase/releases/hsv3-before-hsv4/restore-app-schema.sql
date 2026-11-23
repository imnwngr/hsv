-- HSV v3 live application schema before hsv4.
-- Captured 2026-11-23T02:02:48.777702+00:00; schema only, no rows, passwords, Auth users or Storage files.
-- Restore only into an EMPTY compatible Supabase environment with its auth/storage schemas and roles.
-- Not an upgrade or a script to run on the existing production database.
begin;
set local check_function_bodies = off;
set local search_path = public, pg_catalog;
do $$ begin if to_regclass('public.events') is not null then raise exception 'Restore requires an empty application schema'; end if; end $$;

create table "public"."admin_users" (
  "user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."editor_add_operations" (
  "email" text not null,
  "actor" uuid not null,
  "request_id" uuid not null,
  "lease" uuid,
  "lease_until" timestamp with time zone,
  "state" text not null,
  "target" uuid,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."editor_users" (
  "user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."event_agenda_items" (
  "id" uuid default gen_random_uuid() not null,
  "event_id" uuid not null,
  "time" text not null,
  "description" text not null,
  "highlight" boolean default false not null,
  "sort_order" integer not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "end_time" text,
  "icon" text default 'book'::text not null
);

create table "public"."event_guests" (
  "id" uuid default gen_random_uuid() not null,
  "event_id" uuid not null,
  "guest_id" uuid not null,
  "salutation" text not null,
  "name" text not null,
  "description" text not null,
  "kind" text not null,
  "primary_alias" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."events" (
  "id" uuid default gen_random_uuid() not null,
  "code" text not null,
  "title" text not null,
  "description" text default ''::text not null,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "status" text default 'draft'::text not null,
  "venue_name" text default ''::text not null,
  "address" text default ''::text not null,
  "directions" text default ''::text not null,
  "latitude" double precision,
  "longitude" double precision,
  "place_id" text default ''::text not null,
  "maps_url" text default ''::text not null,
  "location_method" text default 'url'::text not null,
  "venue_image_path" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "quote_one" text default ''::text not null,
  "quote_two" jsonb,
  "description_rich" jsonb,
  "youtube_url" text,
  "music_path" text,
  "event_type" text default 'invitation'::text not null,
  "theme" jsonb default '{"primary": "#174b78", "version": 1}'::jsonb not null
);

create table "public"."guests" (
  "id" uuid default gen_random_uuid() not null,
  "salutation" text default ''::text not null,
  "name" text not null,
  "description" text default ''::text not null,
  "kind" text default 'individual'::text not null,
  "active" boolean default true not null,
  "primary_alias" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "display_order" integer not null
);

create table "public"."invitation_aliases" (
  "id" uuid default gen_random_uuid() not null,
  "event_id" uuid not null,
  "event_guest_id" uuid not null,
  "alias" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."music_uploads" (
  "path" text not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."venue_image_uploads" (
  "path" text not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);

CREATE OR REPLACE FUNCTION public.agenda_icon_capabilities()
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select array['users','music','mic','film','award','sparkles','book-open','gift','trophy','camera','heart-handshake']::text[] $function$;

CREATE OR REPLACE FUNCTION public.begin_editor_add(p_actor uuid, p_email text, p_request_id uuid, p_allow_invite boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare email_value text:=lower(btrim(p_email)); target_user auth.users; op public.editor_add_operations; token uuid:=gen_random_uuid();
begin
  perform pg_advisory_xact_lock(194827,112);
  lock table public.admin_users in share mode;
  if not exists(select 1 from public.admin_users a join auth.users u on u.id=a.user_id where a.user_id=p_actor and coalesce(u.is_anonymous,false)=false and (u.banned_until is null or u.banned_until<=now())) then raise exception 'Admin required' using errcode='42501'; end if;
  if p_request_id is null or email_value is null or length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Invalid email/request' using errcode='22023'; end if;
  if (select count(*) from auth.users where lower(email)=email_value)>1 then return jsonb_build_object('state','ambiguous_account'); end if;
  select * into target_user from auth.users where lower(email)=email_value;
  if target_user.id is not null and (coalesce(target_user.is_anonymous,false) or target_user.banned_until>now()) then return jsonb_build_object('state','account_ineligible'); end if;
  if exists(select 1 from public.admin_users where user_id=target_user.id) then return jsonb_build_object('state','admin_protected'); end if;
  select * into op from public.editor_add_operations where email=email_value for update;
  if op.request_id=p_request_id and (op.state='revoked' or (op.state='granted' and not exists(select 1 from public.editor_users where user_id=target_user.id))) then
    return jsonb_build_object('state','role_changed');
  end if;
  if exists(select 1 from public.editor_users where user_id=target_user.id) then
    return jsonb_build_object('state','already_editor','account_status',case when target_user.email_confirmed_at is not null then 'confirmed' when target_user.invited_at is not null then 'invited' else 'unconfirmed' end);
  end if;
  if op.lease is not null and op.lease_until>now() then return jsonb_build_object('state','processing'); end if;
  if target_user.id is null and op.email is not null then
    update public.editor_add_operations set state='delivery_unknown',lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
    return jsonb_build_object('state','delivery_unknown');
  end if;
  if target_user.id is null and not coalesce(p_allow_invite,false) then return jsonb_build_object('state','invitation_not_ready'); end if;
  insert into public.editor_add_operations(email,actor,request_id,lease,lease_until,state,target)
    values(email_value,p_actor,p_request_id,token,now()+interval '90 seconds',case when target_user.id is null then 'sending' else 'granting' end,target_user.id)
    on conflict(email) do update set actor=excluded.actor,request_id=excluded.request_id,lease=excluded.lease,lease_until=excluded.lease_until,state=excluded.state,target=excluded.target,updated_at=clock_timestamp();
  return jsonb_build_object('state',case when target_user.id is null then 'invite' else 'grant' end,'lease',token,'target',target_user.id);
end $function$;

CREATE OR REPLACE FUNCTION public.can_edit_content()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.is_admin() or exists(select 1 from public.editor_users where user_id=(select auth.uid()))
$function$;

CREATE OR REPLACE FUNCTION public.editor_add_recovery()
 RETURNS TABLE(email text, state text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  return query select o.email,o.state,o.updated_at from public.editor_add_operations o
    where o.state not in ('granted','revoked') and not exists(select 1 from auth.users u join public.editor_users e on e.user_id=u.id where lower(u.email)=o.email)
    order by o.updated_at desc;
end $function$;

CREATE OR REPLACE FUNCTION public.effective_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when public.is_admin() then 'admin' when exists(select 1 from public.editor_users where user_id=(select auth.uid())) then 'editor' end
$function$;

CREATE OR REPLACE FUNCTION public.event_payload_v110(e events)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select to_jsonb(e)||jsonb_build_object('agenda',coalesce((select jsonb_agg(to_jsonb(a) order by a.time,a.sort_order) from public.event_agenda_items a where a.event_id=e.id),'[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.finish_editor_add(p_actor uuid, p_email text, p_lease uuid, p_target uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare email_value text:=lower(btrim(p_email)); op public.editor_add_operations; target_user auth.users;
begin
  perform pg_advisory_xact_lock(194827,112);
  lock table public.admin_users in share mode;
  select * into op from public.editor_add_operations where email=email_value for update;
  if op.state='revoked' then return jsonb_build_object('state','role_changed'); end if;
  if op.email is null or op.lease is distinct from p_lease or op.lease is null or op.actor<>p_actor then return jsonb_build_object('state','processing'); end if;
  if p_target is null then
    update public.editor_add_operations set state='delivery_unknown',lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
    return jsonb_build_object('state','delivery_unknown');
  end if;
  select * into target_user from auth.users where id=p_target and lower(email)=email_value;
  if target_user.id is null or coalesce(target_user.is_anonymous,false) or target_user.banned_until>now()
     or exists(select 1 from public.admin_users where user_id=p_target)
     or not exists(select 1 from public.admin_users a join auth.users u on u.id=a.user_id where a.user_id=p_actor and coalesce(u.is_anonymous,false)=false and (u.banned_until is null or u.banned_until<=now())) then
    update public.editor_add_operations set state='grant_failed',lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
    return jsonb_build_object('state','grant_failed');
  end if;
  begin
    insert into public.editor_users(user_id) values(p_target) on conflict(user_id) do nothing;
    update public.editor_add_operations set state='granted',target=p_target,lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
  exception when others then
    update public.editor_add_operations set state='grant_failed',target=p_target,lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
    return jsonb_build_object('state','grant_failed');
  end;
  return jsonb_build_object('state','granted','account_status',case when target_user.email_confirmed_at is not null then 'confirmed' when target_user.invited_at is not null then 'invited' else 'unconfirmed' end);
end $function$;

CREATE OR REPLACE FUNCTION public.get_event_v110(p_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.event_payload_v110(e) from public.events e where e.code=p_code and (e.status='published' or public.can_edit_content());
$function$;

CREATE OR REPLACE FUNCTION public.guard_music_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if old.bucket_id='bookclub-music' and exists(select 1 from public.events e where e.music_path=old.name) then raise exception 'Music is referenced by an event' using errcode='23503';end if;
 return old;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_music_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.music_path is not null then
  perform 1 from storage.objects where bucket_id='bookclub-music' and name=new.music_path for key share;
  if not found then raise exception 'Music object missing' using errcode='23503';end if;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guest_alias_v110()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin new.primary_alias:=coalesce(nullif(new.primary_alias,''),public.guest_slug_v110(new.name)); return new; end $function$;

CREATE OR REPLACE FUNCTION public.guest_order_append()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 select coalesce(max(display_order),0)+1 into new.display_order from public.guests;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guest_order_available()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select true $function$;

CREATE OR REPLACE FUNCTION public.guest_order_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if (to_jsonb(new)-'display_order'-'updated_at') is distinct from (to_jsonb(old)-'display_order'-'updated_at') then
  new.updated_at:=clock_timestamp();
 else new.updated_at:=old.updated_at;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guest_order_write_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.can_edit_content() then raise exception 'Admin required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(194827,110);
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.guest_slug_v110(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select trim(both '-' from left(public.slug_v110(regexp_replace(value,'^((thầy|cô|anh|chị|thạc sĩ|ths\.?|ks\.?|đ/c)[[:space:]]+)+','','i')),80));
$function$;

CREATE OR REPLACE FUNCTION public.hsv_v3_capabilities()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select '{"version":3,"event_types":["invitation","congratulation"],"theme_version":1,"editor_add_operations":true}'::jsonb
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.admin_users where user_id = (select auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION public.primary_invitation_alias_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.event_guests eg where eg.id=new.event_guest_id and eg.event_id=new.event_id and eg.primary_alias=new.alias) then raise exception 'Only primary invitation alias is allowed' using errcode='23514'; end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.reorder_guests(p_expected uuid[], p_order uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_ids uuid[];
begin
  if not public.can_edit_content() then raise exception 'Admin required' using errcode='42501'; end if;
  if p_expected is null or p_order is null then raise exception 'Guest IDs required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(194827,110);
  select coalesce(array_agg(id order by display_order,id),array[]::uuid[]) into current_ids from public.guests;
  if current_ids is distinct from p_expected then raise exception 'Guest order changed; reload before retry' using errcode='40001'; end if;
  if cardinality(p_order) <> cardinality(current_ids)
     or cardinality(p_order) <> (select count(distinct id) from unnest(p_order) id)
     or exists(select id from unnest(current_ids) id except select id from unnest(p_order) id) then
    raise exception 'Invalid guest order' using errcode='22023';
  end if;
  update public.guests g set display_order=x.position from unnest(p_order) with ordinality x(id,position)
    where g.id=x.id and g.display_order is distinct from x.position;
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_invitation(p_code text, p_alias text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('event',public.event_payload_v110(e),'invitation',jsonb_build_object('salutation',eg.salutation,'name',eg.name,'description',eg.description,'kind',eg.kind))
 from public.events e join public.invitation_aliases a on a.event_id=e.id join public.event_guests eg on eg.id=a.event_guest_id
 where e.code=p_code and a.alias=p_alias and a.alias=eg.primary_alias and (e.status='published' or public.can_edit_content()) limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.role_directory()
 RETURNS TABLE(user_id uuid, email text, role text, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.can_edit_content() then raise exception 'Content access required' using errcode='42501';end if;
 return query select u.id,u.email::text,case when a.user_id is not null then 'admin' else 'editor' end,
 case when u.email_confirmed_at is not null then 'confirmed' when u.invited_at is not null then 'invited' else 'unconfirmed' end
 from auth.users u left join public.admin_users a on a.user_id=u.id left join public.editor_users e on e.user_id=u.id
 where a.user_id is not null or e.user_id is not null order by lower(u.email);
end $function$;

CREATE OR REPLACE FUNCTION public.save_event(p_event jsonb, p_guest_ids uuid[], p_id uuid DEFAULT NULL::uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.events; old_event public.events; g public.guests; eg_id uuid; base_alias text; candidate text; n integer; first_alias text; item jsonb; edit jsonb; target uuid; alias_value text;
begin
  if not public.can_edit_content() then raise exception 'Admin required' using errcode='42501'; end if;
  if p_guest_ids is null then raise exception 'Guest IDs required'; end if;
  if cardinality(p_guest_ids) <> (select count(distinct x) from unnest(p_guest_ids) x) then raise exception 'Duplicate guest'; end if;
  if exists(select 1 from unnest(p_guest_ids) x where not exists(select 1 from public.guests directory where directory.id=x)) then raise exception 'Unknown guest'; end if;
  if p_id is not null then
    select * into old_event from public.events where id=p_id for update;
    if not found then raise exception 'Event not found'; end if;
    if p_expected_updated_at is distinct from old_event.updated_at then raise exception 'Concurrent update' using errcode='40001'; end if;

  end if;
  if exists(select 1 from public.guests directory where directory.id=any(p_guest_ids) and not directory.active and not exists(select 1 from public.event_guests eg where eg.event_id=p_id and eg.guest_id=directory.id)) then raise exception 'Inactive guest'; end if;
  if p_id is null and coalesce(p_event->>'code','')='' then p_event:=p_event||jsonb_build_object('code',trim(both '-' from left(public.slug_v110(p_event->>'title'),80))); end if;
  
  if p_event ? 'event_type' and (p_event->>'event_type' is null or p_event->>'event_type' not in ('invitation','congratulation')) then raise exception 'Invalid event type' using errcode='23514'; end if;
  if p_event ? 'theme' and not public.valid_event_theme(p_event->'theme') then raise exception 'Invalid event theme' using errcode='23514'; end if;
  v := jsonb_populate_record(null::public.events,p_event);
  v.event_type:=coalesce(v.event_type,old_event.event_type,'invitation');
  v.theme:=coalesce(v.theme,old_event.theme,'{"version":1,"primary":"#174b78"}'::jsonb);
  
  if p_id is null then
    insert into public.events(code,title,description,starts_at,ends_at,status,venue_name,address,directions,latitude,longitude,place_id,maps_url,location_method,venue_image_path,quote_one,quote_two,description_rich,youtube_url,music_path,event_type,theme)
    values(v.code,v.title,coalesce(v.description,''),v.starts_at,v.ends_at,v.status,coalesce(v.venue_name,''),coalesce(v.address,''),coalesce(v.directions,''),v.latitude,v.longitude,coalesce(v.place_id,''),coalesce(v.maps_url,''),coalesce(v.location_method,'url'),v.venue_image_path,coalesce(v.quote_one,''),v.quote_two,v.description_rich,nullif(v.youtube_url,''),v.music_path,v.event_type,v.theme) returning * into v;
  else
    update public.events set event_type=v.event_type,theme=v.theme,music_path=case when p_event ? 'music_path' then nullif(v.music_path,'') else old_event.music_path end, youtube_url=case when p_event ? 'youtube_url' then nullif(v.youtube_url,'') else old_event.youtube_url end, description_rich=case when p_event ? 'description_rich' then v.description_rich else old_event.description_rich end, quote_one=case when p_event ? 'quote_one' then coalesce(v.quote_one,'') else old_event.quote_one end, quote_two=case when p_event ? 'quote_two' then v.quote_two else old_event.quote_two end, code=v.code,location_method=v.location_method,venue_image_path=v.venue_image_path,title=v.title,description=coalesce(v.description,''),starts_at=v.starts_at,ends_at=v.ends_at,status=v.status,venue_name=coalesce(v.venue_name,''),address=coalesce(v.address,''),directions=coalesce(v.directions,''),latitude=v.latitude,longitude=v.longitude,place_id=coalesce(v.place_id,''),maps_url=coalesce(v.maps_url,'') where id=p_id returning * into v;
  end if;
  delete from public.event_guests where event_id=v.id and not(guest_id=any(p_guest_ids));
  for g in select * from public.guests where id=any(p_guest_ids) order by id loop
    if exists(select 1 from public.event_guests where event_id=v.id and guest_id=g.id) then continue; end if;
    eg_id := gen_random_uuid(); first_alias:=g.primary_alias;
    if exists(select 1 from public.invitation_aliases where event_id=v.id and alias=first_alias) then raise exception 'Primary alias conflict: review existing invitation aliases' using errcode='23505'; end if;
    insert into public.event_guests(id,event_id,guest_id,salutation,name,description,kind,primary_alias) values(eg_id,v.id,g.id,g.salutation,g.name,g.description,g.kind,first_alias);
    insert into public.invitation_aliases(event_id,event_guest_id,alias) values(v.id,eg_id,first_alias);

  end loop;
  n:=0;
 if p_event ? 'agenda' then
   if jsonb_typeof(p_event->'agenda')<>'array' or jsonb_array_length(p_event->'agenda')>100 then raise exception 'Invalid agenda'; end if;
   -- Only unchanged legacy milestones may retain a missing end time.
   for item in select value from jsonb_array_elements(p_event->'agenda') loop
    if item->>'end_time' is null and not exists(select 1 from public.event_agenda_items old_item where old_item.event_id=v.id and old_item.end_time is null and old_item.time=item->>'time' and old_item.description=item->>'description') then
     raise exception 'End time required for new or edited milestone' using errcode='23514';
    end if;
   end loop;
   delete from public.event_agenda_items where event_id=v.id;
   for item in select value from jsonb_array_elements(p_event->'agenda') loop
     insert into public.event_agenda_items(event_id,time,end_time,icon,description,highlight,sort_order) values(v.id,item->>'time',item->>'end_time',coalesce(item->>'icon','book'),item->>'description',coalesce((item->>'highlight')::boolean,false),n); n:=n+1;
   end loop;
 end if;
 if p_event ? 'invitation_edits' and p_event->'invitation_edits'<>'[]'::jsonb then raise exception 'Secondary alias editing is disabled' using errcode='42501'; end if;
  return public.event_payload_v110(v);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_editor_role(p_actor uuid, p_target uuid, p_grant boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform pg_advisory_xact_lock(194827,112);
 lock table public.admin_users in share mode;
 if not exists(select 1 from public.admin_users where user_id=p_actor) then raise exception 'Admin required' using errcode='42501';end if;
 if exists(select 1 from public.admin_users where user_id=p_target) then raise exception 'Admin targets locked' using errcode='42501';end if;
 if not exists(select 1 from auth.users where id=p_target) then raise exception 'Account not found' using errcode='22023';end if;
 if p_grant is true then
  if exists(select 1 from public.editor_users where user_id=p_target) then raise exception 'Already Editor' using errcode='23505';end if;
  insert into public.editor_users(user_id) values(p_target);
 elsif p_grant is false then
  delete from public.editor_users where user_id=p_target;
  if not found then raise exception 'Editor not found' using errcode='22023';end if;
  update public.editor_add_operations set state='revoked',lease=null,lease_until=null,updated_at=clock_timestamp()
    where email in (select lower(email) from auth.users where id=p_target);
  
 else raise exception 'Action required' using errcode='22023';end if;
end $function$;

CREATE OR REPLACE FUNCTION public.slug_v110(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select trim(both '-' from regexp_replace(lower(replace(replace(regexp_replace(normalize(value,NFD),'[̀-ͯ]','','g'),'đ','d'),'Đ','D')),'[^a-z0-9]+','-','g'));
$function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin new.updated_at := clock_timestamp(); return new; end;
$function$;

CREATE OR REPLACE FUNCTION public.unused_music()
 RETURNS TABLE(path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.can_edit_content() then raise exception 'Content access required' using errcode='42501';end if;
 return query select r.path from public.music_uploads r where not exists(select 1 from public.events e where e.music_path=r.path) order by r.created_at;
end $function$;

CREATE OR REPLACE FUNCTION public.unused_venue_images()
 RETURNS SETOF venue_image_uploads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin if not public.can_edit_content() then raise exception 'Admin required' using errcode='42501'; end if;
return query select r.* from public.venue_image_uploads r where r.created_by=auth.uid() and not exists(select 1 from public.events e where e.venue_image_path=r.path);
end $function$;

CREATE OR REPLACE FUNCTION public.valid_event_theme(value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_typeof(value)='object' and value->'version'='1'::jsonb
    and jsonb_typeof(value->'primary')='string' and value->>'primary' ~ '^#[0-9a-fA-F]{6}$'
    and (value - 'version' - 'primary')='{}'::jsonb, false)
$function$;

CREATE OR REPLACE FUNCTION public.valid_quote_document(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare r record; n jsonb; a jsonb; m jsonb; ma jsonb; t text; seen text[]; total integer:=0;
begin
 if p is null then return true; end if;
 if jsonb_typeof(p)<>'object' or octet_length(p::text)>50000 then return false; end if;
 for r in with recursive walk(n,parent,depth,idx) as (
 select p,''::text,0,1::bigint union all
 select c.value,w.n->>'type',w.depth+1,c.ordinality from walk w cross join lateral jsonb_array_elements(case when jsonb_typeof(w.n->'content')='array' then w.n->'content' else '[]'::jsonb end) with ordinality c where w.depth<21
 ) select * from walk loop
 total:=total+1;n:=r.n;t:=n->>'type';a:=coalesce(n->'attrs','{}'::jsonb);
 if total>2000 or r.depth>20 or jsonb_typeof(n)<>'object' or t is null or n-array['type','attrs','content','marks','text']<>'{}'::jsonb or jsonb_typeof(a)<>'object' then return false; end if;
 if r.parent='' then if t<>'doc' then return false;end if;
 elsif r.parent='doc' then if t not in ('paragraph','heading','bulletList','orderedList') then return false;end if;
 elsif r.parent in ('paragraph','heading') then if t not in ('text','hardBreak') then return false;end if;
 elsif r.parent in ('bulletList','orderedList') then if t<>'listItem' then return false;end if;
 elsif r.parent='listItem' then if (r.idx=1 and t<>'paragraph') or (r.idx>1 and t not in ('paragraph','heading','bulletList','orderedList')) then return false;end if;
 else return false;end if;
 if a-(case when t='heading' then array['level','textAlign'] when t='paragraph' then array['textAlign'] when t='orderedList' then array['start','type'] else array[]::text[] end)<>'{}'::jsonb then return false;end if;
 if a ? 'textAlign' and a->'textAlign'<>'null'::jsonb and (jsonb_typeof(a->'textAlign')<>'string' or a->>'textAlign' not in ('left','center','right','justify')) then return false;end if;
 if t='heading' and (jsonb_typeof(a->'level') is distinct from 'number' or a->>'level' not in ('1','2','3','4','5','6')) then return false;end if;
 if t='orderedList' and ((a ? 'start' and (jsonb_typeof(a->'start')<>'number' or (a->>'start') !~ '^[0-9]+$' or (a->>'start')::numeric not between 1 and 10000)) or (a ? 'type' and a->'type'<>'null'::jsonb and a->'type'<>'"1"'::jsonb)) then return false;end if;
 if t='text' then if jsonb_typeof(n->'text') is distinct from 'string' or length(n->>'text') not between 1 and 10000 or n ? 'content' then return false;end if;
 elsif n ? 'text' then return false;end if;
 if n ? 'marks' then
 if t<>'text' or jsonb_typeof(n->'marks')<>'array' or jsonb_array_length(n->'marks')>6 then return false;end if;
 seen:=array[]::text[];
 for m in select value from jsonb_array_elements(n->'marks') loop
 ma:=coalesce(m->'attrs','{}'::jsonb);
 if jsonb_typeof(m)<>'object' or m-array['type','attrs']<>'{}'::jsonb or m->>'type' is null or m->>'type' not in ('bold','italic','underline','strike','highlight','textStyle') or m->>'type'=any(seen) or jsonb_typeof(ma)<>'object' then return false;end if;
 seen:=array_append(seen,m->>'type');
 if ma-(case when m->>'type'='textStyle' then array['color'] else array[]::text[] end)<>'{}'::jsonb then return false;end if;
 if ma ? 'color' and ma->'color'<>'null'::jsonb and (jsonb_typeof(ma->'color')<>'string' or lower(ma->>'color') not in ('#1c2845','#377f7c','#c78087','#000000')) then return false;end if;
 end loop;end if;
 if t in ('text','hardBreak') then if n ? 'content' then return false;end if;
 elsif n ? 'content' then if jsonb_typeof(n->'content')<>'array' or (t in ('listItem','bulletList','orderedList') and jsonb_array_length(n->'content')=0) then return false;end if;
 elsif t not in ('doc','paragraph','heading') then return false;end if;
 end loop;return true;
exception when others then return false;
end $function$;

alter table "public"."admin_users" add constraint "admin_users_pkey" PRIMARY KEY (user_id);

alter table "public"."editor_add_operations" add constraint "editor_add_operations_email_check" CHECK (email = lower(btrim(email)) AND length(email) <= 254);

alter table "public"."editor_add_operations" add constraint "editor_add_operations_pkey" PRIMARY KEY (email);

alter table "public"."editor_add_operations" add constraint "editor_add_operations_state_check" CHECK (state = ANY (ARRAY['sending'::text, 'granting'::text, 'granted'::text, 'grant_failed'::text, 'delivery_unknown'::text, 'revoked'::text]));

alter table "public"."editor_users" add constraint "editor_users_pkey" PRIMARY KEY (user_id);

alter table "public"."event_agenda_items" add constraint "agenda_end_time_valid" CHECK (end_time IS NULL OR end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text AND end_time > "time");

alter table "public"."event_agenda_items" add constraint "agenda_icon_valid" CHECK (icon = ANY (ARRAY['welcome'::text, 'speech'::text, 'book'::text, 'chat'::text, 'music'::text, 'gift'::text, 'summary'::text, 'camera'::text, 'finish'::text, 'users'::text, 'mic'::text, 'film'::text, 'award'::text, 'sparkles'::text, 'book-open'::text, 'trophy'::text, 'heart-handshake'::text]));

alter table "public"."event_agenda_items" add constraint "event_agenda_items_description_check" CHECK (length(btrim(description)) >= 1 AND length(btrim(description)) <= 1000);

alter table "public"."event_agenda_items" add constraint "event_agenda_items_event_id_sort_order_key" UNIQUE (event_id, sort_order);

alter table "public"."event_agenda_items" add constraint "event_agenda_items_pkey" PRIMARY KEY (id);

alter table "public"."event_agenda_items" add constraint "event_agenda_items_sort_order_check" CHECK (sort_order >= 0);

alter table "public"."event_agenda_items" add constraint "event_agenda_items_time_check" CHECK ("time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text);

alter table "public"."event_guests" add constraint "event_guests_event_id_guest_id_key" UNIQUE (event_id, guest_id);

alter table "public"."event_guests" add constraint "event_guests_id_event_id_key" UNIQUE (id, event_id);

alter table "public"."event_guests" add constraint "event_guests_kind_check" CHECK (kind = ANY (ARRAY['individual'::text, 'group'::text]));

alter table "public"."event_guests" add constraint "event_guests_pkey" PRIMARY KEY (id);

alter table "public"."event_guests" add constraint "event_guests_primary_alias_check" CHECK (length(primary_alias) >= 1 AND length(primary_alias) <= 80 AND primary_alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text);

alter table "public"."events" add constraint "events_address_check" CHECK (length(address) <= 1000);

alter table "public"."events" add constraint "events_check2" CHECK ((latitude IS NULL) = (longitude IS NULL));

alter table "public"."events" add constraint "events_code_check" CHECK (length(code) >= 1 AND length(code) <= 80 AND code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text AND (code <> ALL (ARRAY['admin'::text, 'auth'::text, 'assets'::text, '404'::text, 'index'::text, 'login'::text, 'new'::text, 'edit'::text])));

alter table "public"."events" add constraint "events_code_key" UNIQUE (code);

alter table "public"."events" add constraint "events_description_check" CHECK (length(description) <= 10000);

alter table "public"."events" add constraint "events_description_rich_valid" CHECK (valid_quote_document(description_rich));

alter table "public"."events" add constraint "events_directions_check" CHECK (length(directions) <= 3000);

alter table "public"."events" add constraint "events_event_type_check" CHECK (event_type = ANY (ARRAY['invitation'::text, 'congratulation'::text]));

alter table "public"."events" add constraint "events_invitation_location" CHECK (event_type = 'congratulation'::text OR location_method = 'url'::text AND maps_url <> ''::text OR location_method = 'place'::text AND place_id ~ '^[A-Za-z0-9_-]{5,255}$'::text);

alter table "public"."events" add constraint "events_invitation_time" CHECK (event_type = 'congratulation'::text OR starts_at IS NOT NULL AND ends_at IS NOT NULL AND isfinite(starts_at) AND isfinite(ends_at) AND ends_at > starts_at);

alter table "public"."events" add constraint "events_latitude_check" CHECK (latitude >= '-90'::integer::double precision AND latitude <= 90::double precision);

alter table "public"."events" add constraint "events_location_method_check" CHECK (location_method = ANY (ARRAY['url'::text, 'place'::text]));

alter table "public"."events" add constraint "events_longitude_check" CHECK (longitude >= '-180'::integer::double precision AND longitude <= 180::double precision);

alter table "public"."events" add constraint "events_maps_url_check" CHECK (maps_url = ''::text OR maps_url ~ '^https://([a-zA-Z0-9-]+\.)*(google\.com|maps\.app\.goo\.gl|goo\.gl)(/|$)'::text);

alter table "public"."events" add constraint "events_music_path_check" CHECK (music_path IS NULL OR length(music_path) <= 500 AND music_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+[.]mp3$'::text);

alter table "public"."events" add constraint "events_pkey" PRIMARY KEY (id);

alter table "public"."events" add constraint "events_quote_one_check" CHECK (length(quote_one) <= 5000);

alter table "public"."events" add constraint "events_quote_two_valid" CHECK (valid_quote_document(quote_two));

alter table "public"."events" add constraint "events_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text]));

alter table "public"."events" add constraint "events_theme_check" CHECK (valid_event_theme(theme));

alter table "public"."events" add constraint "events_title_check" CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 240);

alter table "public"."events" add constraint "events_v3_reserved_code" CHECK (code <> ALL (ARRAY['thiep-moi'::text, 'thiep-chuc'::text]));

alter table "public"."events" add constraint "events_venue_name_check" CHECK (length(venue_name) <= 240);

alter table "public"."events" add constraint "events_youtube_url_valid" CHECK (youtube_url IS NULL OR youtube_url ~ '^https://www[.]youtube[.]com/watch[?]v=[A-Za-z0-9_-]{11}$'::text);

alter table "public"."guests" add constraint "guests_description_check" CHECK (length(description) <= 3000);

alter table "public"."guests" add constraint "guests_display_order_unique" UNIQUE (display_order) DEFERRABLE INITIALLY DEFERRED;

alter table "public"."guests" add constraint "guests_kind_check" CHECK (kind = ANY (ARRAY['individual'::text, 'group'::text]));

alter table "public"."guests" add constraint "guests_name_check" CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 240);

alter table "public"."guests" add constraint "guests_pkey" PRIMARY KEY (id);

alter table "public"."guests" add constraint "guests_primary_alias_check" CHECK (length(primary_alias) >= 1 AND length(primary_alias) <= 80 AND primary_alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text);

alter table "public"."guests" add constraint "guests_primary_alias_key" UNIQUE (primary_alias);

alter table "public"."guests" add constraint "guests_salutation_check" CHECK (length(salutation) <= 80);

alter table "public"."invitation_aliases" add constraint "invitation_aliases_alias_check" CHECK (length(alias) >= 1 AND length(alias) <= 80 AND alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text);

alter table "public"."invitation_aliases" add constraint "invitation_aliases_event_guest_id_alias_key" UNIQUE (event_guest_id, alias);

alter table "public"."invitation_aliases" add constraint "invitation_aliases_event_id_alias_key" UNIQUE (event_id, alias);

alter table "public"."invitation_aliases" add constraint "invitation_aliases_pkey" PRIMARY KEY (id);

alter table "public"."music_uploads" add constraint "music_uploads_pkey" PRIMARY KEY (path);

alter table "public"."venue_image_uploads" add constraint "venue_image_uploads_path_check" CHECK (path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp)$'::text);

alter table "public"."venue_image_uploads" add constraint "venue_image_uploads_pkey" PRIMARY KEY (path);

alter table "public"."admin_users" add constraint "admin_users_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."editor_add_operations" add constraint "editor_add_operations_target_fkey" FOREIGN KEY (target) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table "public"."editor_users" add constraint "editor_users_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."event_agenda_items" add constraint "event_agenda_items_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

alter table "public"."event_guests" add constraint "event_guests_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

alter table "public"."event_guests" add constraint "event_guests_guest_id_fkey" FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE RESTRICT;

alter table "public"."event_guests" add constraint "primary_alias_exists" FOREIGN KEY (id, primary_alias) REFERENCES invitation_aliases(event_guest_id, alias) DEFERRABLE INITIALLY DEFERRED;

alter table "public"."events" add constraint "event_image_registered" FOREIGN KEY (venue_image_path) REFERENCES venue_image_uploads(path) ON DELETE RESTRICT;

alter table "public"."invitation_aliases" add constraint "invitation_aliases_event_guest_id_event_id_fkey" FOREIGN KEY (event_guest_id, event_id) REFERENCES event_guests(id, event_id) ON DELETE CASCADE;

alter table "public"."music_uploads" add constraint "music_uploads_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table "public"."venue_image_uploads" add constraint "venue_image_uploads_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

CREATE INDEX event_agenda_event ON public.event_agenda_items USING btree (event_id);

CREATE INDEX event_guests_guest ON public.event_guests USING btree (guest_id);

CREATE INDEX events_public_time ON public.events USING btree (starts_at, ends_at) WHERE (status = 'published'::text);

CREATE INDEX invitation_aliases_invitation ON public.invitation_aliases USING btree (event_guest_id);

alter table "public"."admin_users" enable row level security;

alter table "public"."editor_add_operations" enable row level security;

alter table "public"."editor_users" enable row level security;

alter table "public"."event_agenda_items" enable row level security;

alter table "public"."event_guests" enable row level security;

alter table "public"."events" enable row level security;

alter table "public"."guests" enable row level security;

alter table "public"."invitation_aliases" enable row level security;

alter table "public"."music_uploads" enable row level security;

alter table "public"."venue_image_uploads" enable row level security;

create policy "admin_membership_read" on "public"."admin_users" as PERMISSIVE for SELECT to "authenticated" using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "agenda_admin" on "public"."event_agenda_items" as PERMISSIVE for ALL to "authenticated" using (can_edit_content()) with check (can_edit_content());

create policy "agenda_read" on "public"."event_agenda_items" as PERMISSIVE for SELECT to "anon","authenticated" using ((can_edit_content() OR (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = event_agenda_items.event_id) AND (e.status = 'published'::text))))));

create policy "admin_invitations" on "public"."event_guests" as PERMISSIVE for ALL to "authenticated" using (( SELECT can_edit_content() AS is_admin)) with check (( SELECT can_edit_content() AS is_admin));

create policy "admin_events_write" on "public"."events" as PERMISSIVE for ALL to "authenticated" using (( SELECT can_edit_content() AS is_admin)) with check (( SELECT can_edit_content() AS is_admin));

create policy "published_events" on "public"."events" as PERMISSIVE for SELECT to "anon","authenticated" using (((status = 'published'::text) OR ( SELECT can_edit_content() AS is_admin)));

create policy "admin_guests" on "public"."guests" as PERMISSIVE for ALL to "authenticated" using (( SELECT can_edit_content() AS is_admin)) with check (( SELECT can_edit_content() AS is_admin));

create policy "admin_aliases" on "public"."invitation_aliases" as PERMISSIVE for ALL to "authenticated" using (( SELECT can_edit_content() AS is_admin)) with check (( SELECT can_edit_content() AS is_admin));

create policy "music_registry_delete" on "public"."music_uploads" as PERMISSIVE for DELETE to "authenticated" using ((can_edit_content() AND (NOT (EXISTS ( SELECT 1
   FROM events e
  WHERE (e.music_path = music_uploads.path)))) AND (NOT (EXISTS ( SELECT 1
   FROM storage.objects o
  WHERE ((o.bucket_id = 'bookclub-music'::text) AND (o.name = music_uploads.path)))))));

create policy "music_registry_insert" on "public"."music_uploads" as PERMISSIVE for INSERT to "authenticated" with check ((can_edit_content() AND (created_by = auth.uid()) AND (split_part(path, '/'::text, 1) = (auth.uid())::text) AND (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+[.]mp3$'::text)));

create policy "music_registry_read" on "public"."music_uploads" as PERMISSIVE for SELECT to "authenticated" using (can_edit_content());

create policy "image_registry_admin" on "public"."venue_image_uploads" as PERMISSIVE for ALL to "authenticated" using (can_edit_content()) with check ((can_edit_content() AND (created_by = auth.uid())));

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON event_agenda_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON event_guests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER events_music_reference BEFORE INSERT OR UPDATE OF music_path ON events FOR EACH ROW EXECUTE FUNCTION guard_music_reference();

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER guest_alias_v110 BEFORE INSERT OR UPDATE ON guests FOR EACH ROW EXECUTE FUNCTION guest_alias_v110();

CREATE TRIGGER guest_order_append BEFORE INSERT ON guests FOR EACH ROW EXECUTE FUNCTION guest_order_append();

CREATE TRIGGER guest_order_write_lock BEFORE INSERT OR DELETE OR UPDATE ON guests FOR EACH STATEMENT EXECUTE FUNCTION guest_order_write_lock();

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON guests FOR EACH ROW EXECUTE FUNCTION guest_order_timestamp();

CREATE TRIGGER primary_invitation_alias_only BEFORE INSERT OR UPDATE ON invitation_aliases FOR EACH ROW EXECUTE FUNCTION primary_invitation_alias_only();

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON invitation_aliases FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

revoke all on table "public"."admin_users" from public, anon, authenticated, service_role;

revoke all on table "public"."editor_add_operations" from public, anon, authenticated, service_role;

revoke all on table "public"."editor_users" from public, anon, authenticated, service_role;

revoke all on table "public"."event_agenda_items" from public, anon, authenticated, service_role;

revoke all on table "public"."event_guests" from public, anon, authenticated, service_role;

revoke all on table "public"."events" from public, anon, authenticated, service_role;

revoke all on table "public"."guests" from public, anon, authenticated, service_role;

revoke all on table "public"."invitation_aliases" from public, anon, authenticated, service_role;

revoke all on table "public"."music_uploads" from public, anon, authenticated, service_role;

revoke all on table "public"."venue_image_uploads" from public, anon, authenticated, service_role;

revoke all on function public.agenda_icon_capabilities() from public, anon, authenticated, service_role;

revoke all on function public.begin_editor_add(uuid,text,uuid,boolean) from public, anon, authenticated, service_role;

revoke all on function public.can_edit_content() from public, anon, authenticated, service_role;

revoke all on function public.editor_add_recovery() from public, anon, authenticated, service_role;

revoke all on function public.effective_role() from public, anon, authenticated, service_role;

revoke all on function public.event_payload_v110(events) from public, anon, authenticated, service_role;

revoke all on function public.finish_editor_add(uuid,text,uuid,uuid) from public, anon, authenticated, service_role;

revoke all on function public.get_event_v110(text) from public, anon, authenticated, service_role;

revoke all on function public.guard_music_delete() from public, anon, authenticated, service_role;

revoke all on function public.guard_music_reference() from public, anon, authenticated, service_role;

revoke all on function public.guest_alias_v110() from public, anon, authenticated, service_role;

revoke all on function public.guest_order_append() from public, anon, authenticated, service_role;

revoke all on function public.guest_order_available() from public, anon, authenticated, service_role;

revoke all on function public.guest_order_timestamp() from public, anon, authenticated, service_role;

revoke all on function public.guest_order_write_lock() from public, anon, authenticated, service_role;

revoke all on function public.guest_slug_v110(text) from public, anon, authenticated, service_role;

revoke all on function public.hsv_v3_capabilities() from public, anon, authenticated, service_role;

revoke all on function public.is_admin() from public, anon, authenticated, service_role;

revoke all on function public.primary_invitation_alias_only() from public, anon, authenticated, service_role;

revoke all on function public.reorder_guests(uuid[],uuid[]) from public, anon, authenticated, service_role;

revoke all on function public.resolve_invitation(text,text) from public, anon, authenticated, service_role;

revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;

revoke all on function public.role_directory() from public, anon, authenticated, service_role;

revoke all on function public.save_event(jsonb,uuid[],uuid,timestamp with time zone) from public, anon, authenticated, service_role;

revoke all on function public.set_editor_role(uuid,uuid,boolean) from public, anon, authenticated, service_role;

revoke all on function public.slug_v110(text) from public, anon, authenticated, service_role;

revoke all on function public.touch_updated_at() from public, anon, authenticated, service_role;

revoke all on function public.unused_music() from public, anon, authenticated, service_role;

revoke all on function public.unused_venue_images() from public, anon, authenticated, service_role;

revoke all on function public.valid_event_theme(jsonb) from public, anon, authenticated, service_role;

revoke all on function public.valid_quote_document(jsonb) from public, anon, authenticated, service_role;
grant SELECT on table "public"."admin_users" to "authenticated";
grant DELETE on table "public"."admin_users" to "service_role";
grant INSERT on table "public"."admin_users" to "service_role";
grant MAINTAIN on table "public"."admin_users" to "service_role";
grant REFERENCES on table "public"."admin_users" to "service_role";
grant SELECT on table "public"."admin_users" to "service_role";
grant TRIGGER on table "public"."admin_users" to "service_role";
grant TRUNCATE on table "public"."admin_users" to "service_role";
grant UPDATE on table "public"."admin_users" to "service_role";
grant DELETE on table "public"."editor_users" to "service_role";
grant INSERT on table "public"."editor_users" to "service_role";
grant MAINTAIN on table "public"."editor_users" to "service_role";
grant REFERENCES on table "public"."editor_users" to "service_role";
grant SELECT on table "public"."editor_users" to "service_role";
grant TRIGGER on table "public"."editor_users" to "service_role";
grant TRUNCATE on table "public"."editor_users" to "service_role";
grant UPDATE on table "public"."editor_users" to "service_role";
grant SELECT on table "public"."event_agenda_items" to "anon";
grant DELETE on table "public"."event_agenda_items" to "authenticated";
grant INSERT on table "public"."event_agenda_items" to "authenticated";
grant SELECT on table "public"."event_agenda_items" to "authenticated";
grant UPDATE on table "public"."event_agenda_items" to "authenticated";
grant DELETE on table "public"."event_agenda_items" to "service_role";
grant INSERT on table "public"."event_agenda_items" to "service_role";
grant MAINTAIN on table "public"."event_agenda_items" to "service_role";
grant REFERENCES on table "public"."event_agenda_items" to "service_role";
grant SELECT on table "public"."event_agenda_items" to "service_role";
grant TRIGGER on table "public"."event_agenda_items" to "service_role";
grant TRUNCATE on table "public"."event_agenda_items" to "service_role";
grant UPDATE on table "public"."event_agenda_items" to "service_role";
grant DELETE on table "public"."event_guests" to "authenticated";
grant INSERT on table "public"."event_guests" to "authenticated";
grant SELECT on table "public"."event_guests" to "authenticated";
grant UPDATE on table "public"."event_guests" to "authenticated";
grant DELETE on table "public"."event_guests" to "service_role";
grant INSERT on table "public"."event_guests" to "service_role";
grant MAINTAIN on table "public"."event_guests" to "service_role";
grant REFERENCES on table "public"."event_guests" to "service_role";
grant SELECT on table "public"."event_guests" to "service_role";
grant TRIGGER on table "public"."event_guests" to "service_role";
grant TRUNCATE on table "public"."event_guests" to "service_role";
grant UPDATE on table "public"."event_guests" to "service_role";
grant SELECT on table "public"."events" to "anon";
grant DELETE on table "public"."events" to "authenticated";
grant INSERT on table "public"."events" to "authenticated";
grant SELECT on table "public"."events" to "authenticated";
grant UPDATE on table "public"."events" to "authenticated";
grant DELETE on table "public"."events" to "service_role";
grant INSERT on table "public"."events" to "service_role";
grant MAINTAIN on table "public"."events" to "service_role";
grant REFERENCES on table "public"."events" to "service_role";
grant SELECT on table "public"."events" to "service_role";
grant TRIGGER on table "public"."events" to "service_role";
grant TRUNCATE on table "public"."events" to "service_role";
grant UPDATE on table "public"."events" to "service_role";
grant DELETE on table "public"."guests" to "authenticated";
grant INSERT on table "public"."guests" to "authenticated";
grant SELECT on table "public"."guests" to "authenticated";
grant UPDATE on table "public"."guests" to "authenticated";
grant DELETE on table "public"."guests" to "service_role";
grant INSERT on table "public"."guests" to "service_role";
grant MAINTAIN on table "public"."guests" to "service_role";
grant REFERENCES on table "public"."guests" to "service_role";
grant SELECT on table "public"."guests" to "service_role";
grant TRIGGER on table "public"."guests" to "service_role";
grant TRUNCATE on table "public"."guests" to "service_role";
grant UPDATE on table "public"."guests" to "service_role";
grant SELECT on table "public"."invitation_aliases" to "authenticated";
grant DELETE on table "public"."invitation_aliases" to "service_role";
grant INSERT on table "public"."invitation_aliases" to "service_role";
grant MAINTAIN on table "public"."invitation_aliases" to "service_role";
grant REFERENCES on table "public"."invitation_aliases" to "service_role";
grant SELECT on table "public"."invitation_aliases" to "service_role";
grant TRIGGER on table "public"."invitation_aliases" to "service_role";
grant TRUNCATE on table "public"."invitation_aliases" to "service_role";
grant UPDATE on table "public"."invitation_aliases" to "service_role";
grant DELETE on table "public"."music_uploads" to "authenticated";
grant INSERT on table "public"."music_uploads" to "authenticated";
grant SELECT on table "public"."music_uploads" to "authenticated";
grant DELETE on table "public"."music_uploads" to "service_role";
grant INSERT on table "public"."music_uploads" to "service_role";
grant MAINTAIN on table "public"."music_uploads" to "service_role";
grant REFERENCES on table "public"."music_uploads" to "service_role";
grant SELECT on table "public"."music_uploads" to "service_role";
grant TRIGGER on table "public"."music_uploads" to "service_role";
grant TRUNCATE on table "public"."music_uploads" to "service_role";
grant UPDATE on table "public"."music_uploads" to "service_role";
grant DELETE on table "public"."venue_image_uploads" to "authenticated";
grant INSERT on table "public"."venue_image_uploads" to "authenticated";
grant SELECT on table "public"."venue_image_uploads" to "authenticated";
grant DELETE on table "public"."venue_image_uploads" to "service_role";
grant INSERT on table "public"."venue_image_uploads" to "service_role";
grant MAINTAIN on table "public"."venue_image_uploads" to "service_role";
grant REFERENCES on table "public"."venue_image_uploads" to "service_role";
grant SELECT on table "public"."venue_image_uploads" to "service_role";
grant TRIGGER on table "public"."venue_image_uploads" to "service_role";
grant TRUNCATE on table "public"."venue_image_uploads" to "service_role";
grant UPDATE on table "public"."venue_image_uploads" to "service_role";
grant EXECUTE on function public.agenda_icon_capabilities() to "authenticated";
grant EXECUTE on function public.agenda_icon_capabilities() to "service_role";
grant EXECUTE on function public.begin_editor_add(uuid,text,uuid,boolean) to "service_role";
grant EXECUTE on function public.can_edit_content() to "anon";
grant EXECUTE on function public.can_edit_content() to "authenticated";
grant EXECUTE on function public.can_edit_content() to "service_role";
grant EXECUTE on function public.editor_add_recovery() to "authenticated";
grant EXECUTE on function public.editor_add_recovery() to "service_role";
grant EXECUTE on function public.effective_role() to "authenticated";
grant EXECUTE on function public.effective_role() to "service_role";
grant EXECUTE on function public.event_payload_v110(events) to "service_role";
grant EXECUTE on function public.finish_editor_add(uuid,text,uuid,uuid) to "service_role";
grant EXECUTE on function public.get_event_v110(text) to "anon";
grant EXECUTE on function public.get_event_v110(text) to "authenticated";
grant EXECUTE on function public.get_event_v110(text) to "service_role";
grant EXECUTE on function public.guard_music_delete() to "service_role";
grant EXECUTE on function public.guard_music_reference() to "service_role";
grant EXECUTE on function public.guest_alias_v110() to "service_role";
grant EXECUTE on function public.guest_order_append() to "service_role";
grant EXECUTE on function public.guest_order_available() to "authenticated";
grant EXECUTE on function public.guest_order_available() to "service_role";
grant EXECUTE on function public.guest_order_timestamp() to "service_role";
grant EXECUTE on function public.guest_order_write_lock() to "service_role";
grant EXECUTE on function public.guest_slug_v110(text) to PUBLIC;
grant EXECUTE on function public.guest_slug_v110(text) to "anon";
grant EXECUTE on function public.guest_slug_v110(text) to "authenticated";
grant EXECUTE on function public.guest_slug_v110(text) to "service_role";
grant EXECUTE on function public.hsv_v3_capabilities() to "anon";
grant EXECUTE on function public.hsv_v3_capabilities() to "authenticated";
grant EXECUTE on function public.hsv_v3_capabilities() to "service_role";
grant EXECUTE on function public.is_admin() to "anon";
grant EXECUTE on function public.is_admin() to "authenticated";
grant EXECUTE on function public.is_admin() to "service_role";
grant EXECUTE on function public.primary_invitation_alias_only() to "service_role";
grant EXECUTE on function public.reorder_guests(uuid[],uuid[]) to "authenticated";
grant EXECUTE on function public.reorder_guests(uuid[],uuid[]) to "service_role";
grant EXECUTE on function public.resolve_invitation(text,text) to "anon";
grant EXECUTE on function public.resolve_invitation(text,text) to "authenticated";
grant EXECUTE on function public.resolve_invitation(text,text) to "service_role";
grant EXECUTE on function public.rls_auto_enable() to PUBLIC;
grant EXECUTE on function public.rls_auto_enable() to "anon";
grant EXECUTE on function public.rls_auto_enable() to "authenticated";
grant EXECUTE on function public.rls_auto_enable() to "service_role";
grant EXECUTE on function public.role_directory() to "authenticated";
grant EXECUTE on function public.role_directory() to "service_role";
grant EXECUTE on function public.save_event(jsonb,uuid[],uuid,timestamp with time zone) to "authenticated";
grant EXECUTE on function public.save_event(jsonb,uuid[],uuid,timestamp with time zone) to "service_role";
grant EXECUTE on function public.set_editor_role(uuid,uuid,boolean) to "service_role";
grant EXECUTE on function public.slug_v110(text) to PUBLIC;
grant EXECUTE on function public.slug_v110(text) to "anon";
grant EXECUTE on function public.slug_v110(text) to "authenticated";
grant EXECUTE on function public.slug_v110(text) to "service_role";
grant EXECUTE on function public.touch_updated_at() to "service_role";
grant EXECUTE on function public.unused_music() to "authenticated";
grant EXECUTE on function public.unused_music() to "service_role";
grant EXECUTE on function public.unused_venue_images() to "anon";
grant EXECUTE on function public.unused_venue_images() to "authenticated";
grant EXECUTE on function public.unused_venue_images() to "service_role";
grant EXECUTE on function public.valid_event_theme(jsonb) to "anon";
grant EXECUTE on function public.valid_event_theme(jsonb) to "authenticated";
grant EXECUTE on function public.valid_event_theme(jsonb) to "service_role";
grant EXECUTE on function public.valid_quote_document(jsonb) to "authenticated";
grant EXECUTE on function public.valid_quote_document(jsonb) to "service_role";

commit;
-- Platform-owned schemas, storage policies, event triggers and default ACL remain in schema.json/grants.json for comparison.

