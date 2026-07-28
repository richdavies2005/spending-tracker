import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Category, Transaction } from "../lib/types";
import { dayLabel, money, todayIso } from "../lib/format";
import { errMessage, useToast } from "../lib/toast";
import { Modal } from "../components/Modal";
import { CategoryOptGroups } from "../components/CategoryOptGroups";
import { PeriodDropdown } from "../components/PeriodDropdown";
import { useCustomRange } from "../lib/customRange";

export function Transactions() {
  const toast = useToast();
  const { range, apply, clear } = useCustomRange();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [showTransfers, setShowTransfers] = useState(false);
  const [allPeriods, setAllPeriods] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  async function load() {
    try {
      // With a custom range active, pull everything and filter to the window
      // client-side (the same range the Dashboard uses).
      const [t, c] = await Promise.all([
        api.transactionsList(showTransfers, range ? true : allPeriods),
        api.categoriesList(),
      ]);
      const shown = range
        ? t.filter((tx) => {
            const d = tx.date.slice(0, 10);
            return d >= range.start && d <= range.end;
          })
        : t;
      setTxns(shown);
      setCats(c);
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTransfers, allPeriods, range]);

  async function setCategory(tx: Transaction, categoryId: number | null) {
    const wasUnset = tx.user_category_id == null || tx.suggested;
    try {
      const learned = await api.transactionSetCategory(tx.id, categoryId, wasUnset);
      if (wasUnset && categoryId != null && learned > 0) {
        toast.success(`Also categorised ${learned} more like it.`);
      }
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  async function confirmSuggestion(tx: Transaction) {
    try {
      await api.transactionConfirm(tx.id);
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  async function rejectSuggestion(tx: Transaction) {
    try {
      await api.transactionReject(tx.id);
      toast.info("Set back to uncategorised.");
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  async function setInBudget(tx: Transaction, inBudget: boolean) {
    try {
      await api.transactionSetInBudget(tx.id, inBudget);
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  const uncategorised = txns.filter((t) => t.user_category_id == null);

  // Search filters only what's already loaded (the current period / All / custom
  // range view) — matching merchant, description, category name, or amount.
  const q = query.trim().toLowerCase();
  const visible = q
    ? txns.filter((t) => {
        const cat = t.user_category_id != null ? catById.get(t.user_category_id)?.name ?? "" : "";
        return (
          (t.merchant_name ?? "").toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q) ||
          cat.toLowerCase().includes(q) ||
          Math.abs(t.amount).toFixed(2).includes(q)
        );
      })
    : txns;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          <div className="sub">
            {range ? "Custom period" : allPeriods ? "All transactions" : "This pay period"} ·{" "}
            {q ? `${visible.length} of ${txns.length} shown` : `${txns.length} shown`}
          </div>
        </div>
        <div className="btn-row">
          <div className="search-box">
            <input
              type="text"
              className="search-input"
              placeholder="Search this view…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          <PeriodDropdown range={range} onApply={apply} onClear={clear} />
          <div className="seg">
            <button
              className={`seg-btn ${!allPeriods && !range ? "active" : ""}`}
              onClick={() => {
                clear();
                setAllPeriods(false);
              }}
            >
              This period
            </button>
            <button
              className={`seg-btn ${allPeriods && !range ? "active" : ""}`}
              onClick={() => {
                clear();
                setAllPeriods(true);
              }}
            >
              All
            </button>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showTransfers}
              onChange={(e) => setShowTransfers(e.target.checked)}
            />
            Show transfers
          </label>
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Add transaction
          </button>
        </div>
      </div>

      {uncategorised.length > 0 && (
        <div className="inbox-callout" style={{ marginBottom: 16 }}>
          <span>{uncategorised.length} uncategorised — assign a category to teach the app.</span>
        </div>
      )}

      <div className="card table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th style={{ textAlign: "center" }}>In budget</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    {q
                      ? `No transactions match “${query.trim()}” in this view.`
                      : "No transactions in this period yet."}
                  </div>
                </td>
              </tr>
            )}
            {visible.map((tx) => (
              <tr key={tx.id} className={tx.in_budget ? "" : "tx-excluded"}>
                <td style={{ whiteSpace: "nowrap", color: "var(--text-dim)" }}>
                  {dayLabel(tx.date)}
                </td>
                <td>
                  <div style={{ fontWeight: 550 }}>
                    {tx.merchant_name || tx.description || "—"}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                    {tx.status === "pending" && <span className="badge pending">Pending</span>}
                    {tx.source === "manual" && <span className="badge manual">Manual</span>}
                    {tx.source === "recurring" && (
                      <span className="badge recurring">Recurring</span>
                    )}
                    {tx.edited && <span className="badge edited">Edited</span>}
                  </div>
                </td>
                <td>
                  <div className="cat-cell">
                    <select
                      className="mini"
                      aria-label={`Category for ${tx.merchant_name || tx.description || "transaction"}`}
                      value={tx.user_category_id ?? ""}
                      onChange={(e) =>
                        setCategory(tx, e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">— Uncategorised —</option>
                      <CategoryOptGroups cats={cats} />
                    </select>
                    {tx.suggested && (
                      <span className="suggest-controls">
                        <span className="badge suggested">Auto</span>
                        <button
                          className="icon-btn confirm"
                          aria-label="Confirm suggested category and remember this rule"
                          title="Correct — keep it and remember this rule"
                          onClick={() => confirmSuggestion(tx)}
                        >
                          ✓
                        </button>
                        <button
                          className="icon-btn reject"
                          aria-label="Reject suggested category and forget this rule"
                          title="Wrong — clear it and forget this rule"
                          onClick={() => rejectSuggestion(tx)}
                        >
                          ✕
                        </button>
                      </span>
                    )}
                  </div>
                </td>
                <td className={`amount ${tx.amount > 0 ? "pos" : ""}`}>
                  {tx.amount > 0 ? "+" : ""}
                  {money(tx.amount)}
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    className="budget-check"
                    aria-label="Count this transaction in budget"
                    checked={tx.in_budget}
                    title={
                      tx.in_budget
                        ? "Counted in budget — untick to exclude (e.g. a reimbursement)"
                        : "Excluded from budget maths"
                    }
                    onChange={(e) => setInBudget(tx, e.target.checked)}
                  />
                </td>
                <td>
                  <button className="btn small" onClick={() => setEditing(tx)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <TxModal
          cats={cats}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}
      {editing && (
        <TxModal
          tx={editing}
          cats={cats}
          catName={
            editing.user_category_id != null
              ? catById.get(editing.user_category_id)?.name
              : undefined
          }
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function TxModal({
  tx,
  cats,
  onClose,
  onSaved,
}: {
  tx?: Transaction;
  cats: Category[];
  catName?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editing = !!tx;
  const [date, setDate] = useState((tx?.date ?? todayIso()).slice(0, 10));
  const [direction, setDirection] = useState<"expense" | "income">(
    tx && tx.amount > 0 ? "income" : "expense",
  );
  const [amount, setAmount] = useState(tx ? Math.abs(tx.amount).toString() : "");
  const [description, setDescription] = useState(tx?.description ?? "");
  const [merchant, setMerchant] = useState(tx?.merchant_name ?? "");
  const [categoryId, setCategoryId] = useState<string>(
    tx?.user_category_id != null ? String(tx.user_category_id) : "",
  );
  const [confirmDel, setConfirmDel] = useState(false);

  async function save() {
    const abs = parseFloat(amount);
    if (isNaN(abs) || abs <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    const signed = direction === "expense" ? -abs : abs;
    const cat = categoryId ? Number(categoryId) : null;
    const dateIso = `${date}T12:00:00Z`;
    try {
      if (editing) {
        await api.transactionEdit(tx!.id, dateIso, signed, description || null, merchant || null, cat);
        toast.success("Transaction updated.");
      } else {
        await api.manualAdd(dateIso, signed, description || null, merchant || null, cat);
        toast.success("Transaction added.");
      }
      onSaved();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  async function reset() {
    try {
      await api.transactionReset(tx!.id);
      toast.success("Reset to bank data.");
      onSaved();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  async function del() {
    try {
      await api.transactionDelete(tx!.id);
      toast.success("Transaction deleted.");
      onSaved();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  const isManual = tx?.source === "manual" || tx?.source === "recurring";

  return (
    <Modal
      title={editing ? "Edit transaction" : "Add transaction"}
      onClose={onClose}
      footer={
        <>
          <div className="btn-row">
            {editing && tx?.edited && !isManual && (
              <button className="btn small" onClick={reset}>
                Reset to bank data
              </button>
            )}
            {editing && isManual && (
              <button
                className="btn small danger"
                onClick={() => (confirmDel ? del() : setConfirmDel(true))}
                onBlur={() => setConfirmDel(false)}
                title="Permanently delete this manual transaction"
              >
                {confirmDel ? "Confirm delete?" : "Delete"}
              </button>
            )}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={save}>
              Save
            </button>
          </div>
        </>
      }
    >
      <div className="row-2">
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Direction</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="expense">Expense (out)</option>
            <option value="income">Income (in)</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Amount (NZD)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
      </label>
      <label className="field">
        <span>Merchant</span>
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. PAK'nSAVE" />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span>Category</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">— Uncategorised —</option>
          <CategoryOptGroups cats={cats} />
        </select>
      </label>
      {editing && (
        <div className="muted" style={{ fontSize: 12 }}>
          {tx?.source === "akahu"
            ? "Editing a bank transaction locks it against future syncs."
            : "Manual transaction."}
        </div>
      )}
    </Modal>
  );
}
