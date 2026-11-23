import { useEffect, useRef, useState } from "react";
import { decodeQrImage } from "./decodeQr";
export default function QrScanner({
  onToken,
  onError,
}: {
  onToken: (token: string) => void;
  onError: (message: string, permissionDenied?: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onToken),
    failure = useRef(onError);
  callback.current = onToken;
  failure.current = onError;
  const [ready, setReady] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const resumeVideo = useRef<(() => void) | null>(null);
  useEffect(() => {
    let stopped = false,
      stream: MediaStream | null = null,
      timer = 0;
    const stop = () => {
      stopped = true;
      resumeVideo.current = null;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (video.current) video.current.srcObject = null;
    };
    const hide = () => {
      if (document.hidden) {
        stop();
        failure.current(
          "Camera đã dừng khi rời tab. Bắt đầu lại để lấy vị trí mới.",
        );
      }
    };
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Error("unsupported");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const element = video.current;
        if (!element) {
          stop();
          return;
        }
        element.srcObject = stream;
        const canvas = document.createElement("canvas"),
          context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw Error("canvas");
        const detect = () => {
          if (stopped) return;
          if (element.videoWidth && element.videoHeight) {
            const scale = Math.min(1, 640 / element.videoWidth);
            canvas.width = Math.round(element.videoWidth * scale);
            canvas.height = Math.round(element.videoHeight * scale);
            context.drawImage(element, 0, 0, canvas.width, canvas.height);
            const token = decodeQrImage(
              context.getImageData(0, 0, canvas.width, canvas.height),
            );
            if (token) {
              stop();
              callback.current(token);
              return;
            }
          }
          timer = window.setTimeout(detect, 180);
        };
        let playing = false;
        const play = async () => {
          if (stopped || playing) return;
          playing = true;
          try {
            await element.play();
            if (stopped) return;
            setNeedsTap(false);
            setReady(true);
            resumeVideo.current = null;
            detect();
          } catch (error) {
            if (stopped) return;
            if (
              error instanceof DOMException &&
              error.name === "NotAllowedError"
            ) {
              setNeedsTap(true);
            } else {
              stop();
              failure.current(
                "Không phát được hình ảnh camera. Đóng ứng dụng đang dùng camera rồi thử lại.",
              );
            }
          } finally {
            playing = false;
          }
        };
        resumeVideo.current = () => void play();
        await play();
      } catch (error) {
        if (stopped) return;
        stop();
        const name = error instanceof DOMException ? error.name : "";
        const permissionDenied =
          name === "NotAllowedError" || name === "SecurityError";
        failure.current(
          permissionDenied
            ? "Trình duyệt hoặc thiết bị đang chặn camera. Kiểm tra quyền website và cài đặt thiết bị theo hướng dẫn bên dưới."
            : name === "NotFoundError"
              ? "Không tìm thấy camera. Mở thiệp trên thiết bị có camera rồi thử lại."
              : name === "NotReadableError" || name === "AbortError"
                ? "Camera đang bận hoặc không khởi động được. Đóng ứng dụng đang dùng camera rồi thử lại."
                : "Không mở được camera. Kiểm tra camera, kết nối HTTPS và thử lại.",
          permissionDenied,
        );
      }
    };
    void start();
    document.addEventListener("visibilitychange", hide);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  return (
    <div>
      <p role="status">
        {ready
          ? "Đưa QR đang trình chiếu vào giữa khung hình, giữ máy ổn định."
          : needsTap
            ? "Camera đã được cho phép. Chạm nút bên dưới để bắt đầu hiển thị video."
            : "Đang mở camera…"}
      </p>
      {needsTap && (
        <button
          type="button"
          className="attendance-resume-camera"
          onClick={() => resumeVideo.current?.()}
        >
          Bật video camera
        </button>
      )}
      <video
        ref={video}
        className="attendance-camera"
        muted
        playsInline
        aria-label="Camera quét QR điểm danh"
      />
    </div>
  );
}
