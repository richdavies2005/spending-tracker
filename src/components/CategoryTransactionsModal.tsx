import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { api } from "../lib/api";
import type { DashboardRow, Transaction } from "../lib/types";
import { money, periodRangeLabel } from "../lib/format";
import { errMessage, useToast } from "../lib/toast";

/// Drill-down from a Dashboard budget row: lists the transactions that make up a
/// category's spend. Defaults to the current pay period (so the total matches the
/// dashboard figure); an "All" toggle shows every transaction in the category.
export function CategoryTransactionsModal({
  row,
  periodStart,
  periodEnd,
  onClose,
}: {
  row: DashboardRow;
  periodStart: string;
  periodEnd: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [allPeriods, setAllPeriods] = useState(false);
  const [txns, setTxns] = useState<Transaction[] | null>(null);

  // Fetch every transaction in the category once, then window it client-side so
  // the "current period" view honours whatever the dashboard is showing (natural
  // pay period OR a custom date range, passed in via periodStart/periodEnd).
  useEffect(() => {
    let live = true;
    setTxns(null);
    api
      .transactionsList(true, true)
      .then((all) => {
        if (live) setTxns(all.filter((t) => t.user_category_id === row.category_id));
      })
      .catch((e) => toast.error(errMessage(e)));
    return () => {
      live = false;
    };
  }, [row.category_id]);

  // periodEnd is exclusive; matches the dashboard's [start, end) window exactly.
  const start = periodStart.slice(0, 10);
  const end = periodEnd.slice(0, 10);
  const visible = useMemo(() => {
    const all = txns ?? [];
    if (allPeriods) return all;
    return all.filter((t) => {
      const d = t.date.slice(0, 10);
      return d >= start && d < end;
    });
  }, [txns, allPeriods, start, end]);

  // Match the dashboard: only in-budget rows count toward the spent total.
  const includedSpent = useMemo(
    () => visible.filter((t) => t.in_budget).reduce((sum, t) => sum - t.amount, 0),
    [visible],
  );

  return (
    <Modal
      title={row.category_name}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {allPeriods
            ? `${money(includedSpent)} spent across all time`
            : `${money(includedSpent)} of ${money(row.budget)} · ${periodRangeLabel(periodStart, periodEnd)}`}
        </div>
        <div className="seg">
          <button
            className={`seg-btn ${!allPeriods ? "active" : ""}`}
            onClick={() => setAllPeriods(false)}
          >
            This period
          </button>
          <button
            className={`seg-btn ${allPeriods ? "active" : ""}`}
            onClick={() => setAllPeriods(true)}
          >
            All
          </button>
        </div>
      </div>

      {txns === null ? (
        <div className="empty">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          No {row.category_name} transactions {allPeriods ? "yet" : "in this period"}.
        </div>
      ) : (
        visible.map((t) => (
          <div
            className="cat-row"
            key={t.id}
            style={{ opacity: t.in_budget ? 1 : 0.5 }}
          >
            <div className="cat-name">
              {t.date.slice(0, 10)} · {t.merchant_name ?? t.description ?? "—"}
              {!t.in_budget && (
                <span className="badge" style={{ marginLeft: 8 }} title="Excluded from budget maths">
                  excluded
                </span>
              )}
              {t.status === "pending" && (
                <span className="badge type-transfer" style={{ marginLeft: 8 }}>
                  pending
                </span>
              )}
            </div>
            <div className="cat-amounts" style={{ color: t.amount > 0 ? "var(--good)" : undefined }}>
              {t.amount > 0 ? `+${money(t.amount)}` : money(-t.amount)}
            </div>
          </div>
        ))
      )}
    </Modal>
  );
}
