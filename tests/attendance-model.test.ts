import { it, expect, vi } from "vitest";
import {
  attendanceIssues,
  defaultAttendance,
  distanceMeters,
  locationSource,
  roundAt,
  validPosition,
} from "../src/features/attendance/model";
import { coordinatesFromMaps } from "../src/features/attendance/mapLinks";
import { resolveMapsLocation } from "../supabase/functions/attendance-location/resolve";
const source = {
  maps_url: "https://www.google.com/maps?q=10,105",
  place_id: "",
  location_method: "url",
  venue_name: "Địa điểm thử",
  address: "",
  latitude: null,
  longitude: null,
};
const event = {
  ...source,
  starts_at: "2026-11-23T08:00:00+07:00",
  ends_at: "2026-11-23T10:00:00+07:00",
  event_type: "invitation",
};
const config = () => ({
  ...defaultAttendance(event.starts_at, event.ends_at),
  enabled: true,
  latitude: 10,
  longitude: 105,
  pin_confirmed: true,
  pin_source: locationSource(source),
});
it("sets explicit opt-in defaults and calculates Vietnam midpoint to the second", () => {
  const defaults = defaultAttendance(event.starts_at, event.ends_at);
  expect(defaults.enabled).toBe(false);
  expect(defaults.radius_m).toBe(100);
  expect(defaults.qr_seconds).toBe(5);
  expect(defaults.round_one).toBe("2026-11-23T01:52:30.000Z");
  expect(defaults.round_two).toBe("2026-11-23T02:45:00.000Z");
  expect(
    defaultAttendance(event.starts_at, "2026-11-23T08:30:00+07:00").round_one,
  ).toBe("");
  expect(
    defaultAttendance(event.starts_at, "2026-11-25T10:00:00+07:00").round_one,
  ).toBe("");
});
it("uses inclusive opening/exclusive closing and rejects overlap, invalid ranges and stale pin source", () => {
  const c = config(),
    t = Date.parse(c.round_one);
  expect(roundAt(c, t - 1)).toBe(null);
  expect(roundAt(c, t)).toBe(1);
  expect(roundAt(c, t + 900000 - 1)).toBe(1);
  expect(roundAt(c, t + 900000)).toBe(null);
  expect(attendanceIssues(c, event)).toEqual([]);
  for (const patch of [
    { radius_m: 0 },
    { radius_m: -5 },
    { qr_seconds: 0 },
    { qr_seconds: 5000 },
    { qr_seconds: 3.5 },
    { pin_confirmed: false },
    { pin_source: "[]" },
    { round_two: c.round_one },
  ])
    expect(attendanceIssues({ ...c, ...patch }, event).length).toBeGreaterThan(
      0,
    );
  expect(
    attendanceIssues(c, {
      ...event,
      maps_url: "https://maps.google.com/?q=11,105",
    }).length,
  ).toBeGreaterThan(0);
});
it("checks radius without inflating by accuracy; rejects old/poor/future fixes", () => {
  const t = Date.now(),
    pin = { latitude: 10, longitude: 105 },
    fix = { ...pin, accuracy: 5, captured_at: new Date(t).toISOString() };
  expect(validPosition(fix, pin, 100, t)).toBe(true);
  const near = { ...fix, latitude: 10.0005 },
    far = { ...fix, latitude: 10.001 };
  expect(distanceMeters(near, pin)).toBeGreaterThan(50);
  expect(validPosition(near, pin, 100, t)).toBe(true);
  expect(validPosition(far, pin, 100, t)).toBe(false);
  expect(validPosition(far, pin, 200, t)).toBe(true);
  for (const patch of [
    { accuracy: 51 },
    { accuracy: 0 },
    { captured_at: new Date(t - 30001).toISOString() },
    { captured_at: new Date(t + 5001).toISOString() },
  ])
    expect(validPosition({ ...fix, ...patch }, pin, 100, t)).toBe(false);
});
it("distinguishes place coordinates from viewport centres and safely bounds short-link redirects", async () => {
  expect(coordinatesFromMaps("https://www.google.com/maps/@10,105,15z")).toBe(
    null,
  );
  expect(
    coordinatesFromMaps(
      "https://www.google.com/maps/place/Test/data=!3d10!4d105",
    ),
  ).toEqual({ latitude: 10, longitude: 105 });
  const mock = vi
    .fn()
    .mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://www.google.com/maps?q=10,105" },
      }),
    );
  expect(
    await resolveMapsLocation("https://maps.app.goo.gl/test", mock),
  ).toEqual({ latitude: 10, longitude: 105 });
  expect(mock.mock.calls[0][1].redirect).toBe("manual");
  for (const location of [
    "http://www.google.com/maps?q=10,105",
    "https://127.0.0.1/",
    "https://google.com.evil.test/",
    "https://user:pass@www.google.com/",
    "https://www.google.com:444/",
  ]) {
    mock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location } }),
    );
    await expect(
      resolveMapsLocation("https://maps.app.goo.gl/test", mock),
    ).rejects.toThrow();
  }
  mock.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://maps.app.goo.gl/test" },
    }),
  );
  await expect(
    resolveMapsLocation("https://maps.app.goo.gl/test", mock),
  ).rejects.toThrow("loop");
});
