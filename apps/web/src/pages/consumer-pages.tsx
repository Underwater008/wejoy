import {
  ArrowLeft,
  Bike,
  ChefHat,
  Clock3,
  MapPin,
  PackageOpen,
  ReceiptText,
  ShoppingBag,
  Store,
  UtensilsCrossed
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { usePolling } from "../hooks";
import { OrderCard } from "../order-card";
import type { ApiConfig, DeliveryQuote, Merchant, OrderView } from "../types";
import {
  EmptyState,
  IconButton,
  LoadingState,
  Modal,
  Price,
  QuantityControl
} from "../ui";

const merchantImages: Record<string, string> = {
  usr_demo_merchant_noodles: "/assets/noodles.jpg",
  usr_demo_merchant_dumplings: "/assets/dumplings.jpg"
};

export function ConsumerHome({
  config,
  onError
}: {
  config: ApiConfig;
  onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      api<{ merchants: Merchant[] }>("/api/merchants"),
      api<DeliveryQuote>("/api/delivery/quote")
    ])
      .then(([merchantResponse, quoteResponse]) => {
        setMerchants(merchantResponse.merchants);
        setQuote(quoteResponse);
      })
      .catch((caught: unknown) => onError(caught instanceof Error ? caught.message : "商家加载失败"))
      .finally(() => setLoading(false));
  }, [onError]);

  const selected = merchants.find((merchant) => merchant.id === selectedId) ?? null;
  const cartLines = useMemo(() => {
    if (!selected) return [];
    return selected.menu
      .filter((item) => (cart[item.id] ?? 0) > 0)
      .map((item) => ({ ...item, quantity: cart[item.id] ?? 0 }));
  }, [cart, selected]);
  const subtotal = cartLines.reduce((total, item) => total + item.priceFen * item.quantity, 0);
  const grandTotal = subtotal + (quote?.riderFeeFen ?? 0) + (quote?.networkFeeFen ?? 0);

  const chooseMerchant = (merchant: Merchant) => {
    if (selectedId !== merchant.id) setCart({});
    setSelectedId(merchant.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading) return <LoadingState label="正在加载附近商家" />;

  if (!selected) {
    return (
      <div className="consumer-page page-stack">
        <section className="page-heading">
          <div><span className="eyebrow">本节点商家</span><h1>今天吃什么</h1></div>
          <div className="quote-summary"><Bike size={17} /><span>本单配送费</span><strong>{quote ? <Price fen={quote.riderFeeFen} /> : "--"}</strong></div>
        </section>
        <div className="merchant-grid">
          {merchants.map((merchant) => (
            <button className="merchant-card" key={merchant.id} onClick={() => chooseMerchant(merchant)} disabled={!merchant.isOpen}>
              <img src={merchantImages[merchant.id] ?? "/assets/noodles.jpg"} alt={`${merchant.name}菜品`} />
              <span className={`merchant-card__state ${merchant.isOpen ? "open" : ""}`}>{merchant.isOpen ? "营业中" : "休息中"}</span>
              <div className="merchant-card__body">
                <div><h2>{merchant.name}</h2><span><Clock3 size={14} />约 {merchant.prepMinutes} 分钟</span></div>
                <p>{merchant.description}</p>
                <div className="merchant-card__footer"><span><MapPin size={14} />{merchant.address}</span><strong>{merchant.menu.length} 道菜</strong></div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const categories = Object.entries(
    selected.menu.reduce<Record<string, typeof selected.menu>>((groups, item) => {
      (groups[item.category] ??= []).push(item);
      return groups;
    }, {})
  );

  return (
    <div className="menu-page">
      <section className="menu-main">
        <button className="back-link" onClick={() => setSelectedId(null)}><ArrowLeft size={17} />返回商家</button>
        <div className="merchant-banner">
          <img src={merchantImages[selected.id] ?? "/assets/noodles.jpg"} alt={`${selected.name}菜品`} />
          <div><span className="eyebrow">营业中 · 约 {selected.prepMinutes} 分钟</span><h1>{selected.name}</h1><p>{selected.description}</p><span><MapPin size={15} />{selected.address}</span></div>
        </div>

        <div className="menu-categories">
          {categories.map(([category, items]) => (
            <section key={category}>
              <h2>{category}</h2>
              <div className="menu-list">
                {items.map((item) => (
                  <div className={`menu-row ${!item.isAvailable ? "menu-row--disabled" : ""}`} key={item.id}>
                    <div><h3>{item.name}</h3><p>{item.description}</p><Price fen={item.priceFen} /></div>
                    {item.isAvailable ? (
                      <QuantityControl value={cart[item.id] ?? 0} onChange={(quantity) => setCart((current) => ({ ...current, [item.id]: quantity }))} />
                    ) : <span className="sold-out">已售罄</span>}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <aside className={`cart-panel ${cartLines.length ? "cart-panel--active" : ""}`}>
        <header><div><ShoppingBag size={18} /><h2>购物袋</h2></div><span>{cartLines.reduce((sum, item) => sum + item.quantity, 0)} 件</span></header>
        {cartLines.length ? (
          <>
            <div className="cart-lines">
              {cartLines.map((item) => <div key={item.id}><span>{item.name}<small>x{item.quantity}</small></span><Price fen={item.priceFen * item.quantity} /></div>)}
            </div>
            <div className="cart-allocation">
              <div><span>餐费</span><Price fen={subtotal} /></div>
              <div><span>配送费</span><Price fen={quote?.riderFeeFen ?? 0} /></div>
              <div><span>节点费</span><Price fen={quote?.networkFeeFen ?? 0} /></div>
              <div className="total"><strong>合计</strong><Price fen={grandTotal} /></div>
            </div>
            <button className="button button--primary button--wide" onClick={() => setCheckoutOpen(true)}>去结算 <Price fen={grandTotal} /></button>
          </>
        ) : <EmptyState icon={<ShoppingBag size={22} />} title="购物袋为空" />}
      </aside>

      {checkoutOpen && quote ? (
        <CheckoutModal
          config={config}
          merchant={selected}
          lines={cartLines}
          quote={quote}
          total={grandTotal}
          onClose={() => setCheckoutOpen(false)}
          onError={onError}
          onCreated={() => navigate("/orders")}
        />
      ) : null}
    </div>
  );
}

function CheckoutModal({
  config,
  merchant,
  lines,
  quote,
  total,
  onClose,
  onError,
  onCreated
}: {
  config: ApiConfig;
  merchant: Merchant;
  lines: Array<Merchant["menu"][number] & { quantity: number }>;
  quote: DeliveryQuote;
  total: number;
  onClose: () => void;
  onError: (message: string) => void;
  onCreated: () => void;
}) {
  const [area, setArea] = useState("青禾社区");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api<{ order: OrderView }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          merchantId: merchant.id,
          deliveryArea: area,
          deliveryAddress: address,
          deliveryNote: note || undefined,
          items: lines.map((item) => ({ menuItemId: item.id, quantity: item.quantity }))
        })
      });
      onCreated();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "订单提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="确认订单"
      onClose={onClose}
      footer={<button className="button button--primary button--wide" type="submit" form="checkout-form" disabled={submitting}>{submitting ? "支付中..." : config.paymentProvider === "mock" ? "模拟支付" : "支付"} <Price fen={total} /></button>}
    >
      <form id="checkout-form" className="form-grid" onSubmit={(event) => void submit(event)}>
        <label htmlFor="area">配送区域</label>
        <input id="area" value={area} onChange={(event) => setArea(event.target.value)} required minLength={2} />
        <label htmlFor="address">详细地址</label>
        <textarea id="address" value={address} onChange={(event) => setAddress(event.target.value)} required minLength={4} rows={2} placeholder="街道、门牌、楼层和房间号" />
        <label htmlFor="note">订单备注</label>
        <input id="note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="口味、门禁等" />
      </form>
      <div className="checkout-summary">
        {lines.map((item) => <div key={item.id}><span>{item.name} x{item.quantity}</span><Price fen={item.priceFen * item.quantity} /></div>)}
        <div><span>配送给骑手</span><Price fen={quote.riderFeeFen} /></div>
        <div><span>基础设施节点</span><Price fen={quote.networkFeeFen} /></div>
      </div>
      <div className="payment-note"><ReceiptText size={17} /><span>付款后进入 {Math.round(quote.matchingWindowSeconds / 60)} 分钟接单窗口；未同时匹配商家与骑手将自动退款。</span></div>
    </Modal>
  );
}

export function ConsumerOrders({ onError }: { onError: (message: string) => void }) {
  const [filter, setFilter] = useState<"active" | "history">("active");
  const [acting, setActing] = useState<string | null>(null);
  const { data: orders, loading, refresh } = usePolling(async () => {
    const response = await api<{ orders: OrderView[] }>("/api/orders");
    return response.orders;
  });
  const activeStatuses = ["matching", "confirmed", "preparing", "ready", "picked_up", "delivered", "disputed"];
  const visible = (orders ?? []).filter((order) => filter === "active" ? activeStatuses.includes(order.status) : !activeStatuses.includes(order.status));

  const act = async (order: OrderView, action: string) => {
    setActing(order.id);
    try {
      await api(`/api/orders/${order.id}/actions`, { method: "POST", body: JSON.stringify({ action }) });
      await refresh();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "订单更新失败");
    } finally {
      setActing(null);
    }
  };

  if (loading) return <LoadingState label="正在加载订单" />;

  return (
    <div className="page-stack order-page">
      <section className="page-heading">
        <div><span className="eyebrow">我的订单</span><h1>订单进度</h1></div>
        <div className="segmented segmented--compact">
          <button className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}>进行中</button>
          <button className={filter === "history" ? "active" : ""} onClick={() => setFilter("history")}>历史订单</button>
        </div>
      </section>
      {visible.length ? (
        <div className="order-grid">
          {visible.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              role="consumer"
              actions={
                <>
                  {order.status === "matching" ? <button className="button button--secondary" disabled={acting === order.id} onClick={() => void act(order, "cancel")}>取消并退款</button> : null}
                  {order.status === "delivered" ? <button className="button button--primary" disabled={acting === order.id} onClick={() => void act(order, "confirm-delivery")}>确认收货</button> : null}
                  {["confirmed", "preparing", "ready", "picked_up", "delivered"].includes(order.status) ? <button className="button button--danger-text" disabled={acting === order.id} onClick={() => void act(order, "open-dispute")}>提交争议</button> : null}
                </>
              }
            />
          ))}
        </div>
      ) : <EmptyState icon={filter === "active" ? <PackageOpen size={24} /> : <ReceiptText size={24} />} title={filter === "active" ? "暂无进行中订单" : "暂无历史订单"} />}
    </div>
  );
}
