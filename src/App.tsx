import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Transactions } from "./pages/Transactions";
import { Categories } from "./pages/Categories";
import { Budgets } from "./pages/Budgets";
import { Bills } from "./pages/Bills";
import { Settings } from "./pages/Settings";
import { UpdateBanner } from "./components/UpdateBanner";
import { IS_TAURI } from "./lib/api";

type Page = "dashboard" | "transactions" | "categories" | "budgets" | "bills" | "settings";

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "◎" },
  { id: "transactions", label: "Transactions", icon: "≡" },
  { id: "categories", label: "Categories", icon: "▧" },
  { id: "budgets", label: "Budgets", icon: "◑" },
  { id: "bills", label: "Recurring bills", icon: "↻" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">$</span>
          <div className="brand-name">Spending &amp; Budget</div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => setPage(n.id)}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        {!IS_TAURI && (
          <div className="mode-badge" title="Running in the browser with sample data">
            Demo data · browser preview
          </div>
        )}
      </aside>

      <main className="content">
        <UpdateBanner />
        {page === "dashboard" && <Dashboard />}
        {page === "transactions" && <Transactions />}
        {page === "categories" && <Categories />}
        {page === "budgets" && <Budgets />}
        {page === "bills" && <Bills />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}
