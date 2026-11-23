import { useRef } from "react";

export function SegmentedTime({
  value,
  label,
  onChange,
  disabled = false,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const parts = value ? value.split(":") : ["", "", ""];
  const invalid = !!value && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value);
  const focus = (index: number) => {
    refs.current[index]?.focus();
    refs.current[index]?.select();
  };
  return (
    <div className="segmented-time-wrap">
      <div
        className="segmented-time"
        role="group"
        aria-label={label}
        data-time-invalid={invalid || undefined}
        onPaste={(event) => {
          const match = event.clipboardData
            .getData("text")
            .trim()
            .match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
          if (!match || disabled) return;
          event.preventDefault();
          onChange(`${match[1]}:${match[2]}:${match[3] ?? "00"}`);
        }}
      >
        {["Giờ", "Phút", "Giây"].map((part, index) => (
          <span className="time-segment" key={part}>
            {index > 0 && <span aria-hidden="true">:</span>}
            <input
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              aria-label={`${part} ${label}`}
              aria-invalid={invalid}
              disabled={disabled}
              placeholder="--"
              value={parts[index] ?? ""}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, "").slice(0, 2);
                const values = [...parts];
                values[index] = next;
                onChange(values.join(":"));
                if (
                  next.length === 2 &&
                  Number(next) <= (index === 0 ? 23 : 59) &&
                  index < 2
                )
                  focus(index + 1);
              }}
              onBlur={(event) => {
                const entered = event.currentTarget.value;
                if (/^\d$/.test(entered)) {
                  const values = [...parts];
                  values[index] = entered.padStart(2, "0");
                  onChange(values.join(":"));
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "ArrowLeft" && index > 0) {
                  event.preventDefault();
                  focus(index - 1);
                }
                if (event.key === "ArrowRight" && index < 2) {
                  event.preventDefault();
                  focus(index + 1);
                }
                if (event.key === "Backspace" && !parts[index] && index > 0) {
                  event.preventDefault();
                  focus(index - 1);
                }
              }}
            />
          </span>
        ))}
      </div>
      {invalid && (
        <p role="alert" className="field-error">
          Nhập đủ giờ 00–23, phút và giây 00–59.
        </p>
      )}
    </div>
  );
}
