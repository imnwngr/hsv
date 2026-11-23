import { it, expect, vi } from "vitest";
import {
  attendanceIssues,
  attendanceDate,
  attendanceTime,
  attendanceTimeOnEvent,
  defaultAttendance,
  distanceMeters,
  locationSource,
  roundAt,
  roundDurationMs,
  validPosition,
} from "../src/features/attendance/model";
import { coordinatesFromMaps } from "../src/features/attendance/mapLinks";
import { resolveMapsLocation } from "../supabase/functions/attendance-location/resolve";
import {
  parsePlusCode,
  pointFromPlusCode,
} from "../src/features/attendance/plusCode";

it("decodes full Plus Codes, padding and precision grids using official OLC vectors", () => {
  // Reference cells: google/open-location-code test_data/decoding.csv.
  for (const [code, latitude, longitude] of [
    ["7FG49Q00+", 20.375, 2.775],
    ["7FG49QCJ+2V", 20.3700625, 2.7821875],
    ["7FG49QCJ+2VX", 20.3701125, 2.782234375],
    ["4VCPPQGP+Q9", -41.2730625, 174.7859375],
    ["7P272222+22", 10.0000625, 105.0000625],
  ] as const) {
    const point = pointFromPlusCode(code)!;
    expect(point.latitude).toBeCloseTo(latitude, 10);
    expect(point.longitude).toBeCloseTo(longitude, 10);
  }
  expect(parsePlusCode("  2222+22 Cần Thơ, Việt Nam  ")).toEqual({
    code: "2222+22",
    locality: "Cần Thơ, Việt Nam",
    short: true,
  });
  expect(pointFromPlusCode("7p272222+22")).toEqual(
    pointFromPlusCode("7P272222+22"),
  );
});

it("requires a reference for short Plus Codes and recovers the nearest cell across boundaries", () => {
  expect(pointFromPlusCode("2222+22")).toBeNull();
  expect(
    pointFromPlusCode("2222+22", { latitude: 10, longitude: 105 }),
  ).toEqual(pointFromPlusCode("7P272222+22"));
  for (const latitude of [51.3852125, 51.3550125]) {
    const point = pointFromPlusCode("9QCJ+2VX", {
      latitude,
      longitude: -1.217765625,
    })!;
    expect(point.latitude).toBeCloseTo(51.3701125, 10);
    expect(point.longitude).toBeCloseTo(-1.217765625, 10);
  }
  expect(
    pointFromPlusCode("22+", { latitude: 42.899, longitude: 9.012 }),
  ).toEqual(pointFromPlusCode("8FJFW222+"));
  for (const code of [
    "",
    "+",
    "10,105",
    "7P272222+2",
    "7P272222+ZZ",
    "7P2+22",
    "7P270000+22",
    "7P200000+",
    "ZZ222222+22",
    "2222+22222222",
  ])
    expect(
      pointFromPlusCode(code, { latitude: 10, longitude: 105 }),
    ).toBeNull();
});
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
it("takes attendance dates from the event in Vietnam time and preserves seconds across midnight", () => {
  expect(
    attendanceTimeOnEvent(
      "08:52:30",
      "round_one",
      event.starts_at,
      event.ends_at,
    ),
  ).toBe("2026-11-23T01:52:30.000Z");
  expect(attendanceTime("2026-11-23T01:52:30.000Z")).toBe("08:52:30");
  const start = "2026-11-23T23:00:00+07:00",
    end = "2026-11-24T01:00:00+07:00";
  expect(attendanceDate("round_one", start, end)).toBe("2026-11-23");
  expect(attendanceDate("round_two", start, end)).toBe("2026-11-24");
  expect(attendanceTimeOnEvent("23:52:30", "round_one", start, end)).toBe(
    "2026-11-23T16:52:30.000Z",
  );
  expect(attendanceTimeOnEvent("00:45:00", "round_two", start, end)).toBe(
    "2026-11-23T17:45:00.000Z",
  );
  expect(attendanceTimeOnEvent("27:00:00", "round_one", start, end)).toBe(
    "T27:00:00",
  );
  expect(attendanceTime("T09::30")).toBe("09::30");
  expect(attendanceTimeOnEvent("", "round_one", start, end)).toBe("");
  expect(attendanceDate("round_one", "", end)).toBe("");
});
it("sets explicit opt-in defaults and calculates Vietnam midpoint to the second", () => {
  const defaults = defaultAttendance(event.starts_at, event.ends_at);
  expect(defaults.enabled).toBe(false);
  expect(defaults.radius_m).toBe(50);
  expect(defaults.qr_seconds).toBe(5);
  expect(defaults.duration_minutes).toBe(10);
  expect(defaults.round_one).toBe("2026-11-23T01:55:00.000Z");
  expect(defaults.round_two).toBe("2026-11-23T02:50:00.000Z");
  expect(
    defaultAttendance(event.starts_at, "2026-11-23T08:29:00+07:00").round_one,
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
  expect(roundAt(c, t + 600000 - 1)).toBe(1);
  expect(roundAt(c, t + 600000)).toBe(null);
  expect(attendanceIssues(c, event)).toEqual([]);
  for (const patch of [
    { radius_m: 0 },
    { radius_m: -5 },
    { qr_seconds: 0 },
    { qr_seconds: 5000 },
    { qr_seconds: 3.5 },
    { duration_minutes: 0 },
    { duration_minutes: -1 },
    { duration_minutes: 61 },
    { duration_minutes: 1.5 },
    { duration_minutes: NaN },
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
it("supports custom duration while retaining 15 minutes for saved legacy configuration", () => {
  const c = {
    ...config(),
    ...defaultAttendance(event.starts_at, event.ends_at, 7),
    enabled: true,
  };
  expect(c.round_one).toBe("2026-11-23T01:56:30.000Z");
  expect(c.round_two).toBe("2026-11-23T02:53:00.000Z");
  expect(roundDurationMs(c)).toBe(420000);
  const legacy = { ...config(), duration_minutes: undefined };
  expect(roundDurationMs(legacy)).toBe(900000);
  const open = Date.parse(legacy.round_one);
  expect(roundAt(legacy, open + 900000 - 1)).toBe(1);
  expect(roundAt(legacy, open + 900000)).toBeNull();
  expect(defaultAttendance(event.starts_at, event.ends_at, 15).round_one).toBe(
    "2026-11-23T01:52:30.000Z",
  );
  expect(attendanceDate("round_one", event.starts_at, event.ends_at, NaN)).toBe(
    "",
  );
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
  const mock = vi.fn().mockResolvedValue(
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
