import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplication } from "./app.js";
import { config as defaultConfig } from "./config.js";

type Application = Awaited<ReturnType<typeof createApplication>>;

describe("WeJoy node API", () => {
  let application: Application;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "wejoy-test-"));
    application = await createApplication({
      inMemory: true,
      config: {
        ...defaultConfig,
        dataDir,
        webDist: join(dataDir, "missing-web-dist"),
        publicUrl: "http://test-node.local",
        seedDemoData: true,
        peers: []
      }
    });
  });

  afterEach(async () => {
    await application.app.close();
    application.database.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("completes an order only after both merchant and rider accept", async () => {
    const consumer = await login("demo.consumer");
    const merchant = await login("demo.noodles");
    const rider = await login("demo.rider");

    const created = await application.app.inject({
      method: "POST",
      url: "/api/orders",
      headers: bearer(consumer),
      payload: {
        merchantId: "usr_demo_merchant_noodles",
        deliveryArea: "青禾社区",
        deliveryAddress: "青禾路 28 号 2 单元 301",
        items: [{ menuItemId: "menu_beef_noodles", quantity: 1 }]
      }
    });
    expect(created.statusCode).toBe(201);
    const orderId = created.json().order.id as string;
    expect(created.json().order).toMatchObject({
      status: "matching",
      paymentStatus: "paid",
      merchantDecision: "pending",
      riderId: null,
      allocation: { merchantFen: 2_600, riderFen: 700, networkFen: 50, totalFen: 3_350 }
    });

    const riderAccepted = await action(orderId, "rider-accept", rider);
    expect(riderAccepted.statusCode).toBe(200);
    expect(riderAccepted.json().order.status).toBe("matching");
    expect(riderAccepted.json().order.deliveryAddress).toBe("青禾路 28 号 2 单元 301");

    const merchantAccepted = await action(orderId, "merchant-accept", merchant);
    expect(merchantAccepted.statusCode).toBe(200);
    expect(merchantAccepted.json().order.status).toBe("confirmed");

    expect((await action(orderId, "start-preparing", merchant)).json().order.status).toBe(
      "preparing"
    );
    expect((await action(orderId, "mark-ready", merchant)).json().order.status).toBe("ready");
    expect((await action(orderId, "mark-picked-up", rider)).json().order.status).toBe(
      "picked_up"
    );
    expect((await action(orderId, "mark-delivered", rider)).json().order.status).toBe(
      "delivered"
    );

    const completed = await action(orderId, "confirm-delivery", consumer);
    expect(completed.json().order).toMatchObject({ status: "completed", paymentStatus: "split" });

    const events = await application.app.inject({
      method: "GET",
      url: `/api/orders/${orderId}/events`,
      headers: bearer(consumer)
    });
    expect(events.json().events.map((event: { type: string }) => event.type)).toEqual([
      "order_created",
      "rider_accepted",
      "merchant_accepted",
      "order_confirmed",
      "preparing",
      "ready_for_pickup",
      "picked_up",
      "delivered",
      "funds_released"
    ]);
  });

  it("lets only the first eligible rider claim an offer", async () => {
    const consumer = await login("demo.consumer");
    const firstRider = await login("demo.rider");
    const secondRider = await login("demo.rider2");
    const created = await createDemoOrder(consumer);
    const orderId = created.json().order.id as string;

    expect((await action(orderId, "rider-accept", firstRider)).statusCode).toBe(200);
    const losingClaim = await action(orderId, "rider-accept", secondRider);
    expect(losingClaim.statusCode).toBe(409);
    expect(losingClaim.json().error).toBe("RIDER_ALREADY_ASSIGNED");
  });

  it("automatically refunds an unmatched order after its deadline", async () => {
    const consumer = await login("demo.consumer");
    const created = await createDemoOrder(consumer);
    const orderId = created.json().order.id as string;
    application.database.sqlite
      .prepare("UPDATE orders SET matching_deadline = ? WHERE id = ?")
      .run(new Date(Date.now() - 1_000).toISOString(), orderId);

    await application.orders.sweep();
    const response = await application.app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: bearer(consumer)
    });
    expect(response.json().order).toMatchObject({
      status: "cancelled",
      paymentStatus: "refunded",
      cancellationReason: "matching_timeout"
    });
  });

  it("paginates public receipts without breaking per-order sequence", async () => {
    const consumer = await login("demo.consumer");
    const merchant = await login("demo.noodles");
    const rider = await login("demo.rider");
    const created = await createDemoOrder(consumer);
    const orderId = created.json().order.id as string;
    await action(orderId, "merchant-accept", merchant);
    await action(orderId, "rider-accept", rider);

    const firstPage = await application.app.inject({
      method: "GET",
      url: "/api/federation/events?limit=2"
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().events.map((event: { sequence: number }) => event.sequence)).toEqual([
      1, 2
    ]);

    const secondPage = await application.app.inject({
      method: "GET",
      url: `/api/federation/events?limit=2&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`
    });
    expect(secondPage.json().events.map((event: { sequence: number }) => event.sequence)).toEqual([
      3, 4
    ]);
  });

  it("verifies and replicates a peer's signed receipt chain", async () => {
    const consumer = await login("demo.consumer");
    const merchant = await login("demo.noodles");
    const rider = await login("demo.rider");
    const created = await createDemoOrder(consumer);
    const orderId = created.json().order.id as string;
    await action(orderId, "merchant-accept", merchant);
    await action(orderId, "rider-accept", rider);

    const sourceUrl = await application.app.listen({ host: "127.0.0.1", port: 0 });
    const replicaDirectory = mkdtempSync(join(tmpdir(), "wejoy-replica-"));
    const replica = await createApplication({
      inMemory: true,
      config: {
        ...defaultConfig,
        dataDir: replicaDirectory,
        webDist: join(replicaDirectory, "missing-web-dist"),
        publicUrl: "http://replica.local",
        seedDemoData: false,
        peers: [sourceUrl]
      }
    });

    try {
      await replica.federation.syncAll();
      expect(replica.federation.getFederatedEventCount()).toBe(4);
      expect(replica.federation.listPeers()[0]).toMatchObject({
        url: sourceUrl,
        receivedEvents: 4,
        lastError: null
      });
    } finally {
      await replica.app.close();
      replica.database.close();
      rmSync(replicaDirectory, { recursive: true, force: true });
    }
  });

  async function login(username: string): Promise<string> {
    const response = await application.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password: "demo1234" }
    });
    expect(response.statusCode).toBe(200);
    return response.json().token as string;
  }

  function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
  }

  function action(orderId: string, name: string, token: string) {
    return application.app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/actions`,
      headers: bearer(token),
      payload: { action: name }
    });
  }

  function createDemoOrder(token: string) {
    return application.app.inject({
      method: "POST",
      url: "/api/orders",
      headers: bearer(token),
      payload: {
        merchantId: "usr_demo_merchant_noodles",
        deliveryArea: "青禾社区",
        deliveryAddress: "青禾路 28 号 2 单元 301",
        items: [{ menuItemId: "menu_beef_noodles", quantity: 1 }]
      }
    });
  }
});
