// @vitest-environment node
import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { hsvBaseline, adminId, guestId, sqlFile } from "./helpers/hsvDatabase";
import { randomUUID } from "node:crypto";
let pg: PGlite;
let eventId: string;
const secret = "a".repeat(64),
  browser = randomUUID(),
  group = randomUUID();
const rpc = async <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
) =>
  (await pg.query<{ result: T }>(`select ${query} result`, params)).rows[0]
    .result;
beforeAll(async () => {
  ({ pg } = await hsvBaseline());
  await pg.exec(
    sqlFile("supabase/migrations/202611200001_event_types_theme.sql"),
  );
  await pg.exec(sqlFile("supabase/releases/hsv4/01-attendance.sql"));
  await pg.exec(sqlFile("supabase/releases/hsv4/02-attendance-duration.sql"));
  await pg.query(
    "insert into guests(id,name,kind,primary_alias) values($1,'Nhóm kiểm thử','group','nhom-test')",
    [group],
  );
  const event = await rpc<{ id: string }>("save_event($1,$2)", [
    {
      code: "attendance-test",
      title: "Kiểm thử điểm danh",
      starts_at: new Date(Date.now() - 3600_000).toISOString(),
      ends_at: new Date(Date.now() + 3600_000).toISOString(),
      status: "draft",
      maps_url: "https://www.google.com/maps?q=10,105",
      location_method: "url",
    },
    [guestId, group],
  ]);
  eventId = event.id;
  await pg.query(
    `update events set status='published', attendance_config=jsonb_build_object('enabled',true,'radius_m',100,'qr_seconds',5,'latitude',10,'longitude',105,'pin_confirmed',true,'pin_source',attendance_private.location_source(events)::text,'round_one',clock_timestamp()-interval '1 minute','round_two',clock_timestamp()+interval '20 minutes') where id=$1`,
    [eventId],
  );
}, 30000);
afterAll(async () => {
  await pg?.close();
});
it("validates configurable duration, server round boundaries and QR closing time, preserving legacy duration", async () => {
  const read = async () =>
    (
      await pg.query<{ c: Record<string, unknown> }>(
        "select attendance_config c from events where id=$1",
        [eventId],
      )
    ).rows[0].c;
  const old = await read();
  expect(await rpc("attendance_capabilities()")).toMatchObject({
    duration_minutes: true,
  });
  expect(
    await rpc("extract(epoch from attendance_private.duration($1))", [old]),
  ).toBe("900.000000");
  for (const minutes of [0, -1, 61, 1.5, "10", null]) {
    await expect(
      pg.query("update events set attendance_config=$1 where id=$2", [
        { ...old, duration_minutes: minutes },
        eventId,
      ]),
    ).rejects.toThrow();
    expect(await read()).toEqual(old);
  }
  for (const minutes of [1, 7, 10, 15]) {
    const config = {
      ...old,
      duration_minutes: minutes,
      round_one: new Date(Date.now() - 30_000).toISOString(),
    };
    await pg.query("update events set attendance_config=$1 where id=$2", [
      config,
      eventId,
    ]);
    const open = Date.parse(config.round_one);
    for (const [time, round] of [
      [open - 1, null],
      [open, 1],
      [open + minutes * 60_000 - 1, 1],
      [open + minutes * 60_000, null],
    ])
      expect(
        await rpc(
          "(select attendance_private.round_at(e,$2) from events e where id=$1)",
          [eventId, new Date(time as number).toISOString()],
        ),
      ).toBe(round);
    const status = await rpc<{ closes_at: string }>(
      "attendance_status('attendance-test','nhom-test')",
    );
    expect(Date.parse(status.closes_at)).toBe(open + minutes * 60_000);
    const display = await rpc<{ closes_at: string; expires_at: string }>(
      "attendance_display('attendance-test')",
    );
    expect(Date.parse(display.closes_at)).toBe(open + minutes * 60_000);
    expect(Date.parse(display.expires_at)).toBeLessThanOrEqual(
      Date.parse(display.closes_at),
    );
  }
  await expect(
    pg.query("update events set attendance_config=$1 where id=$2", [
      { ...old, duration_minutes: 30 },
      eventId,
    ]),
  ).rejects.toThrow();
  await pg.query("update events set attendance_config=$1 where id=$2", [
    old,
    eventId,
  ]);
});
const token = async () =>
  (await rpc<{ token: string }>("attendance_display('attendance-test')")).token;
const position = () => ({
  latitude: 10,
  longitude: 105,
  accuracy: 5,
  captured_at: new Date().toISOString(),
});
const submit = async (overrides: Record<string, unknown> = {}) => {
  const p = {
    browser,
    secret,
    name: "Sinh viên kiểm thử",
    student: "TEST001",
    token: await token(),
    alias: "nhom-test",
    position: position(),
    ...overrides,
  };
  return rpc<{
    ok: boolean;
    record?: {
      id: string;
      count: number;
      student_id: string;
      round_one_at: string;
      round_two_at: string | null;
    };
  }>("attendance_submit('attendance-test',$1,$2,$3,$4,$5,$6,$7)", [
    p.alias,
    p.browser,
    p.secret,
    p.name,
    p.student,
    p.token,
    p.position,
  ]);
};
it("defaults old events off and keeps snapshot, alias and publication controls separate", async () => {
  expect(
    await rpc(
      "(select attendance_config from events where code='legacy-fixture')",
    ),
  ).toBe(null);
  const before = (
    await pg.query("select * from event_guests where event_id=$1 order by id", [
      eventId,
    ])
  ).rows;
  await pg.query("update events set status='draft' where id=$1", [eventId]);
  expect(
    (
      await pg.query(
        "select * from event_guests where event_id=$1 order by id",
        [eventId],
      )
    ).rows,
  ).toEqual(before);
  expect((await submit()).ok).toBe(false);
  await pg.query("update events set status='published' where id=$1", [eventId]);
});
it("requires group invitation, valid token, fresh accurate location and confirmed configuration", async () => {
  for (const override of [
    { alias: "missing" },
    { token: "HSV1:" + "0".repeat(64) },
    { position: { ...position(), latitude: 11 } },
    { position: { ...position(), accuracy: 51 } },
    {
      position: {
        ...position(),
        captured_at: new Date(Date.now() - 60_000).toISOString(),
      },
    },
  ])
    expect((await submit(override)).ok).toBe(false);
  const alias = await rpc<string>(
    "(select primary_alias from event_guests where event_id=$1 and guest_id=$2)",
    [eventId, guestId],
  );
  expect((await submit({ alias })).ok).toBe(false);
  await expect(
    pg.query(
      "update events set attendance_config=jsonb_set(attendance_config,'{radius_m}','0') where id=$1",
      [eventId],
    ),
  ).rejects.toThrow();
  await expect(
    pg.query(
      "update events set attendance_config=jsonb_set(attendance_config,'{pin_confirmed}','false') where id=$1",
      [eventId],
    ),
  ).rejects.toThrow();
  expect(
    await rpc<number>(
      "(select count(*)::integer from attendance_private.records)",
    ),
  ).toBe(0);
});
it("uses a shared QR without consumption, binds only on success and rejects duplicate or mismatched ownership", async () => {
  const qr = await token();
  const first = await submit({ token: qr });
  expect(first.ok).toBe(true);
  expect(first.record?.count).toBe(1);
  expect(first.record?.round_two_at).toBe(null);
  expect(
    (
      await submit({
        token: qr,
        browser: randomUUID(),
        secret: "b".repeat(64),
        student: "TEST002",
      })
    ).ok,
  ).toBe(true);
  expect((await submit()).ok).toBe(false);
  expect((await submit({ student: "TEST003" })).ok).toBe(false);
  expect((await submit({ browser: randomUUID() })).ok).toBe(false);
  expect((await submit({ secret: "c".repeat(64) })).ok).toBe(false);
  const recovered = await rpc<{ id: string; count: number }>(
    "attendance_own('attendance-test',$1,$2)",
    [browser, secret],
  );
  expect(recovered.id).toBe(first.record?.id);
  expect(recovered.count).toBe(1);
  expect(
    await rpc("attendance_own('attendance-test',$1,$2)", [
      browser,
      "c".repeat(64),
    ]),
  ).toBe(null);
});
it("allows repeated correction outside rounds preserving identity and timestamps; collision rolls back history", async () => {
  const before = await rpc<Record<string, unknown>>(
    "attendance_own('attendance-test',$1,$2)",
    [browser, secret],
  );
  await pg.query(
    "update events set attendance_config=jsonb_set(attendance_config,'{enabled}','false') where id=$1",
    [eventId],
  );
  for (const student of ["CORRECT1", "CORRECT2", "TEST001"]) {
    const result = await rpc<{ ok: boolean; record: Record<string, unknown> }>(
      "attendance_edit('attendance-test',$1,$2,$3,$4)",
      [browser, secret, "Họ tên đã sửa", student],
    );
    expect(result.ok).toBe(true);
    expect(result.record.id).toBe(before.id);
    expect(result.record.round_one_at).toBe(before.round_one_at);
    expect(result.record.count).toBe(1);
  }
  expect(
    (
      await rpc<{ ok: boolean }>(
        "attendance_edit('attendance-test',$1,$2,'Họ tên','TEST002')",
        [browser, secret],
      )
    ).ok,
  ).toBe(false);
  expect(
    await rpc<number>(
      "(select count(*)::integer from attendance_private.edits)",
    ),
  ).toBe(3);
  await pg.query(
    "update events set attendance_config=jsonb_set(attendance_config,'{enabled}','true') where id=$1",
    [eventId],
  );
});
it("denies attendee access to staff APIs/private tables and preserves existing roles", async () => {
  await pg.exec(
    "set role anon; select set_config('request.jwt.claim.sub','',false)",
  );
  await expect(rpc("attendance_results('attendance-test')")).rejects.toThrow();
  await expect(rpc("attendance_display('attendance-test')")).rejects.toThrow();
  await expect(
    pg.query("select * from attendance_private.records"),
  ).rejects.toThrow();
  const own = await rpc<{ count: number }>(
    "attendance_own('attendance-test',$1,$2)",
    [browser, secret],
  );
  expect(own.count).toBe(1);
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
    adminId,
  ]);
});
it("checks half-open round boundaries and rejects wrong type, disabled, stale-config and expired QR", async () => {
  const e = (
    await pg.query<{ attendance_config: Record<string, unknown> }>(
      "select attendance_config from events where id=$1",
      [eventId],
    )
  ).rows[0];
  const one = String(e.attendance_config.round_one);
  for (const [delta, expected] of [
    [-0.001, null],
    [0, 1],
    [899.999, 1],
    [900, null],
  ] as const)
    expect(
      await rpc(
        "(select attendance_private.round_at(events,$2::timestamptz+$3::double precision*interval '1 second') from events where id=$1)",
        [eventId, one, delta],
      ),
    ).toBe(expected);
  const oldQr = await token();
  await pg.query("update events set event_type='congratulation' where id=$1", [
    eventId,
  ]);
  expect((await submit({ token: oldQr })).ok).toBe(false);
  expect(
    (
      await rpc<{ round: number | null }>(
        "attendance_status('attendance-test','nhom-test')",
      )
    ).round,
  ).toBe(null);
  await pg.query("update events set event_type='invitation' where id=$1", [
    eventId,
  ]);
  await pg.query(
    "update events set attendance_config=jsonb_set(attendance_config,'{qr_seconds}','10') where id=$1",
    [eventId],
  );
  expect((await submit({ token: oldQr })).ok).toBe(false);
  const fresh = await token();
  await pg.query(
    "update attendance_private.tokens set expires_at=clock_timestamp()-interval '2 seconds' where token=$1",
    [fresh.slice(5)],
  );
  expect(
    (await submit({ token: fresh, browser: randomUUID(), student: "EXPIRED" }))
      .ok,
  ).toBe(false);
  await pg.query(
    "update attendance_private.tokens set expires_at=clock_timestamp()+interval '10 seconds',round=2 where token=$1",
    [fresh.slice(5)],
  );
  expect(
    (
      await submit({
        token: fresh,
        browser: randomUUID(),
        student: "WRONGROUND",
      })
    ).ok,
  ).toBe(false);
  await expect(
    pg.query(
      "update events set attendance_config=jsonb_set(attendance_config,'{round_two}',attendance_config->'round_one') where id=$1",
      [eventId],
    ),
  ).rejects.toThrow();
});
it("enforces custom radius and a one-second token grace without extending a closed round", async () => {
  await pg.exec("begin");
  try {
    await pg.query(
      "update events set attendance_config=jsonb_set(attendance_config,'{radius_m}','200') where id=$1",
      [eventId],
    );
    const qr = await token();
    await pg.query(
      "update attendance_private.tokens set expires_at=clock_timestamp()-interval '0.1 seconds' where token=$1",
      [qr.slice(5)],
    );
    expect(
      (
        await submit({
          browser: randomUUID(),
          student: "GRACE001",
          token: qr,
          position: { ...position(), latitude: 10.001 },
        })
      ).ok,
    ).toBe(true);
    await pg.query(
      "update attendance_private.tokens set expires_at=clock_timestamp()-interval '1.1 seconds' where token=$1",
      [qr.slice(5)],
    );
    expect(
      (await submit({ browser: randomUUID(), student: "GRACE002", token: qr }))
        .ok,
    ).toBe(false);
    await pg.query(
      "update events set attendance_config=jsonb_set(attendance_config,'{round_one}',to_jsonb((clock_timestamp()-interval '15 minutes')::text)) where id=$1",
      [eventId],
    );
    await pg.query(
      "update attendance_private.tokens set config_hash=(select md5(attendance_config::text) from events where id=$1),expires_at=clock_timestamp() where token=$2",
      [eventId, qr.slice(5)],
    );
    expect(
      (await submit({ browser: randomUUID(), student: "GRACE003", token: qr }))
        .ok,
    ).toBe(false);
  } finally {
    await pg.exec("rollback");
  }
});
it("protects snapshots and ownership across group links and forged browser credentials", async () => {
  await pg.exec("begin");
  try {
    const otherGroup = randomUUID();
    await pg.query(
      "insert into guests(id,name,kind,primary_alias) values($1,'Nhóm khác','group','nhom-khac')",
      [otherGroup],
    );
    const current = await rpc<Record<string, unknown>>(
      "get_event_v110('attendance-test')",
    );
    await rpc("save_event($1,$2,$3,$4)", [
      current,
      [guestId, group, otherGroup],
      eventId,
      current.updated_at,
    ]);
    expect(
      (
        await submit({
          browser: randomUUID(),
          alias: "nhom-khac",
          student: "TEST001",
        })
      ).ok,
    ).toBe(false);
    expect(
      (await submit({ alias: "nhom-khac", student: "SWITCH001" })).ok,
    ).toBe(false);
    const own = await rpc<{ id: string }>(
      "attendance_own('attendance-test',$1,$2)",
      [browser, secret],
    );
    expect(
      await rpc("attendance_own('attendance-test',$1,$2)", [own.id, secret]),
    ).toBe(null);
    expect(
      (
        await rpc<{ ok: boolean }>(
          "attendance_edit('attendance-test',$1,$2,'Giả mạo','HIJACK001')",
          [browser, "b".repeat(64)],
        )
      ).ok,
    ).toBe(false);
    await pg.exec(
      "set local role authenticated; select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000099',true)",
    );
    await expect(rpc("attendance_results('attendance-test')")).rejects.toThrow(
      "Forbidden",
    );
  } finally {
    await pg.exec("rollback");
  }
});
it("exposes only a validated primary default alias and saves configuration atomically", async () => {
  const invitationId = await rpc<string>(
    "(select id from event_guests where event_id=$1 and guest_id=$2)",
    [eventId, group],
  );
  await pg.query("update events set default_invitation_id=$1 where id=$2", [
    invitationId,
    eventId,
  ]);
  const event = await rpc<Record<string, unknown>>(
    "get_event_v110('attendance-test')",
  );
  expect(event.default_invitation_alias).toBe("nhom-test");
  const aliases = (
    await pg.query(
      "select * from invitation_aliases where event_id=$1 order by id",
      [eventId],
    )
  ).rows;
  const snapshots = (
    await pg.query("select * from event_guests where event_id=$1 order by id", [
      eventId,
    ])
  ).rows;
  const oldToken = await token();
  await pg.query(
    "update attendance_private.tokens set event_id=(select id from events where code='legacy-fixture') where token=$1",
    [oldToken.slice(5)],
  );
  expect(
    (
      await submit({
        token: oldToken,
        browser: randomUUID(),
        student: "WRONGEVENT",
      })
    ).ok,
  ).toBe(false);
  const saved = await rpc<Record<string, unknown>>("save_event($1,$2,$3,$4)", [
    { ...event, title: "Updated fixture", status: "draft" },
    [guestId, group],
    eventId,
    event.updated_at,
  ]);
  expect(saved.status).toBe("published");
  expect(saved.default_invitation_alias).toBe("nhom-test");
  expect(
    (
      await pg.query(
        "select * from invitation_aliases where event_id=$1 order by id",
        [eventId],
      )
    ).rows,
  ).toEqual(aliases);
  expect(
    (
      await pg.query(
        "select * from event_guests where event_id=$1 order by id",
        [eventId],
      )
    ).rows,
  ).toEqual(snapshots);
  await expect(
    rpc("save_event($1,$2,$3,$4)", [
      {
        ...saved,
        attendance_config: {
          ...(saved.attendance_config as object),
          radius_m: -1,
        },
      },
      [guestId, group],
      eventId,
      saved.updated_at,
    ]),
  ).rejects.toThrow();
  expect(
    (await rpc<Record<string, unknown>>("get_event_v110('attendance-test')"))
      .updated_at,
  ).toBe(saved.updated_at);
  const beforeSecond = await rpc<Record<string, unknown>>(
    "attendance_own('attendance-test',$1,$2)",
    [browser, secret],
  );
  await pg.query(
    "update events set attendance_config=jsonb_set(jsonb_set(attendance_config,'{round_one}',to_jsonb((clock_timestamp()-interval '30 minutes')::text)),'{round_two}',to_jsonb((clock_timestamp()-interval '1 minute')::text)) where id=$1",
    [eventId],
  );
  const second = await submit({ name: "Họ tên đã sửa" });
  expect(second.ok).toBe(true);
  expect(second.record?.count).toBe(2);
  expect(second.record?.round_one_at).toBe(beforeSecond.round_one_at);
  expect(
    (
      await rpc<{ ok: boolean }>(
        "attendance_edit('attendance-test',$1,$2,'Tên sau đợt hai','AFTER002')",
        [browser, secret],
      )
    ).ok,
  ).toBe(true);
  const legacyId = await rpc<string>(
    "(select id from event_guests where event_id=(select id from events where code='legacy-fixture') limit 1)",
  );
  await expect(
    pg.query("update events set default_invitation_id=$1 where id=$2", [
      legacyId,
      eventId,
    ]),
  ).rejects.toThrow();
  const beforeRemoval = await rpc<Record<string, unknown>>(
    "get_event_v110('attendance-test')",
  );
  const removed = await rpc<Record<string, unknown>>(
    "save_event($1,$2,$3,$4)",
    [beforeRemoval, [guestId], eventId, beforeRemoval.updated_at],
  );
  expect(removed.default_invitation_id).toBe(null);
  expect(removed.default_invitation_alias).toBe(null);
  const afterRemoval = await rpc<Record<string, unknown>>(
    "get_event_v110('attendance-test')",
  );
  expect(removed.updated_at).toBe(afterRemoval.updated_at);
  await expect(
    rpc("save_event($1,$2,$3,$4)", [
      removed,
      [guestId],
      eventId,
      removed.updated_at,
    ]),
  ).resolves.toMatchObject({ default_invitation_id: null });
  expect(
    (await rpc<Record<string, unknown>>("get_event_v110('attendance-test')"))
      .default_invitation_alias,
  ).toBe(null);
  await pg.query("update events set status='draft' where id=$1", [eventId]);
  await pg.exec(
    "set role anon; select set_config('request.jwt.claim.sub','',false)",
  );
  expect(await rpc("get_event_v110('attendance-test')")).toBe(null);
  expect(await rpc("resolve_invitation('attendance-test','nhom-test')")).toBe(
    null,
  );
  await expect(
    pg.query("update events set status='published' where id=$1", [eventId]),
  ).rejects.toThrow();
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
    adminId,
  ]);
});
