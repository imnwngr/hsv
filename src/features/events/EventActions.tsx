import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardList,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ClubEvent } from "../../types/domain";
import { eventPath, invitationUrl } from "../../lib/domain";

export function EventActions({
  event,
  onDelete,
}: {
  event: ClubEvent;
  onDelete: () => void;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismiss(e: PointerEvent) {
      if (
        disclosure.current?.open &&
        !disclosure.current.contains(e.target as Node)
      )
        disclosure.current.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <details
      className="event-actions"
      ref={disclosure}
      onKeyDown={(e) => {
        if (e.key === "Escape" && disclosure.current?.open) {
          e.preventDefault();
          disclosure.current.open = false;
          disclosure.current.querySelector("summary")?.focus();
        }
      }}
      onBlur={(e) => {
        if (
          e.relatedTarget &&
          !e.currentTarget.contains(e.relatedTarget as Node)
        )
          e.currentTarget.open = false;
      }}
    >
      <summary aria-label={`Thao tác cho ${event.title}`}>
        <MoreHorizontal size={18} aria-hidden="true" />
        <span className="action-label">Thao tác</span>
      </summary>
      <div className="event-actions-panel">
        <Link to={eventPath(event.code, event.event_type)}>
          <ExternalLink size={17} aria-hidden="true" /> Xem sự kiện
        </Link>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(invitationUrl(event.code, undefined, event.event_type))
              .then(
                () => toast.success("Đã sao chép liên kết"),
                () => toast.error("Không thể truy cập clipboard"),
              )
          }
        >
          <Copy size={17} aria-hidden="true" /> Sao chép link
        </button>
        {event.event_type !== "congratulation" && (
          <Link to={`/admin/attendance/${encodeURIComponent(event.code)}`}>
            <ClipboardList size={17} aria-hidden="true" /> Kết quả điểm danh
          </Link>
        )}
        <button
          type="button"
          className="danger-text"
          onClick={() => {
            if (disclosure.current) {
              disclosure.current.open = false;
              disclosure.current.querySelector("summary")?.focus();
            }
            onDelete();
          }}
        >
          <Trash2 size={17} aria-hidden="true" /> Xóa sự kiện
        </button>
      </div>
    </details>
  );
}
