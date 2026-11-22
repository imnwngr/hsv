import type { Page } from "@playwright/test";

// Matrix captures are review artifacts, not screenshot assertions. Failure
// screenshots and traces remain enabled by the Playwright configuration.
export async function captureVisualEvidence(
  page: Page,
  options: Parameters<Page["screenshot"]>[0],
) {
  if (process.env.HSV_CAPTURE_VISUALS === "1") {
    await page.screenshot(options);
  }
}
