import { useEffect, useRef, useState } from "react";
import type { DateRange } from "../lib/customRange";
import type { IncomePeriod } from "../lib/types";
import { periodRangeLabel } from "../lib/format";

const CYCLES: { value: IncomePeriod; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
];

function nextDayIso(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/// A "Select period" button that opens a dropdown with start/end date pickers
/// (native calendar popups). Applying a range overrides the natural pay period;
/// clearing reverts to it. Used on both the Dashboard and Transactions screens.
export function PeriodDropdown({
  range,
  onApply,
  onClear,
  cycle,
  onCycleChange,
}: {
  range: DateRange | null;
  onApply: (r: DateRange) => void;
  onClear: () => void;
  cycle?: IncomePeriod;
  onCycleChange?: (p: IncomePeriod) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(range?.start ?? "");
  const [end, setEnd] = useState(range?.end ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStart(range?.start ?? "");
    setEnd(range?.end ?? "");
  }, [range]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const valid = !!start && !!end && start <= end;
  const label = range ? periodRangeLabel(range.start, nextDayIso(range.end)) : "Select period";

  return (
    <div className="period-dd" ref={ref}>
      <button
        className={`btn ${range ? "primary" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Choose a custom date range"
      >
        📅 {label} ▾
      </button>
      {open && (
        <div className="period-pop">
          {cycle && onCycleChange && (
            <>
              <div className="pop-label">Pay cycle</div>
              <div className="seg pop-seg">
                {CYCLES.map((c) => (
                  <button
                    key={c.value}
                    className={`seg-btn ${cycle === c.value ? "active" : ""}`}
                    onClick={() => onCycleChange(c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="pop-hint">
                Switching the cycle rescales your budgets. Fine-tune payday in Settings.
              </div>
              <div className="pop-divider" />
              <div className="pop-label">Or view an exact date range</div>
            </>
          )}
          <label className="field">
            <span>Start date</span>
            <input type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>End date</span>
            <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          </label>
          {start && end && start > end && (
            <div className="muted" style={{ fontSize: 12, color: "var(--warn)" }}>
              End date must be on or after the start date.
            </div>
          )}
          <div className="period-pop-actions">
            {range && (
              <button
                className="btn"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                Reset to current period
              </button>
            )}
            <button
              className="btn primary"
              disabled={!valid}
              onClick={() => {
                onApply({ start, end });
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
