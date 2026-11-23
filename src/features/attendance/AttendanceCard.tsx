import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ClubEvent } from "../../types/domain";
import {
  attendanceStatus,
  browserKey,
  editAttendance,
  ownAttendance,
  submitAttendance,
} from "./api";
import {
  personalInfoSchema,
  validPosition,
  type AttendanceRecord,
  type AttendanceStatus,
  type PositionFix,
} from "./model";
import "../../styles/attendance.css";
const QrScanner = lazy(() => import("./QrScanner"));
type Phase =
  | "notice"
  | "prepare"
  | "locating"
  | "scan"
  | "submitting"
  | "success"
  | "edit"
  | "failure";
const displayTime = (time: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "medium",
    hourCycle: "h23",
  }).format(new Date(time));
export default function AttendanceCard({
  event,
  alias,
}: {
  event: ClubEvent;
  alias: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const seen = useRef(new Set<string>());
  const request = useRef(false),
    mounted = useRef(true);
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("notice");
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const [name, setName] = useState(""),
    [student, setStudent] = useState("");
  const [error, setError] = useState("");
  const [fix, setFix] = useState<PositionFix | null>(null);
  const [recordedRound, setRecordedRound] = useState<1 | 2 | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const fixingRound = useRef<1 | 2 | null>(null);
  const generation = useRef(0);
  const applyRecord = (value: AttendanceRecord) => {
    setRecord(value);
    setName(value.full_name);
    setStudent(value.student_id);
  };
  useEffect(() => {
    mounted.current = true;
    let stopped = false,
      busy = false,
      expiry = 0;
    const poll = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const started = performance.now();
        const result = await attendanceStatus(event.code, alias);
        if (stopped) return;
        const remaining =
          Date.parse(result.closes_at ?? "") -
          Date.parse(result.server_time) -
          (performance.now() - started);
        if (result.round && remaining <= 0) result.round = null;
        setStatus(result);
        setOffline(false);
        clearTimeout(expiry);
        if (result.round && result.closes_at)
          expiry = window.setTimeout(
            () =>
              setStatus((value) => (value ? { ...value, round: null } : null)),
            Math.max(0, remaining),
          );
        if (result.eligible && result.round) {
          const key = `hsv.attendance.popup.${event.id}.${result.round}`;
          let shown = seen.current.has(key);
          try {
            shown ||= sessionStorage.getItem(key) === "seen";
          } catch {
            /* In-memory suppression still works if session storage is unavailable. */
          }
          if (!shown) {
            seen.current.add(key);
            try {
              sessionStorage.setItem(key, "seen");
            } catch {
              /* No persistent claims are made. */
            }
            setOpen(true);
          }
        }
      } catch {
        if (!stopped) {
          setStatus(null);
          setOffline(true);
        }
      } finally {
        busy = false;
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 3000);
    const resume = () => void poll();
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    void browserKey(event.id)
      .then((key) => (key ? ownAttendance(event.code, key) : null))
      .then((r) => {
        if (!stopped && r) {
          setRecord(r);
          setName(r.full_name);
          setStudent(r.student_id);
        }
      })
      .catch(() => {});
    return () => {
      stopped = true;
      mounted.current = false;
      clearInterval(interval);
      clearTimeout(expiry);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [event.code, event.id, alias]);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (phase === "prepare" || phase === "edit")
      dialog.current
        ?.querySelector<HTMLInputElement>('input[name="full_name"]')
        ?.focus();
    if (phase === "success" || phase === "failure")
      dialog.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [phase, open]);
  useEffect(() => {
    if (phase !== "scan") return;
    const timer = window.setTimeout(() => {
      setFix(null);
      setPhase("prepare");
      setError("Vị trí đã cũ. Lấy vị trí mới rồi quét lại.");
    }, 25_000);
    return () => window.clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (
      (phase === "scan" || phase === "locating") &&
      (!status?.round ||
        offline ||
        (fixingRound.current !== null && fixingRound.current !== status.round))
    ) {
      generation.current++;
      setPhase("prepare");
      setFix(null);
      setError(
        offline
          ? "Mất kết nối. Kết nối lại rồi thử tiếp."
          : "Đợt điểm danh đã đóng hoặc tạm dừng.",
      );
    }
  }, [status?.round, offline, phase]);
  const close = () => {
    generation.current++;
    setOpen(false);
    setFix(null);
    setError("");
    setPhase("notice");
    request.current = false;
    dialog.current?.close();
    trigger.current?.focus({ preventScroll: true });
  };
  const start = async () => {
    if (starting) return;
    const attempt = ++generation.current;
    setError("");
    setStarting(true);
    try {
      const key = (await browserKey(event.id, true))!;
      const own = await ownAttendance(event.code, key);
      if (!mounted.current || generation.current !== attempt) return;
      if (own) applyRecord(own);
      setPhase("prepare");
    } catch {
      if (mounted.current && generation.current === attempt)
        setError(
          "Không sử dụng được bộ nhớ hoặc không kết nối được máy chủ. Cho phép lưu dữ liệu trong trình duyệt rồi thử lại.",
        );
    } finally {
      if (mounted.current) setStarting(false);
    }
  };
  const locate = async () => {
    const parsed = personalInfoSchema.safeParse({
      full_name: name,
      student_id: student,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    const attempt = ++generation.current;
    fixingRound.current = status?.round ?? null;
    setName(parsed.data.full_name);
    setStudent(parsed.data.student_id);
    setError("");
    setFix(null);
    setPhase("locating");
    try {
      if (!navigator.geolocation)
        throw Error("Trình duyệt không hỗ trợ định vị.");
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15_000,
          }),
      );
      const current = await attendanceStatus(event.code, alias);
      if (!mounted.current || generation.current !== attempt) return;
      setStatus(current);
      if (
        !current.round ||
        current.latitude == null ||
        current.longitude == null ||
        !current.radius_m
      )
        throw Error("Đợt điểm danh chưa mở hoặc đã đóng.");
      const age = Math.max(0, Date.now() - position.timestamp);
      const point = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        captured_at: new Date(
          Date.parse(current.server_time) - age,
        ).toISOString(),
      };
      if (
        !validPosition(
          point,
          { latitude: current.latitude, longitude: current.longitude },
          current.radius_m,
          Date.parse(current.server_time),
        )
      )
        throw Error(
          "Vị trí chưa đủ chính xác hoặc ngoài khu vực điểm danh. Đến gần địa điểm, bật vị trí chính xác rồi thử lại.",
        );
      setFix(point);
      setPhase("scan");
    } catch (cause) {
      if (!mounted.current || generation.current !== attempt) return;
      setPhase("prepare");
      setError(
        cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === 1
          ? "Cho phép truy cập vị trí trong cài đặt trình duyệt rồi thử lại."
          : cause instanceof Error
            ? cause.message
            : "Không lấy được vị trí. Bật định vị rồi thử lại.",
      );
    }
  };
  const submit = async (token: string) => {
    if (request.current || !fix) return;
    request.current = true;
    setPhase("submitting");
    setError("");
    const round = status?.round;
    try {
      const key = await browserKey(event.id);
      if (!key) throw Error();
      const result = await submitAttendance(
        event.code,
        alias,
        key,
        name,
        student,
        token,
        fix,
      );
      if (!mounted.current) return;
      if (!result.ok || !result.record) {
        setError("Không thể ghi nhận điểm danh.");
        setPhase("failure");
        return;
      }
      applyRecord(result.record);
      setRecordedRound(result.round ?? null);
      setPhase("success");
    } catch {
      try {
        const key = await browserKey(event.id),
          own = key ? await ownAttendance(event.code, key) : null;
        if (!mounted.current) return;
        if (
          own &&
          (round === 1
            ? own.round_one_at
            : round === 2
              ? own.round_two_at
              : false)
        ) {
          applyRecord(own);
          setRecordedRound(round ?? null);
          setPhase("success");
          return;
        }
      } catch {
        /* The retry action reads the saved result before another submission. */
      }
      if (mounted.current) {
        setError("Không thể ghi nhận điểm danh.");
        setPhase("failure");
      }
    } finally {
      request.current = false;
      setFix(null);
    }
  };
  const busy = phase === "submitting" || editingBusy;
  return (
    <>
      {(status?.round || record || offline) && (
        <button
          ref={trigger}
          className="attendance-trigger"
          onClick={() => {
            setPhase(record && !status?.round ? "success" : "notice");
            setOpen(true);
          }}
        >
          {status?.round
            ? `Điểm danh đợt ${status.round}`
            : record
              ? "Kết quả điểm danh"
              : "Kiểm tra điểm danh"}
        </button>
      )}
      <dialog
        ref={dialog}
        className="attendance-dialog"
        aria-labelledby="attendance-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) close();
        }}
      >
        <div className="dialog-heading">
          <h2 id="attendance-title" tabIndex={-1}>
            {phase === "edit"
              ? "Chỉnh sửa thông tin"
              : phase === "success"
                ? "Đã ghi nhận điểm danh"
                : "Điểm danh sự kiện"}
          </h2>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
            aria-label="Đóng điểm danh"
          >
            Đóng
          </button>
        </div>
        {phase === "notice" && (
          <>
            <p>
              {status?.round
                ? `Đợt ${status.round} đang mở.`
                : offline
                  ? "Không có kết nối máy chủ."
                  : "Hiện chưa có đợt đang mở."}
            </p>
            <p>
              Sau khi điểm danh xong, vui lòng giữ trạng thái web hiện tại để
              điểm danh cho đợt sau.
            </p>
            <p className="field-hint">
              Dùng cùng trình duyệt và không xóa dữ liệu duyệt web trong thời
              gian sự kiện. Họ tên, MSSV và kết quả được dùng để đối chiếu tham
              dự; vị trí chỉ được kiểm tra lúc điểm danh.
            </p>
            <button
              disabled={starting || !status?.round || offline}
              onClick={() => void start()}
            >
              {starting ? "Đang kiểm tra liên kết…" : "Bắt đầu điểm danh"}
            </button>
            {record && (
              <button
                className="secondary"
                onClick={() => {
                  setRecordedRound(null);
                  setPhase("success");
                }}
              >
                Xem kết quả đã lưu
              </button>
            )}
          </>
        )}
        {(phase === "prepare" || phase === "locating" || phase === "edit") && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (phase !== "edit") {
                await locate();
                return;
              }
              const parsed = personalInfoSchema.safeParse({
                full_name: name,
                student_id: student,
              });
              if (!parsed.success) {
                setError(parsed.error.issues[0].message);
                return;
              }
              if (request.current) return;
              request.current = true;
              setEditingBusy(true);
              setError("");
              try {
                const key = await browserKey(event.id);
                if (!key) throw Error();
                const result = await editAttendance(
                  event.code,
                  key,
                  parsed.data.full_name,
                  parsed.data.student_id,
                );
                if (!result.ok || !result.record) throw Error();
                applyRecord(result.record);
                setPhase("success");
              } catch {
                setError("Không thể cập nhật thông tin.");
              } finally {
                request.current = false;
                setEditingBusy(false);
              }
            }}
          >
            <label>
              Họ tên
              <input
                autoComplete="name"
                name="full_name"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                readOnly={phase !== "edit" && !!record}
              />
            </label>
            <label>
              MSSV
              <input
                name="student_id"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={30}
                value={student}
                onChange={(e) => setStudent(e.target.value)}
                readOnly={phase !== "edit" && !!record}
              />
            </label>
            {phase !== "edit" && record && (
              <button
                type="button"
                className="secondary"
                onClick={() => setPhase("edit")}
              >
                Chỉnh sửa thông tin
              </button>
            )}
            <button
              disabled={
                editingBusy ||
                phase === "locating" ||
                (phase !== "edit" && (!status?.round || offline))
              }
            >
              {phase === "edit"
                ? editingBusy
                  ? "Đang lưu…"
                  : "Lưu thông tin"
                : phase === "locating"
                  ? "Đang lấy vị trí…"
                  : "Lấy vị trí và quét QR"}
            </button>
            {phase === "edit" && (
              <button
                type="button"
                className="secondary"
                disabled={editingBusy}
                onClick={() => {
                  if (record) applyRecord(record);
                  setError("");
                  setPhase("success");
                }}
              >
                Hủy chỉnh sửa
              </button>
            )}
          </form>
        )}
        {phase === "scan" && (
          <Suspense fallback={<p role="status">Đang tải phần quét QR…</p>}>
            <QrScanner
              onToken={(token) => void submit(token)}
              onError={(message) => {
                setFix(null);
                setError(message);
                setPhase("prepare");
              }}
            />
          </Suspense>
        )}
        {phase === "submitting" && (
          <p role="status">Máy chủ đang kiểm tra và ghi nhận…</p>
        )}
        {phase === "success" && record && (
          <>
            <dl className="attendance-result">
              <dt>Họ tên</dt>
              <dd>{record.full_name}</dd>
              <dt>MSSV</dt>
              <dd>{record.student_id}</dd>
              <dt>Số đợt</dt>
              <dd>{record.count}/2</dd>
              {([1, 2] as const).map((r) => {
                const time =
                  r === 1 ? record.round_one_at : record.round_two_at;
                return time ? (
                  <div className="attendance-result-row" key={r}>
                    <dt>
                      Đợt {r}
                      {recordedRound === r ? " vừa ghi nhận" : ""}
                    </dt>
                    <dd>{displayTime(time)}</dd>
                  </div>
                ) : null;
              })}
            </dl>
            <button
              onClick={() => {
                setError("");
                setPhase("edit");
              }}
            >
              Chỉnh sửa thông tin
            </button>
            <p className="field-hint">
              Giữ dữ liệu trình duyệt để tiếp tục đợt sau. Tải lại trang trong
              cùng hồ sơ vẫn giữ liên kết.
            </p>
          </>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {phase === "failure" && (
          <button
            onClick={async () => {
              setError("");
              try {
                const key = await browserKey(event.id),
                  own = key ? await ownAttendance(event.code, key) : null;
                if (own) {
                  applyRecord(own);
                  if (
                    status?.round === 1
                      ? own.round_one_at
                      : status?.round === 2
                        ? own.round_two_at
                        : true
                  ) {
                    setPhase("success");
                    return;
                  }
                }
              } catch {
                /* Preparation remains available after a transient error. */
              }
              setPhase("prepare");
            }}
          >
            Thử lại
          </button>
        )}
      </dialog>
    </>
  );
}
