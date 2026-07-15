# Product Contract

## Purpose

WeJoy tests whether a local delivery market can coordinate restaurants, riders, and consumers without a central platform setting every commercial term or taking an opaque commission. The node supplies coordination infrastructure; the restaurant sets menu prices, the rider sets a minimum delivery price, and every order exposes its exact allocation.

## Roles

| Role | Owns | Does not own |
| --- | --- | --- |
| Consumer | cart, delivery details, payment authorization, receipt confirmation | merchant or rider selection after matching |
| Merchant | menu, opening state, order acceptance, kitchen state | rider payout |
| Rider | availability, minimum fee, offer acceptance, delivery state | restaurant pricing |
| Operator | node uptime, disputes, peer configuration, policy | routine order acceptance |

## Order Rules

1. The consumer sees food, rider, and node allocations before submitting.
2. The payment adapter reports a successful capture before matching begins.
3. Merchant and rider acceptance happen independently and in parallel.
4. The first eligible rider claim wins atomically.
5. The order remains `matching` until both the merchant accepted and a rider is assigned.
6. A merchant must not start preparation before `confirmed`.
7. If either side is missing at the deadline, the order becomes `cancelled` and enters refund processing.
8. The rider can pick up only a `ready` order and deliver only a `picked_up` order.
9. Funds release only after consumer confirmation or the delivery auto-complete deadline.
10. A dispute freezes the normal lifecycle for operator resolution.

## Delivery Quote

The v0.1 node uses the upper median of online rider minimum fees. Riders whose minimum is less than or equal to the quote can claim the offer. If no rider is online, the node uses `DEFAULT_RIDER_FEE_FEN`; the order can still time out if nobody becomes eligible.

This is intentionally replaceable. Distance, weather, batching, and zone pricing are not implemented.

## Money Model

```text
consumer total = merchant subtotal + rider fee + node fee
```

All values are stored as non-negative integer fen. Floating-point currency is rejected by the shared domain package.

The UI calls the v0.1 flow “模拟支付” because the mock adapter makes no financial transaction. A real adapter must preserve the same allocation contract while delegating custody, refunds, and splitting to an approved provider.

## Privacy Boundary

- An unassigned rider sees the merchant, delivery area, items, and offered fee.
- The exact address and note become visible to the assigned rider.
- Public receipts contain opaque order IDs, lifecycle types, statuses, and allocations.
- Public receipts do not contain account IDs, names, addresses, notes, credentials, or payment identifiers.

## MVP Non-Goals

- Cross-node ordering or cross-node identity
- Real payment processing
- Maps, routing, distance quotes, or rider navigation
- Group ordering or batched delivery
- Ratings, promotions, recommendations, or advertising
- Tax invoices, payroll, insurance, or employment classification
- Automated dispute evidence or appeals
- Production KYC, AML, sanctions, fraud, or content review

## Pilot Success Signals

- At least 80% of accepted orders reach `completed` without operator intervention.
- Median dual-acceptance time is under the configured matching window.
- Refund retries reach a terminal provider result.
- Riders do not need restaurant staff to settle delivery fees.
- Participants can reconcile completed orders from provider records and signed node receipts.
