import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  attendanceDisplay,
  type DisplayState,
} from "../features/attendance/api";
import { encodeQr } from "../features/attendance/qr";
import "../styles/attendance.css";
export default function AttendanceDisplay() {
  const { eventCode = "" } = useParams();
  const [state, setState] = useState<DisplayState | null>(null);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let stopped = false,
      timer = 0,
      expiry = 0;
    const update = async () => {
      window.clearTimeout(timer);
      const started = performance.now();
      try {
        const result = await attendanceDisplay(eventCode);
        if (stopped) return;
        const remaining =
          Date.parse(result.expires_at ?? "") -
          Date.parse(result.server_time) -
          (performance.now() - started);
        window.clearTimeout(expiry);
        setState(
          result.token && remaining <= 0 ? { ...result, token: null } : result,
        );
        setError("");
        if (result.token)
          expiry = window.setTimeout(
            () =>
              setState((value) => (value ? { ...value, token: null } : null)),
            Math.max(0, remaining),
          );
        timer = window.setTimeout(
          () => void update(),
          result.token ? Math.max(150, remaining + 20) : 2000,
        );
      } catch {
        if (stopped) return;
        setState((value) => (value ? { ...value, token: null } : null));
        setError("Mất kết nối. QR tạm dừng; đang thử kết nối lại.");
        timer = window.setTimeout(() => void update(), 2000);
      }
    };
    const resume = () => {
      if (!document.hidden && !paused) {
        setState((value) => (value ? { ...value, token: null } : null));
        void update();
      }
    };
    if (!paused) void update();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(expiry);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [eventCode, paused]);
  const matrix = !paused && state?.token ? encodeQr(state.token) : null;
  return (
    <section className="attendance-display">
      <h1>{state?.title ?? "Trình chiếu QR điểm danh"}</h1>
      <p className="round-label">
        {paused
          ? "Đã tạm dừng trình chiếu"
          : state?.round
            ? `Đợt ${state.round}`
            : "Chưa có đợt đang mở"}
      </p>
      {matrix ? (
        <svg
          viewBox="0 0 41 41"
          role="img"
          aria-label="QR điểm danh hiện tại"
          shapeRendering="crispEdges"
        >
          <rect width="41" height="41" fill="var(--qr-paper)" />
          <path
            fill="var(--qr-ink)"
            d={matrix
              .flatMap((row, y) =>
                row.flatMap((v, x) =>
                  v ? [`M${x + 4},${y + 4}h1v1h-1z`] : [],
                ),
              )
              .join("")}
          />
        </svg>
      ) : (
        <p role="status">
          {error ||
            (paused
              ? "Bấm tiếp tục để nhận QR mới."
              : state?.round
                ? "Đang nhận QR mới…"
                : "Điểm danh chỉ tiếp nhận theo lịch đã lưu và khi sự kiện được công khai.")}
        </p>
      )}
      {state?.closes_at && (
        <p>
          Đóng đợt lúc{" "}
          {new Intl.DateTimeFormat("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
            timeStyle: "medium",
            hourCycle: "h23",
          }).format(new Date(state.closes_at))}
        </p>
      )}
      <button className="secondary" onClick={() => setPaused(!paused)}>
        {paused ? "Tiếp tục trình chiếu" : "Tạm dừng trình chiếu"}
      </button>
      <p className="field-hint">
        Mở thiệp nhóm để điểm danh. QR tự thay theo thời gian máy chủ.
      </p>
    </section>
  );
}
