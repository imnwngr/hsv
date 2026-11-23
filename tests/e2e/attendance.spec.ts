import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { designBackend, designEvent } from "./redesign-fixtures";
import {
  defaultAttendance,
  locationSource,
} from "../../src/features/attendance/model";
import { encodeQr } from "../../src/features/attendance/qr";
import AxeBuilder from "@axe-core/playwright";
const token = "HSV1:" + "0123456789abcdef".repeat(4);
const event = {
  ...designEvent,
  id: "a0000000-0000-4000-8000-000000000001",
  title: "Điểm danh • Dữ liệu kiểm thử",
  venue_image_path: null,
  maps_url: "https://www.google.com/maps?q=10,105",
  event_type: "invitation" as const,
};
const config = {
  ...defaultAttendance(event.starts_at, event.ends_at, 15),
  radius_m: 100,
  duration_minutes: undefined,
  latitude: 10,
  longitude: 105,
  pin_confirmed: true,
  pin_source: locationSource(event),
};
async function fixture(page: Page, admin = false) {
  const { writes } = await designBackend(page, {
    admin,
    event: { ...event, attendance_config: config },
  });
  const control = {
    active: true,
    fail: false,
    lost: false,
    editFail: false,
    record: null as Record<string, unknown> | null,
    round: 1,
    writes: 0,
    browserId: "",
    secret: "",
  };
  await page.route("**/rest/v1/rpc/attendance_*", async (route) => {
    const path = new URL(route.request().url()).pathname,
      input = route.request().postDataJSON();
    let data: unknown = null;
    if (path.endsWith("attendance_capabilities"))
      data = { version: 1, duration_minutes: true };
    if (path.endsWith("attendance_status"))
      data = {
        eligible: true,
        server_time: new Date().toISOString(),
        round: control.active ? control.round : null,
        closes_at: new Date(Date.now() + 800000).toISOString(),
        latitude: 10,
        longitude: 105,
        radius_m: 100,
      };
    if (path.endsWith("attendance_display"))
      data = {
        title: event.title,
        server_time: new Date().toISOString(),
        round: control.active ? control.round : null,
        token: control.active ? token : null,
        expires_at: new Date(Date.now() + 5000).toISOString(),
        closes_at: new Date(Date.now() + 800000).toISOString(),
      };
    const owns =
      input.p_browser_id === control.browserId &&
      input.p_secret === control.secret;
    if (path.endsWith("attendance_own")) data = owns ? control.record : null;
    if (path.endsWith("attendance_submit")) {
      control.writes++;
      if (
        control.fail ||
        (control.record &&
          (!owns ||
            control.record[
              control.round === 1 ? "round_one_at" : "round_two_at"
            ]))
      )
        data = { ok: false };
      else {
        control.browserId = input.p_browser_id;
        control.secret = input.p_secret;
        control.record = {
          id: "stable-record",
          event_id: event.id,
          full_name: input.p_name,
          student_id: input.p_student_id,
          round_one_at: null,
          round_two_at: null,
          ...control.record,
          [control.round === 1 ? "round_one_at" : "round_two_at"]:
            new Date().toISOString(),
          count: control.record ? 2 : 1,
        };
        data = { ok: true, record: control.record, round: control.round };
        if (control.lost) return route.abort("failed");
      }
    }
    if (path.endsWith("attendance_edit")) {
      if (control.editFail || !owns) data = { ok: false };
      else {
        control.record = {
          ...control.record,
          full_name: input.p_name,
          student_id: input.p_student_id,
        };
        data = { ok: true, record: control.record };
      }
    }
    if (path.endsWith("attendance_results"))
      data = control.record ? [{ ...control.record, history: [] }] : [];
    return route.fulfill({ json: data });
  });
  await page.addInitScript(
    ({ matrix }) => {
      const runtime = window as unknown as {
        qrVisible: boolean;
        cameraStarts: number;
        cameraStops: number;
        geoCalls: number;
        denyGeo: boolean;
        denyCamera: boolean;
      };
      runtime.qrVisible = false;
      runtime.cameraStarts = 0;
      runtime.cameraStops = 0;
      runtime.geoCalls = 0;
      Object.defineProperty(navigator, "geolocation", {
        value: {
          getCurrentPosition: (
            success: (v: unknown) => void,
            failure: (v: unknown) => void,
          ) => {
            runtime.geoCalls++;
            if (runtime.denyGeo) failure({ code: 1 });
            else
              success({
                coords: { latitude: 10, longitude: 105, accuracy: 5 },
                timestamp: Date.now(),
              });
          },
        },
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          runtime.cameraStarts++;
          if (runtime.denyCamera)
            throw new DOMException("Denied", "NotAllowedError");
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 410;
          const ctx = canvas.getContext("2d")!;
          const paint = () => {
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, 410, 410);
            ctx.fillStyle = "black";
            if (runtime.qrVisible) {
              matrix.forEach((row, y) =>
                row.forEach((v, x) => {
                  if (v) ctx.fillRect((x + 4) * 10, (y + 4) * 10, 10, 10);
                }),
              );
            } else {
              ctx.font = "16px sans-serif";
              ctx.fillText("Video mô phỏng để kiểm thử", 95, 200);
            }
          };
          paint();
          const interval = setInterval(paint, 80),
            stream = canvas.captureStream(15);
          stream.getTracks().forEach((track) => {
            const stop = track.stop.bind(track);
            track.stop = () => {
              runtime.cameraStops++;
              clearInterval(interval);
              stop();
            };
          });
          return stream;
        },
      });
    },
    { matrix: encodeQr(token) },
  );
  return { control, writes };
}
const shot = async (page: Page, name: string) => {
  await mkdir(".local/attendance", { recursive: true });
  await page.screenshot({
    path: `.local/attendance/${name}.png`,
    fullPage: false,
  });
};
const openCard = async (page: Page) => {
  await page.goto("/hsv/thiep-moi/design-fixture/thanh-vien");
  await expect(page.getByRole("dialog")).toBeVisible();
};
const prepare = async (page: Page) => {
  await page
    .getByRole("button", { name: "Bắt đầu điểm danh", exact: true })
    .click();
  await page.getByLabel("Họ tên", { exact: true }).fill("Sinh viên kiểm thử");
  await page.getByLabel("MSSV", { exact: true }).fill("TEST001");
};
test("publication writes only status, disables pending switch, and rolls back failed writes", async ({
  page,
}) => {
  await fixture(page, true);
  let captured: unknown;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  await page.route("**/rest/v1/events?*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    captured = route.request().postDataJSON();
    await gate;
    return route.fulfill({ status: 500, json: { message: "Lỗi kiểm thử" } });
  });
  await page.goto("/hsv/admin/");
  const row = page.locator('[data-event-code="design-fixture"]');
  const toggle = row
    .getByRole("switch", { name: "Đã công khai", exact: true })
    .first();
  await toggle.click();
  await expect(
    row.getByRole("switch", { name: "Chưa công khai", exact: true }),
  ).toBeDisabled();
  expect(captured).toEqual({ status: "draft" });
  finish();
  await expect(toggle).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("Lỗi kiểm thử");
});
test("closed rounds do not auto-popup; denied permissions are explained before any write", async ({
  page,
}) => {
  const { control } = await fixture(page);
  control.active = false;
  await page.goto("/hsv/thiep-moi/design-fixture/thanh-vien");
  await page.waitForTimeout(300);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  control.active = true;
  await expect(page.getByRole("dialog")).toBeVisible();
  await prepare(page);
  await page.evaluate(
    () => ((window as unknown as { denyGeo: boolean }).denyGeo = true),
  );
  await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Cho phép truy cập vị trí",
  );
  expect(control.writes).toBe(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { cameraStarts: number }).cameraStarts,
    ),
  ).toBe(0);
});
test("lost response recovers own result, reload preserves key, corrections preserve one record", async ({
  page,
}) => {
  const { control } = await fixture(page);
  control.lost = true;
  await openCard(page);
  await prepare(page);
  await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
  await page.evaluate(
    () => ((window as unknown as { qrVisible: boolean }).qrVisible = true),
  );
  await expect(
    page.getByRole("heading", { name: "Đã ghi nhận điểm danh" }),
  ).toBeVisible();
  expect(control.writes).toBe(1);
  const before = { ...control.record };
  for (const student of ["FIX001", "FIX002"]) {
    await page
      .getByRole("button", { name: "Chỉnh sửa thông tin", exact: true })
      .click();
    await page.getByLabel("MSSV", { exact: true }).fill(student);
    await page.getByRole("button", { name: "Lưu thông tin" }).click();
    await expect(page.getByRole("dialog")).toContainText(student);
  }
  expect(control.record?.id).toBe(before.id);
  expect(control.record?.round_one_at).toBe(before.round_one_at);
  expect(control.writes).toBe(1);
  const key = await page.evaluate(
    (id) => localStorage.getItem(`hsv.attendance.key.v1.${id}`),
    event.id,
  );
  await page.reload();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`hsv.attendance.key.v1.${id}`),
      event.id,
    ),
  ).toBe(key);
  await page
    .getByRole("button", { name: "Điểm danh đợt 1", exact: true })
    .click();
  await page.getByRole("button", { name: "Xem kết quả đã lưu" }).click();
  await expect(page.getByRole("dialog")).toContainText("FIX002");
});
for (const width of [320, 390, 768, 1440])
  test(`attendance visual/interaction evidence at ${width}px`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === "mobile",
      "Widths are explicitly exercised in desktop Chromium, including 320 and 390.",
    );
    await page.setViewportSize({ width, height: 900 });
    const { control } = await fixture(page, true);
    await page.goto("/hsv/admin/edit/design-fixture");
    await expect(page.locator(".editor-nav a")).toHaveCount(6);
    await page.locator('.editor-nav a[href="#editor-attendance"]').click();
    await shot(page, `config-${width}`);
    const position = await page.locator("#editor-attendance").boundingBox(),
      nav = await page.locator(".editor-nav").boundingBox();
    expect(position!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height - 2);
    await page
      .getByRole("heading", { name: "Hai đợt điểm danh", exact: true })
      .evaluate((element) => {
        const offset =
          document.querySelector(".editor-nav")!.getBoundingClientRect()
            .bottom + 20;
        window.scrollBy(0, element.getBoundingClientRect().top - offset);
      });
    await shot(page, `schedule-${width}`);
    await page.getByRole("button", { name: "Chọn ghim điểm danh" }).click();
    await page.locator(".attendance-map").scrollIntoViewIfNeeded();
    await shot(page, `pin-${width}`);
    await page.getByLabel("Bán kính (m)").fill("150");
    await page.getByRole("link", { name: "Về danh sách quản trị" }).click();
    await expect(
      page.getByRole("dialog", { name: "Rời trang khi chưa lưu?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Hủy", exact: true }).click();
    await expect(page.getByLabel("Bán kính (m)")).toHaveValue("150");
    await page.goto("/hsv/admin/attendance/design-fixture/display");
    await expect(
      page.getByRole("img", { name: "QR điểm danh hiện tại" }),
    ).toBeVisible();
    await shot(page, `display-${width}`);
    await openCard(page);
    await prepare(page);
    await shot(page, `prepare-${width}`);
    await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
    await expect(
      page.getByText(
        "Đưa QR đang trình chiếu vào giữa khung hình, giữ máy ổn định.",
      ),
    ).toBeVisible();
    await shot(page, `scan-${width}`);
    control.fail = true;
    await page.evaluate(
      () => ((window as unknown as { qrVisible: boolean }).qrVisible = true),
    );
    await expect(page.getByRole("alert")).toContainText(
      "Không thể ghi nhận điểm danh.",
    );
    await shot(page, `failure-${width}`);
    control.fail = false;
    await page.getByRole("button", { name: "Thử lại", exact: true }).click();
    await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
    await expect(
      page.getByRole("heading", { name: "Đã ghi nhận điểm danh" }),
    ).toBeVisible();
    await shot(page, `success-${width}`);
    await page
      .getByRole("button", { name: "Chỉnh sửa thông tin", exact: true })
      .click();
    await page.getByLabel("MSSV", { exact: true }).fill("NEW001");
    control.editFail = true;
    await page.getByRole("button", { name: "Lưu thông tin" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Không thể cập nhật thông tin.",
    );
    await expect(page.getByLabel("MSSV", { exact: true })).toHaveValue(
      "NEW001",
    );
    await shot(page, `edit-${width}`);
    await page.getByRole("button", { name: "Đóng điểm danh" }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { cameraStops: number }).cameraStops,
      ),
    ).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
test("default recipient uses saved current type/primary alias and selection waits for Save", async ({
  page,
}) => {
  const { writes } = await fixture(page, true);
  await page.goto("/hsv/admin/edit/design-fixture");
  await page
    .getByLabel("Người hoặc đơn vị nhận thiệp")
    .selectOption("inv-design-group");
  expect(writes.filter((w) => w.path.endsWith("save_event"))).toHaveLength(0);
  await page.getByLabel("Tên sự kiện *").fill("Nội dung chưa lưu");
  await page.getByRole("button", { name: "Lưu sự kiện", exact: true }).click();
  await expect(page.getByText("Đã lưu sự kiện", { exact: true })).toBeVisible();
  expect(
    (
      writes.find((w) => w.path.endsWith("save_event"))!.body as {
        p_event: { default_invitation_id: string; title: string };
      }
    ).p_event,
  ).toMatchObject({
    default_invitation_id: "inv-design-group",
    title: "Nội dung chưa lưu",
  });
  await page.route("**/rest/v1/rpc/get_event_v110", (route) =>
    route.fulfill({
      json: { ...event, default_invitation_alias: "thanh-vien" },
    }),
  );
  await page.goto("/hsv/design-fixture");
  await expect(page).toHaveURL(/\/hsv\/thiep-moi\/design-fixture\/thanh-vien$/);
  await page.getByRole("button", { name: "Đóng điểm danh" }).click();
  await expect(
    page.getByText("Thành viên và cộng tác viên", { exact: true }),
  ).toBeVisible();
  await page.goto("/hsv/thiep-moi/design-fixture/minh-an");
  await expect(page.getByText("Nguyễn Minh An", { exact: true })).toBeVisible();
  await page.route("**/rest/v1/rpc/get_event_v110", (route) =>
    route.fulfill({ json: { ...event, default_invitation_alias: null } }),
  );
  await page.goto("/hsv/thiep-moi/design-fixture");
  await expect(
    page.getByRole("heading", { name: event.title, exact: true }),
  ).toBeVisible();
});
test("camera cleanup, permission retry, focus, accessibility and narrow keyboard viewport", async ({
  page,
}) => {
  await fixture(page);
  await openCard(page);
  await prepare(page);
  await page.evaluate(
    () => ((window as unknown as { denyCamera: boolean }).denyCamera = true),
  );
  await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Cho phép truy cập camera",
  );
  await page.evaluate(
    () => ((window as unknown as { denyCamera: boolean }).denyCamera = false),
  );
  await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
  await expect(
    page.getByText(
      "Đưa QR đang trình chiếu vào giữa khung hình, giữ máy ổn định.",
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { cameraStops: number }).cameraStops,
    ),
  ).toBe(1);
  await expect(
    page.getByRole("button", { name: "Điểm danh đợt 1", exact: true }),
  ).toBeFocused();
  await page.waitForTimeout(3200);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Điểm danh đợt 1", exact: true })
    .click();
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 420 });
  await page.getByLabel("MSSV", { exact: true }).focus();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.height).toBeLessThanOrEqual(396);
  const axe = await new AxeBuilder({ page })
    .include(".attendance-dialog")
    .analyze();
  expect(axe.violations).toEqual([]);
});
test("projector removes expired QR after network loss and pause/resume requests a fresh code", async ({
  page,
}) => {
  await fixture(page, true);
  await page.goto("/hsv/admin/attendance/design-fixture/display");
  await expect(
    page.getByRole("img", { name: "QR điểm danh hiện tại" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tạm dừng trình chiếu" }).click();
  await expect(
    page.getByRole("img", { name: "QR điểm danh hiện tại" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Tiếp tục trình chiếu" }).click();
  await expect(
    page.getByRole("img", { name: "QR điểm danh hiện tại" }),
  ).toBeVisible();
  await page.route("**/rest/v1/rpc/attendance_display", (route) =>
    route.abort("failed"),
  );
  await expect(
    page.getByRole("img", { name: "QR điểm danh hiện tại" }),
  ).toHaveCount(0, { timeout: 7000 });
  await expect(page.getByRole("status")).toContainText("Mất kết nối");
});

test("second round checks server state on return, takes a new location and preserves the first timestamp", async ({
  page,
}) => {
  const { control } = await fixture(page);
  await openCard(page);
  await prepare(page);
  await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
  await page.evaluate(
    () => ((window as unknown as { qrVisible: boolean }).qrVisible = true),
  );
  await expect(
    page.getByRole("heading", { name: "Đã ghi nhận điểm danh" }),
  ).toBeVisible();
  const first = control.record?.round_one_at;
  await page.getByRole("button", { name: "Đóng điểm danh" }).click();
  control.active = false;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("button", { name: "Kết quả điểm danh", exact: true }),
  ).toBeVisible();
  await page.clock.setSystemTime(new Date("2040-01-01T12:00:00Z"));
  control.round = 2;
  control.active = true;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByRole("dialog")).toContainText("Đợt 2 đang mở.");
  await page
    .getByRole("button", { name: "Bắt đầu điểm danh", exact: true })
    .click();
  await expect(page.getByLabel("MSSV", { exact: true })).toHaveValue("TEST001");
  await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
  await expect(page.getByRole("dialog")).toContainText("Đợt 2 vừa ghi nhận");
  expect(control.record?.round_one_at).toBe(first);
  expect(control.record?.count).toBe(2);
  expect(
    await page.evaluate(
      () => (window as unknown as { geoCalls: number }).geoCalls,
    ),
  ).toBe(2);
  control.active = false;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await page
    .getByRole("button", { name: "Chỉnh sửa thông tin", exact: true })
    .click();
  await page.getByLabel("MSSV", { exact: true }).fill("AFTER002");
  await page.getByRole("button", { name: "Lưu thông tin" }).click();
  await expect(page.getByRole("dialog")).toContainText("AFTER002");
  expect(control.record?.count).toBe(2);
});

test("missing storage fails before permission requests; lost key cannot read the old record", async ({
  page,
}) => {
  const { control } = await fixture(page);
  await openCard(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Unavailable", "QuotaExceededError");
    };
  });
  await page
    .getByRole("button", { name: "Bắt đầu điểm danh", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Không sử dụng được bộ nhớ",
  );
  expect(control.writes).toBe(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { geoCalls: number }).geoCalls,
    ),
  ).toBe(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Điểm danh đợt 1", exact: true })
    .click();
  await prepare(page);
  await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
  await page.evaluate(
    () => ((window as unknown as { qrVisible: boolean }).qrVisible = true),
  );
  await expect(
    page.getByRole("heading", { name: "Đã ghi nhận điểm danh" }),
  ).toBeVisible();
  const id = control.record?.id;
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page
    .getByRole("button", { name: "Điểm danh đợt 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Xem kết quả đã lưu" }),
  ).toHaveCount(0);
  await prepare(page);
  await page.getByRole("button", { name: "Lấy vị trí và quét QR" }).click();
  await page.evaluate(
    () => ((window as unknown as { qrVisible: boolean }).qrVisible = true),
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Không thể ghi nhận điểm danh.",
  );
  expect(control.record?.id).toBe(id);
  expect(control.record?.count).toBe(1);
});

test("staff results refresh the same row and export an importable CSV without browser keys", async ({
  page,
}, info) => {
  const { control } = await fixture(page, true);
  await page.goto("/hsv/admin/attendance/design-fixture");
  await expect(
    page.getByText("Chưa có lượt điểm danh.", { exact: true }),
  ).toBeVisible();
  control.record = {
    id: "stable-record",
    event_id: event.id,
    invitation_id: "inv-design-group",
    full_name: "=FORMULA()",
    student_id: "001234",
    count: 1,
    round_one_at: "2026-11-23T01:55:00Z",
    round_two_at: null,
  };
  await page
    .getByRole("button", { name: "Tải lại kết quả", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất CSV", exact: true }).click();
  const download = await downloading;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain('"\'=FORMULA()"');
  expect(csv).toContain('"001234"');
  expect(csv).toContain("2026-11-23T01:55:00Z");
  expect(csv).not.toContain("secret");
  expect(csv).not.toContain("browser_id");
  control.record = {
    ...control.record,
    full_name: "Tên đã sửa",
    student_id: "CORRECT001",
  };
  await page
    .getByRole("button", { name: "Tải lại kết quả", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("CORRECT001");
  await shot(page, `results-${info.project.name}`);
});

test("saved pin persists, moving it requires confirmation, and short Maps links resolve on opening", async ({
  page,
}) => {
  await fixture(page, true);
  await page.route("**/rest/v1/rpc/get_event_v110", (route) =>
    route.fulfill({
      json: {
        ...event,
        maps_url: "https://maps.app.goo.gl/fixture",
        latitude: null,
        longitude: null,
        attendance_config: null,
      },
    }),
  );
  let resolves = 0;
  await page.route("**/functions/v1/attendance-location", (route) => {
    resolves++;
    return route.fulfill({ json: { latitude: 10.1, longitude: 105.2 } });
  });
  await page.goto("/hsv/admin/edit/design-fixture");
  await page.getByRole("button", { name: "Chọn ghim điểm danh" }).click();
  await expect(page.getByLabel("Vĩ độ", { exact: true })).toHaveValue("10.1");
  expect(resolves).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Xác nhận ghim điểm danh" }).click();
  await expect(
    page.getByText("Đã xác nhận: 10.1, 105.2", { exact: true }),
  ).toBeVisible();
  const circle = await page.locator(".pin-radius").boundingBox();
  await page.getByLabel("Bán kính (m)").fill("200");
  expect((await page.locator(".pin-radius").boundingBox())!.width).toBeCloseTo(
    circle!.width * 4,
    0,
  );
  await page.locator(".attendance-map").focus();
  await page.keyboard.press("ArrowUp");
  await expect(
    page.getByText("Cần kiểm tra và xác nhận ghim trước khi bật.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận ghim điểm danh" }).click();
  const latitude = await page.getByLabel("Vĩ độ", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Đóng bản đồ" }).click();
  await page.getByRole("button", { name: "Chọn ghim điểm danh" }).click();
  await expect(page.getByLabel("Vĩ độ", { exact: true })).toHaveValue(latitude);
  await expect(
    page.getByText("Ghim đã được xác nhận.", { exact: true }),
  ).toBeVisible();
});

test("attendance uses segmented hours without date inputs and follows event dates while retaining seconds", async ({
  page,
}, info) => {
  const { writes } = await fixture(page, true);
  await page.goto("/hsv/admin/edit/design-fixture");
  const attendance = page.locator("#editor-attendance");
  await expect(attendance.locator('input[type="date"]')).toHaveCount(0);
  const hour = page.getByLabel("Giờ mở đợt 1", { exact: true });
  const minute = page.getByLabel("Phút mở đợt 1", { exact: true });
  const second = page.getByLabel("Giây mở đợt 1", { exact: true });
  await expect(hour).toHaveValue("08");
  await expect(minute).toHaveValue("52");
  await expect(second).toHaveValue("30");
  await hour.focus();
  await hour.pressSequentially("09");
  await expect(hour).toHaveValue("09");
  await expect(minute).toBeFocused();
  await minute.fill("00");
  await expect(second).toBeFocused();
  await expect(attendance).toContainText("09:15:30");
  await hour.fill("27");
  await page.getByRole("button", { name: "Lưu sự kiện", exact: true }).click();
  await expect(attendance.getByRole("alert")).toContainText("Nhập đủ giờ");
  expect(writes).toHaveLength(0);
  await page.getByRole("link", { name: "Về danh sách quản trị" }).click();
  await expect(
    page.getByRole("dialog", { name: "Rời trang khi chưa lưu?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await expect(hour).toHaveValue("27");
  await hour.fill("09");
  await page
    .getByRole("button", { name: "Thời gian sự kiện", exact: true })
    .click();
  await page.getByLabel("Ngày Kết thúc", { exact: true }).fill("2099-10-21");
  await page.getByLabel("Ngày Bắt đầu", { exact: true }).fill("2099-10-21");
  await expect(hour).toHaveValue("09");
  await expect(second).toHaveValue("30");
  await expect(attendance).toContainText("21/10/99");
  await attendance
    .getByRole("heading", { name: "Hai đợt điểm danh", exact: true })
    .evaluate((element) => {
      const offset =
        document.querySelector(".editor-nav")!.getBoundingClientRect().bottom +
        20;
      window.scrollBy(0, element.getBoundingClientRect().top - offset);
    });
  await shot(page, `time-only-${info.project.name}`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Lưu sự kiện", exact: true }).click();
  await expect(page.getByText("Đã lưu sự kiện", { exact: true })).toBeVisible();
  expect(
    (
      writes.find((w) => w.path.endsWith("save_event"))!.body as {
        p_event: { attendance_config: unknown };
      }
    ).p_event.attendance_config,
  ).toMatchObject({
    round_one: "2099-10-21T02:00:30.000Z",
    round_two: "2099-10-21T02:45:00.000Z",
  });
});

test("new attendance defaults to 50m and ten minutes, custom duration follows Save and legacy values remain intact", async ({
  page,
}, info) => {
  const { writes } = await designBackend(page, {
    admin: true,
    event: { ...event, attendance_config: null },
  });
  await page.route("**/rest/v1/rpc/attendance_capabilities", (route) =>
    route.fulfill({ json: { version: 1, duration_minutes: true } }),
  );
  await page.goto("/hsv/admin/edit/design-fixture");
  const section = page.locator("#editor-attendance");
  const duration = page.getByLabel("Thời lượng mỗi đợt (phút)");
  await expect(page.getByLabel("Bán kính (m)")).toHaveValue("50");
  await expect(duration).toHaveValue("10");
  await expect(page.getByLabel("Phút mở đợt 1", { exact: true })).toHaveValue(
    "55",
  );
  await expect(section).toContainText("09:05:00");
  await duration.fill("0");
  await expect(section.getByRole("alert")).toContainText(
    "thời lượng mỗi đợt từ 1 đến 60 phút",
  );
  await page.getByRole("button", { name: "Lưu sự kiện", exact: true }).click();
  expect(writes).toHaveLength(0);
  await duration.fill("7");
  await expect(page.getByLabel("Phút mở đợt 1", { exact: true })).toHaveValue(
    "55",
  );
  await expect(section).toContainText("09:02:00");
  await page.getByRole("button", { name: "Tính lại lịch mặc định" }).click();
  await expect(page.getByLabel("Phút mở đợt 1", { exact: true })).toHaveValue(
    "56",
  );
  await expect(page.getByLabel("Giây mở đợt 1", { exact: true })).toHaveValue(
    "30",
  );
  await expect(section).toContainText("09:03:30");
  await page.getByRole("link", { name: "Về danh sách quản trị" }).click();
  await expect(
    page.getByRole("dialog", { name: "Rời trang khi chưa lưu?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  for (const width of info.project.name === "desktop"
    ? [320, 390, 768, 1440]
    : [390]) {
    await page.setViewportSize({ width, height: 900 });
    await duration.scrollIntoViewIfNeeded();
    await shot(page, `duration-${info.project.name}-${width}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Lưu sự kiện", exact: true }).click();
  await expect(page.getByText("Đã lưu sự kiện", { exact: true })).toBeVisible();
  const saved = (
    writes.find((write) => write.path.endsWith("save_event"))!.body as {
      p_event: { attendance_config: unknown };
    }
  ).p_event.attendance_config;
  expect(saved).toMatchObject({
    radius_m: 50,
    duration_minutes: 7,
    round_one: "2099-10-20T01:56:30.000Z",
    round_two: "2099-10-20T02:53:00.000Z",
  });
});

test("Plus Code selects a pin without saving, requires confirmation and handles locality lookup failures", async ({
  page,
}, info) => {
  const { writes } = await fixture(page, true);
  let lookups = 0;
  await page.route("https://nominatim.openstreetmap.org/**", (route) => {
    lookups++;
    return route.fulfill({
      json: [{ lat: "10", lon: "105", display_name: "Địa phương kiểm thử" }],
    });
  });
  await page.goto("/hsv/admin/edit/design-fixture");
  await page.getByRole("button", { name: "Chọn ghim điểm danh" }).click();
  const code = page.getByLabel("Plus Code Google Maps", { exact: true });
  await code.fill("7P272222+22");
  await code.press("Enter");
  await expect(page.getByLabel("Vĩ độ", { exact: true })).toHaveValue(
    "10.0000625",
  );
  await expect(page.getByLabel("Kinh độ", { exact: true })).toHaveValue(
    "105.0000625",
  );
  expect(lookups).toBe(0);
  expect(writes).toHaveLength(0);
  await expect(
    page.getByText("Cần kiểm tra và xác nhận ghim trước khi bật.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xác nhận ghim điểm danh" }).click();
  await expect(
    page.getByText("Ghim đã được xác nhận.", { exact: true }),
  ).toBeVisible();
  await code.fill("not-a-code");
  await page.getByRole("button", { name: "Đặt ghim từ Plus Code" }).click();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Vĩ độ", { exact: true })).toHaveValue(
    "10.0000625",
  );
  await code.fill("2222+22 Địa phương kiểm thử");
  await page.getByRole("button", { name: "Đặt ghim từ Plus Code" }).click();
  await expect(
    page.getByText(
      "Ghim gợi ý chưa được xác nhận. Kiểm tra trên bản đồ trước khi dùng.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(lookups).toBe(1);
  await page.getByRole("button", { name: "Xác nhận ghim điểm danh" }).click();
  await code.scrollIntoViewIfNeeded();
  await shot(page, `plus-code-${info.project.name}`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.waitForTimeout(1150);
  await page.route("https://nominatim.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.getByRole("button", { name: "Đặt ghim từ Plus Code" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Không tìm được địa phương lúc này" }),
  ).toBeVisible();
  await expect(
    page.getByText("Ghim đã được xác nhận.", { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
});
