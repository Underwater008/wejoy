import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "../../..");

try {
  loadEnvFile(resolve(repositoryRoot, ".env"));
} catch {
  // Environment variables are optional; deployers can inject them directly.
}

const booleanFromEnv = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().optional(),
  WEB_DIST: z.string().optional(),
  NODE_NAME: z.string().min(1).default("WeJoy Community Node"),
  NODE_PUBLIC_URL: z.string().url().default("http://localhost:8787"),
  MATCH_WINDOW_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  AUTO_COMPLETE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  DEFAULT_RIDER_FEE_FEN: z.coerce.number().int().min(0).default(600),
  INFRA_FEE_FEN: z.coerce.number().int().min(0).default(50),
  PAYMENT_PROVIDER: z.enum(["mock"]).default("mock"),
  ALLOW_REGISTRATION: booleanFromEnv,
  SEED_DEMO_DATA: booleanFromEnv,
  WEJOY_PEERS: z.string().default("")
});

const parsed = configSchema.parse(process.env);

export const config = {
  port: parsed.PORT,
  host: parsed.HOST,
  dataDir: parsed.DATA_DIR
    ? resolve(repositoryRoot, parsed.DATA_DIR)
    : resolve(repositoryRoot, ".data"),
  webDist: parsed.WEB_DIST
    ? resolve(repositoryRoot, parsed.WEB_DIST)
    : resolve(moduleDirectory, "../../web/dist"),
  nodeName: parsed.NODE_NAME,
  publicUrl: parsed.NODE_PUBLIC_URL.replace(/\/$/, ""),
  matchWindowSeconds: parsed.MATCH_WINDOW_SECONDS,
  autoCompleteSeconds: parsed.AUTO_COMPLETE_SECONDS,
  defaultRiderFeeFen: parsed.DEFAULT_RIDER_FEE_FEN,
  infraFeeFen: parsed.INFRA_FEE_FEN,
  paymentProvider: parsed.PAYMENT_PROVIDER,
  allowRegistration: parsed.ALLOW_REGISTRATION,
  seedDemoData: parsed.SEED_DEMO_DATA,
  peers: parsed.WEJOY_PEERS.split(",")
    .map((peer) => peer.trim().replace(/\/$/, ""))
    .filter(Boolean)
} as const;

export type AppConfig = typeof config;
