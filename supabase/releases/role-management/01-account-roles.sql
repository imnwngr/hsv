begin;
set local lock_timeout = '5s';

alter table public.editor_add_operations add column requested_role text not null default 'editor'
  check (requested_role in ('admin','editor'));

-- All role writers share this lock, including legacy Editor APIs.
create function public.set_account_role(p_actor uuid,p_target uuid,p_role text,p_expected_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing_role text;
begin
  perform pg_advisory_xact_lock(194827,112);
  lock table public.admin_users in share row exclusive mode;
  if not exists(select 1 from public.admin_users a join auth.users u on u.id=a.user_id
    where a.user_id=p_actor and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if (p_role is not null and p_role not in ('admin','editor')) or p_expected_role is null or p_expected_role not in ('admin','editor') then
    raise exception 'Invalid role' using errcode='22023';
  end if;
  select case when exists(select 1 from public.admin_users where user_id=p_target) then 'admin'
    when exists(select 1 from public.editor_users where user_id=p_target) then 'editor' end into existing_role;
  if existing_role is distinct from p_expected_role then return jsonb_build_object('state','role_changed'); end if;
  if p_role is not null and not exists(select 1 from auth.users where id=p_target
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then
    return jsonb_build_object('state','account_ineligible');
  end if;
  if existing_role='admin' and p_role is distinct from 'admin' and not exists(
    select 1 from public.admin_users a join auth.users u on u.id=a.user_id where a.user_id<>p_target
    and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
  ) then return jsonb_build_object('state','last_admin'); end if;
  if p_role is not distinct from existing_role then return jsonb_build_object('state','unchanged','role',p_role); end if;
  if p_role='admin' then
    insert into public.admin_users(user_id) values(p_target) on conflict(user_id) do nothing;
    delete from public.editor_users where user_id=p_target;
  elsif p_role='editor' then
    insert into public.editor_users(user_id) values(p_target) on conflict(user_id) do nothing;
    delete from public.admin_users where user_id=p_target;
  else
    delete from public.admin_users where user_id=p_target;
    delete from public.editor_users where user_id=p_target;
  end if;
  update public.editor_add_operations set state='revoked',lease=null,lease_until=null,updated_at=clock_timestamp()
    where target=p_target or email in (select lower(email) from auth.users where id=p_target);
  return jsonb_build_object('state',case when p_role is null then 'revoked' else 'updated' end,'role',p_role);
end $$;

create function public.begin_account_add(p_actor uuid,p_email text,p_request_id uuid,p_allow_invite boolean,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare email_value text:=lower(btrim(p_email)); target_user auth.users; op public.editor_add_operations;
  token uuid:=gen_random_uuid(); existing_role text;
begin
  perform pg_advisory_xact_lock(194827,112);
  lock table public.admin_users in share row exclusive mode;
  if not exists(select 1 from public.admin_users a join auth.users u on u.id=a.user_id where a.user_id=p_actor
    and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if p_role is null or p_role not in ('admin','editor') or p_request_id is null or email_value is null
    or length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Invalid email/request/role' using errcode='22023';
  end if;
  if (select count(*) from auth.users where lower(email)=email_value)>1 then return jsonb_build_object('state','ambiguous_account'); end if;
  select * into target_user from auth.users where lower(email)=email_value;
  if target_user.id is not null and (coalesce(target_user.is_anonymous,false) or target_user.banned_until>now()) then
    return jsonb_build_object('state','account_ineligible');
  end if;
  select case when exists(select 1 from public.admin_users where user_id=target_user.id) then 'admin'
    when exists(select 1 from public.editor_users where user_id=target_user.id) then 'editor' end into existing_role;
  select * into op from public.editor_add_operations where email=email_value for update;
  if op.request_id=p_request_id and (op.requested_role<>p_role or op.state='revoked'
    or (op.state='granted' and existing_role is distinct from p_role)) then return jsonb_build_object('state','role_changed'); end if;
  if existing_role is not null then
    if existing_role<>p_role then return jsonb_build_object('state','role_conflict'); end if;
    return jsonb_build_object('state','already_'||existing_role,'role',existing_role,'account_status',
      case when target_user.email_confirmed_at is not null then 'confirmed' when target_user.invited_at is not null then 'invited' else 'unconfirmed' end);
  end if;
  if op.lease is not null and op.lease_until>now() then return jsonb_build_object('state','processing'); end if;
  -- Recovery must preserve the role originally chosen, even after a lost invitation response.
  if op.email is not null and op.state not in ('granted','revoked') and op.requested_role<>p_role then
    return jsonb_build_object('state','role_conflict');
  end if;
  if target_user.id is null and op.email is not null then
    update public.editor_add_operations set state='delivery_unknown',lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
    return jsonb_build_object('state','delivery_unknown');
  end if;
  if target_user.id is null and not coalesce(p_allow_invite,false) then return jsonb_build_object('state','invitation_not_ready'); end if;
  insert into public.editor_add_operations(email,actor,request_id,lease,lease_until,state,target,requested_role)
    values(email_value,p_actor,p_request_id,token,now()+interval '90 seconds',case when target_user.id is null then 'sending' else 'granting' end,target_user.id,p_role)
    on conflict(email) do update set actor=excluded.actor,request_id=excluded.request_id,lease=excluded.lease,
      lease_until=excluded.lease_until,state=excluded.state,target=excluded.target,requested_role=excluded.requested_role,updated_at=clock_timestamp();
  return jsonb_build_object('state',case when target_user.id is null then 'invite' else 'grant' end,'lease',token,'target',target_user.id,'role',p_role);
end $$;

create function public.finish_account_add(p_actor uuid,p_email text,p_lease uuid,p_target uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare email_value text:=lower(btrim(p_email)); op public.editor_add_operations; target_user auth.users; existing_role text;
begin
  perform pg_advisory_xact_lock(194827,112);
  lock table public.admin_users in share row exclusive mode;
  select * into op from public.editor_add_operations where email=email_value for update;
  if op.state='revoked' then return jsonb_build_object('state','role_changed'); end if;
  if op.email is null or op.lease is distinct from p_lease or op.lease is null or op.actor<>p_actor then return jsonb_build_object('state','processing'); end if;
  if not exists(select 1 from public.admin_users a join auth.users u on u.id=a.user_id where a.user_id=p_actor
    and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then
    update public.editor_add_operations set state='grant_failed',lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
    return jsonb_build_object('state','grant_failed');
  end if;
  if p_target is null then
    update public.editor_add_operations set state='delivery_unknown',lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
    return jsonb_build_object('state','delivery_unknown');
  end if;
  select * into target_user from auth.users where id=p_target and lower(email)=email_value;
  select case when exists(select 1 from public.admin_users where user_id=p_target) then 'admin'
    when exists(select 1 from public.editor_users where user_id=p_target) then 'editor' end into existing_role;
  if target_user.id is null or coalesce(target_user.is_anonymous,false) or target_user.banned_until>now()
    or (existing_role is not null and existing_role<>op.requested_role) then
    update public.editor_add_operations set state='grant_failed',lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
    return jsonb_build_object('state','grant_failed');
  end if;
  begin
    if op.requested_role='admin' then
      insert into public.admin_users(user_id) values(p_target) on conflict(user_id) do nothing;
    else
      insert into public.editor_users(user_id) values(p_target) on conflict(user_id) do nothing;
    end if;
    update public.editor_add_operations set state='granted',target=p_target,lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
  exception when others then
    update public.editor_add_operations set state='grant_failed',target=p_target,lease=null,lease_until=null,updated_at=clock_timestamp() where email=email_value;
    return jsonb_build_object('state','grant_failed');
  end;
  return jsonb_build_object('state','granted','role',op.requested_role,'account_status',
    case when target_user.email_confirmed_at is not null then 'confirmed' when target_user.invited_at is not null then 'invited' else 'unconfirmed' end);
end $$;

-- Old clients retain Editor-only behavior through the same coordination ledger.
create or replace function public.begin_editor_add(p_actor uuid,p_email text,p_request_id uuid,p_allow_invite boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.begin_account_add(p_actor,p_email,p_request_id,p_allow_invite,'editor');
  if result->>'state'='role_conflict' then return jsonb_build_object('state','admin_protected'); end if;
  return result-'role';
end $$;
create or replace function public.finish_editor_add(p_actor uuid,p_email text,p_lease uuid,p_target uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(194827,112);
  if exists(select 1 from public.editor_add_operations where email=lower(btrim(p_email)) and requested_role<>'editor') then
    return jsonb_build_object('state','role_changed');
  end if;
  return public.finish_account_add(p_actor,p_email,p_lease,p_target)-'role';
end $$;
create function public.account_add_recovery() returns table(email text,state text,updated_at timestamptz,requested_role text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  return query select o.email,o.state,o.updated_at,o.requested_role from public.editor_add_operations o
    where o.state not in ('granted','revoked') order by o.updated_at desc;
end $$;

revoke all on function public.set_account_role(uuid,uuid,text,text),public.begin_account_add(uuid,text,uuid,boolean,text),
  public.finish_account_add(uuid,text,uuid,uuid),public.account_add_recovery() from public,anon,authenticated;
grant execute on function public.set_account_role(uuid,uuid,text,text),public.begin_account_add(uuid,text,uuid,boolean,text),
  public.finish_account_add(uuid,text,uuid,uuid) to service_role;
grant execute on function public.account_add_recovery() to authenticated;
create function public.account_role_capabilities() returns jsonb language sql immutable set search_path='' as $$
  select '{"version":1,"admin_assignment":true,"last_admin_guard":true}'::jsonb
$$;
revoke all on function public.account_role_capabilities() from public;
grant execute on function public.account_role_capabilities() to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
