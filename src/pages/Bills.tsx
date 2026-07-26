import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { BillFrequency, Category, RecurringBill } from "../lib/types";
import { dayLabel, money, todayIso } from "../lib/format";
import { errMessage, useToast } from "../lib/toast";
import { Modal } from "../components/Modal";

const FREQS: BillFrequency[] = ["weekly", "fortnightly", "monthly", "annual"];

export function Bills() {
  const toast = useToast();
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [editing, setEditing] = useState<RecurringBill | null>(null);
  const [adding, setAdding] = useState(false);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  async function load() {
    try {
      const [b, c] = await Promise.all([api.billsList(), api.categoriesList()]);
      setBills(b);
      setCats(c);
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function del(b: RecurringBill) {
    if (!confirm(`Delete "${b.name}"? Already-created entries stay in your transactions.`)) return;
    try {
      await api.billDelete(b.id);
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recurring bills</h1>
          <div className="sub">
            Fixed payments the app can't see in your everyday account (e.g. insurance)
          </div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + New bill
        </button>
      </div>

      <div className="card">
        {bills.length === 0 ? (
          <div className="empty">
            No recurring bills. Add one for anything paid outside your everyday account (cash,
            another account) so it still counts toward your budget.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Bill</th>
                <th>Amount</th>
                <th>Frequency</th>
                <th>Category</th>
                <th>Next from</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 550 }}>
                    {b.name}
                    {!b.active && <span className="badge edited"> paused</span>}
                  </td>
                  <td>{money(b.amount)}</td>
                  <td style={{ textTransform: "capitalize" }}>{b.frequency}</td>
                  <td>{b.category_id != null ? catById.get(b.category_id)?.name ?? "—" : "—"}</td>
                  <td className="muted">{dayLabel(b.anchor_date)}</td>
                  <td>
                    <div className="btn-row">
                      <button className="btn small" onClick={() => setEditing(b)}>
                        Edit
                      </button>
                      <button className="btn small danger" onClick={() => del(b)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(adding || editing) && (
        <BillModal
          bill={editing ?? undefined}
          cats={cats}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setAdding(false);
            setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function BillModal({
  bill,
  cats,
  onClose,
  onSaved,
}: {
  bill?: RecurringBill;
  cats: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editing = !!bill;
  const [name, setName] = useState(bill?.name ?? "");
  const [amount, setAmount] = useState(bill ? String(bill.amount) : "");
  const [frequency, setFrequency] = useState<BillFrequency>(bill?.frequency ?? "monthly");
  const [anchor, setAnchor] = useState(bill?.anchor_date ?? todayIso());
  const [categoryId, setCategoryId] = useState<string>(
    bill?.category_id != null ? String(bill.category_id) : "",
  );
  const [active, setActive] = useState(bill?.active ?? true);

  async function save() {
    const amt = parseFloat(amount);
    if (!name.trim() || isNaN(amt) || amt <= 0) {
      toast.error("Enter a name and a valid amount.");
      return;
    }
    const cat = categoryId ? Number(categoryId) : null;
    try {
      if (editing) {
        await api.billUpdate(bill!.id, name.trim(), amt, cat, frequency, anchor, active);
      } else {
        await api.billCreate(name.trim(), amt, cat, frequency, anchor);
      }
      toast.success(editing ? "Bill updated." : "Bill added.");
      onSaved();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  const expenseCats = cats.filter((c) => c.kind === "expense");

  return (
    <Modal
      title={editing ? "Edit recurring bill" : "New recurring bill"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car insurance" />
      </label>
      <div className="row-2">
        <label className="field">
          <span>Amount (NZD)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Frequency</span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as BillFrequency)}>
            {FREQS.map((f) => (
              <option key={f} value={f} style={{ textTransform: "capitalize" }}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row-2">
        <label className="field">
          <span>First due date</span>
          <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— None —</option>
            {expenseCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {editing && (
        <label className="toggle">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Active (uncheck to pause future entries)</span>
        </label>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Tip: point this at a rollover category to spread a lumpy bill across periods.
      </div>
    </Modal>
  );
}
