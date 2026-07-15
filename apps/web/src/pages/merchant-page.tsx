import {
  ClipboardList,
  Clock3,
  PackageOpen,
  Plus,
  Settings2,
  Store,
  Utensils
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { OrderCard } from "../order-card";
import type { MeResponse, MenuItem, Merchant, OrderView } from "../types";
import { EmptyState, LoadingState, Modal, Price, Toggle } from "../ui";

type MerchantTab = "orders" | "menu" | "settings";

export function MerchantWorkspace({
  me,
  refreshMe,
  onError
}: {
  me: MeResponse;
  refreshMe: () => Promise<MeResponse>;
  onError: (message: string) => void;
}) {
  const merchant = me.profile as Merchant;
  const [tab, setTab] = useState<MerchantTab>("orders");
  const [acting, setActing] = useState<string | null>(null);
  const [menuEditor, setMenuEditor] = useState<MenuItem | "new" | null>(null);
  const { data: orders, loading, refresh } = usePolling(async () => {
    const response = await api<{ orders: OrderView[] }>("/api/orders");
    return response.orders;
  });

  const updateOpen = async (isOpen: boolean) => {
    try {
      await api("/api/merchant/settings", {
        method: "PATCH",
        body: JSON.stringify({ isOpen })
      });
      await refreshMe();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "营业状态更新失败");
    }
  };

  const act = async (orderId: string, action: string) => {
    setActing(orderId);
    try {
      await api(`/api/orders/${orderId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      await refresh();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "订单更新失败");
    } finally {
      setActing(null);
    }
  };

  const updateMenuItem = async (item: MenuItem, values: Partial<MenuItem>) => {
    try {
      await api(`/api/merchant/menu/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(values)
      });
      await refreshMe();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "菜品更新失败");
    }
  };

  const matching = (orders ?? []).filter((order) => order.status === "matching");
  const active = (orders ?? []).filter((order) => ["confirmed", "preparing", "ready", "picked_up", "delivered", "disputed"].includes(order.status));
  const history = (orders ?? []).filter((order) => ["completed", "cancelled"].includes(order.status));

  return (
    <div className="workspace page-stack">
      <section className="workspace-header">
        <div className="workspace-header__identity">
          <span className="workspace-icon"><Store size={24} /></span>
          <div><span className="eyebrow">商家工作台</span><h1>{merchant.name}</h1><p>{merchant.address} · 备餐约 {merchant.prepMinutes} 分钟</p></div>
        </div>
        <div className="availability-control">
          <span><i className={merchant.isOpen ? "online" : ""} />{merchant.isOpen ? "营业中" : "已休息"}</span>
          <Toggle checked={merchant.isOpen} onChange={(next) => void updateOpen(next)} label="切换营业状态" />
        </div>
      </section>

      <div className="workspace-tabs" role="tablist">
        <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><ClipboardList size={17} />订单{matching.length ? <b>{matching.length}</b> : null}</button>
        <button className={tab === "menu" ? "active" : ""} onClick={() => setTab("menu")}><Utensils size={17} />菜单</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings2 size={17} />店铺设置</button>
      </div>

      {tab === "orders" ? (
        loading ? <LoadingState label="正在加载订单" /> : (
          <div className="operational-columns">
            <section>
              <div className="section-title"><div><h2>待处理</h2><span>接单窗口内确认</span></div><strong>{matching.length}</strong></div>
              <div className="order-list">
                {matching.length ? matching.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    role="merchant"
                    actions={order.merchantDecision === "pending" ? <>
                      <button className="button button--secondary" disabled={acting === order.id} onClick={() => void act(order.id, "merchant-reject")}>无法接单</button>
                      <button className="button button--primary" disabled={acting === order.id} onClick={() => void act(order.id, "merchant-accept")}>接受订单</button>
                    </> : <span className="waiting-label"><Clock3 size={15} />等待骑手接单</span>}
                  />
                )) : <EmptyState icon={<PackageOpen size={23} />} title="暂无待接订单" />}
              </div>
            </section>

            <section>
              <div className="section-title"><div><h2>履约中</h2><span>制作、出餐与配送</span></div><strong>{active.length}</strong></div>
              <div className="order-list">
                {active.length ? active.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    role="merchant"
                    actions={<>
                      {order.status === "confirmed" ? <button className="button button--primary" disabled={acting === order.id} onClick={() => void act(order.id, "start-preparing")}>开始制作</button> : null}
                      {order.status === "preparing" ? <button className="button button--primary" disabled={acting === order.id} onClick={() => void act(order.id, "mark-ready")}>通知取餐</button> : null}
                      {["confirmed", "preparing", "ready"].includes(order.status) ? <button className="button button--danger-text" disabled={acting === order.id} onClick={() => void act(order.id, "open-dispute")}>提交争议</button> : null}
                    </>}
                  />
                )) : <EmptyState icon={<ClipboardList size={23} />} title="暂无履约中订单" />}
              </div>
            </section>

            {history.length ? <section className="operational-columns__wide"><div className="section-title"><div><h2>最近完成</h2><span>已结算或退款</span></div></div><div className="history-row">{history.slice(0, 4).map((order) => <OrderCard key={order.id} order={order} role="merchant" compact />)}</div></section> : null}
          </div>
        )
      ) : null}

      {tab === "menu" ? (
        <section className="menu-manager">
          <div className="section-toolbar"><div><h2>菜单</h2><span>{merchant.menu.filter((item) => item.isAvailable).length} 道在售</span></div><button className="button button--primary" onClick={() => setMenuEditor("new")}><Plus size={16} />添加菜品</button></div>
          <div className="menu-table">
            {merchant.menu.map((item) => (
              <div className="menu-table__row" key={item.id}>
                <button className="menu-table__identity" onClick={() => setMenuEditor(item)}><span><strong>{item.name}</strong><small>{item.category} · {item.description}</small></span></button>
                <Price fen={item.priceFen} />
                <span className={item.isAvailable ? "availability-text active" : "availability-text"}>{item.isAvailable ? "在售" : "下架"}</span>
                <Toggle checked={item.isAvailable} onChange={(isAvailable) => void updateMenuItem(item, { isAvailable })} label={`${item.name}上下架`} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "settings" ? <MerchantSettings merchant={merchant} refreshMe={refreshMe} onError={onError} /> : null}

      {menuEditor ? <MenuEditor item={menuEditor === "new" ? null : menuEditor} onClose={() => setMenuEditor(null)} onSaved={async () => { setMenuEditor(null); await refreshMe(); }} onError={onError} /> : null}
    </div>
  );
}

function MenuEditor({
  item,
  onClose,
  onSaved,
  onError
}: {
  item: MenuItem | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [category, setCategory] = useState(item?.category ?? "主食");
  const [price, setPrice] = useState(item ? String(item.priceFen / 100) : "");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api(item ? `/api/merchant/menu/${item.id}` : "/api/merchant/menu", {
        method: item ? "PATCH" : "POST",
        body: JSON.stringify({ name, description, category, priceFen: Math.round(Number(price) * 100), isAvailable: item?.isAvailable ?? true })
      });
      await onSaved();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "菜品保存失败");
    } finally {
      setSaving(false);
    }
  };

  return <Modal title={item ? "编辑菜品" : "添加菜品"} onClose={onClose} footer={<button className="button button--primary button--wide" type="submit" form="menu-editor" disabled={saving}>{saving ? "保存中..." : "保存菜品"}</button>}>
    <form id="menu-editor" className="form-grid" onSubmit={(event) => void submit(event)}>
      <label htmlFor="menu-name">菜品名称</label><input id="menu-name" value={name} onChange={(event) => setName(event.target.value)} required />
      <label htmlFor="menu-category">分类</label><input id="menu-category" value={category} onChange={(event) => setCategory(event.target.value)} required />
      <label htmlFor="menu-description">描述</label><textarea id="menu-description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
      <label htmlFor="menu-price">价格（元）</label><input id="menu-price" type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required />
    </form>
  </Modal>;
}

function MerchantSettings({ merchant, refreshMe, onError }: { merchant: Merchant; refreshMe: () => Promise<MeResponse>; onError: (message: string) => void }) {
  const [name, setName] = useState(merchant.name);
  const [description, setDescription] = useState(merchant.description);
  const [address, setAddress] = useState(merchant.address);
  const [prepMinutes, setPrepMinutes] = useState(String(merchant.prepMinutes));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(merchant.name); setDescription(merchant.description); setAddress(merchant.address); setPrepMinutes(String(merchant.prepMinutes));
  }, [merchant]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await api("/api/merchant/settings", { method: "PATCH", body: JSON.stringify({ name, description, address, prepMinutes: Number(prepMinutes) }) });
      await refreshMe();
    } catch (caught) { onError(caught instanceof Error ? caught.message : "店铺保存失败"); }
    finally { setSaving(false); }
  };

  return <section className="settings-panel"><div className="section-toolbar"><div><h2>店铺资料</h2><span>消费者下单时可见</span></div></div><form className="settings-form" onSubmit={(event) => void submit(event)}>
    <label>店铺名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
    <label>备餐时间（分钟）<input type="number" min="5" max="120" value={prepMinutes} onChange={(event) => setPrepMinutes(event.target.value)} required /></label>
    <label className="span-two">店铺地址<input value={address} onChange={(event) => setAddress(event.target.value)} required /></label>
    <label className="span-two">店铺介绍<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="span-two"><button className="button button--primary" disabled={saving}>{saving ? "保存中..." : "保存设置"}</button></div>
  </form></section>;
}
