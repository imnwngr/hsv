import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "../admin/Auth";
import { db, errorMessage } from "../../lib/supabase";
import type { ClubEvent } from "../../types/domain";

export function DuplicateEventButton({ event }: { event: ClubEvent }) {
  const cache = useQueryClient();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<string | null>(null);
  const inFlight = useRef(false);
  const key = `hsv:duplicate:${session?.user.id}:${event.id}`;
  return (
    <div className="duplicate-event">
      <button
        type="button"
        className="secondary"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          if (inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          setError("");
          try {
            if (!request.current) {
              const id = sessionStorage.getItem(key) || crypto.randomUUID();
              sessionStorage.setItem(key, id);
              request.current = id;
            }
            const { data, error: failure } = await db().rpc("duplicate_event", {
              p_source_id: event.id,
              p_copy_id: request.current,
            });
            if (failure) {
              if (failure.code === "PGRST202")
                throw Error("Chức năng nhân bản chưa được bật trên máy chủ.");
              throw failure;
            }
            const saved = data as ClubEvent | null;
            if (
              !saved ||
              saved.id !== request.current ||
              saved.duplicated_from_id !== event.id
            )
              throw Error(
                "Chưa xác nhận được bản sao. Bấm thử lại để kiểm tra.",
              );
            cache.setQueryData<ClubEvent[]>(["events", "admin"], (events) => [
              ...(events ?? []).filter((row) => row.id !== saved.id),
              saved,
            ]);
            sessionStorage.removeItem(key);
            request.current = null;
            void cache.invalidateQueries({ queryKey: ["events"] });
            toast.success(`Đã nhân bản: ${saved.code}`);
          } catch (reason) {
            setError(errorMessage(reason));
          } finally {
            inFlight.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? "Đang nhân bản…" : error ? "Thử lại nhân bản" : "Nhân bản"}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
