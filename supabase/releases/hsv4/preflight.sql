-- Read-only. Save this result before applying any missing hsv4 step.
select current_setting('server_version') as postgres_version,
  public.hsv_v3_capabilities() as baseline_capability,
  to_regnamespace('attendance_private')::text as attendance_schema,
  to_regprocedure('attendance_private.duration(jsonb)')::text as duration_function,
  to_regprocedure('public.duplicate_event(uuid,uuid)')::text as duplication_function,
  to_regprocedure('public.hsv4_capabilities()')::text as release_capability,
  md5(pg_get_functiondef('public.save_event(jsonb,uuid[],uuid,timestamptz)'::regprocedure)) as save_event_hash,
  md5(pg_get_functiondef('public.event_payload_v110(public.events)'::regprocedure)) as event_payload_hash;

select version,name from supabase_migrations.schema_migrations order by version;

-- The first application must match hsv3-before-hsv4/schema.json.
-- A present object or recorded migration means inspect/skip that step, never replay it.
