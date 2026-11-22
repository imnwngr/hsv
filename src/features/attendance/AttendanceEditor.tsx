import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Switch } from "../../components/Switch";
import { DateTime24 } from "../../components/DateTime24";
import type { ClubEvent, EventInput } from "../../types/domain";
import {
  attendanceIssues,
  defaultAttendance,
  locationSource,
  ROUND_MS,
  type AttendanceConfig,
} from "./model";
import "../../styles/attendance.css";
const PinPicker = lazy(() => import("./PinPicker"));
const show = (date: string) =>
  Number.isFinite(Date.parse(date))
    ? new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        dateStyle: "short",
        timeStyle: "medium",
        hourCycle: "h23",
      }).format(new Date(date))
    : "Chưa chọn giờ";
export function AttendanceEditor({
  value,
  event,
  saved,
  onChange,
  error,
}: {
  value?: AttendanceConfig | null;
  event: EventInput;
  saved?: ClubEvent;
  onChange: (value: AttendanceConfig) => void;
  error?: string;
}) {
  const config = value ?? defaultAttendance(event.starts_at, event.ends_at);
  const [pinOpen, setPinOpen] = useState(false);
  const issues = attendanceIssues(config, event);
  const link = saved
    ? `${window.location.origin}${import.meta.env.BASE_URL}admin/attendance/${encodeURIComponent(saved.code)}/display`
    : "";
  return (
    <fieldset id="editor-attendance">
      <legend>Điểm danh</legend>
      <p className="field-hint">
        Chỉ dành cho thiệp nhóm. Hai đợt tự mở theo giờ Việt Nam; tắt điểm danh
        vẫn giữ kết quả đã ghi nhận.
      </p>
      <Switch
        checked={config.enabled}
        label="Bật điểm danh theo lịch"
        onChange={(enabled) => onChange({ ...config, enabled })}
      />
      <div className="attendance-fields">
        <label>
          Bán kính (m)
          <input
            type="number"
            min={10}
            max={1000}
            step={1}
            value={config.radius_m}
            onChange={(e) =>
              onChange({ ...config, radius_m: e.target.valueAsNumber })
            }
          />
        </label>
        <label>
          Chu kỳ thay QR (giây)
          <input
            type="number"
            min={3}
            max={60}
            step={1}
            value={config.qr_seconds}
            onChange={(e) =>
              onChange({ ...config, qr_seconds: e.target.valueAsNumber })
            }
          />
        </label>
      </div>
      <p className="field-hint">
        Bán kính 10–1.000 m. QR đổi mỗi 3–60 giây; mã cũ chỉ được chấp nhận thêm
        tối đa 1 giây, không vượt giờ đóng đợt.
      </p>
      <h3>Vị trí điểm danh</h3>
      <p>
        {config.pin_confirmed && config.pin_source === locationSource(event)
          ? `Đã xác nhận: ${config.latitude}, ${config.longitude}`
          : "Cần kiểm tra và xác nhận ghim trước khi bật."}
      </p>
      <button
        type="button"
        className="secondary"
        aria-expanded={pinOpen}
        onClick={() => setPinOpen(!pinOpen)}
      >
        {pinOpen ? "Đóng bản đồ" : "Chọn ghim điểm danh"}
      </button>
      {pinOpen && (
        <Suspense fallback={<p role="status">Đang tải phần chọn ghim…</p>}>
          <PinPicker value={config} source={event} onChange={onChange} />
        </Suspense>
      )}
      <h3>Hai đợt điểm danh</h3>
      <div className="attendance-fields">
        {(["round_one", "round_two"] as const).map((key, index) => (
          <div key={key}>
            <DateTime24
              label={`mở đợt ${index + 1}`}
              value={config[key]}
              onChange={(value) => {
                const parsed = Date.parse(value),
                  previous = Date.parse(config[key]);
                onChange({
                  ...config,
                  [key]: Number.isFinite(parsed)
                    ? new Date(
                        parsed +
                          (Number.isFinite(previous) ? previous % 60_000 : 0),
                      ).toISOString()
                    : value,
                });
              }}
            />
            <label>
              Giây mở đợt {index + 1}
              <select
                value={
                  Number.isFinite(Date.parse(config[key]))
                    ? new Date(config[key]).getUTCSeconds()
                    : 0
                }
                onChange={(e) => {
                  const time = Date.parse(config[key]);
                  if (Number.isFinite(time))
                    onChange({
                      ...config,
                      [key]: new Date(
                        Math.floor(time / 60_000) * 60_000 +
                          Number(e.target.value) * 1000,
                      ).toISOString(),
                    });
                }}
              >
                {Array.from({ length: 60 }, (_, second) => (
                  <option key={second} value={second}>
                    {String(second).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-hint">
              Đóng:{" "}
              {Number.isFinite(Date.parse(config[key]))
                ? show(
                    new Date(Date.parse(config[key]) + ROUND_MS).toISOString(),
                  )
                : "Chưa chọn giờ"}
            </p>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          const defaults = defaultAttendance(event.starts_at, event.ends_at);
          onChange({
            ...config,
            round_one: defaults.round_one,
            round_two: defaults.round_two,
          });
        }}
      >
        Tính lại lịch mặc định
      </button>
      <p className="field-hint">
        Đợt 1 quanh trung điểm; đợt 2 trong 15 phút cuối. Sự kiện ngắn hoặc
        nhiều ngày cần chọn lịch phù hợp. Mỗi đợt dài đúng 15 phút.
      </p>
      {(error || issues.length > 0) && (
        <p className="field-error" role="alert">
          {error || issues.join(" ")}
        </p>
      )}
      {saved ? (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void navigator.clipboard.writeText(link).then(
                () => toast.success("Đã sao chép link trình chiếu QR"),
                () => toast.error("Không thể sao chép liên kết."),
              )
            }
          >
            Sao chép link trình chiếu QR
          </button>
          <a
            className="button secondary"
            href={link}
            target="_blank"
            rel="noreferrer"
          >
            Mở trình chiếu QR
          </a>
          <Link to={`/admin/attendance/${saved.code}`}>
            Xem kết quả điểm danh
          </Link>
        </div>
      ) : (
        <p className="field-hint">
          Lưu sự kiện để có link trình chiếu QR và danh sách kết quả.
        </p>
      )}
      <p className="field-hint">
        Trang trình chiếu yêu cầu quyền quản trị nội dung. Lưu cấu hình trước
        khi mở trình chiếu.
      </p>
    </fieldset>
  );
}
