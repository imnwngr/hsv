// @vitest-environment node
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { hsvBaseline, adminId, sqlFile } from "./helpers/hsvDatabase";
let pg: PGlite;
const other = "20000000-0000-4000-8000-000000000002";
const editor = "20000000-0000-4000-8000-000000000003";
const fresh = "20000000-0000-4000-8000-000000000004";
const requestId = "30000000-0000-4000-8000-000000000001";
const read = async (sql: string, args: unknown[] = []) =>
  (await pg.query<{ r: Record<string, string> }>(sql, args)).rows[0].r;
const change = (
  actor: string,
  target: string,
  next: string | null,
  expected: string,
) =>
  read("select set_account_role($1,$2,$3,$4) r", [
    actor,
    target,
    next,
    expected,
  ]);
const begin = (
  role = "admin",
  actor = adminId,
  email = "fresh@fixture.invalid",
) =>
  read("select begin_account_add($1,$2,$3,true,$4) r", [
    actor,
    email,
    requestId,
    role,
  ]);
const finish = (
  lease: string,
  actor = adminId,
  target: string | null = fresh,
) =>
  read("select finish_account_add($1,'fresh@fixture.invalid',$2,$3) r", [
    actor,
    lease,
    target,
  ]);
const membership = async (id: string) =>
  (
    await pg.query(
      "select 'admin' role from admin_users where user_id=$1 union all select 'editor' from editor_users where user_id=$1",
      [id],
    )
  ).rows;
beforeAll(async () => {
  ({ pg } = await hsvBaseline());
  await pg.exec(
    sqlFile("supabase/migrations/202611200001_event_types_theme.sql"),
  );
  await pg.exec(
    sqlFile("supabase/migrations/202611200002_editor_add_operations.sql"),
  );
  await pg.exec(
    sqlFile("supabase/releases/role-management/01-account-roles.sql"),
  );
}, 30000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec("begin");
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'other@fixture.invalid',now()),($2,'editor@fixture.invalid',now()),($3,'fresh@fixture.invalid',now())",
    [other, editor, fresh],
  );
  await pg.query("insert into admin_users(user_id) values($1)", [other]);
  await pg.query("insert into editor_users(user_id) values($1)", [editor]);
});
afterEach(async () => {
  await pg.exec("rollback");
});
it("promotes and demotes another Admin atomically, removing the previous membership", async () => {
  expect(await change(adminId, editor, "admin", "editor")).toMatchObject({
    state: "updated",
    role: "admin",
  });
  expect(await membership(editor)).toEqual([{ role: "admin" }]);
  expect(await change(adminId, editor, "editor", "admin")).toMatchObject({
    state: "updated",
    role: "editor",
  });
  expect(await membership(editor)).toEqual([{ role: "editor" }]);
  expect(await change(adminId, other, null, "admin")).toMatchObject({
    state: "revoked",
  });
  expect(await membership(other)).toEqual([]);
  expect(
    (await pg.query("select id from auth.users where id=$1", [other])).rows,
  ).toHaveLength(1);
});
it("keeps the last active Admin and does not count banned accounts as a fallback", async () => {
  await pg.query(
    "update auth.users set banned_until=now()+interval '1 day' where id=$1",
    [other],
  );
  expect(await change(adminId, adminId, "editor", "admin")).toMatchObject({
    state: "last_admin",
  });
  expect(await change(adminId, adminId, null, "admin")).toMatchObject({
    state: "last_admin",
  });
  expect(await membership(adminId)).toEqual([{ role: "admin" }]);
});
it("stale pages cannot overwrite a newer role and a demoted actor loses authority immediately", async () => {
  await change(adminId, other, "editor", "admin");
  expect(await change(adminId, other, null, "admin")).toMatchObject({
    state: "role_changed",
  });
  await expect(change(other, editor, "admin", "editor")).rejects.toThrow(
    "Admin required",
  );
});
it.each(["admin", "editor", null])(
  "Editor cannot assign %s or revoke itself even when the service supplies its ID",
  async (next) => {
    await expect(change(editor, editor, next, "editor")).rejects.toThrow(
      "Admin required",
    );
  },
);
it.each(["anon", "authenticated"])(
  "%s cannot forge the actor or write membership and operation tables",
  async (role) => {
    await pg.exec(`set local role ${role}`);
    await expect(change(adminId, editor, "admin", "editor")).rejects.toThrow(
      "permission denied",
    );
  },
);
it("revokes all direct client write privileges and exposes only the guarded recovery reader", async () => {
  const result = await pg.query<{ allowed: boolean }>(
    "select has_function_privilege('authenticated','begin_account_add(uuid,text,uuid,boolean,text)','execute') or has_function_privilege('anon','finish_account_add(uuid,text,uuid,uuid)','execute') or has_table_privilege('authenticated','admin_users','insert') or has_table_privilege('authenticated','editor_users','delete') or has_table_privilege('authenticated','editor_add_operations','update') allowed",
  );
  expect(result.rows[0].allowed).toBe(false);
  await pg.query("select set_config('request.jwt.claim.sub',$1,true)", [
    editor,
  ]);
  await expect(
    pg.query("select * from account_add_recovery()"),
  ).rejects.toThrow("Admin required");
});
it.each(["admin", "editor"])(
  "adds an existing account directly as %s and retries without changing the role",
  async (role) => {
    const claim = await begin(role);
    expect(claim.state).toBe("grant");
    expect(await finish(claim.lease)).toMatchObject({ state: "granted", role });
    expect(await membership(fresh)).toEqual([{ role }]);
    expect(await begin(role)).toMatchObject({ state: `already_${role}`, role });
  },
);
it("invites as Admin, retains that role on recovery and prevents Editor replay from changing it", async () => {
  await pg.query("delete from auth.users where id=$1", [fresh]);
  const claim = await begin();
  expect(claim.state).toBe("invite");
  expect(await begin()).toMatchObject({ state: "processing" });
  expect(await finish(claim.lease, adminId, null)).toMatchObject({
    state: "delivery_unknown",
  });
  expect(await begin()).toMatchObject({ state: "delivery_unknown" });
  expect(
    (await pg.query("select requested_role from account_add_recovery()")).rows,
  ).toEqual([{ requested_role: "admin" }]);
  await pg.query(
    "insert into auth.users(id,email,invited_at) values($1,'fresh@fixture.invalid',now())",
    [fresh],
  );
  expect(await begin("editor")).toMatchObject({ state: "role_changed" });
  const retry = await begin();
  expect(await finish(retry.lease)).toMatchObject({
    state: "granted",
    role: "admin",
    account_status: "invited",
  });
});
it("old add requests cannot restore privileges after demotion, and adding an existing different role does not overwrite it", async () => {
  const claim = await begin();
  await finish(claim.lease);
  await change(adminId, fresh, "editor", "admin");
  expect(await begin()).toMatchObject({ state: "role_changed" });
  expect(await finish(claim.lease)).toMatchObject({ state: "role_changed" });
  expect(await begin("editor", adminId, "other@fixture.invalid")).toMatchObject(
    { state: "role_conflict" },
  );
  expect(await membership(fresh)).toEqual([{ role: "editor" }]);
});
it("a pending worker cannot grant Admin after its actor is demoted", async () => {
  const claim = await begin("admin", other);
  await change(adminId, other, "editor", "admin");
  expect(await finish(claim.lease, other)).toMatchObject({
    state: "grant_failed",
  });
  expect(await membership(fresh)).toEqual([]);
});
it("legacy Editor add stays compatible and cannot finish a pending Admin invitation", async () => {
  const claim = await begin();
  expect(
    await read("select finish_editor_add($1,'fresh@fixture.invalid',$2,$3) r", [
      adminId,
      claim.lease,
      fresh,
    ]),
  ).toMatchObject({ state: "role_changed" });
  expect(await membership(fresh)).toEqual([]);
  expect(
    await read(
      "select begin_editor_add($1,'other@fixture.invalid',$2,false) r",
      [adminId, requestId],
    ),
  ).toMatchObject({ state: "admin_protected" });
});
