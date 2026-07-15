# HTTP API

All authenticated routes use `Authorization: Bearer <token>`. JSON errors have `error` and `message` fields.

## Public

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health and payment-adapter status |
| `GET` | `/api/config` | Public node and UI configuration |
| `POST` | `/api/auth/login` | Create a local session |
| `POST` | `/api/auth/register` | Register consumer, merchant, or rider |
| `GET` | `/api/merchants` | List merchant profiles and menus |
| `GET` | `/api/merchants/:merchantId` | Read one merchant |
| `GET` | `/api/delivery/quote` | Current rider/node fee quote |
| `GET` | `/api/federation/info` | Node identity and protocol |
| `GET` | `/api/federation/events` | Cursor-paginated signed receipts |

Federation parameters are `limit` (1-500) and the opaque `cursor` returned by the prior response.

## Account

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/logout` | Revoke current session |
| `GET` | `/api/me` | Account and role profile |
| `GET` | `/api/orders` | Role-scoped order list or eligible rider offers |
| `POST` | `/api/orders` | Consumer creates and mock-pays an order |
| `GET` | `/api/orders/:orderId` | Authorized order view |
| `GET` | `/api/orders/:orderId/events` | Signed receipts for an authorized order |
| `POST` | `/api/orders/:orderId/actions` | Perform a role-scoped order command |

Supported action values:

```text
merchant-accept     merchant-reject     start-preparing
mark-ready          rider-accept        mark-picked-up
mark-delivered      confirm-delivery    cancel
open-dispute        operator-refund     operator-complete
```

## Merchant

| Method | Route | Purpose |
| --- | --- | --- |
| `PATCH` | `/api/merchant/settings` | Name, description, address, prep time, open state |
| `POST` | `/api/merchant/menu` | Add menu item |
| `PATCH` | `/api/merchant/menu/:itemId` | Edit or toggle menu item |

## Rider

| Method | Route | Purpose |
| --- | --- | --- |
| `PATCH` | `/api/rider/settings` | Availability, minimum fee, transport |

## Operator

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/operator/overview` | Counts, volume, network revenue, peers |

The current API is an MVP contract and is not versioned. Introduce `/api/v1` before third-party clients depend on it.
