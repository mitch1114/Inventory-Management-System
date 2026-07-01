import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { LOCKING } from "./lib/constants";
import { computeInventory } from "./lib/inventory";
import { loadData, saveData, subscribeToChanges } from "./lib/storage";
import { isSupabaseConfigured } from "./lib/supabase";
import { isAuthEnabled, getSession, onAuthChange, signOut } from "./lib/auth";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import PipelineView from "./components/PipelineView";
import SalesOrders from "./components/SalesOrders";
import Products from "./components/Products";
import PurchaseOrders from "./components/PurchaseOrders";
import Suppliers from "./components/Suppliers";
import Customers from "./components/Customers";
import Reports from "./components/Reports";
import AuditLog from "./components/AuditLog";
import Settings from "./components/Settings";
import DemandPlanning from "./components/DemandPlanning";
import CycleCount from "./components/CycleCount";
import { defaultData, demoData } from "./lib/defaultData";

const TABS = [
  { key: "dashboard", label: "Overview", icon: "\u25A1" },
  { key: "pipeline", label: "Pipeline", icon: "\u25A0", hasPipelineBadge: true },
  { key: "sales", label: "Orders", icon: "\u2630" },
  { key: "products", label: "Inventory", icon: "\u25A3", hasAlertBadge: true },
  { key: "po", label: "Supplier POs", icon: "\u2191" },
  { key: "suppliers", label: "Suppliers", icon: "\u2692" },
  { key: "customers", label: "Customers", icon: "\u2B50" },
  { key: "reports", label: "Reports", icon: "\u2261" },
  { key: "planning", label: "Demand Planning", icon: "\u25C8" },
  { key: "cyclecount", label: "Cycle Count", icon: "\u2714" },
  { key: "audit", label: "Audit Log", icon: "\u270E" },
  { key: "settings", label: "Settings", icon: "\u2699" },
];

export default function App() {
  const [dataRaw, setDataRaw] = useState(defaultData);
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState("idle"); // "idle" | "connected" | "updated"
  const ignoreNextRemote = useRef(false);

  // Auth: only enforced when Supabase is configured.
  const authRequired = isAuthEnabled();
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Check session on mount and subscribe to auth changes
  useEffect(() => {
    if (!authRequired) {
      setAuthChecked(true);
      return;
    }
    getSession().then((s) => {
      setSession(s);
      setAuthChecked(true);
    });
    return onAuthChange((s) => setSession(s));
  }, [authRequired]);

  const authed = !authRequired || !!session;

  // Load data once authenticated (async -- Supabase fetch, localStorage fallback)
  useEffect(() => {
    if (!authChecked || !authed) return;
    let cancelled = false;
    setLoading(true);
    loadData().then((loaded) => {
      if (!cancelled) {
        setDataRaw(loaded);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [authChecked, authed]);

  // Subscribe to real-time changes from other users
  useEffect(() => {
    if (!isSupabaseConfigured() || !authed) return;
    setSyncStatus("connected");

    const unsubscribe = subscribeToChanges((remoteData) => {
      // Skip if this was our own save that triggered the subscription
      if (ignoreNextRemote.current) {
        ignoreNextRemote.current = false;
        return;
      }
      setDataRaw(remoteData);
      setSyncStatus("updated");
      // Reset the "updated" indicator after 3 seconds
      setTimeout(() => setSyncStatus("connected"), 3000);
    });

    return unsubscribe;
  }, [authed]);

  const setData = useCallback((updater) => {
    setDataRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      ignoreNextRemote.current = true;
      saveData(next);
      return next;
    });
  }, []);

  const data = useMemo(
    () => ({
      ...dataRaw,
      products: computeInventory(dataRaw.products, dataRaw.salesOrders),
    }),
    [dataRaw],
  );

  const pipelineCount = data.salesOrders.filter((o) => LOCKING.has(o.fulfillmentStage)).length;
  const alertCount = data.products.filter((p) => p.available <= p.reorderPoint).length;

  // While checking the session, show a minimal splash
  if (authRequired && !authChecked) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "#F1F5F9",
          fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 20, color: "#0F172A", marginBottom: 8 }}>
            ACC Crappie Stix
          </div>
          <div style={{ fontSize: 13, color: "#94A3B8" }}>Loading...</div>
        </div>
      </div>
    );
  }

  // Gate the app behind a login when auth is enabled
  if (authRequired && !session) {
    return <Login />;
  }

  // Loading screen
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "#F1F5F9",
          fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 20, color: "#0F172A", marginBottom: 8 }}>
            ACC Crappie Stix
          </div>
          <div style={{ fontSize: 13, color: "#94A3B8" }}>Loading inventory data...</div>
        </div>
      </div>
    );
  }

  const syncLabel =
    syncStatus === "connected"
      ? "Synced"
      : syncStatus === "updated"
        ? "Updated just now"
        : isSupabaseConfigured()
          ? "Connecting..."
          : "Local only";
  const syncColor =
    syncStatus === "connected"
      ? "#16A34A"
      : syncStatus === "updated"
        ? "#2563EB"
        : "#94A3B8";

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#F1F5F9",
        color: "#1E293B",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: 196,
          flexShrink: 0,
          background: "#FFFFFF",
          borderRight: "1px solid #E2E8F0",
          boxShadow: "2px 0 8px rgba(0,0,0,0.04)",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
        }}
      >
        <div style={{ padding: "20px 16px 14px" }}>
          <div style={{ fontWeight: 900, fontSize: 16, color: "#0F172A", letterSpacing: "-0.02em" }}>
            ACC Crappie Stix
          </div>
          <div
            style={{
              fontSize: 10,
              color: "#94A3B8",
              marginTop: 3,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            Inventory &middot; v4
          </div>
        </div>
        <nav style={{ flex: 1, padding: "4px 8px" }}>
          {TABS.map((t) => {
            const badge = t.hasPipelineBadge
              ? pipelineCount > 0
                ? pipelineCount
                : null
              : t.hasAlertBadge
                ? alertCount > 0
                  ? alertCount
                  : null
                : null;
            const badgeColor = t.hasPipelineBadge ? "#EAB308" : "#EF4444";
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "9px 10px",
                  borderRadius: 10,
                  border: "none",
                  background: tab === t.key ? "#EFF6FF" : "transparent",
                  color: tab === t.key ? "#2563EB" : "#64748B",
                  fontWeight: tab === t.key ? 600 : 400,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  marginBottom: 2,
                  textAlign: "left",
                  transition: "background 0.15s",
                }}
              >
                <span style={{ fontSize: 14, flexShrink: 0 }}>{t.icon}</span>
                <span style={{ flex: 1 }}>{t.label}</span>
                {badge && (
                  <span
                    style={{
                      background: badgeColor,
                      color: "#fff",
                      borderRadius: 10,
                      padding: "1px 7px",
                      fontSize: 10,
                      fontWeight: 800,
                      minWidth: 18,
                      textAlign: "center",
                    }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div style={{ padding: "14px 16px", borderTop: "1px solid #E2E8F0" }}>
          {/* Sync status */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: syncColor,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: syncColor,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 700,
              }}
            >
              {syncLabel}
            </span>
          </div>
          <button
            onClick={() => {
              if (window.confirm("Reset all data to demo catalog? This will overwrite your current data.")) setData(demoData);
            }}
            style={{
              fontSize: 11,
              color: "#DC2626",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontFamily: "inherit",
            }}
          >
            Reset to defaults
          </button>

          {authRequired && session && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
              <div
                style={{
                  fontSize: 10,
                  color: "#94A3B8",
                  marginBottom: 6,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={session.user?.email}
              >
                {session.user?.email}
              </div>
              <button
                onClick={() => signOut()}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#475569",
                  background: "#F8FAFC",
                  border: "1px solid #CBD5E1",
                  borderRadius: 8,
                  cursor: "pointer",
                  padding: "6px 12px",
                  fontFamily: "inherit",
                  width: "100%",
                }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          padding: 28,
          overflow: "auto",
          background: "#F1F5F9",
          minWidth: 0,
        }}
      >
        {tab === "dashboard" && <Dashboard data={data} />}
        {tab === "pipeline" && <PipelineView data={data} setData={setData} />}
        {tab === "sales" && <SalesOrders data={data} setData={setData} />}
        {tab === "products" && <Products data={data} setData={setData} />}
        {tab === "po" && <PurchaseOrders data={data} setData={setData} />}
        {tab === "suppliers" && <Suppliers data={data} setData={setData} />}
        {tab === "customers" && <Customers data={data} setData={setData} />}
        {tab === "reports" && <Reports data={data} />}
        {tab === "planning" && <DemandPlanning data={data} setData={setData} />}
        {tab === "cyclecount" && <CycleCount data={data} setData={setData} />}
        {tab === "audit" && <AuditLog data={data} setData={setData} />}
        {tab === "settings" && <Settings data={data} setData={setData} />}
      </div>
    </div>
  );
}
