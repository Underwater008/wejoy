import {
  Bike,
  CircleUserRound,
  LogOut,
  Network,
  ReceiptText,
  Store,
  Utensils
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, ApiError, clearToken, getToken, setToken } from "./api";
import { AuthPage } from "./pages/auth-page";
import { ConsumerHome, ConsumerOrders } from "./pages/consumer-pages";
import { MerchantWorkspace } from "./pages/merchant-page";
import { OperatorWorkspace } from "./pages/operator-page";
import { RiderWorkspace } from "./pages/rider-page";
import type { ApiConfig, MeResponse, UserRole } from "./types";
import { ErrorBanner, IconButton, LoadingState } from "./ui";

const roleLabels: Record<UserRole, string> = {
  consumer: "食客",
  merchant: "商家",
  rider: "骑手",
  operator: "节点运营"
};

const roleIcons = {
  consumer: Utensils,
  merchant: Store,
  rider: Bike,
  operator: Network
};

export function App() {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshMe = useCallback(async () => {
    const response = await api<MeResponse>("/api/me");
    setMe(response);
    return response;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const nodeConfig = await api<ApiConfig>("/api/config");
        setConfig(nodeConfig);
        if (getToken()) {
          await refreshMe();
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          clearToken();
        } else {
          setError(caught instanceof Error ? caught.message : "节点连接失败");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshMe]);

  const authenticated = (token: string, _session: MeResponse["user"]) => {
    setToken(token);
    setLoading(true);
    void refreshMe()
      .catch((caught: unknown) => {
        clearToken();
        setError(caught instanceof Error ? caught.message : "账户加载失败");
      })
      .finally(() => setLoading(false));
  };

  const logout = async () => {
    try {
      await api<void>("/api/auth/logout", { method: "POST" });
    } finally {
      clearToken();
      setMe(null);
    }
  };

  if (loading) {
    return <main className="boot-screen"><Brand /><LoadingState label="正在连接社区节点" /></main>;
  }

  if (!config) {
    return <main className="boot-screen"><Brand /><ErrorBanner message={error || "无法连接节点"} /></main>;
  }

  if (!me) {
    return <AuthPage config={config} onAuthenticated={authenticated} />;
  }

  const role = me.user.role;
  const home =
    role === "consumer" ? (
      <ConsumerHome config={config} onError={setError} />
    ) : role === "merchant" ? (
      <MerchantWorkspace me={me} refreshMe={refreshMe} onError={setError} />
    ) : role === "rider" ? (
      <RiderWorkspace me={me} refreshMe={refreshMe} onError={setError} />
    ) : (
      <OperatorWorkspace config={config} onError={setError} />
    );

  return (
    <AppShell config={config} role={role} displayName={me.user.displayName} onLogout={logout}>
      {error ? <ErrorBanner message={error} onClose={() => setError("")} /> : null}
      <Routes>
        <Route path="/" element={home} />
        <Route
          path="/orders"
          element={
            role === "consumer" ? <ConsumerOrders onError={setError} /> : <Navigate to="/" replace />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

function AppShell({
  config,
  role,
  displayName,
  onLogout,
  children
}: {
  config: ApiConfig;
  role: UserRole;
  displayName: string;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const RoleIcon = roleIcons[role];
  return (
    <div className={`app role-${role}`}>
      <header className="app-header">
        <div className="app-header__inner">
          <Brand compact />
          {role === "consumer" ? (
            <nav className="primary-nav" aria-label="主要导航">
              <NavLink to="/" end><Utensils size={17} />点餐</NavLink>
              <NavLink to="/orders"><ReceiptText size={17} />订单</NavLink>
            </nav>
          ) : (
            <div className="workspace-label"><RoleIcon size={17} />{roleLabels[role]}工作台</div>
          )}
          <div className="account-cluster">
            <span className="node-indicator" title={config.publicUrl}><i />{config.nodeName}</span>
            <span className="account-name"><CircleUserRound size={17} />{displayName}</span>
            <IconButton label="退出登录" onClick={() => void onLogout()}><LogOut size={18} /></IconButton>
          </div>
        </div>
      </header>
      <main className="app-main">{children}</main>
      {role === "consumer" ? (
        <nav className="mobile-nav" aria-label="移动端导航">
          <NavLink to="/" end><Utensils size={19} /><span>点餐</span></NavLink>
          <NavLink to="/orders"><ReceiptText size={19} /><span>订单</span></NavLink>
        </nav>
      ) : null}
    </div>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="WeJoy">
      <span className="brand__mark">W</span>
      <span><strong>WeJoy</strong>{compact ? null : <small>社区配送节点</small>}</span>
    </div>
  );
}
