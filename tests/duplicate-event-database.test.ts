// @vitest-environment node
import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { hsvBaseline, adminId, guestId, sqlFile } from "./helpers/hsvDatabase";
let pg: PGlite;
let sourceId: string;
const duplicate = async (source = sourceId, id = randomUUID()) =>
  (
    await pg.query<{ result: Record<string, unknown> }>(
      "select public.duplicate_event($1,$2) result",
      [source, id],
    )
  ).rows[0].result;
const content = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).filter(
      ([key]) =>
        ![
          "id",
          "event_id",
          "event_guest_id",
          "created_at",
          "updated_at",
          "code",
          "duplicated_from_id",
          "default_invitation_id",
        ].includes(key),
    ),
  );
beforeAll(async () => {
  const baseline = await hsvBaseline();
  pg = baseline.pg;
  sourceId = baseline.legacy.id;
  await pg.exec(
    sqlFile("supabase/migrations/202611200001_event_types_theme.sql"),
  );
  await pg.exec(sqlFile("supabase/proposals/duplicate-event.sql"));
  const music = `${adminId}/${randomUUID()}/fixture.mp3`;
  const venue = `${adminId}/${randomUUID()}.png`;
  await pg.query(
    "insert into venue_image_uploads(path,created_by) values($1,$2)",
    [venue, adminId],
  );
  await pg.query(
    "insert into storage.objects(id,bucket_id,name) values($1,'bookclub-music',$2)",
    [randomUUID(), music],
  );
  await pg.query(
    "update events set code='cuoc-thi-rung-chuong-vang',status='published',music_path=$1,venue_image_path=$5,theme=$2,quote_one='Lời mời gốc',description_rich=$3 where id=$4",
    [
      music,
      { version: 1, primary: "#873c42" },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Nội dung gốc" }],
          },
        ],
      },
      sourceId,
      venue,
    ],
  );
  // Directory drift must not refresh the invitation's historical snapshot or primary alias.
  await pg.query(
    "update guests set name='Tên mới trong danh bạ',primary_alias='alias-moi',active=false where id=$1",
    [guestId],
  );
}, 30000);
afterAll(async () => {
  await pg?.close();
});

it("atomically copies all event content, legacy agenda, media references and snapshots even for inactive guests", async () => {
  const source = (
    await pg.query<Record<string, unknown>>(
      "select * from events where id=$1",
      [sourceId],
    )
  ).rows[0];
  await pg.exec("set role authenticated");
  const copy = await duplicate();
  await pg.exec("reset role");
  expect(copy.code).toBe("cuoc-thi-rung-chuong-vang-copy");
  expect(copy.duplicated_from_id).toBe(sourceId);
  expect(
    content(
      (
        await pg.query<Record<string, unknown>>(
          "select * from events where id=$1",
          [copy.id],
        )
      ).rows[0],
    ),
  ).toEqual(content(source));
  for (const table of [
    "event_guests",
    "event_agenda_items",
    "invitation_aliases",
  ]) {
    const original = (
      await pg.query<Record<string, unknown>>(
        `select * from ${table} where event_id=$1 order by id`,
        [sourceId],
      )
    ).rows;
    const cloned = (
      await pg.query<Record<string, unknown>>(
        `select * from ${table} where event_id=$1 order by id`,
        [copy.id],
      )
    ).rows;
    expect(
      cloned
        .map(content)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(
      original
        .map(content)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    expect(
      cloned.every((row) => !original.some((old) => old.id === row.id)),
    ).toBe(true);
  }
  expect(
    (await pg.query("select * from events where id=$1", [sourceId])).rows[0],
  ).toEqual(source);
  const nested = await duplicate(String(copy.id));
  expect(nested.code).toBe("cuoc-thi-rung-chuong-vang-copy-copy");
});

it("uses sequential copy codes and replays a lost response without creating another event", async () => {
  const id = randomUUID();
  const first = await duplicate(sourceId, id);
  expect(first.code).toBe("cuoc-thi-rung-chuong-vang-copy-2");
  expect(await duplicate(sourceId, id)).toEqual(first);
  const copies = await Promise.all([duplicate(), duplicate()]);
  expect(copies.map((copy) => copy.code)).toEqual([
    "cuoc-thi-rung-chuong-vang-copy-3",
    "cuoc-thi-rung-chuong-vang-copy-4",
  ]);
  await expect(duplicate(String(first.id), id)).rejects.toThrow();
  await expect(duplicate(randomUUID())).rejects.toThrow(
    "Source event not found",
  );
});

it("preserves the 80-character limit and avoids historical reserved codes when that table exists", async () => {
  await pg.query("update events set code=$1 where id=$2", [
    "a".repeat(80),
    sourceId,
  ]);
  const long = await duplicate();
  expect(String(long.code)).toHaveLength(80);
  expect(String(long.code)).toMatch(/-copy$/);
  await pg.exec(
    "create table public.event_codes(code text primary key,event_id uuid)",
  );
  await pg.query("insert into event_codes values($1,$2)", [
    "a".repeat(73) + "-copy-2",
    sourceId,
  ]);
  const next = await duplicate();
  expect(String(next.code)).toBe("a".repeat(73) + "-copy-3");
});

it("checks server permissions for anonymous, unprivileged and revoked accounts, including replay", async () => {
  const existing = await duplicate();
  await pg.exec("set role anon");
  await expect(duplicate()).rejects.toThrow();
  await pg.exec("reset role");
  const stranger = randomUUID();
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'viewer@fixture.invalid',now())",
    [stranger],
  );
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
    stranger,
  ]);
  await pg.exec("set role authenticated");
  await expect(duplicate(sourceId, String(existing.id))).rejects.toThrow(
    "Content access required",
  );
  await pg.exec("reset role");
  await pg.query("insert into editor_users(user_id) values($1)", [stranger]);
  await pg.exec("set role authenticated");
  expect((await duplicate()).duplicated_from_id).toBe(sourceId);
  await pg.exec("reset role");
  await pg.query("delete from editor_users where user_id=$1", [stranger]);
  await pg.exec("set role authenticated");
  await expect(duplicate()).rejects.toThrow("Content access required");
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
    adminId,
  ]);
});

it("copies attendance configuration and remaps the default card without copying attendance results or QR tokens", async () => {
  await pg.exec(sqlFile("supabase/proposals/attendance.sql"));
  await pg.query(
    "update events e set default_invitation_id=(select id from event_guests where event_id=e.id limit 1),attendance_config=jsonb_build_object('enabled',true,'radius_m',100,'qr_seconds',5,'latitude',10,'longitude',105,'pin_confirmed',true,'pin_source',attendance_private.location_source(e)::text,'round_one',starts_at+interval '15 minutes','round_two',ends_at-interval '15 minutes') where id=$1",
    [sourceId],
  );
  const source = (
    await pg.query<Record<string, unknown>>(
      "select * from events where id=$1",
      [sourceId],
    )
  ).rows[0];
  const copy = await duplicate();
  expect(copy.attendance_config).toEqual(source.attendance_config);
  expect(copy.default_invitation_id).not.toBe(source.default_invitation_id);
  const own = (
    await pg.query("select * from event_guests where id=$1 and event_id=$2", [
      copy.default_invitation_id,
      copy.id,
    ])
  ).rows;
  expect(own).toHaveLength(1);
  const tables = (
    await pg.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname='attendance_private'",
    )
  ).rows;
  for (const { tablename } of tables) {
    const hasEvent = (
      await pg.query(
        "select 1 from information_schema.columns where table_schema='attendance_private' and table_name=$1 and column_name='event_id'",
        [tablename],
      )
    ).rows.length;
    if (hasEvent)
      expect(
        (
          await pg.query(
            `select * from attendance_private.${tablename} where event_id=$1`,
            [copy.id],
          )
        ).rows,
      ).toHaveLength(0);
  }
});

it("rolls back the entire copy if any child write fails", async () => {
  await pg.exec(
    "create function public.reject_copy_test() returns trigger language plpgsql as $$ begin raise exception 'fixture failure'; end $$; create trigger reject_copy_test before insert on event_agenda_items for each row execute function public.reject_copy_test();",
  );
  const id = randomUUID();
  await expect(duplicate(sourceId, id)).rejects.toThrow("fixture failure");
  for (const [table, key] of [
    ["events", "id"],
    ["event_guests", "event_id"],
    ["invitation_aliases", "event_id"],
    ["event_agenda_items", "event_id"],
  ])
    expect(
      (await pg.query(`select * from ${table} where ${key}=$1`, [id])).rows,
    ).toHaveLength(0);
  await pg.exec(
    "drop trigger reject_copy_test on event_agenda_items; drop function public.reject_copy_test();",
  );
  expect((await duplicate(sourceId, id)).id).toBe(id);
});
