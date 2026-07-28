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

  useEffect(() => {
    let live = true;
    setTxns(null);
    api
      .transactionsList(true, allPeriods)
      .then((all) => {
        if (live) setTxns(all.filter((t) => t.user_category_id === row.category_id));
      })
      .catch((e) => toast.error(errMessage(e)));
    return () => {
      live = false;
    };
  }, [allPeriods, row.category_id]);

  // Match the dashboard: only in-budget rows count toward the spent total.
  const includedSpent = useMemo(
    () => (txns ?? []).filter((t) => t.in_budget).reduce((sum, t) => sum - t.amount, 0),
    [txns],
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
      ) : txns.length === 0 ? (
        <div className="empty">
          No transactions in {row.category_name} {allPeriods ? "yet" : "this period"}.
        </div>
      ) : (
        txns.map((t) => (
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
