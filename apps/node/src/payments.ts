import { randomUUID } from "node:crypto";
import type { MoneyAllocation } from "@wejoy/domain";

export interface PaymentResult {
  providerReference: string;
  status: "succeeded";
}

export interface CaptureRequest {
  idempotencyKey: string;
  orderId: string;
  consumerId: string;
  amountFen: number;
}

export interface RefundRequest {
  idempotencyKey: string;
  orderId: string;
  paymentReference: string;
  amountFen: number;
}

export interface SplitRequest {
  idempotencyKey: string;
  orderId: string;
  paymentReference: string;
  allocation: MoneyAllocation;
  merchantId: string;
  riderId: string;
}

export interface PaymentAdapter {
  readonly name: string;
  capture(request: CaptureRequest): Promise<PaymentResult>;
  refund(request: RefundRequest): Promise<PaymentResult>;
  split(request: SplitRequest): Promise<PaymentResult>;
}

export class MockPaymentAdapter implements PaymentAdapter {
  readonly name = "mock";
  private readonly operations = new Map<string, PaymentResult>();

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    return this.perform(request.idempotencyKey, "mock_pay");
  }

  async refund(request: RefundRequest): Promise<PaymentResult> {
    return this.perform(request.idempotencyKey, "mock_refund");
  }

  async split(request: SplitRequest): Promise<PaymentResult> {
    return this.perform(request.idempotencyKey, "mock_split");
  }

  private perform(idempotencyKey: string, prefix: string): PaymentResult {
    const existing = this.operations.get(idempotencyKey);
    if (existing) {
      return existing;
    }

    const result: PaymentResult = {
      providerReference: `${prefix}_${randomUUID()}`,
      status: "succeeded"
    };
    this.operations.set(idempotencyKey, result);
    return result;
  }
}
