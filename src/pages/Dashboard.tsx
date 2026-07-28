import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AkahuDiagnostic, DashboardRow, DashboardSummary, SyncState } from "../lib/types";
import { money, moneySigned, periodRangeLabel, timestampLabel } from "../lib/format";
import { errMessage, useToast } from "../lib/toast";
import { TrimModal } from "../components/TrimModal";
import { CategoryTransactionsModal } from "../components/CategoryTransactionsModal";
import { PeriodDropdown } from "../components/PeriodDropdown";
import { useCustomRange } from "../lib/customRange";

export function Dashboard() {
  const toast = useToast();
  const { range, apply, clear } = useCustomRange();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
  const [openCat, setOpenCat] = useState<DashboardRow | null>(null);
  const [diag, setDiag] = useState<AkahuDiagnostic | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  async function load() {
    try {
      setData(await api.dashboard(range?.start ?? null, range?.end ?? null));
      setSync(await api.syncStateGet());
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // One smart refresh: ask Akahu to re-poll the bank, then pull. The backend
  // falls back to a plain pull automatically if the bank rate-limits the re-poll.
  async function runSync() {
    setRefreshing(true);
    try {
      const res = await api.syncFromBank();
      toast.success(
        `Refreshed — ${res.inserted} new, ${res.updated} updated, ${res.pending} pending (${res.total_transactions} total).`,
      );
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function runDiagnostic() {
    setDiagLoading(true);
    try {
      setDiag(await api.akahuDiagnostic());
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setDiagLoading(false);
    }
  }

  if (!data) return <div className="empty">Loading…</div>;

  const expenseRows = data.rows
    .filter((r) => r.kind === "expense")
    .sort((a, b) => a.category_name.localeCompare(b.category_name, undefined, { sensitivity: "base" }));
  const surplusPositive = data.surplus >= 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">
            {range ? "Custom period" : "Pay period"}{" "}
            {periodRangeLabel(data.period_start, data.period_end)} · last synced{" "}
            {timestampLabel(sync?.last_sync_at ?? null)}
          </div>
        </div>
        <div className="btn-row">
          <PeriodDropdown range={range} onApply={apply} onClear={clear} />
          <button
            className="btn"
            onClick={() => setTrimOpen(true)}
            disabled={refreshing}
            title="Permanently delete old transactions to keep the list lean"
          >
            Trim…
          </button>
          <button
            className="btn primary"
            onClick={runSync}
            disabled={refreshing}
            title="Ask your bank for the latest, then pull. Takes a few seconds."
          >
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {trimOpen && (
        <TrimModal
          onClose={() => setTrimOpen(false)}
          onDone={async () => {
            setTrimOpen(false);
            await load();
          }}
        />
      )}

      {data.uncategorized_count > 0 && (
        <div className="inbox-callout" style={{ marginBottom: 16 }}>
          <span>
            {data.uncategorized_count} uncategorised transaction
            {data.uncategorized_count === 1 ? "" : "s"} need a category.
          </span>
          <span className="muted" style={{ color: "#fff", opacity: 0.9 }}>
            → Transactions tab
          </span>
        </div>
      )}

      <div className="grid stat-row" style={{ marginBottom: 16 }}>
        <div className={`card surplus-card ${surplusPositive ? "" : "over"}`}>
          <div className="stat">
            <div className="label">Net balance</div>
            <div className="value">{moneySigned(data.surplus)}</div>
            <div className="hint">
              {surplusPositive ? "Spare to save this period" : "Overspent this period"}
            </div>
          </div>
        </div>
        <div className="card stat">
          <div className="label">Income</div>
          <div className="value">{money(data.income)}</div>
          <div className="hint">received this period</div>
        </div>
        <div className="card stat">
          <div className="label">Spent</div>
          <div className="value">{money(data.expense_spent)}</div>
          <div className="hint">total spending this period</div>
        </div>
        <div className="card stat">
          <div className="label">Set aside</div>
          <div className="value">{money(data.rollover_budget)}</div>
          <div className="hint">budgeted to rollover funds</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-title" style={{ marginTop: 0 }}>
          Budgets this period
        </div>
        {expenseRows.length === 0 && (
          <div className="empty">No expense categories yet — add some in Categories.</div>
        )}
        {expenseRows.map((r) => {
          const pct = r.budget > 0 ? Math.min((r.spent / r.budget) * 100, 100) : 0;
          const over = r.budget > 0 && r.spent > r.budget;
          const remaining = r.budget - r.spent;
          return (
            <div
              className="cat-row clickable"
              key={r.category_id}
              onClick={() => setOpenCat(r)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenCat(r);
                }
              }}
              title={`View ${r.category_name} transactions`}
            >
              <div className="cat-name">
                <span className="dot" style={{ background: r.color }} />
                {r.category_name}
                {r.rollover && (
                  <span className="badge type-transfer" title="Rollover / sinking fund">
                    fund
                  </span>
                )}
              </div>
              <div className="cat-amounts">
                <b>{money(r.spent)}</b> / {money(r.budget)}
                <span className="chevron" aria-hidden="true">
                  ›
                </span>
              </div>
              <div className="bar">
                <span
                  style={{
                    width: `${pct}%`,
                    background: over ? "var(--warn)" : r.color,
                  }}
                />
              </div>
              {!r.rollover && (
                <div className={`avail-tag ${remaining < 0 ? "over" : ""}`}>
                  {remaining >= 0 ? (
                    <>
                      Available: <b>{money(remaining)}</b>
                    </>
                  ) : (
                    <>
                      Over by <b>{money(-remaining)}</b>
                    </>
                  )}
                </div>
              )}
              {r.rollover && (
                <div className={`envelope-tag ${r.envelope_balance < 0 ? "neg" : ""}`}>
                  {r.envelope_balance >= 0
                    ? `${money(r.envelope_balance)} banked in this fund`
                    : `${money(-r.envelope_balance)} over the fund balance`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="cat-row" style={{ alignItems: "center" }}>
          <div className="cat-name" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
            <div className="section-title" style={{ margin: 0 }}>
              Connection diagnostics
            </div>
            <span className="muted" style={{ fontSize: 13 }}>
              Shows what Akahu currently has — use this to check if today's transactions
              have reached Akahu yet.
            </span>
          </div>
          <button className="btn" onClick={runDiagnostic} disabled={diagLoading}>
            {diagLoading ? "Checking…" : "Check Akahu"}
          </button>
        </div>

        {diag && (
          <div style={{ marginTop: 12 }}>
            <div className="grid stat-row" style={{ marginBottom: 12 }}>
              <div className="card stat">
                <div className="label">Akahu last refreshed</div>
                <div className="value" style={{ fontSize: 18 }}>
                  {timestampLabel(diag.refreshed_at)}
                </div>
                <div className="hint">{diag.account_count} account(s) connected</div>
              </div>
              <div className="card stat">
                <div className="label">Newest settled</div>
                <div className="value" style={{ fontSize: 18 }}>
                  {diag.newest_settled_date?.slice(0, 10) ?? "—"}
                </div>
                <div className="hint">{diag.settled_count} in last 14 days</div>
              </div>
              <div className="card stat">
                <div className="label">Newest pending</div>
                <div className="value" style={{ fontSize: 18 }}>
                  {diag.newest_pending_date?.slice(0, 10) ?? "—"}
                </div>
                <div className="hint">{diag.pending_count} pending held</div>
              </div>
            </div>
            <div className="section-title" style={{ marginTop: 0 }}>
              Most recent from Akahu
            </div>
            {diag.recent.length === 0 && (
              <div className="empty">Akahu returned no transactions in the last 14 days.</div>
            )}
            {diag.recent.map((t, i) => (
              <div className="cat-row" key={i}>
                <div className="cat-name">
                  {t.date.slice(0, 10)} · {t.merchant ?? t.description ?? "—"}
                  <span
                    className={`badge ${t.status === "pending" ? "type-transfer" : ""}`}
                    style={{ marginLeft: 8 }}
                  >
                    {t.status}
                  </span>
                </div>
                <div className="cat-amounts">{money(Math.abs(t.amount))}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {openCat && (
        <CategoryTransactionsModal
          row={openCat}
          periodStart={data.period_start}
          periodEnd={data.period_end}
          onClose={() => setOpenCat(null)}
        />
      )}
    </>
  );
}
