import { z } from "zod";

export const DEFAULT_ROUND_MINUTES = 10;
export const roundDurationMs = (config: { duration_minutes?: number }) =>
  (config.duration_minutes ?? 15) * 60_000;
export function attendanceTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time + 7 * 3600_000).toISOString().slice(11, 19)
    : value.startsWith("T")
      ? value.slice(1)
      : "";
}
export function attendanceDate(
  round: "round_one" | "round_two",
  starts?: string | null,
  ends?: string | null,
  durationMinutes = DEFAULT_ROUND_MINUTES,
) {
  const start = Date.parse(starts ?? ""),
    end = Date.parse(ends ?? "");
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > 60
  )
    return "";
  const anchor =
    round === "round_one"
      ? start + (end - start) / 2 - durationMinutes * 30_000
      : end - durationMinutes * 60_000;
  return new Date(anchor + 7 * 3600_000).toISOString().slice(0, 10);
}
export function attendanceTimeOnEvent(
  time: string,
  round: "round_one" | "round_two",
  starts?: string | null,
  ends?: string | null,
  durationMinutes = DEFAULT_ROUND_MINUTES,
) {
  if (!time) return "";
  const date = attendanceDate(round, starts, ends, durationMinutes);
  if (!date || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time))
    return `T${time}`;
  return new Date(`${date}T${time}+07:00`).toISOString();
}
export const attendanceSchema = z
  .object({
    enabled: z.boolean(),
    duration_minutes: z.number().int().min(1).max(60).optional(),
    radius_m: z.number().int().min(10).max(1000),
    qr_seconds: z.number().int().min(3).max(60),
    latitude: z.number().min(-85).max(85).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    pin_confirmed: z.boolean(),
    pin_source: z.string().max(5000),
    round_one: z.string(),
    round_two: z.string(),
  })
  .strict();
export type AttendanceConfig = z.infer<typeof attendanceSchema>;
export type LocationSource = {
  maps_url: string;
  place_id: string;
  location_method?: string;
  venue_name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};
export function locationSource(e: LocationSource) {
  return JSON.stringify([
    e.location_method ?? "url",
    e.maps_url,
    e.place_id,
    e.venue_name,
    e.address,
    e.latitude,
    e.longitude,
  ]);
}
export function defaultAttendance(
  starts?: string | null,
  ends?: string | null,
  durationMinutes = DEFAULT_ROUND_MINUTES,
): AttendanceConfig {
  const start = Date.parse(starts ?? ""),
    end = Date.parse(ends ?? "");
  const suitable =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isInteger(durationMinutes) &&
    durationMinutes >= 1 &&
    durationMinutes <= 60 &&
    end - start >= 3 * durationMinutes * 60_000 &&
    end - start <= 24 * 3600_000;
  return {
    enabled: false,
    duration_minutes: durationMinutes,
    radius_m: 50,
    qr_seconds: 5,
    latitude: null,
    longitude: null,
    pin_confirmed: false,
    pin_source: "",
    round_one: suitable
      ? new Date(
          start + (end - start) / 2 - durationMinutes * 30_000,
        ).toISOString()
      : "",
    round_two: suitable
      ? new Date(end - durationMinutes * 60_000).toISOString()
      : "",
  };
}
export function attendanceIssues(
  config: AttendanceConfig,
  e: LocationSource & {
    starts_at: string | null;
    ends_at: string | null;
    event_type?: string;
  },
) {
  const errors: string[] = [];
  if (!attendanceSchema.safeParse(config).success)
    errors.push(
      "Bán kính phải từ 10 đến 1.000 m; chu kỳ QR từ 3 đến 60 giây; thời lượng mỗi đợt từ 1 đến 60 phút, đều là số nguyên. Tọa độ phải hợp lệ.",
    );
  if (!config.enabled || e.event_type === "congratulation") return errors;
  if (
    !config.pin_confirmed ||
    config.latitude === null ||
    config.longitude === null ||
    config.pin_source !== locationSource(e)
  )
    errors.push("Kiểm tra và xác nhận ghim điểm danh cho địa điểm hiện tại.");
  const start = Date.parse(e.starts_at ?? ""),
    end = Date.parse(e.ends_at ?? "");
  const one = Date.parse(config.round_one),
    two = Date.parse(config.round_two);
  const duration = roundDurationMs(config);
  if (
    ![start, end, one, two].every(Number.isFinite) ||
    one < start ||
    two < start ||
    one + duration > end ||
    two + duration > end ||
    one + duration > two
  )
    errors.push(
      "Hai đợt phải theo thứ tự, không chồng nhau và nằm trong thời gian sự kiện.",
    );
  return errors;
}
export function roundAt(
  config: AttendanceConfig,
  serverTime: number,
): 1 | 2 | null {
  if (!config.enabled) return null;
  for (const [index, time] of [config.round_one, config.round_two].entries()) {
    const open = Date.parse(time);
    if (serverTime >= open && serverTime < open + roundDurationMs(config))
      return (index + 1) as 1 | 2;
  }
  return null;
}
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = Math.PI / 180;
  const value =
    Math.sin(((a.latitude - b.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((a.longitude - b.longitude) * rad) / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
}
export interface PositionFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  captured_at: string;
}
export function validPosition(
  fix: PositionFix,
  pin: { latitude: number; longitude: number },
  radius: number,
  serverTime: number,
) {
  const age = serverTime - Date.parse(fix.captured_at);
  return (
    [fix.latitude, fix.longitude, fix.accuracy, age].every(Number.isFinite) &&
    Math.abs(fix.latitude) <= 90 &&
    Math.abs(fix.longitude) <= 180 &&
    fix.accuracy > 0 &&
    fix.accuracy <= Math.min(50, radius / 2) &&
    age >= -5000 &&
    age <= 30_000 &&
    distanceMeters(fix, pin) <= radius
  );
}
export interface AttendanceRecord {
  id: string;
  event_id: string;
  invitation_id: string | null;
  full_name: string;
  student_id: string;
  round_one_at: string | null;
  round_two_at: string | null;
  count: number;
  updated_at: string;
}
export interface AttendanceStatus {
  eligible: boolean;
  server_time: string;
  round: 1 | 2 | null;
  closes_at: string | null;
  radius_m?: number;
  latitude?: number;
  longitude?: number;
}
export const personalInfoSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Nhập họ tên đầy đủ.")
    .max(120, "Họ tên tối đa 120 ký tự."),
  student_id: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9._-]{2,29}$/,
      "MSSV gồm 3–30 chữ hoặc số, dấu chấm, gạch ngang, gạch dưới.",
    ),
});
