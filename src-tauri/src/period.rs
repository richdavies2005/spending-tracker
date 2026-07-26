//! Pay-period math. The app's budgeting cycle is configurable: `Weekly`
//! (anchored on a day of the week — the user's payday), `Fortnightly` (every two
//! weeks, pinned by a reference payday), or `Monthly` (anchored on a day of the
//! month). Everything — budgets, dashboard, surplus — runs on the period returned
//! here.

use chrono::{Datelike, Duration, Months, NaiveDate};

use crate::models::Settings;

#[derive(Clone, Copy, PartialEq)]
pub enum PeriodKind {
    Weekly,
    Fortnightly,
    Monthly,
}

impl Settings {
    fn kind(&self) -> PeriodKind {
        match self.income_period.as_str() {
            "monthly" => PeriodKind::Monthly,
            "fortnightly" => PeriodKind::Fortnightly,
            _ => PeriodKind::Weekly,
        }
    }
}

/// The reference payday that pins the fortnightly cycle. Uses `income_anchor`
/// when set; otherwise falls back to a fixed epoch shifted to the chosen weekday
/// so the boundaries are at least on the right day of the week.
fn fortnight_anchor(settings: &Settings) -> NaiveDate {
    if let Some(a) = settings.income_anchor.as_deref() {
        if let Ok(d) = NaiveDate::parse_from_str(a, "%Y-%m-%d") {
            return d;
        }
    }
    // 2000-01-03 is a Monday (ISO weekday 1); shift to the configured weekday.
    let wd = settings.income_day.clamp(1, 7) as i64;
    NaiveDate::from_ymd_opt(2000, 1, 3).unwrap() + Duration::days(wd - 1)
}

/// Number of days in the month containing `date`.
fn days_in_month(date: NaiveDate) -> u32 {
    let (y, m) = (date.year(), date.month());
    let first_next = if m == 12 {
        NaiveDate::from_ymd_opt(y + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(y, m + 1, 1)
    }
    .unwrap();
    (first_next - NaiveDate::from_ymd_opt(y, m, 1).unwrap()).num_days() as u32
}

/// The start date of the pay period that contains `date`.
pub fn period_start(settings: &Settings, date: NaiveDate) -> NaiveDate {
    match settings.kind() {
        PeriodKind::Weekly => {
            // income_day: ISO weekday 1=Mon..7=Sun (default Tuesday = 2).
            let anchor = settings.income_day.clamp(1, 7) as i64;
            let wd = date.weekday().number_from_monday() as i64; // 1..7
            let diff = (wd - anchor).rem_euclid(7);
            date - Duration::days(diff)
        }
        PeriodKind::Fortnightly => {
            // Step back to the most recent multiple of 14 days from the anchor.
            let anchor = fortnight_anchor(settings);
            let offset = (date - anchor).num_days().rem_euclid(14);
            date - Duration::days(offset)
        }
        PeriodKind::Monthly => {
            // income_day: day of month 1..31, clamped to the month's length.
            let target = settings.income_day.clamp(1, 31) as u32;
            let this_dom = target.min(days_in_month(date));
            let this_start = date.with_day(this_dom).unwrap();
            if date >= this_start {
                this_start
            } else {
                let prev = date - Months::new(1);
                let dom = target.min(days_in_month(prev));
                prev.with_day(dom).unwrap()
            }
        }
    }
}

/// The start of the next period after the one containing `date`.
pub fn next_period_start(settings: &Settings, date: NaiveDate) -> NaiveDate {
    let start = period_start(settings, date);
    match settings.kind() {
        PeriodKind::Weekly => start + Duration::days(7),
        PeriodKind::Fortnightly => start + Duration::days(14),
        PeriodKind::Monthly => {
            let next = start + Months::new(1);
            // Re-anchor in case the target day differs by month length.
            period_start(settings, next)
        }
    }
}

/// A monotonically increasing integer that increments by 1 each period. Used to
/// count how many periods have elapsed (for rollover envelope accrual).
pub fn period_index(settings: &Settings, date: NaiveDate) -> i64 {
    let start = period_start(settings, date);
    match settings.kind() {
        // All weekly starts share the same weekday, so they are 7 days apart and
        // integer division by 7 yields consecutive indices.
        PeriodKind::Weekly => start.num_days_from_ce() as i64 / 7,
        // Fortnight starts are all `anchor + 14k`, so days-from-anchor / 14 = k.
        PeriodKind::Fortnightly => {
            (start - fortnight_anchor(settings)).num_days() / 14
        }
        PeriodKind::Monthly => start.year() as i64 * 12 + (start.month() as i64 - 1),
    }
}

/// [start, end) date bounds of the period containing `date`, as ISO `YYYY-MM-DD`
/// strings for comparing against transaction dates.
pub fn period_bounds_str(settings: &Settings, date: NaiveDate) -> (String, String) {
    let start = period_start(settings, date);
    let end = next_period_start(settings, date);
    (start.format("%Y-%m-%d").to_string(), end.format("%Y-%m-%d").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn weekly(day: i64) -> Settings {
        Settings { income_period: "weekly".into(), income_day: day, income_anchor: None }
    }
    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn weekly_tuesday_period() {
        let s = weekly(2); // Tuesday
        // 2026-07-24 is a Friday; the containing Tue→Mon week starts 2026-07-21.
        assert_eq!(period_start(&s, d("2026-07-24")), d("2026-07-21"));
        assert_eq!(next_period_start(&s, d("2026-07-24")), d("2026-07-28"));
        // A Tuesday is its own period start.
        assert_eq!(period_start(&s, d("2026-07-21")), d("2026-07-21"));
        // Indices are consecutive across weeks.
        assert_eq!(
            period_index(&s, d("2026-07-28")) - period_index(&s, d("2026-07-21")),
            1
        );
    }

    #[test]
    fn fortnightly_period() {
        // Paid every second Tuesday, reference payday 2026-07-21.
        let s = Settings {
            income_period: "fortnightly".into(),
            income_day: 2,
            income_anchor: Some("2026-07-21".into()),
        };
        // Within the first fortnight (21 Jul → 3 Aug).
        assert_eq!(period_start(&s, d("2026-07-21")), d("2026-07-21"));
        assert_eq!(period_start(&s, d("2026-07-28")), d("2026-07-21"));
        assert_eq!(next_period_start(&s, d("2026-07-28")), d("2026-08-04"));
        // The following Tuesday is a NEW fortnight, not a boundary mid-period.
        assert_eq!(period_start(&s, d("2026-08-04")), d("2026-08-04"));
        // A date before the anchor lands in the prior fortnight (7 Jul → 20 Jul).
        assert_eq!(period_start(&s, d("2026-07-14")), d("2026-07-07"));
        // Indices increment by one each fortnight.
        assert_eq!(
            period_index(&s, d("2026-08-04")) - period_index(&s, d("2026-07-21")),
            1
        );
    }

    #[test]
    fn monthly_first_period() {
        let s = Settings { income_period: "monthly".into(), income_day: 1, income_anchor: None };
        assert_eq!(period_start(&s, d("2026-07-24")), d("2026-07-01"));
        assert_eq!(next_period_start(&s, d("2026-07-24")), d("2026-08-01"));
        assert_eq!(
            period_index(&s, d("2026-08-01")) - period_index(&s, d("2026-07-01")),
            1
        );
    }

    #[test]
    fn monthly_mid_period() {
        let s = Settings { income_period: "monthly".into(), income_day: 15, income_anchor: None };
        // Before the 15th → period started on the 15th of the previous month.
        assert_eq!(period_start(&s, d("2026-07-10")), d("2026-06-15"));
        // On/after the 15th → this month's 15th.
        assert_eq!(period_start(&s, d("2026-07-20")), d("2026-07-15"));
    }
}
