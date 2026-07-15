import {
  Bike,
  Check,
  ChefHat,
  CircleDollarSign,
  Clock3,
  MapPin,
  PackageCheck,
  ShieldAlert,
  Store,
  UserRound
} from "lucide-react";
import type { ReactNode } from "react";
import type { OrderStatus } from "@wejoy/domain";
import type { OrderView, UserRole } from "./types";
import { Countdown, Price } from "./ui";

const statusCopy: Record<OrderStatus, string> = {
  matching: "等待接单",
  confirmed: "已确认",
  preparing: "制作中",
  ready: "待取餐",
  picked_up: "配送中",
  delivered: "已送达",
  completed: "已完成",
  cancelled: "已退款",
  disputed: "争议处理中"
};

const statusStep: Partial<Record<OrderStatus, number>> = {
  confirmed: 1,
  preparing: 2,
  ready: 3,
  picked_up: 4,
  delivered: 5,
  completed: 6
};

export function OrderCard({
  order,
  role,
  actions,
  compact = false
}: {
  order: OrderView;
  role: UserRole;
  actions?: ReactNode;
  compact?: boolean;
}) {
  const currentStep = statusStep[order.status] ?? 0;
  return (
    <article className={`order-card ${compact ? "order-card--compact" : ""}`}>
      <header className="order-card__header">
        <div>
          <span className="order-card__eyebrow">#{order.id.slice(-6).toUpperCase()}</span>
          <h3>{order.merchantName}</h3>
        </div>
        <span className={`status-badge status-badge--${order.status}`}>
          {order.status === "disputed" ? <ShieldAlert size={14} /> : null}
          {statusCopy[order.status]}
        </span>
      </header>

      {order.status === "matching" ? (
        <div className="matching-strip">
          <div><Clock3 size={16} /><span>剩余</span><Countdown deadline={order.matchingDeadline} /></div>
          <div className={order.merchantDecision === "accepted" ? "accepted" : ""}>
            {order.merchantDecision === "accepted" ? <Check size={15} /> : <Store size={15} />}
            商家{order.merchantDecision === "accepted" ? "已接" : "待接"}
          </div>
          <div className={order.riderId ? "accepted" : ""}>
            {order.riderId ? <Check size={15} /> : <Bike size={15} />}
            骑手{order.riderId ? "已接" : "待接"}
          </div>
        </div>
      ) : null}

      {!compact && !["matching", "cancelled", "disputed"].includes(order.status) ? (
        <div className="order-progress" aria-label="订单进度">
          {[
            [ChefHat, "确认"],
            [Store, "制作"],
            [PackageCheck, "取餐"],
            [Bike, "配送"],
            [MapPin, "送达"]
          ].map(([Icon, label], index) => {
            const StepIcon = Icon as typeof ChefHat;
            const done = currentStep > index;
            return <span key={label as string} className={done ? "done" : ""}><StepIcon size={15} /><small>{label as string}</small></span>;
          })}
        </div>
      ) : null}

      <div className="order-card__meta">
        {role !== "consumer" ? <span><UserRound size={15} />{order.consumerName}</span> : null}
        <span><MapPin size={15} />{order.deliveryAddress}</span>
      </div>

      <div className="order-items">
        {order.items.map((item) => (
          <div key={item.menuItemId}>
            <span>{item.name} <small>x{item.quantity}</small></span>
            <Price fen={item.totalFen} />
          </div>
        ))}
      </div>

      <details className="allocation">
        <summary><CircleDollarSign size={15} />资金分配 <Price fen={order.allocation.totalFen} /></summary>
        <div><span>餐费给商家</span><Price fen={order.allocation.merchantFen} /></div>
        <div><span>配送费给骑手</span><Price fen={order.allocation.riderFen} /></div>
        <div><span>节点基础设施</span><Price fen={order.allocation.networkFen} /></div>
      </details>

      {order.cancellationReason ? <p className="order-note">原因：{order.cancellationReason}</p> : null}
      {order.deliveryNote ? <p className="order-note">备注：{order.deliveryNote}</p> : null}
      {actions ? <footer className="order-card__actions">{actions}</footer> : null}
    </article>
  );
}

export { statusCopy };
