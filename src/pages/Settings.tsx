import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type {
  Account,
  CredentialStatus,
  IncomePeriod,
  Settings as SettingsT,
  SyncState,
} from "../lib/types";
import { WEEKDAYS, lastWeekdayIso, timestampLabel } from "../lib/format";
import { errMessage, useToast } from "../lib/toast";

export function Settings() {
  const toast = useToast();
  const [settings, setSettings] = useState<SettingsT | null>(null);
  const [creds, setCreds] = useState<CredentialStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sync, setSync] = useState<SyncState | null>(null);

  const [appToken, setAppToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [userToken, setUserToken] = useState("");
  const [validating, setValidating] = useState(false);
  const [resyncing, setResyncing] = useState(false);

  async function load() {
    try {
      const [s, c, a, sy] = await Promise.all([
        api.getSettings(),
        api.credentialsStatus(),
        api.accountsList(),
        api.syncStateGet(),
      ]);
      setSettings(s);
      setCreds(c);
      setAccounts(a);
      setSync(sy);
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function saveSettings(next: SettingsT) {
    setSettings(next);
    try {
      await api.setSettings(next.income_period, next.income_day, next.income_anchor);
      toast.success("Pay period saved.");
    } catch (e) {
      toast.error(errMessage(e));
    }
  }

  async function saveCreds() {
    try {
      const c = await api.saveCredentials(appToken, appSecret, userToken);
      setCreds(c);
      setAppToken("");
      setAppSecret("");
      setUserToken("");
      toast.success("Credentials saved to Keychain.");
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  async function validate() {
    setValidating(true);
    try {
      const name = await api.akahuValidate();
      toast.success(`Connected as ${name}.`);
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setValidating(false);
    }
  }
  async function clearCreds() {
    if (!confirm("Remove all Akahu credentials from the Keychain?")) return;
    try {
      setCreds(await api.clearCredentials());
      toast.success("Credentials removed.");
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  async function toggleAccount(a: Account, enabled: boolean) {
    try {
      await api.accountSetEnabled(a.id, enabled);
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    }
  }
  async function fullResync() {
    setResyncing(true);
    try {
      const res = await api.syncFull();
      toast.success(
        `Full resync — ${res.inserted} new, ${res.updated} updated (${res.total_transactions} total).`,
      );
      await load();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setResyncing(false);
    }
  }

  if (!settings) return <div className="empty">Loading…</div>;

  const dot = (ok: boolean) => (
    <span style={{ color: ok ? "var(--good)" : "var(--text-faint)" }}>{ok ? "● set" : "○ not set"}</span>
  );

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          Pay period
        </div>
        <div className="row-2">
          <label className="field">
            <span>Budget cycle</span>
            <select
              value={settings.income_period}
              onChange={(e) => {
                const period = e.target.value as IncomePeriod;
                saveSettings({
                  income_period: period,
                  income_day: period === "monthly" ? 1 : 2,
                  // Seed a sensible fortnightly anchor: the most recent payday.
                  income_anchor: period === "fortnightly" ? lastWeekdayIso(2) : null,
                });
              }}
            >
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          {settings.income_period === "monthly" ? (
            <label className="field">
              <span>Day of month</span>
              <input
                type="number"
                min="1"
                max="28"
                value={settings.income_day}
                onChange={(e) =>
                  saveSettings({ ...settings, income_day: Number(e.target.value) })
                }
              />
            </label>
          ) : settings.income_period === "fortnightly" ? (
            <label className="field">
              <span>A recent payday</span>
              <input
                type="date"
                value={settings.income_anchor ?? ""}
                onChange={(e) =>
                  saveSettings({ ...settings, income_anchor: e.target.value || null })
                }
              />
            </label>
          ) : (
            <label className="field">
              <span>Payday</span>
              <select
                value={settings.income_day}
                onChange={(e) =>
                  saveSettings({ ...settings, income_day: Number(e.target.value) })
                }
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Your budgets, dashboard and surplus all run on this cycle.
          {settings.income_period === "fortnightly" &&
            " Fortnights repeat every two weeks from the payday you pick above."}
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          Akahu connection
        </div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Create a personal app at my.akahu.nz/apps and paste the tokens here. They're stored in
          the macOS Keychain, never in the app files. Only the App Token and User Token are needed
          to pull transactions — the App Secret is optional. Currently — App Token{" "}
          {dot(!!creds?.app_token)}, App Secret {dot(!!creds?.app_secret)}, User Token{" "}
          {dot(!!creds?.user_token)}.
        </div>
        <label className="field">
          <span>App Token (app_token_…)</span>
          <input value={appToken} onChange={(e) => setAppToken(e.target.value)} placeholder="leave blank to keep existing" />
        </label>
        <label className="field">
          <span>App Secret (optional)</span>
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder="not needed for data pulls — leave blank"
          />
        </label>
        <label className="field">
          <span>User Token (user_token_…)</span>
          <input value={userToken} onChange={(e) => setUserToken(e.target.value)} placeholder="leave blank to keep existing" />
        </label>
        <div className="btn-row">
          <button className="btn primary" onClick={saveCreds}>
            Save credentials
          </button>
          <button className="btn" onClick={validate} disabled={validating}>
            {validating ? "Checking…" : "Test connection"}
          </button>
          <button className="btn danger" onClick={clearCreds}>
            Clear
          </button>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-title" style={{ marginTop: 0 }}>
          Accounts
        </div>
        {accounts.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            No accounts yet — test the connection above to load them.
          </div>
        ) : (
          accounts.map((a) => (
            <label
              key={a.id}
              className="toggle"
              style={{ justifyContent: "space-between", padding: "8px 0" }}
            >
              <span>
                <b>{a.name}</b> <span className="muted">{a.connection ?? ""}</span>
              </span>
              <input
                type="checkbox"
                checked={a.enabled}
                onChange={(e) => toggleAccount(a, e.target.checked)}
              />
            </label>
          ))
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Last synced {timestampLabel(sync?.last_sync_at ?? null)}
          {sync?.last_run_status ? ` — ${sync.last_run_status}` : ""}
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          Maintenance
        </div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          A normal Refresh only looks back a few days. If transactions ever seem to be missing,
          run a full resync to re-pull the last ~120 days. It's non-destructive — nothing you've
          categorised or edited is lost.
        </div>
        <button className="btn" onClick={fullResync} disabled={resyncing}>
          {resyncing ? "Resyncing…" : "Full resync (last ~120 days)"}
        </button>
      </div>
    </>
  );
}
