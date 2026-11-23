import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { designBackend, designEvent } from "./redesign-fixtures";
import AxeBuilder from "@axe-core/playwright";

const phase = process.env.HSV_UI_PHASE || "after";
const evidence = `.local/uiux/${phase}`;
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: `${evidence}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const width of [320, 390, 768, 1440]) {
  test(`usability visual baseline and final ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await designBackend(page, { admin: true });
    await page.route("**/rest/v1/events?*", (route) => {
      const rows = [
        {
          ...designEvent,
          event_type: "invitation",
          title: "Hội thi Rung chuông vàng — dữ liệu kiểm thử",
          theme: { version: 1, primary: "#174b78" },
        },
        {
          ...designEvent,
          id: "second",
          code: "ngay-hoi",
          event_type: "invitation",
          title: "Ngày hội sinh viên CTUT — dữ liệu kiểm thử",
          status: "draft",
          starts_at: "2099-09-12T01:00:00Z",
        },
        {
          ...designEvent,
          id: "third",
          code: "chuc-mung",
          event_type: "congratulation",
          title: "Chúc mừng ngày Nhà giáo Việt Nam — dữ liệu kiểm thử",
          starts_at: null,
          ends_at: null,
        },
      ];
      return route.fulfill({
        json: new URL(route.request().url()).searchParams.has("status")
          ? rows.filter((row) => row.status === "published")
          : rows,
      });
    });
    await page.goto("/hsv/admin/");
    await expect(page.locator(".admin-event")).toHaveCount(3);
    await capture(page, `admin-${width}`);
    if (phase !== "before") {
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.locator(".admin-event summary").first().click();
      await capture(page, `actions-${width}`);
      const menu = await page
        .locator(".event-actions-panel:visible")
        .boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(page.locator(".admin-event summary").first()).toBeFocused();
    }
    await writeFile(
      `${evidence}/metrics-${width}.json`,
      JSON.stringify(
        await page
          .locator(".admin-event")
          .first()
          .evaluate((el) => ({
            rowHeight: el.getBoundingClientRect().height,
            firstRowY: el.getBoundingClientRect().top + scrollY,
          })),
        null,
        2,
      ),
    );
    await page.goto("/hsv/");
    await expect(page.locator(".event-row")).toHaveCount(2);
    await page.locator("#events-title").scrollIntoViewIfNeeded();
    await capture(page, `home-${width}`);
    if (phase !== "before") {
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
  });
}

test("list filters find Vietnamese names without accents, survive reload/back and clear every criterion", async ({
  page,
}) => {
  await designBackend(page, { admin: true });
  await page.goto("/hsv/admin/");
  await expect(page.locator(".admin-event")).toHaveCount(2);
  await page
    .getByRole("group", { name: "Lọc trạng thái sự kiện" })
    .getByRole("button", { name: /Chưa công khai/ })
    .click();
  await expect(page.locator(".admin-event")).toHaveCount(1);
  await page
    .getByRole("searchbox", { name: "Tìm sự kiện" })
    .pressSequentially("ban nhap");
  await page.getByLabel("Tháng", { exact: true }).selectOption("10");
  await page.getByLabel("Năm", { exact: true }).selectOption("2099");
  await expect(page.locator(".admin-event")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("searchbox")).toHaveValue("ban nhap");
  await expect(page.getByLabel("Tháng", { exact: true })).toHaveValue("10");
  await expect(
    page.getByRole("button", { name: /Chưa công khai 1/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("link", { name: "Bản nháp kiểm thử", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Chỉnh sửa sự kiện" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator(".admin-event")).toHaveCount(1);
  await expect(page.getByRole("searchbox")).toHaveValue("ban nhap");
  await page.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
  await expect(page.locator(".admin-event")).toHaveCount(2);
  await expect(page).not.toHaveURL(/view=|q=|month=|year=/);
  await page.getByRole("searchbox").fill("không có sự kiện này");
  await expect(
    page.getByRole("heading", { name: "Không tìm thấy sự kiện" }),
  ).toBeVisible();
  await capture(page, "admin-filter-empty");
  await page.getByRole("button", { name: "Xóa từ khóa" }).click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.locator(".admin-event")).toHaveCount(2);
});

test("public filters keep drafts hidden and respect invitation/congratulation dates", async ({
  page,
}) => {
  await designBackend(page);
  await page.route("**/rest/v1/events?*", (route) =>
    route.fulfill({
      json: [
        designEvent,
        {
          ...designEvent,
          id: "hidden",
          code: "hidden",
          title: "Không công khai",
          status: "draft",
        },
        {
          ...designEvent,
          id: "greeting",
          code: "greeting",
          title: "Chúc mừng kiểm thử",
          event_type: "congratulation",
          starts_at: "2000-01-01T00:00:00Z",
        },
        {
          ...designEvent,
          id: "past",
          code: "past",
          title: "Sự kiện đã kết thúc kiểm thử",
          starts_at: "2000-01-01T00:00:00Z",
          ends_at: "2000-01-01T03:00:00Z",
        },
      ],
    }),
  );
  await page.goto("/hsv/");
  await expect(page.locator(".event-row")).toHaveCount(3);
  await expect(page.getByText("Không công khai", { exact: true })).toHaveCount(
    0,
  );
  const filters = page.getByRole("group", { name: "Lọc sự kiện công khai" });
  await filters.getByRole("button", { name: "Sắp & đang diễn ra" }).click();
  await expect(page.locator(".event-row")).toHaveCount(1);
  await expect(page.locator(".event-row")).toContainText(
    "Khi những trang sách",
  );
  await filters.getByRole("button", { name: "Thiệp chúc" }).click();
  await page.getByLabel("Tháng", { exact: true }).selectOption("10");
  await page.getByLabel("Năm", { exact: true }).selectOption("2026");
  await page.getByRole("searchbox").fill("chuc mung");
  await expect(page.locator(".event-row")).toHaveCount(1);
  await expect(page.locator(".event-row a").first()).toHaveAttribute(
    "href",
    "/hsv/thiep-chuc/greeting",
  );
  await page.getByRole("searchbox").fill("khong tim thay");
  await expect(
    page.getByRole("heading", { name: "Không tìm thấy sự kiện" }),
  ).toBeVisible();
  await capture(page, "home-filter-empty");
  await page.getByRole("button", { name: "Hiện tất cả sự kiện" }).click();
  await expect(page.locator(".event-row")).toHaveCount(3);
  await filters.getByRole("button", { name: "Đã kết thúc" }).click();
  await expect(page.locator(".event-row")).toHaveCount(1);
  await expect(page.locator(".event-row")).toContainText("Sự kiện đã kết thúc");
});

test("action disclosure supports keyboard, focus recovery, clipboard and delete cancellation", async ({
  page,
  context,
}) => {
  const { writes } = await designBackend(page, { admin: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/hsv/admin/");
  const row = page.locator('[data-event-code="design-fixture"]');
  const trigger = row.locator("summary");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(row.locator("details")).toHaveAttribute("open", "");
  expect(
    await trigger.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("solid");
  await page.keyboard.press("Tab");
  await expect(
    row.getByRole("link", { name: "Xem sự kiện", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "/hsv/thiep-moi/design-fixture",
  );
  await expect(
    page.locator('[data-sonner-toast][data-type="success"]'),
  ).toHaveCSS("color", "rgb(35, 96, 61)");
  await expect(
    page.locator('[data-sonner-toast][data-type="success"]'),
  ).toHaveCSS("background-color", "rgb(227, 237, 222)");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(row.locator("details")).not.toHaveAttribute("open", "");
  await trigger.click();
  await row.getByRole("button", { name: "Xóa sự kiện", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Xóa sự kiện?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(page.locator(".admin-event")).toHaveCount(2);
  expect(
    writes.filter((write) => write.path.endsWith("/delete_event")),
  ).toHaveLength(0);
  await trigger.click();
  await page.getByRole("heading", { name: "Quản lý sự kiện" }).click();
  await expect(row.locator("details")).not.toHaveAttribute("open", "");
  await trigger.click();
  await expect(
    row.getByRole("link", { name: "Kết quả điểm danh" }),
  ).toHaveAttribute("href", "/hsv/admin/attendance/design-fixture");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("empty, loading and network recovery states remain usable", async ({
  page,
}) => {
  test.setTimeout(45000);
  await designBackend(page, { admin: true, empty: true });
  await page.goto("/hsv/admin/");
  await expect(
    page.getByRole("link", { name: "Thêm sự kiện đầu tiên" }),
  ).toBeVisible();
  await capture(page, "admin-empty");
  await page.goto("/hsv/");
  await expect(
    page.getByRole("heading", { name: "Chưa có sự kiện công khai" }),
  ).toBeVisible();
  await capture(page, "home-empty");
  let fail = true;
  await page.route("**/rest/v1/events?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return route.fulfill(
      fail
        ? { status: 503, json: { message: "Mất kết nối kiểm thử" } }
        : { json: [designEvent] },
    );
  });
  await page.reload();
  await expect(
    page.getByText("Đang tải dữ liệu…", { exact: true }),
  ).toBeVisible();
  await capture(page, "home-loading");
  await expect(
    page.getByRole("heading", { name: "Không thể tải dữ liệu" }),
  ).toBeVisible({ timeout: 25000 });
  await capture(page, "home-network-error");
  fail = false;
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.locator(".event-row")).toHaveCount(1);
});

test("long names, doubled text and reduced motion keep list controls reachable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 768, height: 900 });
  await designBackend(page, {
    admin: true,
    event: {
      ...designEvent,
      title:
        "Đơn vị có tên rất dài dùng để kiểm tra bố cục và thao tác trên màn hình hẹp ".repeat(
          3,
        ),
      code: "ma-su-kien-kiem-thu-rat-dai-".repeat(3),
    },
  });
  await page.goto("/hsv/admin/");
  await expect(page.locator(".admin-event")).toHaveCount(2);
  await page.addStyleTag({ content: "html:root { font-size: 200%; }" });
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
  ).toBe("32px");
  await capture(page, "admin-text-200");
  await page.locator(".admin-event summary").first().click();
  await expect(page.locator(".event-actions-panel:visible")).toBeVisible();
  await capture(page, "admin-text-200-actions");
  await page.keyboard.press("Escape");
  await expect(page.locator(".admin-event summary").first()).toBeFocused();
});
