// A small, self-contained line-icon set (no dependency). One consistent visual
// language: 24×24 viewBox, 1.75 stroke, round caps/joins, drawn with currentColor
// so icons inherit text colour and theme automatically.

export type IconName =
  | "dashboard"
  | "transactions"
  | "categories"
  | "budgets"
  | "bills"
  | "settings"
  | "calendar"
  | "refresh"
  | "scissors"
  | "rollover";

const PATHS: Record<IconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>
  ),
  transactions: (
    <>
      <path d="M7 4.5v13" />
      <path d="M3.75 7.75 7 4.5l3.25 3.25" />
      <path d="M17 19.5v-13" />
      <path d="M20.25 16.25 17 19.5l-3.25-3.25" />
    </>
  ),
  categories: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h5.1a2 2 0 0 1 1.4.6l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-5.2 5.2a1.5 1.5 0 0 1-2.1 0L4.6 11.9a2 2 0 0 1-.6-1.4Z" />
      <circle cx="8.5" cy="8.5" r="1.15" />
    </>
  ),
  budgets: (
    <>
      <circle cx="12" cy="12" r="8.3" />
      <path d="M12 12V3.7a8.3 8.3 0 0 1 8.3 8.3Z" fill="currentColor" stroke="none" />
    </>
  ),
  bills: (
    <>
      <path d="M17 3.5 20 6.5 17 9.5" />
      <path d="M20 6.5H8.5a4.5 4.5 0 0 0-4.5 4.5v.5" />
      <path d="M7 20.5 4 17.5 7 14.5" />
      <path d="M4 17.5h11.5a4.5 4.5 0 0 0 4.5-4.5v-.5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h9.5" />
      <path d="M17.5 7.5H20" />
      <circle cx="15.5" cy="7.5" r="2" />
      <path d="M4 16.5h2.5" />
      <path d="M10.5 16.5H20" />
      <circle cx="8.5" cy="16.5" r="2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 4v5h-5" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <path d="M8.1 7.9 20 18" />
      <path d="M8.1 16.1 20 6" />
    </>
  ),
  rollover: (
    <>
      <path d="M12 3v6.5" />
      <path d="M8.5 6 12 9.5 15.5 6" />
      <rect x="5.5" y="12" width="13" height="8" rx="1.8" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
