import { existsSync } from "node:fs";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthService, type AuthenticatedUser } from "./auth.js";
import { config as defaultConfig, type AppConfig } from "./config.js";
import { Database } from "./database.js";
import { badRequest, HttpError, forbidden } from "./errors.js";
import { EventStore } from "./events.js";
import { FederationService } from "./federation.js";
import { NodeIdentity } from "./identity.js";
import {
  OrderService,
  type MenuItemView,
  type OrderAction
} from "./order-service.js";
import { MockPaymentAdapter } from "./payments.js";
import { demoAccounts, seedDemoData } from "./seed.js";

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(8).max(128)
});

const registerSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(50),
  role: z.enum(["consumer", "merchant", "rider"])
});

const orderSchema = z.object({
  merchantId: z.string().min(1),
  deliveryArea: z.string().trim().min(2).max(80),
  deliveryAddress: z.string().trim().min(4).max(200),
  deliveryNote: z.string().trim().max(300).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(20)
      })
    )
    .min(1)
    .max(20)
});

const actionSchema = z.object({
  action: z.enum([
    "merchant-accept",
    "merchant-reject",
    "start-preparing",
    "mark-ready",
    "rider-accept",
    "mark-picked-up",
    "mark-delivered",
    "confirm-delivery",
    "cancel",
    "open-dispute",
    "operator-refund",
    "operator-complete"
  ])
});

const merchantSettingsSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  address: z.string().trim().min(2).max(200).optional(),
  prepMinutes: z.number().int().min(5).max(120).optional(),
  isOpen: z.boolean().optional()
});

const riderSettingsSchema = z.object({
  minimumFeeFen: z.number().int().min(0).max(100_000).optional(),
  isAvailable: z.boolean().optional(),
  transport: z.string().trim().min(1).max(40).optional()
});

const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200),
  category: z.string().trim().min(1).max(40),
  priceFen: z.number().int().min(0).max(1_000_000),
  isAvailable: z.boolean()
});

export interface ApplicationOptions {
  config?: AppConfig | undefined;
  inMemory?: boolean | undefined;
}

export async function createApplication(options: ApplicationOptions = {}) {
  const config = options.config ?? defaultConfig;
  const database = new Database(config, options.inMemory ?? false);
  if (config.seedDemoData) {
    seedDemoData(database);
  }
  const identity = new NodeIdentity(config.dataDir);
  const auth = new AuthService(database);
  const events = new EventStore(database, identity);
  const payment = new MockPaymentAdapter();
  const orders = new OrderService(database, events, payment, config);
  const federation = new FederationService(database, identity, config);
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  await app.register(cors, { origin: true });

  const authenticated = (request: FastifyRequest): AuthenticatedUser =>
    auth.authenticate(request.headers.authorization);

  app.get("/health", async () => ({
    status: "ok",
    node: config.nodeName,
    paymentProvider: payment.name,
    timestamp: new Date().toISOString()
  }));

  app.get("/api/config", async () => ({
    nodeName: config.nodeName,
    publicUrl: config.publicUrl,
    matchingWindowSeconds: config.matchWindowSeconds,
    autoCompleteSeconds: config.autoCompleteSeconds,
    infraFeeFen: config.infraFeeFen,
    paymentProvider: payment.name,
    registrationOpen: config.allowRegistration,
    demoAccounts: config.seedDemoData ? demoAccounts : []
  }));

  app.post("/api/auth/register", async (request, reply) => {
    if (!config.allowRegistration) {
      throw forbidden("Registration is disabled on this node");
    }
    const input = registerSchema.parse(request.body);
    return reply.code(201).send(auth.register(input));
  });

  app.post("/api/auth/login", async (request) => {
    const input = credentialsSchema.parse(request.body);
    return auth.login(input.username, input.password);
  });

  app.post("/api/auth/logout", async (request, reply) => {
    auth.logout(request.headers.authorization);
    return reply.code(204).send();
  });

  app.get("/api/me", async (request) => {
    const user = authenticated(request);
    return { user, profile: orders.getProfile(user) };
  });

  app.get("/api/merchants", async () => ({ merchants: orders.listMerchants() }));
  app.get<{ Params: { merchantId: string } }>("/api/merchants/:merchantId", async (request) => ({
    merchant: orders.getMerchant(request.params.merchantId)
  }));
  app.get("/api/delivery/quote", async () => orders.getDeliveryQuote());

  app.post("/api/orders", async (request, reply) => {
    const order = await orders.createOrder(authenticated(request), orderSchema.parse(request.body));
    return reply.code(201).send({ order });
  });

  app.get("/api/orders", async (request) => ({ orders: orders.listOrders(authenticated(request)) }));
  app.get<{ Params: { orderId: string } }>("/api/orders/:orderId", async (request) => ({
    order: orders.getOrderForUser(request.params.orderId, authenticated(request))
  }));
  app.get<{ Params: { orderId: string } }>(
    "/api/orders/:orderId/events",
    async (request) => ({
      events: orders.getOrderEvents(request.params.orderId, authenticated(request))
    })
  );
  app.post<{ Params: { orderId: string } }>(
    "/api/orders/:orderId/actions",
    async (request) => {
      const { action } = actionSchema.parse(request.body);
      const order = await orders.performAction(
        request.params.orderId,
        action as OrderAction,
        authenticated(request)
      );
      return { order };
    }
  );

  app.patch("/api/merchant/settings", async (request) => ({
    profile: orders.updateMerchantSettings(
      authenticated(request),
      merchantSettingsSchema.parse(request.body)
    )
  }));
  app.post("/api/merchant/menu", async (request, reply) => {
    const item = orders.addMenuItem(authenticated(request), menuItemSchema.parse(request.body));
    return reply.code(201).send({ item });
  });
  app.patch<{ Params: { itemId: string } }>(
    "/api/merchant/menu/:itemId",
    async (request) => ({
      item: orders.updateMenuItem(
        authenticated(request),
        request.params.itemId,
        menuItemSchema.partial().parse(request.body) as Partial<
          Omit<MenuItemView, "id" | "merchantId">
        >
      )
    })
  );

  app.patch("/api/rider/settings", async (request) => ({
    profile: orders.updateRiderSettings(
      authenticated(request),
      riderSettingsSchema.parse(request.body)
    )
  }));

  app.get("/api/operator/overview", async (request) => ({
    ...orders.getOperatorOverview(authenticated(request)),
    peers: federation.listPeers(),
    federatedEvents: federation.getFederatedEventCount()
  }));

  app.get("/api/federation/info", async () => federation.getInfo());
  app.get("/api/federation/events", async (request) => {
    const query = z
      .object({
        cursor: z.string().max(1_000).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200)
      })
      .parse(request.query);
    try {
      return events.page(query.cursor, query.limit);
    } catch {
      throw badRequest("Invalid event cursor", "INVALID_CURSOR");
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: error.issues[0]?.message ?? "Invalid request",
        issues: error.issues
      });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: "Internal server error" });
  });

  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url === "/health") {
        return reply.code(404).send({ error: "NOT_FOUND", message: "Route not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return { app, database, auth, orders, events, federation, config };
}
