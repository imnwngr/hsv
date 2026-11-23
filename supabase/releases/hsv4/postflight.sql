-- Read-only: metadata, permissions and counts; no student or guest values.
select public.hsv_v3_capabilities() as hsv3, public.hsv4_capabilities() as hsv4;
select n.nspname as schema, c.relname as name, c.relrowsecurity as rls,
  has_table_privilege('anon',c.oid,'SELECT') as anon_select,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='attendance_private' and c.relkind='r' order by c.relname;
select has_schema_privilege('anon','attendance_private','USAGE') as anon_private_schema,
  has_schema_privilege('authenticated','attendance_private','USAGE') as authenticated_private_schema,
  has_function_privilege('anon','public.duplicate_event(uuid,uuid)','EXECUTE') as anon_duplicate,
  has_function_privilege('authenticated','public.duplicate_event(uuid,uuid)','EXECUTE') as authenticated_duplicate,
  has_function_privilege('anon','public.attendance_results(text)','EXECUTE') as anon_results,
  has_function_privilege('anon','public.attendance_display(text)','EXECUTE') as anon_display;
select count(*) as events, count(*) filter(where attendance_config is not null) as configured_events,
  count(*) filter(where default_invitation_id is not null) as default_cards,
  count(*) filter(where duplicated_from_id is not null) as copies from public.events;
select count(*) as attendance_records from attendance_private.records;
