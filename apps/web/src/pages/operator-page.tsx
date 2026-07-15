import {
  Activity,
  CircleDollarSign,
  Database,
  FileKey2,
  GitFork,
  Network,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UsersRound
} from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { statusCopy } from "../order-card";
import type {
  ApiConfig,
  FederationInfo,
  OperatorOverview,
  OrderView,
  PublicOrderEvent
} from "../types";
import { EmptyState, LoadingState, Price } from "../ui";

type OperatorData = {
  overview: OperatorOverview;
  orders: OrderView[];
  events: PublicOrderEvent[];
  info: FederationInfo;
};

export function OperatorWorkspace({
  config,
  onError
}: {
  config: ApiConfig;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<"orders" | "ledger" | "peers">("orders");
  const [acting, setActing] = useState<string | null>(null);
  const { data, loading, refresh } = usePolling(async () => {
    const [overview, orderResponse, eventResponse, info] = await Promise.all([
      api<OperatorOverview>("/api/operator/overview"),
      api<{ orders: OrderView[] }>("/api/orders"),
      api<{ events: PublicOrderEvent[]; nextCursor: string | null }>("/api/federation/events?limit=200"),
      api<FederationInfo>("/api/federation/info")
    ]);
    return { overview, orders: orderResponse.orders, events: eventResponse.events.slice().reverse(), info };
  }, 5_000);

  const resolve = async (orderId: string, action: "operator-refund" | "operator-complete") => {
    setActing(orderId);
    try {
      await api(`/api/orders/${orderId}/actions`, { method: "POST", body: JSON.stringify({ action }) });
      await refresh();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "争议处理失败");
    } finally {
      setActing(null);
    }
  };

  if (loading || !data) return <LoadingState label="正在加载节点状态" />;
  const { overview, orders, events, info } = data;

  return (
    <div className="workspace operator-workspace page-stack">
      <section className="workspace-header">
        <div className="workspace-header__identity">
          <span className="workspace-icon workspace-icon--operator"><Network size={24} /></span>
          <div><span className="eyebrow">节点运营</span><h1>{config.nodeName}</h1><p>Node {info.nodeId} · {info.protocolVersion}</p></div>
        </div>
        <div className="operator-health"><span><i />运行中</span><button className="icon-button" title="刷新" aria-label="刷新" onClick={() => void refresh()}><RefreshCw size={17} /></button></div>
      </section>

      <section className="metric-grid">
        <Metric icon={<ReceiptText size={19} />} label="全部订单" value={String(overview.totalOrders)} detail={`${overview.matchingOrders} 单匹配中`} />
        <Metric icon={<CircleDollarSign size={19} />} label="完成交易额" value={<Price fen={overview.completedVolumeFen} />} detail={`节点收入 ${formatCompactFen(overview.networkRevenueFen)}`} />
        <Metric icon={<UsersRound size={19} />} label="节点账户" value={String(Object.values(overview.users).reduce((sum, count) => sum + (count ?? 0), 0))} detail={`${overview.users.merchant ?? 0} 商家 · ${overview.users.rider ?? 0} 骑手`} />
        <Metric icon={<ShieldCheck size={19} />} label="签名收据" value={String(overview.signedEvents)} detail={`${overview.federatedEvents} 条外部收据`} warning={overview.disputedOrders > 0 ? `${overview.disputedOrders} 单争议` : undefined} />
      </section>

      <div className="workspace-tabs" role="tablist">
        <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><Activity size={17} />订单运行{overview.disputedOrders ? <b>{overview.disputedOrders}</b> : null}</button>
        <button className={tab === "ledger" ? "active" : ""} onClick={() => setTab("ledger")}><FileKey2 size={17} />公开账本</button>
        <button className={tab === "peers" ? "active" : ""} onClick={() => setTab("peers")}><GitFork size={17} />社区节点</button>
      </div>

      {tab === "orders" ? (
        <section className="operator-table-wrap">
          <div className="section-toolbar"><div><h2>订单运行</h2><span>最近 {orders.length} 单</span></div></div>
          {orders.length ? <div className="data-table">
            <div className="data-table__head"><span>订单</span><span>参与方</span><span>状态</span><span>金额</span><span>时间</span><span>操作</span></div>
            {orders.map((order) => <div className="data-table__row" key={order.id}>
              <span data-label="订单"><strong>#{order.id.slice(-6).toUpperCase()}</strong><small>{order.deliveryArea}</small></span>
              <span data-label="参与方"><strong>{order.merchantName}</strong><small>{order.riderName ?? "未匹配骑手"}</small></span>
              <span data-label="状态"><i className={`status-dot status-dot--${order.status}`} />{statusCopy[order.status]}</span>
              <span data-label="金额"><Price fen={order.allocation.totalFen} /><small>节点 <Price fen={order.allocation.networkFen} /></small></span>
              <span data-label="时间"><strong>{formatTime(order.createdAt)}</strong><small>{formatDate(order.createdAt)}</small></span>
              <span data-label="操作" className="table-actions">{order.status === "disputed" ? <><button className="button button--secondary button--small" disabled={acting === order.id} onClick={() => void resolve(order.id, "operator-refund")}>退款</button><button className="button button--primary button--small" disabled={acting === order.id} onClick={() => void resolve(order.id, "operator-complete")}>放款</button></> : <span className="muted">--</span>}</span>
            </div>)}
          </div> : <EmptyState icon={<Database size={23} />} title="节点尚无订单" />}
        </section>
      ) : null}

      {tab === "ledger" ? (
        <section className="ledger-panel">
          <div className="section-toolbar"><div><h2>签名订单收据</h2><span>不包含账户、地址或联系方式</span></div><span className="verified-pill"><ShieldCheck size={15} />Ed25519</span></div>
          {events.length ? <div className="ledger-list">{events.map((event) => <div className="ledger-row" key={event.id}>
            <span className="ledger-row__sequence">{event.sequence}</span>
            <span><strong>{event.type}</strong><small>#{event.orderId.slice(-6).toUpperCase()} · {event.actorRole}</small></span>
            <span className="ledger-row__hash"><code>{event.hash.slice(0, 16)}...</code><small>{formatDateTime(event.createdAt)}</small></span>
            <ShieldCheck size={17} />
          </div>)}</div> : <EmptyState icon={<FileKey2 size={23} />} title="尚无签名收据" />}
        </section>
      ) : null}

      {tab === "peers" ? (
        <section className="peer-panel">
          <div className="node-identity-band"><div><span>本节点 ID</span><code>{info.nodeId}</code></div><div><span>公开地址</span><code>{info.publicUrl}</code></div><div><span>支付适配器</span><code>{config.paymentProvider}</code></div></div>
          <div className="section-toolbar"><div><h2>社区节点</h2><span>只同步公开签名收据</span></div></div>
          {overview.peers.length ? <div className="peer-list">{overview.peers.map((peer) => <div key={peer.url}><span className={peer.lastError ? "peer-state peer-state--error" : "peer-state"}><i />{peer.lastError ? "异常" : "已连接"}</span><strong>{peer.name ?? peer.url}</strong><code>{peer.url}</code><small>{peer.receivedEvents} 条收据</small></div>)}</div> : <EmptyState icon={<GitFork size={23} />} title="尚未配置其他节点" detail="WEJOY_PEERS 为空" />}
          <div className="federation-boundary"><TriangleAlert size={18} /><span>跨节点点餐不在 v0.1 范围内；当前联邦层只验证和复制公开收据。</span></div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ icon, label, value, detail, warning }: { icon: React.ReactNode; label: string; value: React.ReactNode; detail: string; warning?: string | undefined }) {
  return <div className="metric"><span className="metric__icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>{warning ? <em><TriangleAlert size={13} />{warning}</em> : null}</div>;
}

function formatCompactFen(fen: number) { return `¥${(fen / 100).toFixed(2)}`; }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
