# Contributing

## Setup

```bash
npm install
npm run dev
```

Use Node.js 24 or newer. Keep money in integer fen and lifecycle decisions in `packages/domain` or the node service, never only in the client.

## Checks

```bash
npm run check
npm audit --omit=dev
docker build -t wejoy:test .
```

Changes to matching, refunds, rider assignment, fund release, authorization, public receipts, or federation require focused tests. Preserve the rule that exact addresses are hidden from unassigned riders and never included in public events.

## Pull Requests

- Explain the participant-visible behavior.
- Identify payment, privacy, or governance impact.
- Include migration and rollback notes when storage changes.
- Do not add real-payment credentials, personal collection codes, production data, or node private keys.

Contributions are accepted under the repository's AGPL-3.0-only license.
