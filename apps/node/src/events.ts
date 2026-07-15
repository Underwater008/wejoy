import { randomUUID } from "node:crypto";
import type { PublicOrderEvent, UserRole } from "@wejoy/domain";
import type { Database } from "./database.js";
import { hashEvent, NodeIdentity } from "./identity.js";

interface EventRow {
  id: string;
  order_id: string;
  sequence: number;
  type: string;
  actor_role: UserRole | "system";
  payload_json: string;
  created_at: string;
  previous_hash: string | null;
  hash: string;
  signature: string;
  node_public_key: string;
}

export class EventStore {
  constructor(
    private readonly database: Database,
    private readonly identity: NodeIdentity
  ) {}

  append(
    orderId: string,
    type: string,
    actorRole: UserRole | "system",
    payload: Record<string, unknown>
  ): PublicOrderEvent {
    const previous = this.database.sqlite
      .prepare(
        `SELECT sequence, hash FROM order_events
         WHERE order_id = ? ORDER BY sequence DESC LIMIT 1`
      )
      .get(orderId) as { sequence: number; hash: string } | undefined;
    const id = `evt_${randomUUID()}`;
    const sequence = (previous?.sequence ?? 0) + 1;
    const createdAt = new Date().toISOString();
    const previousHash = previous?.hash ?? null;
    const eventBody = {
      orderId,
      sequence,
      type,
      actorRole,
      payload,
      createdAt,
      previousHash,
      nodePublicKey: this.identity.publicKey
    };
    const hash = hashEvent(eventBody);
    const signature = this.identity.signHash(hash);

    this.database.sqlite
      .prepare(
        `INSERT INTO order_events
          (id, order_id, sequence, type, actor_role, payload_json, created_at,
           previous_hash, hash, signature, node_public_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        orderId,
        sequence,
        type,
        actorRole,
        JSON.stringify(payload),
        createdAt,
        previousHash,
        hash,
        signature,
        this.identity.publicKey
      );

    return { id, ...eventBody, hash, signature };
  }

  page(cursor: string | undefined, limit: number): {
    events: PublicOrderEvent[];
    nextCursor: string | null;
  } {
    const decoded = cursor ? this.decodeCursor(cursor) : null;
    const rows = this.database.sqlite
      .prepare(
        `SELECT * FROM order_events
         WHERE (? IS NULL OR created_at > ? OR
           (created_at = ? AND order_id > ?) OR
           (created_at = ? AND order_id = ? AND sequence > ?))
         ORDER BY created_at ASC, order_id ASC, sequence ASC
         LIMIT ?`
      )
      .all(
        decoded?.createdAt ?? null,
        decoded?.createdAt ?? null,
        decoded?.createdAt ?? null,
        decoded?.orderId ?? "",
        decoded?.createdAt ?? null,
        decoded?.orderId ?? "",
        decoded?.sequence ?? 0,
        limit
      ) as unknown as EventRow[];
    const events = rows.map((row) => this.map(row));
    const last = events.at(-1);
    return {
      events,
      nextCursor:
        last
          ? Buffer.from(
              JSON.stringify({
                createdAt: last.createdAt,
                orderId: last.orderId,
                sequence: last.sequence
              })
            ).toString("base64url")
          : null
    };
  }

  listForOrder(orderId: string): PublicOrderEvent[] {
    const rows = this.database.sqlite
      .prepare("SELECT * FROM order_events WHERE order_id = ? ORDER BY sequence ASC")
      .all(orderId) as unknown as EventRow[];
    return rows.map((row) => this.map(row));
  }

  count(): number {
    const row = this.database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM order_events")
      .get() as { count: number };
    return row.count;
  }

  private map(row: EventRow): PublicOrderEvent {
    return {
      id: row.id,
      orderId: row.order_id,
      sequence: row.sequence,
      type: row.type,
      actorRole: row.actor_role,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
      previousHash: row.previous_hash,
      hash: row.hash,
      signature: row.signature,
      nodePublicKey: row.node_public_key
    };
  }

  private decodeCursor(cursor: string): {
    createdAt: string;
    orderId: string;
    sequence: number;
  } {
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
        string,
        unknown
      >;
      if (
        typeof value.createdAt !== "string" ||
        typeof value.orderId !== "string" ||
        typeof value.sequence !== "number"
      ) {
        throw new Error("Malformed cursor");
      }
      return {
        createdAt: value.createdAt,
        orderId: value.orderId,
        sequence: value.sequence
      };
    } catch {
      throw new Error("Invalid event cursor");
    }
  }
}
