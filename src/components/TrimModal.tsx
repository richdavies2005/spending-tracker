import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api } from "../lib/api";
import { errMessage, useToast } from "../lib/toast";

const OPTIONS = [
  { label: "Keep the last 30 days", keepDays: 30 },
  { label: "Keep the last 3 months", keepDays: 90 },
  { label: "Keep the last 12 months", keepDays: 365 },
];

/// Lets the user permanently delete transactions older than a chosen window,
/// with a live count of what will be removed and an explicit confirm.
export function TrimModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [keepDays, setKeepDays] = useState(90);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Preview how many rows the current choice would delete.
  useEffect(() => {
    let live = true;
    setCount(null);
    api
      .transactionsTrimCount(keepDays)
      .then((n) => live && setCount(n))
      .catch((e) => toast.error(errMessage(e)));
    return () => {
      live = false;
    };
  }, [keepDays]);

  async function confirm() {
    setBusy(true);
    try {
      const removed = await api.transactionsTrim(keepDays);
      toast.success(`Removed ${removed} old transaction${removed === 1 ? "" : "s"}.`);
      onDone();
    } catch (e) {
      toast.error(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Trim old transactions"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn danger" onClick={confirm} disabled={busy || count === 0}>
            {busy ? "Removing…" : count === null ? "Delete older" : `Delete ${count} older`}
          </button>
        </>
      }
    >
      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Permanently deletes transactions older than the window you keep. This can't be undone —
        bank transactions inside a later sync window can be re-pulled, but manual entries and
        rollover-fund history are gone for good.
      </div>
      {OPTIONS.map((o) => (
        <label key={o.keepDays} className="toggle" style={{ padding: "8px 0", gap: 10 }}>
          <input
            type="radio"
            name="trim"
            checked={keepDays === o.keepDays}
            onChange={() => setKeepDays(o.keepDays)}
          />
          <span>{o.label}</span>
        </label>
      ))}
      <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
        {count === null
          ? "Counting…"
          : count === 0
            ? "Nothing older than this window — nothing to delete."
            : `${count} transaction${count === 1 ? "" : "s"} older than this will be deleted.`}
      </div>
    </Modal>
  );
}
