export const USER_ROLES = ["consumer", "merchant", "rider", "operator"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ORDER_STATUSES = [
  "matching",
  "confirmed",
  "preparing",
  "ready",
  "picked_up",
  "delivered",
  "completed",
  "cancelled",
  "disputed"
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "paid", "refunded", "split", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const MERCHANT_DECISIONS = ["pending", "accepted", "rejected"] as const;
export type MerchantDecision = (typeof MERCHANT_DECISIONS)[number];

export interface MoneyAllocation {
  merchantFen: number;
  riderFen: number;
  networkFen: number;
  totalFen: number;
}

export interface OrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceFen: number;
  totalFen: number;
}

export interface PublicOrderEvent {
  id: string;
  orderId: string;
  sequence: number;
  type: string;
  actorRole: UserRole | "system";
  payload: Record<string, unknown>;
  createdAt: string;
  previousHash: string | null;
  hash: string;
  signature: string;
  nodePublicKey: string;
}

export interface OrderView {
  id: string;
  consumerId: string;
  merchantId: string;
  riderId: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  merchantDecision: MerchantDecision;
  merchantName: string;
  riderName: string | null;
  consumerName: string;
  deliveryArea: string;
  deliveryAddress: string;
  deliveryNote: string | null;
  items: OrderItem[];
  allocation: MoneyAllocation;
  matchingDeadline: string;
  confirmedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  matching: ["confirmed", "cancelled", "disputed"],
  confirmed: ["preparing", "cancelled", "disputed"],
  preparing: ["ready", "cancelled", "disputed"],
  ready: ["picked_up", "cancelled", "disputed"],
  picked_up: ["delivered", "disputed"],
  delivered: ["completed", "disputed"],
  completed: [],
  cancelled: [],
  disputed: ["cancelled", "completed"]
};

export function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUSES.includes(value as OrderStatus);
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new Error(`Order cannot transition from ${from} to ${to}`);
  }
}

export interface MatchingState {
  paymentStatus: PaymentStatus;
  merchantDecision: MerchantDecision;
  riderAssigned: boolean;
  matchingDeadline: string;
}

export type MatchingResolution = "waiting" | "confirmed" | "cancelled";

export function resolveMatchingState(
  state: MatchingState,
  now: Date = new Date()
): MatchingResolution {
  if (state.paymentStatus !== "paid") {
    return "cancelled";
  }

  if (state.merchantDecision === "rejected") {
    return "cancelled";
  }

  if (state.merchantDecision === "accepted" && state.riderAssigned) {
    return "confirmed";
  }

  return now.getTime() >= new Date(state.matchingDeadline).getTime() ? "cancelled" : "waiting";
}

export function calculateAllocation(
  merchantSubtotalFen: number,
  riderFeeFen: number,
  networkFeeFen: number
): MoneyAllocation {
  for (const amount of [merchantSubtotalFen, riderFeeFen, networkFeeFen]) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error("Money amounts must be non-negative integer fen");
    }
  }

  return {
    merchantFen: merchantSubtotalFen,
    riderFen: riderFeeFen,
    networkFen: networkFeeFen,
    totalFen: merchantSubtotalFen + riderFeeFen + networkFeeFen
  };
}

export function formatFen(fen: number): string {
  if (!Number.isSafeInteger(fen)) {
    throw new Error("Money amounts must be integer fen");
  }

  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2
  }).format(fen / 100);
}

export function secondsUntil(isoDate: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(isoDate).getTime() - now.getTime()) / 1000));
}
