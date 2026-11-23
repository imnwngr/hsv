import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { designBackend, designEvent } from "./redesign-fixtures";
import type { ClubEvent } from "../../src/types/domain";

test("duplicates from the list with sequential codes, stable retry and date-based placement (mock API)", async ({
  page,
}, info) => {
  const source: ClubEvent = {
    ...designEvent,
    id: "source",
    code: "cuoc-thi-rung-chuong-vang",
    title: "Sự kiện nguồn kiểm thử",
  };
  await designBackend(page, { admin: true, event: source });
  const rows = [
    source,
    {
      ...source,
      id: "future",
      code: "later-event",
      starts_at: "2100-01-01T01:00:00Z",
    },
  ];
  const requests: { p_source_id: string; p_copy_id: string }[] = [];
  let loseResponse = false;
  let missing = true;
  await page.route("**/rest/v1/events?*", (route) =>
    route.fulfill({ json: rows }),
  );
  await page.route("**/rest/v1/rpc/duplicate_event", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (missing)
      return route.fulfill({
        status: 404,
        json: { code: "PGRST202", message: "Missing RPC" },
      });
    let copy = rows.find((row) => row.id === input.p_copy_id);
    if (!copy) {
      const original = rows.find((row) => row.id === input.p_source_id)!;
      let code = original.code + "-copy";
      for (let n = 2; rows.some((row) => row.code === code); n++)
        code = original.code + `-copy-${n}`;
      copy = {
        ...original,
        id: input.p_copy_id,
        code,
        duplicated_from_id: original.id,
        created_at: new Date(Date.now() + rows.length * 1000).toISOString(),
      };
      rows.push(copy);
    }
    if (loseResponse) return route.abort();
    return route.fulfill({ json: copy });
  });
  await page.goto("/hsv/admin/");
  const sourceRow = page.locator(
    '[data-event-code="cuoc-thi-rung-chuong-vang"]',
  );
  await sourceRow
    .getByRole("button", { name: "Nhân bản", exact: true })
    .click();
  await expect(sourceRow.getByRole("alert")).toHaveText(
    "Chức năng nhân bản chưa được bật trên máy chủ.",
  );
  expect(rows).toHaveLength(2);
  missing = false;
  loseResponse = true;
  await sourceRow
    .getByRole("button", { name: "Thử lại nhân bản" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    sourceRow.getByRole("button", { name: "Đang nhân bản…" }),
  ).toBeDisabled();
  await expect(
    sourceRow.getByRole("button", { name: "Thử lại nhân bản" }),
  ).toBeVisible();
  expect(rows).toHaveLength(3);
  expect(requests).toHaveLength(2);
  loseResponse = false;
  await page.reload();
  await sourceRow
    .getByRole("button", { name: "Nhân bản", exact: true })
    .click();
  await expect(
    page.getByText("Đã nhân bản: cuoc-thi-rung-chuong-vang-copy", {
      exact: true,
    }),
  ).toBeVisible();
  expect(requests[2].p_copy_id).toBe(requests[1].p_copy_id);
  expect(rows).toHaveLength(3);
  await sourceRow
    .getByRole("button", { name: "Nhân bản", exact: true })
    .click();
  await expect(
    page.locator('[data-event-code="cuoc-thi-rung-chuong-vang-copy-2"]'),
  ).toBeVisible();
  await page
    .locator('[data-event-code="cuoc-thi-rung-chuong-vang-copy"]')
    .getByRole("button", { name: "Nhân bản", exact: true })
    .click();
  await expect(
    page.locator('[data-event-code="cuoc-thi-rung-chuong-vang-copy-copy"]'),
  ).toBeVisible();
  expect(
    await page
      .locator("[data-event-code]")
      .evaluateAll((elements) =>
        elements.map((el) => el.getAttribute("data-event-code")),
      ),
  ).toEqual([
    "later-event",
    "cuoc-thi-rung-chuong-vang-copy-copy",
    "cuoc-thi-rung-chuong-vang-copy",
    "cuoc-thi-rung-chuong-vang-copy-2",
    "cuoc-thi-rung-chuong-vang",
  ]);
  await page.reload();
  await expect(page.locator("[data-event-code]")).toHaveCount(5);
  await mkdir(".local/admin-updates", { recursive: true });
  for (const width of info.project.name === "desktop"
    ? [320, 390, 768, 1440]
    : [390]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .locator('[data-event-code="cuoc-thi-rung-chuong-vang-copy"]')
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/admin-updates/duplicate-${info.project.name}-${width}.png`,
    });
  }
});

test("account completion accepts six characters, rejects five and preserves server errors (mock Auth)", async ({
  page,
}) => {
  await designBackend(page, { admin: true });
  const writes: unknown[] = [];
  let fail = true;
  await page.route("**/auth/v1/user", (route) => {
    if (route.request().method() !== "PUT")
      return route.fulfill({
        json: { id: "admin", aud: "authenticated", role: "authenticated" },
      });
    writes.push(route.request().postDataJSON());
    return route.fulfill({
      status: fail ? 422 : 200,
      json: fail
        ? { code: "weak_password", msg: "Mật khẩu bị máy chủ từ chối." }
        : { id: "admin", aud: "authenticated", role: "authenticated" },
    });
  });
  await page.goto("/hsv/auth/accept");
  const password = page.getByLabel("Mật khẩu mới");
  await expect(password).toHaveAttribute("minlength", "6");
  await password.pressSequentially("Ab12!");
  await page.getByRole("button", { name: "Lưu mật khẩu và tiếp tục" }).click();
  expect(writes).toHaveLength(0);
  await password.pressSequentially("x");
  await page.getByRole("button", { name: "Lưu mật khẩu và tiếp tục" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Mật khẩu bị máy chủ từ chối.",
  );
  expect(writes).toHaveLength(1);
  await expect(password).toHaveValue("Ab12!x");
  fail = false;
  await page.getByRole("button", { name: "Lưu mật khẩu và tiếp tục" }).click();
  await expect(page).toHaveURL(/\/hsv\/admin\/$/);
});
