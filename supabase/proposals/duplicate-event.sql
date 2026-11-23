-- Historical proposal. Superseded by ../releases/hsv4/03-duplicate-event.sql.
-- Do not execute this copy; applied versions are recorded in ../releases/hsv4/manifest.json.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regprocedure('public.can_edit_content()') is null
    or to_regprocedure('public.hsv_v3_capabilities()') is null then
    raise exception 'HSV v3 prerequisites missing';
  end if;
  if to_regprocedure('public.duplicate_event(uuid,uuid)') is not null then
    raise exception 'Duplication already applied; do not replay';
  end if;
end $$;

alter table public.events add column duplicated_from_id uuid
  references public.events(id) on delete set null;
create index events_duplicated_from on public.events(duplicated_from_id)
  where duplicated_from_id is not null;

create function public.duplicate_event(p_source_id uuid, p_copy_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  source public.events;
  copied public.events;
  recipient public.event_guests;
  source_data jsonb;
  copy_data jsonb;
  candidate text;
  suffix text;
  sequence integer := 1;
  reserved boolean;
  recipient_id uuid;
  default_id uuid;
begin
  if not coalesce(public.can_edit_content(), false) then
    raise exception 'Content access required' using errcode = '42501';
  end if;
  if p_source_id is null or p_copy_id is null or p_source_id = p_copy_id then
    raise exception 'Invalid duplication request' using errcode = '22023';
  end if;

  -- save_event locks the source before reserving its code; use the same order.
  select * into source from public.events where id = p_source_id for share;
  if not found then raise exception 'Source event not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(110110);
  select * into copied from public.events where id = p_copy_id;
  if found then
    if copied.duplicated_from_id is distinct from p_source_id then
      raise exception 'Invalid duplication request' using errcode = '22023';
    end if;
    return public.event_payload_v110(copied);
  end if;

  loop
    suffix := '-copy' || case when sequence = 1 then '' else '-' || sequence::text end;
    candidate := rtrim(left(source.code, 80 - length(suffix)), '-') || suffix;
    reserved := exists(select 1 from public.events where code = candidate);
    -- Some installations retain historical event codes; never reuse those links.
    if not reserved and to_regclass('public.event_codes') is not null then
      execute 'select exists(select 1 from public.event_codes where code = $1)'
        into reserved using candidate;
    end if;
    exit when not reserved;
    sequence := sequence + 1;
    if sequence > 10000 then raise exception 'Không còn mã bản sao phù hợp.'; end if;
  end loop;

  source_data := to_jsonb(source);
  copy_data := source_data || jsonb_build_object(
    'id', p_copy_id, 'code', candidate, 'duplicated_from_id', source.id,
    'created_at', clock_timestamp(), 'updated_at', clock_timestamp(),
    'default_invitation_id', null
  );
  insert into public.events select (jsonb_populate_record(null::public.events, copy_data)).*
    returning * into copied;

  for recipient in select * from public.event_guests where event_id = source.id
    order by created_at, id for share loop
    recipient_id := gen_random_uuid();
    insert into public.event_guests
      select (jsonb_populate_record(null::public.event_guests, to_jsonb(recipient) ||
        jsonb_build_object('id', recipient_id, 'event_id', copied.id,
          'created_at', clock_timestamp(), 'updated_at', clock_timestamp()))).*;
    -- Only the snapshot primary alias is currently routable; the directory may have changed.
    insert into public.invitation_aliases(event_id, event_guest_id, alias)
      values(copied.id, recipient_id, recipient.primary_alias);
    if recipient.id::text = source_data->>'default_invitation_id' then
      default_id := recipient_id;
    end if;
  end loop;

  insert into public.event_agenda_items
    select (jsonb_populate_record(null::public.event_agenda_items, to_jsonb(item) ||
      jsonb_build_object('id', gen_random_uuid(), 'event_id', copied.id,
        'created_at', clock_timestamp(), 'updated_at', clock_timestamp()))).*
    from public.event_agenda_items item where item.event_id = source.id;
  if source_data ? 'default_invitation_id' then
    execute 'update public.events set default_invitation_id = $1 where id = $2'
      using default_id, copied.id;
  end if;

  -- Content, media references, publication and attendance configuration are copied.
  -- Attendance records, browser bindings, issued QR tokens and edit history belong to their event.
  select * into copied from public.events where id = copied.id;
  return public.event_payload_v110(copied);
end $$;
revoke all on function public.duplicate_event(uuid,uuid) from public, anon;
grant execute on function public.duplicate_event(uuid,uuid) to authenticated;
commit;
