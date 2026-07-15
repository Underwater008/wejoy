# Payment And Compliance Boundary

## Current Release

`PAYMENT_PROVIDER=mock` is the only supported mode. Capture, refund, and split results are generated in process and recorded for product testing. There is no checkout account, bank transfer, WeChat Pay transaction, Alipay transaction, escrow, or payout.

The mock mode should remain visibly labeled and must not be presented to pilot participants as real payment.

## Production Principle

The consumer should authorize one provider checkout. The provider, not the restaurant and not an ordinary WeJoy bank account, should execute refunds and distribute the merchant, rider, and node allocations under an approved platform or profit-sharing product.

Do not use three uploaded personal collection QR codes as the production design. It produces three consumer payments, makes a unified refund unreliable, exposes recipient payment identifiers, and leaves order/payment state without a single authority.

Do not make the restaurant responsible for paying riders. That changes the commercial relationship, creates delayed-settlement risk for riders, and prevents the node from enforcing the order allocation.

## Provider Adapter Acceptance Criteria

- One consumer authorization for the full order total
- Provider-hosted or provider-approved checkout
- Signed asynchronous callbacks with replay protection
- Idempotent create, refund, and split commands
- Merchant and rider recipient onboarding supported by the provider contract
- Automatic full refund before confirmation
- Defined partial/post-split refund behavior
- Daily reconciliation against provider transactions and settlements
- An operator queue for callbacks, refunds, or splits in unknown states
- No application access to raw card or bank credentials

## Organizational Work

The first controlled pilot can be built by a company operating the node, with a foundation or member-governed entity considered later. The legal entity, payment contract, tax treatment, rider relationship, food-platform obligations, data processing, cybersecurity, consumer support, and local operating permissions require professional review before real launch.

This repository does not decide whether a particular Chinese entity type, payment product, or operating model is lawful. Provider rules and government requirements change; obtain current written advice from the payment provider and qualified Chinese counsel.

## Compliance-Friendly Architecture Choices

- No token, staking, investment return, or pay-to-operate node model
- Explicit role and order audit trail
- Local separation of personal data from public receipts
- Payment adapter rather than embedded custody logic
- Integer currency and immutable order-item snapshots
- Configurable registration and peer list
- Operator-visible disputes and settlement state

## Before A Real-Money Pilot

1. Form the operating entity and document who owns customer support and dispute decisions.
2. Obtain written provider approval for the marketplace/split flow and each recipient type.
3. Implement the provider adapter, callback inbox, outbox, and reconciliation.
4. Replace demo accounts and review authentication, recovery, rate limits, and administrator access.
5. Complete privacy, data-retention, cybersecurity, food-delivery, rider, tax, and consumer-protection reviews.
6. Run provider sandbox tests for success, timeout, duplicate callback, cancellation, refund, split, and reversal.
7. Pilot with capped order volume, staffed support, and a documented shutdown/refund procedure.
