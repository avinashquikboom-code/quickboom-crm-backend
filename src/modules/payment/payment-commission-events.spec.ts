import { PaymentService } from './payment.service';
import * as crypto from 'crypto';

describe('Verified payment/refund commission dispatch', () => {
  let service: any;
  beforeEach(() => {
    service = Object.create(PaymentService.prototype);
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.integrationSettingsService = { getRazorpayConfig: jest.fn().mockResolvedValue({ webhookSecret: 'test-only-secret' }) };
    service.prisma = { paymentHistory: { findFirst: jest.fn().mockResolvedValue({ id: 30, customerId: 50, amount: 10000, totalAmount: 11800, planId: 2 }) } };
    service.commissionService = { calculateAndAwardCommission: jest.fn(), handleRefundOrCancellation: jest.fn() };
    jest.spyOn(service, 'activateSubscriptionTrusted').mockResolvedValue(undefined);
  });
  const send = (payload: any) => {
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', 'test-only-secret').update(raw).digest('hex');
    return service.handleWebhook(raw, signature);
  };
  it('successful webhook routes the persisted payment to the idempotent commission engine', async () => {
    await send({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay-fixture', order_id: 'order-fixture', notes: { customerId: 50, planId: 2 } } } } });
    expect(service.commissionService.calculateAndAwardCommission).toHaveBeenCalledWith({ customerId: 50, purchaseId: 30, purchaseAmount: 10000, planId: 2, orderId: 'order-fixture' });
  });
  it('full refund routes an immutable source reference to cancellation policy', async () => {
    await send({ event: 'refund.processed', payload: { refund: { entity: { id: 'refund-fixture', payment_id: 'pay-fixture', amount: 1180000 } } } });
    expect(service.commissionService.handleRefundOrCancellation).toHaveBeenCalledWith(30, 50, 'refund-fixture', false);
  });
  it('partial refund requires review instead of inventing a prorated reversal', async () => {
    await send({ event: 'refund.processed', payload: { refund: { entity: { id: 'partial-fixture', payment_id: 'pay-fixture', amount: 500000 } } } });
    expect(service.commissionService.handleRefundOrCancellation).toHaveBeenCalledWith(30, 50, 'partial-fixture', true);
  });
});
