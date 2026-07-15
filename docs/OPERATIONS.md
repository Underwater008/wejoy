# Operations Guide

## Production-Like Mock Deployment

Use a fresh persistent volume and terminate TLS in a reverse proxy or managed container platform.

```bash
docker volume create wejoy-data
docker run -d --name wejoy --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v wejoy-data:/data \
  -e NODE_NAME="Example Community Node" \
  -e NODE_PUBLIC_URL="https://delivery.example.org" \
  -e PAYMENT_PROVIDER=mock \
  -e SEED_DEMO_DATA=false \
  -e ALLOW_REGISTRATION=true \
  ghcr.io/underwater008/wejoy:0.1.0
```

Tagged releases publish `linux/amd64` and `linux/arm64` images. To build from an untagged commit instead, run `docker build -t wejoy:COMMIT .` and use that local tag.

The health endpoint is `GET /health`. Docker also runs a 30-second health check.

## Persistent State

`/data/wejoy.sqlite` contains application state. `/data/identity` contains the Ed25519 node key. Treat the entire directory as one backup unit.

For a simple consistent backup, stop writes and archive the volume:

```bash
docker stop wejoy
docker run --rm \
  -v wejoy-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine sh -c 'tar czf /backup/wejoy-data.tgz -C /data .'
docker start wejoy
```

For zero-downtime backups, use a storage snapshot that is consistent across the full volume. Test restores before a pilot.

Restore into an empty volume, preserving both the database and `identity` directory. A missing or regenerated key changes the node ID and causes existing peers to reject it.

## Upgrade

```bash
docker build -t wejoy:NEW_VERSION .
docker stop wejoy
docker rename wejoy wejoy-old
docker run -d --name wejoy --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v wejoy-data:/data \
  --env-file .env \
  wejoy:NEW_VERSION
curl --fail http://127.0.0.1:8787/health
```

Keep `wejoy-old` until the health check and role logins succeed. Never run two containers against the same SQLite volume.

## Peer Configuration

Set canonical HTTPS URLs separated by commas:

```bash
WEJOY_PEERS=https://node-a.example.org,https://node-b.example.org
```

The node checks peers at startup and every minute. A peer key change is treated as an error and requires operator review. v0.1 replicates public receipts only.

## Pilot Checklist

- Fresh volume with demo seeding disabled
- Unique operator credentials and account-recovery procedure
- TLS, firewall, log retention, resource limits, and uptime monitoring
- Daily encrypted backup and tested restore
- Current source commit recorded with the deployment
- `npm run check` and container health pass
- Payment remains visibly simulated
- Staffed dispute/refund process
- A hard order/participant cap appropriate to the pilot

## Incident Actions

- **Matching or refund worker stalled:** restart one node process; idempotency keys make mock operations safe to retry.
- **Database corruption:** stop the node, preserve the damaged volume, restore the latest tested backup, and reconcile missing orders.
- **Signing key lost:** stop federation, restore the full backup, or publish a governed key-rotation process before peers trust the replacement.
- **Peer reports key change:** do not overwrite the pinned key automatically; verify the operator and URL out of band.
- **Unexpected real payment request:** stop the pilot. v0.1 has no supported real-payment path.
