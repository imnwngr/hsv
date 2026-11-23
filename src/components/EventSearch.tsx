import { Search, X } from "lucide-react";
import { useId } from "react";

export function EventSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="event-search">
      <label htmlFor={id}>Tìm sự kiện</label>
      <span className="search-input">
        <Search size={18} aria-hidden="true" />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Tên hoặc mã sự kiện"
        />
        {value && (
          <button
            type="button"
            className="search-clear"
            aria-label="Xóa từ khóa"
            onClick={(e) => {
              const input =
                e.currentTarget.parentElement?.querySelector("input");
              onChange("");
              input?.focus();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </span>
    </div>
  );
}
