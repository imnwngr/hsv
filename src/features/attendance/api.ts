import { db } from "../../lib/supabase";
import type {
  AttendanceConfig,
  AttendanceRecord,
  AttendanceStatus,
  PositionFix,
} from "./model";
export interface BrowserKey {
  id: string;
  secret: string;
}
const storageName = (eventId: string) => `hsv.attendance.key.v1.${eventId}`;
export async function browserKey(
  eventId: string,
  create = false,
): Promise<BrowserKey | null> {
  if (!navigator.locks)
    throw Error("Trình duyệt chưa hỗ trợ lưu khóa điểm danh an toàn.");
  return navigator.locks.request(storageName(eventId), () =>
    storedKey(eventId, create),
  );
}
function storedKey(eventId: string, create: boolean): BrowserKey | null {
  const storage = window.localStorage;
  const name = storageName(eventId);
  const raw = storage.getItem(name);
  if (raw) {
    const key = JSON.parse(raw) as BrowserKey;
    if (!/^[0-9a-f-]{36}$/.test(key.id) || !/^[0-9a-f]{64}$/.test(key.secret))
      throw Error("Không sử dụng được khóa điểm danh đã lưu.");
    // A write/read probe tests storage availability, not private-browsing mode.
    storage.setItem(name, raw);
    if (storage.getItem(name) !== raw)
      throw Error("Không lưu được khóa điểm danh.");
    return key;
  }
  if (!create) return null;
  const key = {
    id: crypto.randomUUID(),
    secret: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
  storage.setItem(name, JSON.stringify(key));
  if (storage.getItem(name) !== JSON.stringify(key))
    throw Error("Không lưu được khóa điểm danh.");
  return key;
}
async function rpc<T>(name: string, body: Record<string, unknown>) {
  const { data, error } = await db()
    .rpc(name, body)
    .abortSignal(AbortSignal.timeout(10_000));
  if (error) throw Error("Không thể kết nối hệ thống điểm danh.");
  return data as T;
}
const auth = (code: string, key: BrowserKey) => ({
  p_code: code,
  p_browser_id: key.id,
  p_secret: key.secret,
});
export const attendanceStatus = (code: string, alias: string) =>
  rpc<AttendanceStatus>("attendance_status", { p_code: code, p_alias: alias });
export const ownAttendance = (code: string, key: BrowserKey) =>
  rpc<AttendanceRecord | null>("attendance_own", auth(code, key));
export const editAttendance = (
  code: string,
  key: BrowserKey,
  name: string,
  student: string,
) =>
  rpc<{ ok: boolean; record?: AttendanceRecord }>("attendance_edit", {
    ...auth(code, key),
    p_name: name,
    p_student_id: student,
  });
export const submitAttendance = (
  code: string,
  alias: string,
  key: BrowserKey,
  name: string,
  student: string,
  token: string,
  position: PositionFix,
) =>
  rpc<{ ok: boolean; round?: 1 | 2; record?: AttendanceRecord }>(
    "attendance_submit",
    {
      ...auth(code, key),
      p_alias: alias,
      p_name: name,
      p_student_id: student,
      p_token: token,
      p_position: position,
    },
  );
export interface DisplayState {
  title: string;
  server_time: string;
  round: 1 | 2 | null;
  token: string | null;
  expires_at?: string;
  closes_at?: string;
  qr_seconds?: number;
  config?: AttendanceConfig | null;
}
export const attendanceDisplay = (code: string) =>
  rpc<DisplayState>("attendance_display", { p_code: code });
export interface AttendanceAdminRecord extends AttendanceRecord {
  history: {
    id: number;
    changed_at: string;
    old_name: string;
    old_student_id: string;
    new_name: string;
    new_student_id: string;
  }[];
}
export const attendanceResults = (code: string) =>
  rpc<AttendanceAdminRecord[]>("attendance_results", { p_code: code });
export function attendanceCsv(rows: AttendanceAdminRecord[]) {
  const cell = (value: string | number | null) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    "\ufeff" +
    [
      [
        "ID",
        "Họ tên",
        "MSSV",
        "Số đợt",
        "Đợt 1 (UTC)",
        "Đợt 2 (UTC)",
        "ID thiệp",
      ],
      ...rows.map((r) => [
        r.id,
        r.full_name,
        r.student_id,
        r.count,
        r.round_one_at,
        r.round_two_at,
        r.invitation_id,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
