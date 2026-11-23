import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { designBackend, designEvent } from "./redesign-fixtures";

const before = process.env.HSV_EDITOR_PHASE === "before";
const evidence = `.local/editor-polish/${before ? "before" : "after"}`;

for (const width of [320, 390, 768, 1440]) {
  test(`editor layout and save notification at ${width}px`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "Viewport matrix runs once.");
    await page.setViewportSize({ width, height: 900 });
    const { writes } = await designBackend(page, {
      admin: true,
      event: {
        ...designEvent,
        title: "Hội thi Rung chuông vàng — dữ liệu kiểm thử",
      },
    });
    await page.goto("/hsv/admin/edit/design-fixture");
    const title = page.getByRole("textbox", {
      name: "Tên sự kiện *",
      exact: true,
    });
    await expect(title).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/editor-${width}.png` });
    await writeFile(
      `${evidence}/metrics-${width}.json`,
      JSON.stringify(
        await page.locator(".editor form > fieldset").evaluateAll((fields) =>
          fields.map((el) => ({
            name: el.querySelector("legend")?.textContent,
            height: el.getBoundingClientRect().height,
          })),
        ),
        null,
        2,
      ),
    );
    await title.fill("Tên sự kiện đã chỉnh — dữ liệu kiểm thử");
    const navigation = page.getByRole("navigation", {
      name: "Các phần của sự kiện",
    });
    await navigation.getByRole("link", { name: "Điểm danh" }).click();
    const attendance = page.locator("#editor-attendance");
    await expect(attendance).toBeFocused();
    expect((await attendance.boundingBox())!.y).toBeGreaterThanOrEqual(
      await navigation.evaluate((el) => el.getBoundingClientRect().bottom),
    );
    await page.screenshot({ path: `${evidence}/attendance-${width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByText("Có thay đổi chưa lưu", { exact: true }),
    ).toBeVisible();
    await expect(title).toHaveValue("Tên sự kiện đã chỉnh — dữ liệu kiểm thử");
    await page
      .getByRole("button", { name: "Lưu sự kiện", exact: true })
      .click();
    const toast = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Đã lưu sự kiện" });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute("data-mounted", "true");
    await page.screenshot({
      path: `${evidence}/saved-${width}.png`,
      animations: "disabled",
    });
    expect(writes.filter((w) => w.path.endsWith("/save_event"))).toHaveLength(
      1,
    );
    await expect(
      page.getByText("Có thay đổi chưa lưu", { exact: true }),
    ).not.toBeVisible();
    if (!before) {
      const close = toast.getByRole("button", { name: "Đóng thông báo" });
      const box = (await close.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBe(box.width);
      const toastBox = (await toast.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(toastBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(
        toastBox.x + toastBox.width,
      );
      expect(
        (
          await new AxeBuilder({ page })
            .include("[data-sonner-toaster]")
            .analyze()
        ).violations,
      ).toEqual([]);
      await close.focus();
      await page.keyboard.press("Enter");
      await expect(toast).not.toBeVisible();
    }
  });
}

test("editor reflows with doubled text and preserves changes after a failed save", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Text resize is checked once.");
  const { writes } = await designBackend(page, { admin: true });
  let attempts = 0;
  await page.route("**/rest/v1/rpc/save_event", (route) => {
    if (++attempts > 1) return route.fallback();
    return route.fulfill({
      status: 503,
      json: {
        message:
          "Không thể lưu sự kiện lúc này. Nội dung đang chỉnh sửa vẫn được giữ lại; vui lòng thử lại khi kết nối ổn định.",
      },
    });
  });
  await page.goto("/hsv/admin/edit/design-fixture");
  const title = page.getByRole("textbox", {
    name: "Tên sự kiện *",
    exact: true,
  });
  await expect(title).toBeVisible();
  await page.addStyleTag({ content: ":root { font-size: 32px; }" });
  const draft =
    "Tiêu đề nhiều dòng để kiểm tra bố cục khi phóng to chữ và giữ nguyên nội dung đang nhập";
  await title.fill(draft);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.locator("#editor-agenda").scrollIntoViewIfNeeded();
    await mkdir(evidence, { recursive: true });
    await page.screenshot({
      path: `${evidence}/text-200-${width}.png`,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Lưu sự kiện", exact: true }).click();
  const error = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(error).toContainText("Không thể lưu sự kiện lúc này");
  await expect(title).toHaveValue(draft);
  await expect(
    page.getByText("Có thay đổi chưa lưu", { exact: true }),
  ).toBeVisible();
  expect(writes.filter((w) => w.path.endsWith("/save_event"))).toHaveLength(0);
  await page.screenshot({
    path: `${evidence}/save-error.png`,
    animations: "disabled",
  });
  await error.getByRole("button", { name: "Đóng thông báo" }).focus();
  await page.keyboard.press("Enter");
  await expect(error).not.toBeVisible();
  await page.getByRole("button", { name: "Lưu sự kiện", exact: true }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Đã lưu sự kiện",
  );
  await expect(
    page.getByText("Có thay đổi chưa lưu", { exact: true }),
  ).not.toBeVisible();
  expect(writes.filter((w) => w.path.endsWith("/save_event"))).toHaveLength(1);
});
