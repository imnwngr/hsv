// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sql = (path: string) => readFileSync(path, "utf8");
const base = "supabase/releases/";
const pg = new PGlite();
const admin = "20000000-0000-4000-8000-000000000001";
it("pins the applied release SQL to its manifest and migration-history mirrors", () => {
  const manifest = JSON.parse(sql(base + "hsv4/manifest.json"));
  expect(manifest.status).toBe("applied");
  for (const step of manifest.steps) {
    const contents = sql(base + "hsv4/" + step.file).replaceAll("\r\n", "\n");
    expect(createHash("sha256").update(contents).digest("hex")).toBe(
      step.sha256,
    );
    expect(
      sql(base + "hsv4/" + step.migration_file).replaceAll("\r\n", "\n"),
    ).toBe(contents);
    expect(step.migration_version).toMatch(/^\d{14}$/);
    expect(step.status).toBe("applied");
  }
});
let original: Record<string, unknown>;
beforeAll(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,invited_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text);`);
  await pg.exec(sql(base + "hsv3-before-hsv4/restore-app-schema.sql"));
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'release@fixture.invalid',now())",
    [admin],
  );
  await pg.query("insert into public.admin_users(user_id) values($1)", [admin]);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin,
  ]);
  original = (
    await pg.query<{ e: Record<string, unknown> }>(
      "select public.save_event($1,'{}'::uuid[]) as e",
      [
        {
          code: "hsv4-release-test",
          title: "Synthetic release fixture",
          starts_at: "2099-01-01T01:00:00Z",
          ends_at: "2099-01-01T03:00:00Z",
          status: "draft",
          location_method: "url",
          maps_url: "https://www.google.com/maps?q=10,105",
        },
      ],
    )
  ).rows[0].e;
}, 30000);
afterAll(async () => {
  await pg.close();
});

it("restores captured application schema and upgrades it without changing existing content", async () => {
  const snapshot = JSON.parse(sql(base + "hsv3-before-hsv4/schema.json"));
  for (const name of ["save_event", "event_payload_v110"]) {
    const fn = snapshot.functions.find(
      (f: { name: string }) => f.name === name,
    );
    const actual = (
      await pg.query<{ definition: string }>(
        "select pg_get_functiondef($1::regprocedure) definition",
        [fn.signature],
      )
    ).rows[0].definition;
    expect(actual.replaceAll("\r\n", "\n")).toBe(
      fn.definition.replaceAll("\r\n", "\n"),
    );
  }
  for (const file of [
    "01-attendance.sql",
    "02-attendance-duration.sql",
    "03-duplicate-event.sql",
  ])
    await pg.exec(sql(base + "hsv4/" + file));
  const row = (
    await pg.query<{ e: Record<string, unknown> }>(
      "select public.event_payload_v110(e) as e from public.events e where id=$1",
      [original.id],
    )
  ).rows[0].e;
  for (const [key, value] of Object.entries(original))
    expect(row[key]).toEqual(value);
  expect(row.attendance_config).toBeNull();
  expect(row.default_invitation_id).toBeNull();
  expect(row.duplicated_from_id).toBeNull();
  expect(
    (await pg.query<{ c: unknown }>("select public.hsv4_capabilities() c"))
      .rows[0].c,
  ).toEqual({
    version: 4,
    duplicate_event: true,
    attendance: { version: 1, duration_minutes: true },
  });
});

it("keeps new admin RPCs private and allows authenticated ownership checks", async () => {
  const rights = (
    await pg.query<{ allowed: boolean[] }>(`select array[
    has_schema_privilege('anon','attendance_private','USAGE'),
    has_schema_privilege('authenticated','attendance_private','USAGE'),
    has_function_privilege('anon','public.duplicate_event(uuid,uuid)','EXECUTE'),
    has_function_privilege('anon','public.attendance_results(text)','EXECUTE'),
    has_function_privilege('authenticated','public.duplicate_event(uuid,uuid)','EXECUTE')
  ] allowed`)
  ).rows[0].allowed;
  expect(rights).toEqual([false, false, false, false, true]);
  await pg.exec("set role authenticated");
  const copy = (
    await pg.query<{ e: { code: string } }>(
      "select public.duplicate_event($1,gen_random_uuid()) as e",
      [original.id],
    )
  ).rows[0].e;
  expect(copy.code).toBe("hsv4-release-test-copy");
  await pg.query("select set_config('request.jwt.claim.sub','',false)");
  await expect(
    pg.query("select public.duplicate_event($1,gen_random_uuid())", [
      original.id,
    ]),
  ).rejects.toThrow("Content access required");
  await pg.exec("reset role");
});

it("rejects reapplying every step and restoring the baseline into an occupied database", async () => {
  for (const file of [
    "01-attendance.sql",
    "02-attendance-duration.sql",
    "03-duplicate-event.sql",
  ]) {
    await expect(pg.exec(sql(base + "hsv4/" + file))).rejects.toThrow(
      /already applied|Already applied/i,
    );
    await pg.exec("rollback");
  }
  await expect(
    pg.exec(sql(base + "hsv3-before-hsv4/restore-app-schema.sql")),
  ).rejects.toThrow("Restore requires an empty application schema");
  await pg.exec("rollback");
});
