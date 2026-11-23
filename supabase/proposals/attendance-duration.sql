-- Review artifact only; additive upgrade after attendance.sql, never replay the base schema.
-- Requires explicit schema approval before promotion through the migration workflow.
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regprocedure('attendance_private.round_at(public.events,timestamptz)') is null then
    raise exception 'Attendance prerequisites missing';
  end if;
  if to_regprocedure('attendance_private.duration(jsonb)') is not null then
    raise exception 'Attendance duration already applied; do not replay';
  end if;
end $$;

create function attendance_private.duration(config jsonb) returns interval
language sql immutable set search_path='' as $$
  select coalesce((config->>'duration_minutes')::integer,15) * interval '1 minute'
$$;
revoke all on function attendance_private.duration(jsonb) from public,anon,authenticated;

do $$
declare original text; changed text; signature text;
begin
  original := pg_get_functiondef('attendance_private.validate_event()'::regprocedure);
  if position('a+interval ''15 minutes''>b' in original) = 0
    or position('''round_one'',''round_two''] <> ' in original) = 0 then
    raise exception 'Unexpected attendance validator baseline';
  end if;
  changed := replace(original, '''round_one'',''round_two''] <> ', '''round_one'',''round_two'',''duration_minutes''] <> ');
  changed := replace(changed, 'if c is null then return new; end if;', $patch$
    if c is null then return new; end if;
    if c ? 'duration_minutes' and (
      jsonb_typeof(c->'duration_minutes') is distinct from 'number'
      or (c->>'duration_minutes')::numeric not between 1 and 60
      or (c->>'duration_minutes')::numeric <> trunc((c->>'duration_minutes')::numeric)
    ) then
      raise exception 'Thời lượng mỗi đợt phải là số nguyên từ 1 đến 60 phút.' using errcode='23514';
    end if;
  $patch$);
  changed := replace(changed, 'interval ''15 minutes''', 'attendance_private.duration(c)');
  changed := replace(changed, 'Hai đợt phải dài 15 phút, không chồng nhau và nằm trong thời gian sự kiện.', 'Hai đợt không được chồng nhau và phải nằm trong thời gian sự kiện.');
  if position('Thời lượng mỗi đợt' in changed) = 0 then raise exception 'Duration validation patch failed'; end if;
  execute changed;

  foreach signature in array array[
    'attendance_private.round_at(public.events,timestamptz)',
    'public.attendance_status(text,text)',
    'public.attendance_display(text)'
  ] loop
    original := pg_get_functiondef(signature::regprocedure);
    if position('interval ''15 minutes''' in original) = 0 then
      raise exception 'Unexpected attendance time baseline: %', signature;
    end if;
    changed := replace(original, 'interval ''15 minutes''', 'attendance_private.duration(e.attendance_config)');
    execute changed;
  end loop;
end $$;
create or replace function public.attendance_capabilities() returns jsonb
language sql immutable set search_path='' as $$select '{"version":1,"duration_minutes":true}'::jsonb$$;
commit;
