import { describe, expect, it } from "vitest";
import {
  assertOrderTransition,
  calculateAllocation,
  canTransitionOrder,
  resolveMatchingState
} from "./index.js";

describe("order lifecycle", () => {
  it("only confirms matching after merchant and rider accept", () => {
    const matchingDeadline = new Date(Date.now() + 60_000).toISOString();

    expect(
      resolveMatchingState({
        paymentStatus: "paid",
        merchantDecision: "accepted",
        riderAssigned: false,
        matchingDeadline
      })
    ).toBe("waiting");

    expect(
      resolveMatchingState({
        paymentStatus: "paid",
        merchantDecision: "accepted",
        riderAssigned: true,
        matchingDeadline
      })
    ).toBe("confirmed");
  });

  it("cancels a paid order when matching expires", () => {
    expect(
      resolveMatchingState({
        paymentStatus: "paid",
        merchantDecision: "pending",
        riderAssigned: false,
        matchingDeadline: new Date(Date.now() - 1_000).toISOString()
      })
    ).toBe("cancelled");
  });

  it("never confirms an unpaid order", () => {
    expect(
      resolveMatchingState({
        paymentStatus: "pending",
        merchantDecision: "accepted",
        riderAssigned: true,
        matchingDeadline: new Date(Date.now() + 60_000).toISOString()
      })
    ).toBe("cancelled");
  });

  it("enforces fulfillment transitions", () => {
    expect(canTransitionOrder("matching", "confirmed")).toBe(true);
    expect(canTransitionOrder("preparing", "picked_up")).toBe(false);
    expect(() => assertOrderTransition("delivered", "ready")).toThrow(
      "Order cannot transition from delivered to ready"
    );
  });
});

describe("money allocation", () => {
  it("keeps every recipient allocation explicit", () => {
    expect(calculateAllocation(3_200, 600, 50)).toEqual({
      merchantFen: 3_200,
      riderFen: 600,
      networkFen: 50,
      totalFen: 3_850
    });
  });

  it("rejects fractional or negative fen", () => {
    expect(() => calculateAllocation(100.5, 600, 50)).toThrow();
    expect(() => calculateAllocation(100, -1, 50)).toThrow();
  });
});
