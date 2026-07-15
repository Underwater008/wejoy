import { Bike, CircleCheck, Network, Store, Utensils } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { Brand } from "../App";
import type { ApiConfig, User, UserRole } from "../types";
import { ErrorBanner } from "../ui";

const roles: Array<{ role: Exclude<UserRole, "operator">; label: string; icon: typeof Utensils }> = [
  { role: "consumer", label: "食客", icon: Utensils },
  { role: "merchant", label: "商家", icon: Store },
  { role: "rider", label: "骑手", icon: Bike }
];

export function AuthPage({
  config,
  onAuthenticated
}: {
  config: ApiConfig;
  onAuthenticated: (token: string, user: User) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Exclude<UserRole, "operator">>("consumer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const quickAccounts = useMemo(() => {
    const seen = new Set<UserRole>();
    return config.demoAccounts.filter((account) => {
      if (seen.has(account.role)) return false;
      seen.add(account.role);
      return true;
    });
  }, [config.demoAccounts]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = mode === "login"
        ? { username, password }
        : { username, password, displayName, role };
      const result = await api<{ token: string; user: User }>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      onAuthenticated(result.token, result.user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  const quickLogin = async (account: ApiConfig["demoAccounts"][number]) => {
    setSubmitting(true);
    setError("");
    try {
      const result = await api<{ token: string; user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: account.username, password: account.password })
      });
      onAuthenticated(result.token, result.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="社区餐饮">
        <div className="auth-visual__top"><Brand /></div>
        <div className="auth-visual__status">
          <span><i />节点在线</span>
          <strong>{config.nodeName}</strong>
          <small>{config.publicUrl}</small>
          <div><CircleCheck size={16} />订单资金透明分配</div>
          <div><CircleCheck size={16} />食客一次付款</div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__inner">
          <div className="auth-heading">
            <span className="auth-heading__icon"><Network size={22} /></span>
            <div><h1>{mode === "login" ? "连接社区节点" : "创建节点账户"}</h1><p>{config.nodeName}</p></div>
          </div>

          {error ? <ErrorBanner message={error} onClose={() => setError("")} /> : null}

          <div className="segmented" role="tablist">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} disabled={!config.registrationOpen}>注册</button>
          </div>

          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === "register" ? (
              <>
                <label>账户类型</label>
                <div className="role-picker">
                  {roles.map(({ role: option, label, icon: Icon }) => (
                    <button type="button" key={option} className={role === option ? "active" : ""} onClick={() => setRole(option)}>
                      <Icon size={18} />{label}
                    </button>
                  ))}
                </div>
                <label htmlFor="displayName">显示名称</label>
                <input id="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required />
              </>
            ) : null}
            <label htmlFor="username">用户名</label>
            <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} required />
            <label htmlFor="password">密码</label>
            <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required />
            <button className="button button--primary button--wide" type="submit" disabled={submitting}>
              {submitting ? "连接中..." : mode === "login" ? "登录节点" : "创建账户"}
            </button>
          </form>

          {mode === "login" && quickAccounts.length ? (
            <div className="quick-login">
              <span>演示账户</span>
              <div>
                {quickAccounts.map((account) => {
                  const Icon = account.role === "consumer" ? Utensils : account.role === "merchant" ? Store : account.role === "rider" ? Bike : Network;
                  return <button key={account.role} type="button" disabled={submitting} onClick={() => void quickLogin(account)}><Icon size={16} />{account.displayName}</button>;
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
