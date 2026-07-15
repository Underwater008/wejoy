import { randomUUID } from "node:crypto";
import {
  assertOrderTransition,
  calculateAllocation,
  resolveMatchingState,
  type MerchantDecision,
  type MoneyAllocation,
  type OrderItem,
  type OrderStatus,
  type OrderView,
  type PaymentStatus,
  type UserRole
} from "@wejoy/domain";
import type { AppConfig } from "./config.js";
import type { AuthenticatedUser } from "./auth.js";
import type { Database } from "./database.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import type { EventStore } from "./events.js";
import type { PaymentAdapter } from "./payments.js";

export interface MenuItemView {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  category: string;
  priceFen: number;
  isAvailable: boolean;
}

export interface MerchantView {
  id: string;
  name: string;
  description: string;
  address: string;
  prepMinutes: number;
  isOpen: boolean;
  menu: MenuItemView[];
}

export interface DeliveryQuote {
  riderFeeFen: number;
  networkFeeFen: number;
  eligibleRiders: number;
  matchingWindowSeconds: number;
}

export interface CreateOrderInput {
  merchantId: string;
  deliveryArea: string;
  deliveryAddress: string;
  deliveryNote?: string | undefined;
  items: Array<{ menuItemId: string; quantity: number }>;
}

export interface MerchantSettingsInput {
  name?: string | undefined;
  description?: string | undefined;
  address?: string | undefined;
  prepMinutes?: number | undefined;
  isOpen?: boolean | undefined;
}

export interface RiderSettingsInput {
  minimumFeeFen?: number | undefined;
  isAvailable?: boolean | undefined;
  transport?: string | undefined;
}

interface MenuItemRow {
  id: string;
  merchant_id: string;
  name: string;
  description: string;
  category: string;
  price_fen: number;
  is_available: number;
}

interface OrderRow {
  id: string;
  consumer_id: string;
  merchant_id: string;
  rider_id: string | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  merchant_decision: MerchantDecision;
  delivery_area: string;
  delivery_address: string;
  delivery_note: string | null;
  items_json: string;
  merchant_fen: number;
  rider_fen: number;
  network_fen: number;
  total_fen: number;
  matching_deadline: string;
  payment_reference: string | null;
  confirmed_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  consumer_name: string;
  merchant_name: string;
  rider_name: string | null;
}

const ORDER_SELECT = `
  SELECT o.*, consumer.display_name AS consumer_name,
         merchant.name AS merchant_name, rider.display_name AS rider_name
  FROM orders o
  JOIN users consumer ON consumer.id = o.consumer_id
  JOIN merchants merchant ON merchant.user_id = o.merchant_id
  LEFT JOIN users rider ON rider.id = o.rider_id
`;

export type OrderAction =
  | "merchant-accept"
  | "merchant-reject"
  | "start-preparing"
  | "mark-ready"
  | "rider-accept"
  | "mark-picked-up"
  | "mark-delivered"
  | "confirm-delivery"
  | "cancel"
  | "open-dispute"
  | "operator-refund"
  | "operator-complete";

export class OrderService {
  constructor(
    private readonly database: Database,
    private readonly events: EventStore,
    private readonly payments: PaymentAdapter,
    private readonly config: AppConfig
  ) {}

  listMerchants(): MerchantView[] {
    const merchants = this.database.sqlite
      .prepare(
        `SELECT user_id, name, description, address, prep_minutes, is_open
         FROM merchants ORDER BY is_open DESC, name ASC`
      )
      .all() as Array<{
      user_id: string;
      name: string;
      description: string;
      address: string;
      prep_minutes: number;
      is_open: number;
    }>;

    return merchants.map((merchant) => ({
      id: merchant.user_id,
      name: merchant.name,
      description: merchant.description,
      address: merchant.address,
      prepMinutes: merchant.prep_minutes,
      isOpen: Boolean(merchant.is_open),
      menu: this.listMenu(merchant.user_id)
    }));
  }

  getMerchant(merchantId: string): MerchantView {
    const merchant = this.listMerchants().find((item) => item.id === merchantId);
    if (!merchant) {
      throw notFound("Merchant not found");
    }
    return merchant;
  }

  getDeliveryQuote(): DeliveryQuote {
    const rows = this.database.sqlite
      .prepare(
        "SELECT minimum_fee_fen FROM riders WHERE is_available = 1 ORDER BY minimum_fee_fen ASC"
      )
      .all() as Array<{ minimum_fee_fen: number }>;
    const values = rows.map((row) => row.minimum_fee_fen);
    const riderFeeFen = values.length
      ? (values[Math.floor(values.length / 2)] ?? this.config.defaultRiderFeeFen)
      : this.config.defaultRiderFeeFen;

    return {
      riderFeeFen,
      networkFeeFen: this.config.infraFeeFen,
      eligibleRiders: values.filter((value) => value <= riderFeeFen).length,
      matchingWindowSeconds: this.config.matchWindowSeconds
    };
  }

  getProfile(user: AuthenticatedUser): unknown {
    if (user.role === "merchant") {
      return this.getMerchant(user.id);
    }

    if (user.role === "rider") {
      const row = this.database.sqlite
        .prepare(
          `SELECT minimum_fee_fen, is_available, transport, completed_deliveries
           FROM riders WHERE user_id = ?`
        )
        .get(user.id) as
        | {
            minimum_fee_fen: number;
            is_available: number;
            transport: string;
            completed_deliveries: number;
          }
        | undefined;
      if (!row) {
        throw notFound("Rider profile not found");
      }
      return {
        minimumFeeFen: row.minimum_fee_fen,
        isAvailable: Boolean(row.is_available),
        transport: row.transport,
        completedDeliveries: row.completed_deliveries
      };
    }

    return {};
  }

  async createOrder(user: AuthenticatedUser, input: CreateOrderInput): Promise<OrderView> {
    this.requireRole(user, "consumer");
    const merchant = this.getMerchant(input.merchantId);
    if (!merchant.isOpen) {
      throw conflict("This merchant is currently closed", "MERCHANT_CLOSED");
    }
    if (input.items.length === 0 || input.items.length > 20) {
      throw badRequest("An order must contain between 1 and 20 menu items");
    }

    const items: OrderItem[] = [];
    let merchantSubtotalFen = 0;
    for (const requested of input.items) {
      if (!Number.isInteger(requested.quantity) || requested.quantity < 1 || requested.quantity > 20) {
        throw badRequest("Item quantity must be between 1 and 20");
      }
      const menuItem = this.database.sqlite
        .prepare("SELECT * FROM menu_items WHERE id = ? AND merchant_id = ?")
        .get(requested.menuItemId, input.merchantId) as unknown as MenuItemRow | undefined;
      if (!menuItem || !menuItem.is_available) {
        throw conflict("A selected menu item is no longer available", "ITEM_UNAVAILABLE");
      }
      const totalFen = menuItem.price_fen * requested.quantity;
      merchantSubtotalFen += totalFen;
      items.push({
        menuItemId: menuItem.id,
        name: menuItem.name,
        quantity: requested.quantity,
        unitPriceFen: menuItem.price_fen,
        totalFen
      });
    }

    const quote = this.getDeliveryQuote();
    const allocation = calculateAllocation(
      merchantSubtotalFen,
      quote.riderFeeFen,
      quote.networkFeeFen
    );
    const orderId = `ord_${randomUUID()}`;
    const captureKey = `${orderId}:capture`;
    const payment = await this.payments.capture({
      idempotencyKey: captureKey,
      orderId,
      consumerId: user.id,
      amountFen: allocation.totalFen
    });

    const now = new Date();
    const matchingDeadline = new Date(
      now.getTime() + this.config.matchWindowSeconds * 1_000
    ).toISOString();

    try {
      this.database.transaction(() => {
        this.database.sqlite
          .prepare(
            `INSERT INTO orders
              (id, consumer_id, merchant_id, rider_id, status, payment_status,
               merchant_decision, delivery_area, delivery_address, delivery_note, items_json,
               merchant_fen, rider_fen, network_fen, total_fen, matching_deadline,
               payment_reference, created_at, updated_at)
             VALUES (?, ?, ?, NULL, 'matching', 'paid', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            orderId,
            user.id,
            input.merchantId,
            input.deliveryArea.trim(),
            input.deliveryAddress.trim(),
            input.deliveryNote?.trim() || null,
            JSON.stringify(items),
            allocation.merchantFen,
            allocation.riderFen,
            allocation.networkFen,
            allocation.totalFen,
            matchingDeadline,
            payment.providerReference,
            now.toISOString(),
            now.toISOString()
          );
        this.recordPaymentOperation(
          captureKey,
          orderId,
          "capture",
          allocation.totalFen,
          payment.providerReference
        );
        this.events.append(orderId, "order_created", "consumer", {
          status: "matching",
          paymentStatus: "paid",
          ...allocation,
          matchingDeadline
        });
      });
    } catch (error) {
      await this.payments.refund({
        idempotencyKey: `${orderId}:rollback-refund`,
        orderId,
        paymentReference: payment.providerReference,
        amountFen: allocation.totalFen
      });
      throw error;
    }

    return this.getOrderForUser(orderId, user);
  }

  listOrders(user: AuthenticatedUser): OrderView[] {
    let rows: OrderRow[];
    if (user.role === "consumer") {
      rows = this.database.sqlite
        .prepare(`${ORDER_SELECT} WHERE o.consumer_id = ? ORDER BY o.created_at DESC`)
        .all(user.id) as unknown as OrderRow[];
    } else if (user.role === "merchant") {
      rows = this.database.sqlite
        .prepare(`${ORDER_SELECT} WHERE o.merchant_id = ? ORDER BY o.created_at DESC`)
        .all(user.id) as unknown as OrderRow[];
    } else if (user.role === "rider") {
      const profile = this.getProfile(user) as { minimumFeeFen: number; isAvailable: boolean };
      rows = this.database.sqlite
        .prepare(
          `${ORDER_SELECT}
           WHERE o.rider_id = ? OR (
             ? = 1 AND o.status = 'matching' AND o.rider_id IS NULL
             AND o.matching_deadline > ? AND o.rider_fen >= ?
           )
           ORDER BY o.created_at DESC`
        )
        .all(
          user.id,
          profile.isAvailable ? 1 : 0,
          new Date().toISOString(),
          profile.minimumFeeFen
        ) as unknown as OrderRow[];
    } else {
      rows = this.database.sqlite
        .prepare(`${ORDER_SELECT} ORDER BY o.created_at DESC LIMIT 200`)
        .all() as unknown as OrderRow[];
    }

    return rows.map((row) => this.mapOrderForUser(row, user));
  }

  getOrderForUser(orderId: string, user: AuthenticatedUser): OrderView {
    const row = this.getOrderRow(orderId);
    if (!this.canViewOrder(row, user)) {
      throw forbidden("You cannot view this order");
    }
    return this.mapOrderForUser(row, user);
  }

  getOrderEvents(orderId: string, user: AuthenticatedUser) {
    this.getOrderForUser(orderId, user);
    return this.events.listForOrder(orderId);
  }

  async performAction(
    orderId: string,
    action: OrderAction,
    user: AuthenticatedUser
  ): Promise<OrderView> {
    if (["merchant-accept", "rider-accept"].includes(action)) {
      const expired = await this.expireOrderIfNeeded(orderId);
      if (expired) {
        throw conflict("The matching window has expired", "MATCHING_EXPIRED");
      }
    }

    switch (action) {
      case "merchant-accept":
        this.merchantAccept(orderId, user);
        break;
      case "merchant-reject":
        this.requireRole(user, "merchant");
        await this.cancelOrder(orderId, user, "merchant_rejected", true);
        break;
      case "start-preparing":
        this.transition(orderId, user, "merchant", "confirmed", "preparing", "preparing");
        break;
      case "mark-ready":
        this.transition(orderId, user, "merchant", "preparing", "ready", "ready_for_pickup");
        break;
      case "rider-accept":
        this.riderAccept(orderId, user);
        break;
      case "mark-picked-up":
        this.transition(orderId, user, "rider", "ready", "picked_up", "picked_up");
        break;
      case "mark-delivered":
        this.markDelivered(orderId, user);
        break;
      case "confirm-delivery":
        this.requireRole(user, "consumer");
        this.assertOrderOwner(this.getOrderRow(orderId), user);
        await this.completeOrder(orderId, "consumer");
        break;
      case "cancel":
        this.requireRole(user, "consumer");
        await this.cancelOrder(orderId, user, "consumer_cancelled", false);
        break;
      case "open-dispute":
        this.openDispute(orderId, user);
        break;
      case "operator-refund":
        this.requireRole(user, "operator");
        await this.cancelOrder(orderId, user, "operator_refund", false, true);
        break;
      case "operator-complete":
        this.requireRole(user, "operator");
        await this.completeOrder(orderId, "operator", true);
        break;
    }

    return this.getOrderForUser(orderId, user);
  }

  updateMerchantSettings(user: AuthenticatedUser, input: MerchantSettingsInput): MerchantView {
    this.requireRole(user, "merchant");
    const current = this.getMerchant(user.id);
    this.database.sqlite
      .prepare(
        `UPDATE merchants SET name = ?, description = ?, address = ?, prep_minutes = ?, is_open = ?
         WHERE user_id = ?`
      )
      .run(
        input.name?.trim() || current.name,
        input.description?.trim() ?? current.description,
        input.address?.trim() || current.address,
        input.prepMinutes ?? current.prepMinutes,
        input.isOpen === undefined ? (current.isOpen ? 1 : 0) : input.isOpen ? 1 : 0,
        user.id
      );
    return this.getMerchant(user.id);
  }

  updateRiderSettings(user: AuthenticatedUser, input: RiderSettingsInput) {
    this.requireRole(user, "rider");
    const current = this.getProfile(user) as {
      minimumFeeFen: number;
      isAvailable: boolean;
      transport: string;
    };
    this.database.sqlite
      .prepare(
        `UPDATE riders SET minimum_fee_fen = ?, is_available = ?, transport = ?
         WHERE user_id = ?`
      )
      .run(
        input.minimumFeeFen ?? current.minimumFeeFen,
        input.isAvailable === undefined ? (current.isAvailable ? 1 : 0) : input.isAvailable ? 1 : 0,
        input.transport?.trim() || current.transport,
        user.id
      );
    return this.getProfile(user);
  }

  addMenuItem(
    user: AuthenticatedUser,
    input: Omit<MenuItemView, "id" | "merchantId">
  ): MenuItemView {
    this.requireRole(user, "merchant");
    const id = `menu_${randomUUID()}`;
    this.database.sqlite
      .prepare(
        `INSERT INTO menu_items
          (id, merchant_id, name, description, category, price_fen, is_available, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM menu_items WHERE merchant_id = ?))`
      )
      .run(
        id,
        user.id,
        input.name.trim(),
        input.description.trim(),
        input.category.trim(),
        input.priceFen,
        input.isAvailable ? 1 : 0,
        user.id
      );
    return this.getMenuItem(id, user.id);
  }

  updateMenuItem(
    user: AuthenticatedUser,
    itemId: string,
    input: Partial<Omit<MenuItemView, "id" | "merchantId">>
  ): MenuItemView {
    this.requireRole(user, "merchant");
    const current = this.getMenuItem(itemId, user.id);
    this.database.sqlite
      .prepare(
        `UPDATE menu_items
         SET name = ?, description = ?, category = ?, price_fen = ?, is_available = ?
         WHERE id = ? AND merchant_id = ?`
      )
      .run(
        input.name?.trim() || current.name,
        input.description?.trim() ?? current.description,
        input.category?.trim() || current.category,
        input.priceFen ?? current.priceFen,
        input.isAvailable === undefined ? (current.isAvailable ? 1 : 0) : input.isAvailable ? 1 : 0,
        itemId,
        user.id
      );
    return this.getMenuItem(itemId, user.id);
  }

  getOperatorOverview(user: AuthenticatedUser) {
    this.requireRole(user, "operator");
    const counts = this.database.sqlite
      .prepare(
        `SELECT
           COUNT(*) AS total_orders,
           SUM(CASE WHEN status = 'matching' THEN 1 ELSE 0 END) AS matching_orders,
           SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) AS disputed_orders,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN total_fen ELSE 0 END), 0) AS completed_volume_fen,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN network_fen ELSE 0 END), 0) AS network_revenue_fen
         FROM orders`
      )
      .get() as {
      total_orders: number;
      matching_orders: number;
      disputed_orders: number;
      completed_orders: number;
      completed_volume_fen: number;
      network_revenue_fen: number;
    };
    const users = this.database.sqlite
      .prepare("SELECT role, COUNT(*) AS count FROM users GROUP BY role")
      .all() as Array<{ role: UserRole; count: number }>;
    return {
      totalOrders: counts.total_orders,
      matchingOrders: counts.matching_orders,
      disputedOrders: counts.disputed_orders,
      completedOrders: counts.completed_orders,
      completedVolumeFen: counts.completed_volume_fen,
      networkRevenueFen: counts.network_revenue_fen,
      users: Object.fromEntries(users.map((row) => [row.role, row.count])),
      signedEvents: this.events.count()
    };
  }

  async sweep(): Promise<void> {
    const now = new Date().toISOString();
    const expired = this.database.sqlite
      .prepare("SELECT id FROM orders WHERE status = 'matching' AND matching_deadline <= ?")
      .all(now) as Array<{ id: string }>;
    for (const order of expired) {
      await this.cancelOrderBySystem(order.id, "matching_timeout");
    }

    const awaitingRefund = this.database.sqlite
      .prepare("SELECT id FROM orders WHERE status = 'cancelled' AND payment_status = 'paid'")
      .all() as Array<{ id: string }>;
    for (const order of awaitingRefund) {
      await this.refundCancelledOrder(order.id);
    }

    const autoCompleteBefore = new Date(
      Date.now() - this.config.autoCompleteSeconds * 1_000
    ).toISOString();
    const delivered = this.database.sqlite
      .prepare(
        "SELECT id FROM orders WHERE status = 'delivered' AND delivered_at <= ?"
      )
      .all(autoCompleteBefore) as Array<{ id: string }>;
    for (const order of delivered) {
      await this.completeOrder(order.id, "system");
    }
  }

  private merchantAccept(orderId: string, user: AuthenticatedUser): void {
    this.requireRole(user, "merchant");
    this.database.transaction(() => {
      const order = this.getOrderRow(orderId);
      this.assertOrderOwner(order, user);
      if (order.status !== "matching" || order.merchant_decision !== "pending") {
        throw conflict("This order is no longer awaiting merchant acceptance");
      }
      const now = new Date().toISOString();
      this.database.sqlite
        .prepare("UPDATE orders SET merchant_decision = 'accepted', updated_at = ? WHERE id = ?")
        .run(now, orderId);
      this.events.append(orderId, "merchant_accepted", "merchant", { status: "matching" });
      this.confirmIfMatched(orderId);
    });
  }

  private riderAccept(orderId: string, user: AuthenticatedUser): void {
    this.requireRole(user, "rider");
    const profile = this.getProfile(user) as { minimumFeeFen: number; isAvailable: boolean };
    if (!profile.isAvailable) {
      throw conflict("Set yourself available before accepting orders", "RIDER_UNAVAILABLE");
    }

    this.database.transaction(() => {
      const order = this.getOrderRow(orderId);
      if (order.status !== "matching" || order.rider_id) {
        throw conflict("Another rider already accepted this order", "RIDER_ALREADY_ASSIGNED");
      }
      if (order.rider_fen < profile.minimumFeeFen) {
        throw conflict("This delivery is below your minimum fee", "BELOW_RIDER_MINIMUM");
      }
      const result = this.database.sqlite
        .prepare(
          `UPDATE orders SET rider_id = ?, updated_at = ?
           WHERE id = ? AND status = 'matching' AND rider_id IS NULL`
        )
        .run(user.id, new Date().toISOString(), orderId);
      if (result.changes !== 1) {
        throw conflict("Another rider already accepted this order", "RIDER_ALREADY_ASSIGNED");
      }
      this.events.append(orderId, "rider_accepted", "rider", { status: "matching" });
      this.confirmIfMatched(orderId);
    });
  }

  private confirmIfMatched(orderId: string): void {
    const order = this.getOrderRow(orderId);
    const resolution = resolveMatchingState({
      paymentStatus: order.payment_status,
      merchantDecision: order.merchant_decision,
      riderAssigned: Boolean(order.rider_id),
      matchingDeadline: order.matching_deadline
    });
    if (resolution !== "confirmed") {
      return;
    }

    assertOrderTransition(order.status, "confirmed");
    const now = new Date().toISOString();
    this.database.sqlite
      .prepare(
        `UPDATE orders SET status = 'confirmed', confirmed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'matching'`
      )
      .run(now, now, orderId);
    this.events.append(orderId, "order_confirmed", "system", { status: "confirmed" });
  }

  private transition(
    orderId: string,
    user: AuthenticatedUser,
    role: "merchant" | "rider",
    expected: OrderStatus,
    next: OrderStatus,
    eventType: string
  ): void {
    this.requireRole(user, role);
    this.database.transaction(() => {
      const order = this.getOrderRow(orderId);
      this.assertOrderOwner(order, user);
      if (order.status !== expected) {
        throw conflict(`Order must be ${expected} before this action`);
      }
      assertOrderTransition(order.status, next);
      const now = new Date().toISOString();
      this.database.sqlite
        .prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")
        .run(next, now, orderId);
      this.events.append(orderId, eventType, role, { status: next });
    });
  }

  private markDelivered(orderId: string, user: AuthenticatedUser): void {
    this.requireRole(user, "rider");
    this.database.transaction(() => {
      const order = this.getOrderRow(orderId);
      this.assertOrderOwner(order, user);
      if (order.status !== "picked_up") {
        throw conflict("Order must be picked up before delivery");
      }
      assertOrderTransition(order.status, "delivered");
      const now = new Date().toISOString();
      this.database.sqlite
        .prepare(
          "UPDATE orders SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ?"
        )
        .run(now, now, orderId);
      this.events.append(orderId, "delivered", "rider", { status: "delivered" });
    });
  }

  private openDispute(orderId: string, user: AuthenticatedUser): void {
    if (user.role === "operator") {
      throw forbidden("Operators resolve disputes; they do not open them");
    }
    this.database.transaction(() => {
      const order = this.getOrderRow(orderId);
      this.assertOrderOwner(order, user);
      if (["cancelled", "completed", "disputed"].includes(order.status)) {
        throw conflict("This order cannot enter dispute");
      }
      assertOrderTransition(order.status, "disputed");
      this.database.sqlite
        .prepare("UPDATE orders SET status = 'disputed', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), orderId);
      this.events.append(orderId, "dispute_opened", user.role, { status: "disputed" });
    });
  }

  private async cancelOrder(
    orderId: string,
    user: AuthenticatedUser,
    reason: string,
    merchantRejected: boolean,
    allowAnyStatus = false
  ): Promise<void> {
    this.database.transaction(() => {
      const order = this.getOrderRow(orderId);
      this.assertOrderOwner(order, user);
      if (!allowAnyStatus && order.status !== "matching") {
        throw conflict("Only an order still matching can be cancelled automatically");
      }
      if (["cancelled", "completed"].includes(order.status)) {
        throw conflict("This order is already final");
      }
      if (order.status !== "disputed") {
        assertOrderTransition(order.status, "cancelled");
      }
      const now = new Date().toISOString();
      this.database.sqlite
        .prepare(
          `UPDATE orders SET status = 'cancelled', merchant_decision = ?, cancelled_at = ?,
           cancellation_reason = ?, updated_at = ? WHERE id = ?`
        )
        .run(merchantRejected ? "rejected" : order.merchant_decision, now, reason, now, orderId);
      this.events.append(orderId, "order_cancelled", user.role, {
        status: "cancelled",
        reason
      });
    });
    await this.refundCancelledOrder(orderId);
  }

  private async cancelOrderBySystem(orderId: string, reason: string): Promise<void> {
    const order = this.getOrderRow(orderId);
    if (order.status !== "matching") {
      return;
    }
    this.database.transaction(() => {
      const current = this.getOrderRow(orderId);
      if (current.status !== "matching") {
        return;
      }
      const now = new Date().toISOString();
      this.database.sqlite
        .prepare(
          `UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancellation_reason = ?,
           updated_at = ? WHERE id = ?`
        )
        .run(now, reason, now, orderId);
      this.events.append(orderId, "order_cancelled", "system", {
        status: "cancelled",
        reason
      });
    });
    await this.refundCancelledOrder(orderId);
  }

  private async expireOrderIfNeeded(orderId: string): Promise<boolean> {
    const order = this.getOrderRow(orderId);
    if (order.status === "matching" && order.matching_deadline <= new Date().toISOString()) {
      await this.cancelOrderBySystem(orderId, "matching_timeout");
      return true;
    }
    return false;
  }

  private async refundCancelledOrder(orderId: string): Promise<void> {
    const order = this.getOrderRow(orderId);
    if (order.status !== "cancelled" || order.payment_status !== "paid" || !order.payment_reference) {
      return;
    }
    const key = `${orderId}:refund`;
    const result = await this.payments.refund({
      idempotencyKey: key,
      orderId,
      paymentReference: order.payment_reference,
      amountFen: order.total_fen
    });

    this.database.transaction(() => {
      const current = this.getOrderRow(orderId);
      if (current.payment_status !== "paid") {
        return;
      }
      this.database.sqlite
        .prepare("UPDATE orders SET payment_status = 'refunded', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), orderId);
      this.recordPaymentOperation(key, orderId, "refund", order.total_fen, result.providerReference);
      this.events.append(orderId, "payment_refunded", "system", {
        paymentStatus: "refunded",
        amountFen: order.total_fen
      });
    });
  }

  private async completeOrder(
    orderId: string,
    actorRole: UserRole | "system",
    allowDisputed = false
  ): Promise<void> {
    const order = this.getOrderRow(orderId);
    if (order.status === "completed" && order.payment_status === "split") {
      return;
    }
    if (order.status !== "delivered" && !(allowDisputed && order.status === "disputed")) {
      throw conflict("Order must be delivered before funds are released");
    }
    if (!order.rider_id || !order.payment_reference) {
      throw conflict("Order is missing a rider or payment reference");
    }

    const allocation = this.allocationFromOrder(order);
    const key = `${orderId}:split`;
    const result = await this.payments.split({
      idempotencyKey: key,
      orderId,
      paymentReference: order.payment_reference,
      allocation,
      merchantId: order.merchant_id,
      riderId: order.rider_id
    });

    this.database.transaction(() => {
      const current = this.getOrderRow(orderId);
      if (current.status === "completed") {
        return;
      }
      if (current.status !== "delivered" && !(allowDisputed && current.status === "disputed")) {
        throw conflict("Order changed before funds could be released");
      }
      assertOrderTransition(current.status, "completed");
      const now = new Date().toISOString();
      this.database.sqlite
        .prepare(
          `UPDATE orders SET status = 'completed', payment_status = 'split', completed_at = ?,
           updated_at = ? WHERE id = ?`
        )
        .run(now, now, orderId);
      this.database.sqlite
        .prepare("UPDATE riders SET completed_deliveries = completed_deliveries + 1 WHERE user_id = ?")
        .run(current.rider_id);
      this.recordPaymentOperation(key, orderId, "split", order.total_fen, result.providerReference);
      this.events.append(orderId, "funds_released", actorRole, {
        status: "completed",
        paymentStatus: "split",
        ...allocation
      });
    });
  }

  private getOrderRow(orderId: string): OrderRow {
    const row = this.database.sqlite
      .prepare(`${ORDER_SELECT} WHERE o.id = ?`)
      .get(orderId) as unknown as OrderRow | undefined;
    if (!row) {
      throw notFound("Order not found");
    }
    return row;
  }

  private mapOrderForUser(row: OrderRow, user: AuthenticatedUser): OrderView {
    const hideExactAddress = user.role === "rider" && row.rider_id !== user.id;
    return {
      id: row.id,
      consumerId: row.consumer_id,
      merchantId: row.merchant_id,
      riderId: row.rider_id,
      status: row.status,
      paymentStatus: row.payment_status,
      merchantDecision: row.merchant_decision,
      merchantName: row.merchant_name,
      riderName: row.rider_name,
      consumerName: row.consumer_name,
      deliveryArea: row.delivery_area,
      deliveryAddress: hideExactAddress ? row.delivery_area : row.delivery_address,
      deliveryNote: hideExactAddress ? null : row.delivery_note,
      items: JSON.parse(row.items_json) as OrderItem[],
      allocation: this.allocationFromOrder(row),
      matchingDeadline: row.matching_deadline,
      confirmedAt: row.confirmed_at,
      deliveredAt: row.delivered_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      cancellationReason: row.cancellation_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private canViewOrder(row: OrderRow, user: AuthenticatedUser): boolean {
    if (user.role === "operator") return true;
    if (user.role === "consumer") return row.consumer_id === user.id;
    if (user.role === "merchant") return row.merchant_id === user.id;
    if (row.rider_id === user.id) return true;
    if (row.status !== "matching" || row.rider_id) return false;
    const profile = this.getProfile(user) as { minimumFeeFen: number; isAvailable: boolean };
    return profile.isAvailable && row.rider_fen >= profile.minimumFeeFen;
  }

  private assertOrderOwner(row: OrderRow, user: AuthenticatedUser): void {
    const owns =
      user.role === "operator" ||
      (user.role === "consumer" && row.consumer_id === user.id) ||
      (user.role === "merchant" && row.merchant_id === user.id) ||
      (user.role === "rider" && row.rider_id === user.id);
    if (!owns) {
      throw forbidden("This order belongs to another account");
    }
  }

  private requireRole(user: AuthenticatedUser, role: UserRole): void {
    if (user.role !== role) {
      throw forbidden(`This action requires the ${role} role`);
    }
  }

  private listMenu(merchantId: string): MenuItemView[] {
    const rows = this.database.sqlite
      .prepare("SELECT * FROM menu_items WHERE merchant_id = ? ORDER BY sort_order ASC, name ASC")
      .all(merchantId) as unknown as MenuItemRow[];
    return rows.map((row) => this.mapMenuItem(row));
  }

  private getMenuItem(itemId: string, merchantId: string): MenuItemView {
    const row = this.database.sqlite
      .prepare("SELECT * FROM menu_items WHERE id = ? AND merchant_id = ?")
      .get(itemId, merchantId) as unknown as MenuItemRow | undefined;
    if (!row) {
      throw notFound("Menu item not found");
    }
    return this.mapMenuItem(row);
  }

  private mapMenuItem(row: MenuItemRow): MenuItemView {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      name: row.name,
      description: row.description,
      category: row.category,
      priceFen: row.price_fen,
      isAvailable: Boolean(row.is_available)
    };
  }

  private allocationFromOrder(order: OrderRow): MoneyAllocation {
    return {
      merchantFen: order.merchant_fen,
      riderFen: order.rider_fen,
      networkFen: order.network_fen,
      totalFen: order.total_fen
    };
  }

  private recordPaymentOperation(
    key: string,
    orderId: string,
    operation: string,
    amountFen: number,
    providerReference: string
  ): void {
    this.database.sqlite
      .prepare(
        `INSERT OR IGNORE INTO payment_operations
          (idempotency_key, order_id, operation, amount_fen, provider_reference, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'succeeded', ?)`
      )
      .run(key, orderId, operation, amountFen, providerReference, new Date().toISOString());
  }
}
