import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Category, CategoryKind, MerchantMap } from "../lib/types";
import { errMessage, useToast } from "../lib/toast";
import { Modal } from "../components/Modal";

const PALETTE = [
  "#4caf82", "#5b8def", "#e0a458", "#c471ed", "#e86a6a",
  "#3a9d78", "#8b95a7", "#d98cb3", "#5bc0c7", "#b7791f",
];
const KIND_LABEL: Record<CategoryKind, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer / Saving",
};

export function Categories() {
  const toast = useToast();
  const [cats, setCats] = useState<Category[]>([]);
  const [maps, setMaps] = useState<MerchantMap[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [adding, setAdding] = useState(false);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  async function load() {
    try {
      const [c, m] = await Promise.all([api.categoriesList(), api.mapList()]);
      setCats(c);
      setMaps(m);
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function del(c: Category) {
    if (!confirm(`Delete "${c.name}"? Its transactions become uncategorised.`)) return;
    try {
      await api.categoryDelete(c.id);
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  async function delMap(m: MerchantMap) {
    try {
      await api.mapDelete(m.id);
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <div className="sub">Type controls how each category affects your budget</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + New category
        </button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Type</th>
              <th>Rollover fund</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="cat-name">
                    <span className="dot" style={{ background: c.color }} />
                    {c.name}
                  </div>
                </td>
                <td>
                  <span className={`badge type-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                </td>
                <td className="muted">{c.rollover ? "Rollover fund" : "—"}</td>
                <td>
                  <div className="btn-row">
                    <button className="btn small" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => del(c)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Merchant map — learned auto-categories</div>
      <div className="card">
        {maps.length === 0 ? (
          <div className="empty">
            None yet. Categorise an uncategorised transaction and the app remembers that merchant
            here.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When {`{field}`} matches</th>
                <th>Category</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {maps.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="muted">{m.field}:</span> <b>{m.pattern}</b>
                  </td>
                  <td>{catById.get(m.category_id)?.name ?? "—"}</td>
                  <td>
                    <button className="btn small danger" onClick={() => delMap(m)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(adding || editing) && (
        <CategoryModal
          category={editing ?? undefined}
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

function CategoryModal({
  category,
  onClose,
  onSaved,
}: {
  category?: Category;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editing = !!category;
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? PALETTE[0]);
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? "expense");
  const [rollover, setRollover] = useState(category?.rollover ?? false);

  async function save() {
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }
    try {
      if (editing) {
        await api.categoryUpdate(category!.id, name.trim(), color, category!.sort_order, kind, rollover);
      } else {
        await api.categoryCreate(name.trim(), color, kind, rollover);
      }
      onSaved();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  return (
    <Modal
      title={editing ? "Edit category" : "New category"}
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Groceries" />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
          <option value="expense">Expense — counts as spending</option>
          <option value="income">Income — salary / money in</option>
          <option value="transfer">Transfer / Saving — excluded &amp; hidden</option>
        </select>
      </label>
      <label className="field">
        <span>Colour</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PALETTE.map((p) => (
            <button
              key={p}
              className="swatch"
              style={{ background: p, outline: p === color ? "2px solid var(--accent)" : "none" }}
              onClick={() => setColor(p)}
            />
          ))}
        </div>
      </label>
      {kind === "expense" && (
        <label className="toggle" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={rollover}
            onChange={(e) => setRollover(e.target.checked)}
          />
          <span>
            Rollover fund — unspent budget carries over across periods for lumpy bills
          </span>
        </label>
      )}
    </Modal>
  );
}
