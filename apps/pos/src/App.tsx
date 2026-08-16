import { Banknote, Settings2, ShoppingCart, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { HashRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { TopBar } from "./components/TopBar.js";
import { useHotkeys } from "./lib/keyboard.js";
import { hasBridge, posData, type PosCashSession } from "./lib/pos-data.js";
import { CashRegister } from "./pages/CashRegister.js";
import { Login } from "./pages/Login.js";
import { Returns } from "./pages/Returns.js";
import { Sale } from "./pages/Sale.js";
import { Settings } from "./pages/Settings.js";
import { useAuth } from "./store/auth.js";

/**
 * HashRouter, not BrowserRouter.
 *
 * The renderer is loaded from a `file://` URL in a packaged build, where the
 * History API has no server to resolve a path against and a refresh on
 * /returns would 404. The hash keeps routing entirely client-side.
 */
export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const cashier = useAuth((s) => s.cashier);
  const [session, setSession] = useState<PosCashSession | null>(null);

  const refreshSession = useCallback(() => {
    void posData.getOpenCashSession().then(setSession);
  }, []);

  useEffect(refreshSession, [refreshSession, cashier]);

  // The whole app is behind sign-in. A till left on the sale screen with no
  // cashier attached is an unattributed transaction waiting to happen.
  if (!cashier) return <Login />;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        cashSessionFloat={session?.openingAmount ?? null}
        onSyncNow={() => hasBridge() && void window.devsfleet.sync.now()}
      />

      <div className="flex min-h-0 flex-1">
        <SideNav />

        <main className="flex min-w-0 flex-1 flex-col">
          <Routes>
            <Route
              path="/"
              element={<Sale cashSessionId={session?.id ?? null} />}
            />
            <Route
              path="/drawer"
              element={<CashRegister session={session} onChanged={refreshSession} />}
            />
            <Route path="/returns" element={<Returns />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

/**
 * Four destinations, icons and labels both.
 *
 * Icon-only navigation is a false economy on a till: staff turnover is high and
 * a new cashier should not have to learn a pictogram to find returns.
 */
function SideNav() {
  const items = [
    { to: "/", label: "Sell", icon: ShoppingCart, end: true },
    { to: "/drawer", label: "Drawer", icon: Banknote },
    { to: "/returns", label: "Returns", icon: Undo2 },
    { to: "/settings", label: "Settings", icon: Settings2 },
  ];

  useHotkeys({
    "ctrl+1": () => (location.hash = "#/"),
    "ctrl+2": () => (location.hash = "#/drawer"),
    "ctrl+3": () => (location.hash = "#/returns"),
    "ctrl+4": () => (location.hash = "#/settings"),
  });

  return (
    <nav
      aria-label="Sections"
      className="flex w-20 shrink-0 flex-col gap-1 border-r border-steel-700 bg-steel-850 p-2"
    >
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            [
              "flex flex-col items-center gap-1.5 rounded-lg py-3 text-[11px] font-medium transition-colors",
              isActive
                ? "bg-brass/12 text-brass"
                : "text-zinc-500 hover:bg-steel-800 hover:text-chalk",
            ].join(" ")
          }
        >
          <Icon className="size-5" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
