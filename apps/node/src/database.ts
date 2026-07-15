import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "./config.js";

export class Database {
  readonly sqlite: DatabaseSync;

  constructor(config: AppConfig, inMemory = false) {
    mkdirSync(config.dataDir, { recursive: true });
    this.sqlite = new DatabaseSync(inMemory ? ":memory:" : join(config.dataDir, "wejoy.sqlite"));
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA journal_mode = WAL");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  transaction<T>(operation: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.sqlite.close();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('consumer', 'merchant', 'rider', 'operator')),
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS merchants (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        address TEXT NOT NULL,
        prep_minutes INTEGER NOT NULL DEFAULT 20,
        is_open INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS riders (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        minimum_fee_fen INTEGER NOT NULL DEFAULT 600,
        is_available INTEGER NOT NULL DEFAULT 1,
        transport TEXT NOT NULL DEFAULT 'ebike',
        completed_deliveries INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(user_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        price_fen INTEGER NOT NULL CHECK (price_fen >= 0),
        is_available INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS menu_items_merchant_idx ON menu_items(merchant_id, sort_order);

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        consumer_id TEXT NOT NULL REFERENCES users(id),
        merchant_id TEXT NOT NULL REFERENCES merchants(user_id),
        rider_id TEXT REFERENCES riders(user_id),
        status TEXT NOT NULL,
        payment_status TEXT NOT NULL,
        merchant_decision TEXT NOT NULL DEFAULT 'pending',
        delivery_area TEXT NOT NULL,
        delivery_address TEXT NOT NULL,
        delivery_note TEXT,
        items_json TEXT NOT NULL,
        merchant_fen INTEGER NOT NULL,
        rider_fen INTEGER NOT NULL,
        network_fen INTEGER NOT NULL,
        total_fen INTEGER NOT NULL,
        matching_deadline TEXT NOT NULL,
        payment_reference TEXT,
        confirmed_at TEXT,
        delivered_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT,
        cancellation_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS orders_consumer_idx ON orders(consumer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS orders_merchant_idx ON orders(merchant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS orders_rider_idx ON orders(rider_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, matching_deadline);

      CREATE TABLE IF NOT EXISTS order_events (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        previous_hash TEXT,
        hash TEXT NOT NULL UNIQUE,
        signature TEXT NOT NULL,
        node_public_key TEXT NOT NULL,
        UNIQUE(order_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS order_events_created_idx ON order_events(created_at, id);

      CREATE TABLE IF NOT EXISTS payment_operations (
        idempotency_key TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        operation TEXT NOT NULL,
        amount_fen INTEGER NOT NULL,
        provider_reference TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS federation_events (
        hash TEXT PRIMARY KEY,
        origin_url TEXT NOT NULL,
        order_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        previous_hash TEXT,
        signature TEXT NOT NULL,
        node_public_key TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS federation_events_origin_idx ON federation_events(origin_url, created_at);

      CREATE TABLE IF NOT EXISTS peers (
        url TEXT PRIMARY KEY,
        name TEXT,
        public_key TEXT,
        cursor TEXT,
        last_sync_at TEXT,
        last_error TEXT,
        received_events INTEGER NOT NULL DEFAULT 0
      );
    `);

    const peerColumns = this.sqlite.prepare("PRAGMA table_info(peers)").all() as Array<{
      name: string;
    }>;
    if (!peerColumns.some((column) => column.name === "cursor")) {
      this.sqlite.exec("ALTER TABLE peers ADD COLUMN cursor TEXT");
    }
  }
}
