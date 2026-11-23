import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { hsvBaseline, adminId, guestId } from "../tests/helpers/hsvDatabase.ts";

// Never reads connection strings or credentials. A new synthetic cluster is loopback-only.
const bin = process.env.HSV_PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
const out = path.resolve(
  ".local/attendance/concurrency",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const data = path.join(out, "data");
mkdirSync(out, { recursive: true });
const executable = (name) =>
  path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
const run = (name, args) =>
  execFileSync(executable(name), args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    ...(name === "pg_ctl" ? { stdio: "ignore" } : {}),
  });
const args = [
  "-X",
  "-A",
  "-t",
  "-v",
  "ON_ERROR_STOP=1",
  "-h",
  "127.0.0.1",
  "-p",
  "55449",
  "-U",
  "postgres",
  "-d",
  "postgres",
];
const query = (sql) =>
  execFileSync(executable("psql"), [...args, "-f", "-"], {
    input: sql,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, PGCLIENTENCODING: "UTF8" },
  }).trim();
const literal = (v) =>
  v === null
    ? "null"
    : "'" +
      String(Array.isArray(v) ? "{" + v.join(",") + "}" : v).replaceAll(
        "'",
        "''",
      ) +
      "'";
const interpolate = (sql, params) =>
  sql.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));
const adapter = {
  exec: async (sql) => query(sql),
  query: async (sql, params = []) => {
    const text = interpolate(sql, params);
    if (!/^\s*select\b/i.test(text)) {
      query(text);
      return { rows: [] };
    }
    return {
      rows: JSON.parse(
        query(
          `select coalesce(json_agg(row_to_json(q)),'[]'::json) from (${text}) q`,
        ),
      ),
    };
  },
};
const worker = (sql) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable("psql"), [...args, "-f", "-"], {
      windowsHide: true,
      env: { ...process.env, PGCLIENTENCODING: "UTF8" },
    });
    child.stdin.end(sql, "utf8");
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(Error(stderr)),
    );
  });
const resultOf = (output) =>
  JSON.parse(output.split(/\r?\n/).find((line) => line.startsWith("{")));
const group = "10000000-0000-4000-8000-000000000099";
const browserA = "30000000-0000-4000-8000-000000000001",
  browserB = "30000000-0000-4000-8000-000000000002";
const secret = "a".repeat(64);
run("initdb", [
  "-D",
  data,
  "-U",
  "postgres",
  "--auth=trust",
  "--encoding=UTF8",
  "--no-locale",
]);
let started = false;
try {
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(out, "postgres.log"),
    "-o",
    "-h 127.0.0.1 -p 55449 -F",
    "-w",
    "start",
  ]);
  started = true;
  // Each psql call is a new connection; the synthetic admin claim is set for every statement.
  const exec = adapter.exec,
    read = adapter.query;
  adapter.exec = (sql) =>
    exec(
      `select set_config('request.jwt.claim.sub','${adminId}',false);` + sql,
    );
  adapter.query = (sql, params) => {
    query(`alter database postgres set "request.jwt.claim.sub"='${adminId}'`);
    return read(sql, params);
  };
  await hsvBaseline(adapter);
  query(
    readFileSync(
      "supabase/migrations/202611200001_event_types_theme.sql",
      "utf8",
    ),
  );
  query(readFileSync("supabase/releases/hsv4/01-attendance.sql", "utf8"));
  query(readFileSync("supabase/releases/hsv4/02-attendance-duration.sql", "utf8"));
  query(readFileSync("supabase/releases/hsv4/03-duplicate-event.sql", "utf8"));
  query(
    `insert into guests(id,name,kind,primary_alias) values('${group}','Nhóm kiểm thử','group','nhom-test')`,
  );
  const payload = {
    code: "attendance-concurrency",
    title: "Synthetic concurrency fixture",
    starts_at: new Date(Date.now() - 3600000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
    status: "draft",
    maps_url: "https://www.google.com/maps?q=10,105",
    location_method: "url",
  };
  const event = JSON.parse(
    query(
      `select save_event(${literal(JSON.stringify(payload))},array['${guestId}','${group}']::uuid[])`,
    ),
  );
  query(
    `update events set status='published', attendance_config=jsonb_build_object('enabled',true,'duration_minutes',10,'radius_m',50,'qr_seconds',60,'latitude',10,'longitude',105,'pin_confirmed',true,'pin_source',attendance_private.location_source(events)::text,'round_one',clock_timestamp()-interval '1 minute','round_two',clock_timestamp()+interval '20 minutes') where id='${event.id}'`,
  );
  const token = () =>
    JSON.parse(query("select attendance_display('attendance-concurrency')"))
      .token;
  const submit = (browser, student, qr = token()) =>
    `select attendance_submit('attendance-concurrency','nhom-test','${browser}','${secret}','Sinh viên kiểm thử','${student}','${qr}',jsonb_build_object('latitude',10,'longitude',105,'accuracy',5,'captured_at',clock_timestamp()))`;
  const race = async (a, b) => {
    const outputs = await Promise.all([
      worker(`begin;select pg_backend_pid();${a};select pg_sleep(.2);commit;`),
      worker(`begin;select pg_backend_pid();${b};select pg_sleep(.2);commit;`),
    ]);
    assert.notEqual(
      outputs[0].split(/\r?\n/).find((l) => /^\d+$/.test(l)),
      outputs[1].split(/\r?\n/).find((l) => /^\d+$/.test(l)),
    );
    return outputs.map(resultOf);
  };
  const qr = token();
  let results = await race(
    submit(browserA, "SAME001", qr),
    submit(browserB, "SAME001", qr),
  );
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
  assert.equal(query("select count(*) from attendance_private.records"), "1");
  const winner = results[0].ok ? browserA : browserB,
    loser = winner === browserA ? browserB : browserA;
  const own = JSON.parse(
    query(
      `select attendance_own('attendance-concurrency','${winner}','${secret}')`,
    ),
  );
  results = await race(submit(winner, "SAME001"), submit(winner, "SAME001"));
  assert.ok(results.every((r) => !r.ok));
  const second = JSON.parse(query(submit(loser, "OTHER001")));
  assert.equal(second.ok, true);
  const edit = (browser) =>
    `select attendance_edit('attendance-concurrency','${browser}','${secret}','Tên đã sửa','COLLISION001')`;
  results = await race(edit(winner), edit(loser));
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
  assert.equal(query("select count(*) from attendance_private.records"), "2");
  assert.equal(query("select count(*) from attendance_private.edits"), "1");
  assert.equal(
    JSON.parse(
      query(
        `select attendance_own('attendance-concurrency','${winner}','${secret}')`,
      ),
    ).round_one_at,
    own.round_one_at,
  );
  const thirdBrowser = "30000000-0000-4000-8000-000000000003";
  results = await race(
    submit(thirdBrowser, "BROWSER001"),
    submit(thirdBrowser, "BROWSER002"),
  );
  assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
  assert.equal(
    query(
      `select count(*) from attendance_private.records where browser_id='${thirdBrowser}'`,
    ),
    "1",
  );
  const duplicate = (id) => `select duplicate_event('${event.id}','${id}')`;
  const copyA = "40000000-0000-4000-8000-000000000001";
  const copyB = "40000000-0000-4000-8000-000000000002";
  const copies = await race(duplicate(copyA), duplicate(copyB));
  assert.deepEqual(copies.map((copy) => copy.code).sort(), [
    "attendance-concurrency-copy",
    "attendance-concurrency-copy-2",
  ]);
  const replayId = "40000000-0000-4000-8000-000000000003";
  const replay = await race(duplicate(replayId), duplicate(replayId));
  assert.deepEqual(replay[0], replay[1]);
  assert.equal(
    query(`select count(*) from events where duplicated_from_id='${event.id}'`),
    "3",
  );
  assert.equal(
    query(
      `select count(*) from attendance_private.records where event_id in ('${copyA}','${copyB}','${replayId}')`,
    ),
    "0",
  );
  assert.equal(
    query(
      `select count(*) from event_guests where event_id in ('${copyA}','${copyB}','${replayId}')`,
    ),
    "6",
  );
  const report = {
    engine: "PostgreSQL 18, new synthetic loopback cluster",
    independentSessions: true,
    duplicateStudent: "PASS",
    duplicateRound: "PASS",
    editCollision: "PASS",
    browserBindingRace: "PASS",
    stableRecordAndTimestamp: "PASS",
    configurableDuration: "10 minutes",
    duplicateEventCodeRace: "PASS",
    duplicateEventRetryRace: "PASS",
    duplicateEventSnapshotsWithoutResults: "PASS",
    productionWrites: 0,
  };
  writeFileSync(path.join(out, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
}
