import { createHash } from "node:crypto";
import type { PublicOrderEvent } from "@wejoy/domain";
import type { AppConfig } from "./config.js";
import type { Database } from "./database.js";
import { hashEvent, NodeIdentity, verifyEventSignature } from "./identity.js";

interface PeerInfo {
  protocolVersion: string;
  name: string;
  publicUrl: string;
  publicKey: string;
}

export class FederationService {
  constructor(
    private readonly database: Database,
    private readonly identity: NodeIdentity,
    private readonly config: AppConfig
  ) {
    for (const peer of config.peers) {
      if (peer !== config.publicUrl) {
        this.database.sqlite.prepare("INSERT OR IGNORE INTO peers (url) VALUES (?)").run(peer);
      }
    }
  }

  getInfo() {
    return {
      protocolVersion: "wejoy-receipts/0.1",
      name: this.config.nodeName,
      publicUrl: this.config.publicUrl,
      nodeId: createHash("sha256").update(this.identity.publicKey).digest("hex").slice(0, 16),
      publicKey: this.identity.publicKey,
      capabilities: ["signed-order-receipts", "transparent-allocations"],
      personalDataFederated: false
    };
  }

  listPeers() {
    return this.database.sqlite
      .prepare(
        `SELECT url, name, public_key, last_sync_at, last_error, received_events
         FROM peers ORDER BY url ASC`
      )
      .all()
      .map((row) => {
        const peer = row as Record<string, unknown>;
        return {
          url: peer.url,
          name: peer.name,
          publicKey: peer.public_key,
          lastSyncAt: peer.last_sync_at,
          lastError: peer.last_error,
          receivedEvents: peer.received_events
        };
      });
  }

  getFederatedEventCount(): number {
    const row = this.database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM federation_events")
      .get() as { count: number };
    return row.count;
  }

  async syncAll(): Promise<void> {
    const peers = this.database.sqlite.prepare("SELECT url FROM peers").all() as Array<{ url: string }>;
    await Promise.allSettled(peers.map((peer) => this.syncPeer(peer.url)));
  }

  private async syncPeer(url: string): Promise<void> {
    try {
      const infoResponse = await fetch(`${url}/api/federation/info`, {
        signal: AbortSignal.timeout(8_000)
      });
      if (!infoResponse.ok) throw new Error(`Peer returned HTTP ${infoResponse.status}`);
      const info = (await infoResponse.json()) as PeerInfo;
      if (info.protocolVersion !== "wejoy-receipts/0.1") {
        throw new Error("Peer uses an incompatible receipt protocol");
      }
      const savedPeer = this.database.sqlite
        .prepare("SELECT public_key, cursor FROM peers WHERE url = ?")
        .get(url) as { public_key: string | null; cursor: string | null } | undefined;
      if (savedPeer?.public_key && savedPeer.public_key !== info.publicKey) {
        throw new Error("Peer identity key changed; operator review required");
      }

      let cursor = savedPeer?.cursor ?? null;
      for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
        const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const eventsResponse = await fetch(
          `${url}/api/federation/events?limit=500${cursorQuery}`,
          { signal: AbortSignal.timeout(8_000) }
        );
        if (!eventsResponse.ok) throw new Error(`Peer returned HTTP ${eventsResponse.status}`);
        const body = (await eventsResponse.json()) as {
          events?: PublicOrderEvent[];
          nextCursor?: string | null;
        };
        if (!Array.isArray(body.events)) {
          throw new Error("Peer returned an invalid event page");
        }

        let received = 0;
        this.database.transaction(() => {
          for (const event of body.events ?? []) {
            if (event.nodePublicKey !== info.publicKey || !this.isValidEvent(event)) {
              throw new Error(`Peer supplied an invalid event: ${event.hash || "unknown"}`);
            }
            this.assertEventChain(url, event);
            const result = this.database.sqlite
              .prepare(
                `INSERT OR IGNORE INTO federation_events
                  (hash, origin_url, order_id, sequence, type, actor_role, payload_json,
                   created_at, previous_hash, signature, node_public_key, received_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                event.hash,
                url,
                event.orderId,
                event.sequence,
                event.type,
                event.actorRole,
                JSON.stringify(event.payload),
                event.createdAt,
                event.previousHash,
                event.signature,
                event.nodePublicKey,
                new Date().toISOString()
              );
            received += Number(result.changes);
          }

          this.database.sqlite
            .prepare(
              `UPDATE peers SET name = ?, public_key = ?, cursor = ?, last_sync_at = ?,
               last_error = NULL, received_events = received_events + ? WHERE url = ?`
            )
            .run(
              info.name,
              info.publicKey,
              body.nextCursor ?? cursor,
              new Date().toISOString(),
              received,
              url
            );
        });

        if (!body.nextCursor || body.events.length === 0) break;
        cursor = body.nextCursor;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown federation error";
      this.database.sqlite
        .prepare("UPDATE peers SET last_error = ? WHERE url = ?")
        .run(message.slice(0, 500), url);
      throw error;
    }
  }

  private isValidEvent(event: PublicOrderEvent): boolean {
    const expectedHash = hashEvent({
      orderId: event.orderId,
      sequence: event.sequence,
      type: event.type,
      actorRole: event.actorRole,
      payload: event.payload,
      createdAt: event.createdAt,
      previousHash: event.previousHash,
      nodePublicKey: event.nodePublicKey
    });
    return (
      expectedHash === event.hash &&
      verifyEventSignature(event.hash, event.signature, event.nodePublicKey)
    );
  }

  private assertEventChain(originUrl: string, event: PublicOrderEvent): void {
    if (event.sequence === 1) {
      if (event.previousHash !== null) throw new Error("First event has a previous hash");
      return;
    }
    if (!event.previousHash) throw new Error("Event chain is missing its previous hash");
    const previous = this.database.sqlite
      .prepare(
        `SELECT order_id, sequence, node_public_key FROM federation_events
         WHERE origin_url = ? AND hash = ?`
      )
      .get(originUrl, event.previousHash) as
      | { order_id: string; sequence: number; node_public_key: string }
      | undefined;
    if (
      !previous ||
      previous.order_id !== event.orderId ||
      previous.sequence !== event.sequence - 1 ||
      previous.node_public_key !== event.nodePublicKey
    ) {
      throw new Error("Event does not extend the verified order chain");
    }
  }
}
