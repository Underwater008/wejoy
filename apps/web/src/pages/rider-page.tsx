import {
  Bike,
  CheckCircle2,
  Clock3,
  MapPinned,
  PackageOpen,
  Route,
  WalletCards
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { OrderCard } from "../order-card";
import type { MeResponse, OrderView, RiderProfile } from "../types";
import { EmptyState, LoadingState, Price, SelectField, Toggle } from "../ui";

export function RiderWorkspace({
  me,
  refreshMe,
  onError
}: {
  me: MeResponse;
  refreshMe: () => Promise<MeResponse>;
  onError: (message: string) => void;
}) {
  const profile = me.profile as RiderProfile;
  const [minimumFee, setMinimumFee] = useState(String(profile.minimumFeeFen / 100));
  const [transport, setTransport] = useState(profile.transport);
  const [savingSettings, setSavingSettings] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const { data: orders, loading, refresh } = usePolling(async () => {
    const response = await api<{ orders: OrderView[] }>("/api/orders");
    return response.orders;
  });

  useEffect(() => {
    setMinimumFee(String(profile.minimumFeeFen / 100));
    setTransport(profile.transport);
  }, [profile.minimumFeeFen, profile.transport]);

  const updateSettings = async (values: Record<string, unknown>) => {
    setSavingSettings(true);
    try {
      await api("/api/rider/settings", {
        method: "PATCH",
        body: JSON.stringify(values)
      });
      await refreshMe();
      await refresh();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "骑手设置更新失败");
    } finally {
      setSavingSettings(false);
    }
  };

  const saveRate = () => updateSettings({
    minimumFeeFen: Math.round(Number(minimumFee) * 100),
    transport
  });

  const act = async (orderId: string, action: string) => {
    setActing(orderId);
    try {
      await api(`/api/orders/${orderId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      await refresh();
      if (action === "mark-delivered") await refreshMe();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "订单更新失败");
    } finally {
      setActing(null);
    }
  };

  const offers = (orders ?? []).filter((order) => order.status === "matching" && !order.riderId);
  const active = (orders ?? []).filter((order) => order.riderId === me.user.id && ["matching", "confirmed", "preparing", "ready", "picked_up", "delivered", "disputed"].includes(order.status));
  const completed = (orders ?? []).filter((order) => order.riderId === me.user.id && ["completed", "cancelled"].includes(order.status));

  return (
    <div className="workspace page-stack rider-workspace">
      <section className="workspace-header rider-header">
        <div className="workspace-header__identity">
          <span className="workspace-icon workspace-icon--rider"><Bike size={24} /></span>
          <div><span className="eyebrow">骑手工作台</span><h1>{me.user.displayName}</h1><p>已完成 {profile.completedDeliveries} 单</p></div>
        </div>
        <div className="availability-control">
          <span><i className={profile.isAvailable ? "online" : ""} />{profile.isAvailable ? "接单中" : "已暂停"}</span>
          <Toggle checked={profile.isAvailable} disabled={savingSettings} onChange={(isAvailable) => void updateSettings({ isAvailable })} label="切换接单状态" />
        </div>
      </section>

      <section className="rider-rate-bar">
        <div><WalletCards size={19} /><span>最低配送费</span><label><b>¥</b><input type="number" min="0" step="0.5" value={minimumFee} onChange={(event) => setMinimumFee(event.target.value)} /></label></div>
        <div><Route size={19} /><span>交通工具</span><SelectField value={transport} onChange={(event) => setTransport(event.target.value)}><option value="ebike">电动车</option><option value="bike">自行车</option><option value="car">汽车</option><option value="walk">步行</option></SelectField></div>
        <button className="button button--secondary" disabled={savingSettings} onClick={() => void saveRate()}>{savingSettings ? "保存中..." : "保存接单设置"}</button>
      </section>

      {loading ? <LoadingState label="正在加载配送订单" /> : (
        <div className="operational-columns">
          <section>
            <div className="section-title"><div><h2>可接订单</h2><span>按你的最低价格筛选</span></div><strong>{offers.length}</strong></div>
            <div className="order-list">
              {offers.length ? offers.map((order) => (
                <OrderCard key={order.id} order={order} role="rider" actions={<button className="button button--rider button--wide" disabled={acting === order.id || !profile.isAvailable} onClick={() => void act(order.id, "rider-accept")}>接受配送 · <Price fen={order.allocation.riderFen} /></button>} />
              )) : <EmptyState icon={<MapPinned size={23} />} title={profile.isAvailable ? "暂无符合价格的订单" : "接单已暂停"} />}
            </div>
          </section>

          <section>
            <div className="section-title"><div><h2>我的配送</h2><span>取餐与送达</span></div><strong>{active.length}</strong></div>
            <div className="order-list">
              {active.length ? active.map((order) => (
                <OrderCard key={order.id} order={order} role="rider" actions={<>
                  {order.status === "matching" ? <span className="waiting-label"><Clock3 size={15} />等待商家接单</span> : null}
                  {order.status === "ready" ? <button className="button button--rider" disabled={acting === order.id} onClick={() => void act(order.id, "mark-picked-up")}>确认取餐</button> : null}
                  {order.status === "picked_up" ? <button className="button button--rider" disabled={acting === order.id} onClick={() => void act(order.id, "mark-delivered")}>确认送达</button> : null}
                  {["confirmed", "preparing", "ready", "picked_up", "delivered"].includes(order.status) ? <button className="button button--danger-text" disabled={acting === order.id} onClick={() => void act(order.id, "open-dispute")}>提交争议</button> : null}
                </>} />
              )) : <EmptyState icon={<PackageOpen size={23} />} title="暂无配送任务" />}
            </div>
          </section>

          {completed.length ? <section className="operational-columns__wide"><div className="section-title"><div><h2>最近完成</h2><span>配送费已结算</span></div><CheckCircle2 size={19} /></div><div className="history-row">{completed.slice(0, 4).map((order) => <OrderCard key={order.id} order={order} role="rider" compact />)}</div></section> : null}
        </div>
      )}
    </div>
  );
}
