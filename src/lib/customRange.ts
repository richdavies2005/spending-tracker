import { useEffect, useState } from "react";

// A user-chosen date window that overrides the natural pay period across the
// Dashboard and Transactions screens. Persisted in localStorage so it's shared
// between the two pages (which remount on navigation) and survives a reload.
const KEY = "spending-tracker-period";

export interface DateRange {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
}

function read(): DateRange | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw);
    return r?.start && r?.end ? { start: r.start, end: r.end } : null;
  } catch {
    return null;
  }
}

export function useCustomRange() {
  const [range, setRange] = useState<DateRange | null>(() => read());

  // Pick up changes made from another tab/window (same-tab changes come through
  // the setters below, and cross-page navigation remounts and re-reads).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setRange(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function apply(next: DateRange) {
    localStorage.setItem(KEY, JSON.stringify(next));
    setRange(next);
  }
  function clear() {
    localStorage.removeItem(KEY);
    setRange(null);
  }
  return { range, apply, clear };
}
