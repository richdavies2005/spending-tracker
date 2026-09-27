import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Transactions } from "./pages/Transactions";
import { Categories } from "./pages/Categories";
import { Budgets } from "./pages/Budgets";
import { Settings } from "./pages/Settings";
import { UpdateBanner } from "./components/UpdateBanner";
import { Icon, type IconName } from "./components/Icon";
import { Logo } from "./components/Logo";
import { IS_TAURI } from "./lib/api";

export type Page = "dashboard" | "transactions" | "categories" | "budgets" | "settings";

const NAV: { id: Page; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "transactions", label: "Transactions", icon: "transactions" },
  { id: "categories", label: "Categories", icon: "categories" },
  { id: "budgets", label: "Budgets", icon: "budgets" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Logo size={17} />
          </span>
          <div className="brand-name">Spare</div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => setPage(n.id)}
              aria-current={page === n.id ? "page" : undefined}
            >
              <Icon name={n.icon} className="nav-icon" size={18} />
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
        {page === "dashboard" && <Dashboard onNavigate={setPage} />}
        {page === "transactions" && <Transactions />}
        {page === "categories" && <Categories />}
        {page === "budgets" && <Budgets />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}
