import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "../../components/Switch";
import { errorMessage } from "../../lib/supabase";
import type { ClubEvent } from "../../types/domain";
import { setEventPublication } from "./api";

export function PublicationSwitch({ event }: { event: ClubEvent }) {
  const cache = useQueryClient();
  const pending = useRef(false);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const checked = optimistic ?? event.status === "published";
  return (
    <div className="publication-control">
      <Switch
        checked={checked}
        disabled={optimistic !== null}
        label={checked ? "Đã công khai" : "Chưa công khai"}
        onChange={async (value) => {
          if (pending.current) return;
          pending.current = true;
          setOptimistic(value);
          setError("");
          try {
            const saved = await setEventPublication(
              event.id,
              value ? "published" : "draft",
            );
            cache.setQueryData<ClubEvent[]>(["events", "admin"], (items) =>
              items?.map((item) =>
                item.id === event.id ? { ...item, ...saved } : item,
              ),
            );
            // Mark editors stale without refetching/remounting an open dirty form.
            await cache.invalidateQueries({
              queryKey: ["event", event.code],
              refetchType: "none",
            });
            await cache.invalidateQueries({
              queryKey: ["events"],
              refetchType: "none",
            });
            await cache.invalidateQueries({
              queryKey: ["invitation", event.code],
              refetchType: "none",
            });
            toast.success(value ? "Đã công khai sự kiện" : "Đã ẩn sự kiện");
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            pending.current = false;
            setOptimistic(null);
          }
        }}
      />
      <span role="status">
        {optimistic !== null ? "Đang lưu trạng thái…" : ""}
      </span>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
