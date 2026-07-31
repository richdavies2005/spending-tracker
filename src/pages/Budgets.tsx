import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Budget, Category, Settings } from "../lib/types";
import { money, todayIso } from "../lib/format";
import { errMessage, useToast } from "../lib/toast";
import { Icon } from "../components/Icon";

export function Budgets() {
  const toast = useToast();
  const [cats, setCats] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  async function load() {
    try {
      const [c, b, s] = await Promise.all([
        api.categoriesList(),
        api.budgetsList(),
        api.getSettings(),
      ]);
      setCats(c);
      setBudgets(b);
      setSettings(s);
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  useEffect(() => {
    load();
  }, []);

  const today = todayIso();
  function currentBudget(categoryId: number): number {
    return (
      budgets
        .filter((b) => b.category_id === categoryId && b.effective_from <= today)
        .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]?.amount ?? 0
    );
  }

  async function save(categoryId: number) {
    const raw = drafts[categoryId];
    if (raw === undefined) return;
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount < 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    try {
      await api.budgetSet(categoryId, amount, today);
      setDrafts((d) => {
        const n = { ...d };
        delete n[categoryId];
        return n;
      });
      await load();
      toast.success("Budget saved.");
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  const expenseCats = cats
    .filter((c) => c.kind === "expense")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const per =
    settings?.income_period === "monthly"
      ? "month"
      : settings?.income_period === "fortnightly"
        ? "fortnight"
        : "week";
  const total = expenseCats.reduce((sum, c) => {
    const raw = drafts[c.id];
    const v = raw !== undefined ? parseFloat(raw) || 0 : currentBudget(c.id);
    return sum + v;
  }, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Budgets</h1>
          <div className="sub">How much each expense category gets per {per}</div>
        </div>
        <div className="card stat" style={{ padding: "10px 16px" }}>
          <div className="label">Total allocated</div>
          <div className="value" style={{ fontSize: 20 }}>
            {money(total)} <span className="muted" style={{ fontSize: 13 }}>/ {per}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ width: 220 }}>Budget per {per}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {expenseCats.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <div className="empty">No expense categories yet.</div>
                </td>
              </tr>
            )}
            {expenseCats.map((c) => {
              const value = drafts[c.id] ?? String(currentBudget(c.id));
              const dirty = drafts[c.id] !== undefined;
              return (
                <tr key={c.id}>
                  <td>
                    <div className="cat-name">
                      <span className="dot" style={{ background: c.color }} />
                      {c.name}
                      {c.rollover && (
                        <Icon name="rollover" size={15} className="fund-mark" />
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="muted">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={value}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                        }
                        onKeyDown={(e) => e.key === "Enter" && save(c.id)}
                      />
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn small primary"
                      disabled={!dirty}
                      onClick={() => save(c.id)}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
