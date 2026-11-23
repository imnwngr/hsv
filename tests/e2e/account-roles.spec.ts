import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { designBackend } from "./redesign-fixtures";
type Role = "admin" | "editor";
async function fixture(page: Page, actor: Role = "admin") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await designBackend(page, { admin: true });
  const rows = [
    {
      user_id: "admin",
      email: "admin@fixture.invalid",
      role: "admin" as Role,
      status: "confirmed",
    },
    {
      user_id: "other",
      email: "other-admin@fixture.invalid",
      role: "admin" as Role,
      status: "confirmed",
    },
    {
      user_id: "editor",
      email: "editor@fixture.invalid",
      role: "editor" as Role,
      status: "confirmed",
    },
  ];
  const control = {
    actor,
    fail: "",
    calls: [] as Record<string, unknown>[],
    recovery: [] as { email: string; state: string; requested_role: Role }[],
  };
  await page.route("**/rest/v1/rpc/effective_role", (r) =>
    r.fulfill({ json: control.actor }),
  );
  await page.route("**/rest/v1/rpc/role_directory", (r) =>
    r.fulfill({ json: rows }),
  );
  await page.route("**/rest/v1/rpc/account_add_recovery", (r) =>
    r.fulfill({ json: control.recovery }),
  );
  await page.route("**/functions/v1/manage-editors", async (r) => {
    const body = r.request().postDataJSON();
    if (body.action === "capabilities")
      return r.fulfill({
        json: { ok: true, account_roles: true, invitations_enabled: true },
      });
    control.calls.push(body);
    if (control.fail)
      return r.fulfill({ status: 409, json: { code: control.fail } });
    if (body.action === "add") {
      rows.push({
        user_id: "new",
        email: body.email,
        role: body.role,
        status: "invited",
      });
      control.recovery = [];
    } else {
      const target = rows.find((x) => x.user_id === body.user_id)!;
      if (body.action === "set_role") {
        target.role = body.role;
        if (target.user_id === "admin") control.actor = body.role;
      } else rows.splice(rows.indexOf(target), 1);
    }
    return r.fulfill({
      json: {
        ok: true,
        state: body.action === "add" ? "granted" : "updated",
        account_status: "invited",
        role: body.role,
      },
    });
  });
  await page.goto("/hsv/admin/roles");
  await expect(page.getByRole("heading", { name: "Quản lý vai trò" })).toBeVisible();
  return control;
}
const row = (page: Page, email: string) =>
  page
    .locator(".role-row")
    .filter({ has: page.getByText(email, { exact: true }) });
async function shot(page: Page, name: string) {
  await mkdir(".local/account-roles", { recursive: true });
  await page.screenshot({ path: `.local/account-roles/${name}.png`, animations: "disabled" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("account roles promote and demote, preserve failed confirmation, and refuse last Admin", async ({
  page,
}, info) => {
  const c = await fixture(page);
  const editor = row(page, "editor@fixture.invalid");
  await editor.getByRole("button", { name: "Nâng thành Admin" }).click();
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  expect(c.calls).toHaveLength(0);
  await editor.getByRole("button", { name: "Nâng thành Admin" }).click();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Hạ thành Editor" }),
  ).toBeVisible();
  expect(c.calls[0]).toMatchObject({
    action: "set_role",
    expected_role: "editor",
    role: "admin",
  });
  await row(page, "other-admin@fixture.invalid")
    .getByRole("button", { name: "Hạ thành Editor" })
    .click();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(
    row(page, "other-admin@fixture.invalid").getByRole("button", {
      name: "Nâng thành Admin",
    }),
  ).toBeVisible();
  c.fail = "last_admin";
  await row(page, "admin@fixture.invalid")
    .getByRole("button", { name: "Hạ thành Editor" })
    .click();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(
    page.getByText(/Cần giữ ít nhất một Admin hoạt động/),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, `last-admin-${info.project.name}`);
  c.fail = "";
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByText("Danh sách chỉ đọc.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Thêm tài khoản" }),
  ).toHaveCount(0);
  await expect(page.locator(".role-actions button")).toHaveCount(0);
});
test("account roles add Admin immediately, retain selection on retry and recover with original role", async ({
  page,
}, info) => {
  const c = await fixture(page);
  await page.getByRole("button", { name: "Thêm tài khoản" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Email", { exact: true })
    .fill("new-admin@fixture.invalid");
  await dialog.getByLabel("Vai trò", { exact: true }).selectOption("admin");
  c.fail = "grant_failed";
  await dialog.getByRole("button", { name: "Thêm Admin", exact: true }).click();
  await expect(dialog.getByText(/Chưa cấp được quyền đã chọn/)).toBeVisible();
  await expect(dialog.getByLabel("Vai trò", { exact: true })).toHaveValue(
    "admin",
  );
  c.fail = "";
  await dialog
    .getByRole("button", { name: "Kiểm tra và khôi phục", exact: true })
    .click();
  await expect(dialog.getByText(/Đã cấp quyền Admin/)).toBeVisible();
  expect(c.calls[0].request_id).toBe(c.calls[1].request_id);
  expect(c.calls[1].role).toBe("admin");
  await shot(page, `add-success-${info.project.name}`);
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(row(page, "new-admin@fixture.invalid")).toContainText("Admin");
  c.recovery = [
    {
      email: "pending-admin@fixture.invalid",
      state: "grant_failed",
      requested_role: "admin",
    },
  ];
  await page.reload();
  await page
    .getByRole("button", { name: "Kiểm tra và khôi phục", exact: true })
    .click();
  await expect(dialog.getByLabel("Vai trò", { exact: true })).toHaveValue(
    "admin",
  );
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(
    "pending-admin@fixture.invalid",
  );
});
test("account roles Editor remains read-only including its own row", async ({
  page,
}) => {
  const c = await fixture(page, "editor");
  await expect(page.getByText("Danh sách chỉ đọc.")).toBeVisible();
  await expect(page.locator(".role-actions button")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Thêm tài khoản" }),
  ).toHaveCount(0);
  expect(c.calls).toHaveLength(0);
});
test("account roles controls and add dialog fit mobile through desktop", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Viewport matrix runs once.");
  await fixture(page);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    await shot(page, `directory-${width}`);
    await page.getByRole("button", { name: "Thêm tài khoản" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Vai trò", { exact: true }).selectOption("admin");
    await shot(page, `add-admin-${width}`);
    expect(
      (await new AxeBuilder({ page }).include("dialog[open]").analyze())
        .violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Thêm tài khoản" }),
    ).toBeFocused();
  }
});
