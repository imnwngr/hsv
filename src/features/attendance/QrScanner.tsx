import { useEffect, useRef, useState } from "react";
import { decodeQrImage } from "./decodeQr";
export default function QrScanner({
  onToken,
  onError,
}: {
  onToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onToken),
    failure = useRef(onError);
  callback.current = onToken;
  failure.current = onError;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stopped = false,
      stream: MediaStream | null = null,
      timer = 0;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
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
        await element.play();
        if (stopped) return;
        setReady(true);
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
        detect();
      } catch (error) {
        if (stopped) return;
        stop();
        failure.current(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Cho phép truy cập camera trong cài đặt trình duyệt rồi thử lại."
            : "Không mở được camera. Kiểm tra camera, kết nối HTTPS và thử lại.",
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
          : "Đang mở camera…"}
      </p>
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
