import * as crypto from 'crypto';
import { PaymentService } from './payment.service';
function setup() {
  const prisma: any = {
    customerCheckout: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: 'checkout',
          customerId: 9,
          orderId: 'order',
          status: 'PENDING',
        }),
      updateMany: jest.fn(),
    },
  };
  const customers: any = { authorize: jest.fn(), settle: jest.fn() };
  const config: any = {
    getRazorpayConfig: jest
      .fn()
      .mockResolvedValue({ webhookSecret: 'test-webhook-secret' }),
  };
  const service = new PaymentService(
    prisma,
    null,
    null,
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    customers,
  );
  const payments = {
    fetch: jest.fn().mockResolvedValue({ id: 'payment', status: 'captured' }),
  };
  jest
    .spyOn(service as any, 'getRazorpayClient')
    .mockResolvedValue({
      instance: { payments },
      config: { keySecret: 'test-key-secret' },
    });
  return { service, prisma, customers, payments };
}
describe('payment verification lifecycle', () => {
  it('rejects invalid webhook signatures even in test mode', async () => {
    const { service, customers } = setup();
    await expect(service.handleWebhook('{}', '0'.repeat(64))).rejects.toThrow(
      'Invalid payment signature',
    );
    expect(customers.settle).not.toHaveBeenCalled();
  });
  it('uses the signed raw body and fetches payment before settlement', async () => {
    const { service, customers, payments } = setup();
    const raw =
      '{ "event": "payment.captured", "payload": {"payment":{"entity":{"order_id":"order","id":"payment"}}}}';
    const signature = crypto
      .createHmac('sha256', 'test-webhook-secret')
      .update(raw)
      .digest('hex');
    await service.handleWebhook(raw, signature);
    expect(payments.fetch).toHaveBeenCalledWith('payment');
    expect(customers.settle).toHaveBeenCalledWith('order', {
      id: 'payment',
      status: 'captured',
    });
    await expect(
      service.handleWebhook(JSON.stringify(JSON.parse(raw)), signature),
    ).rejects.toThrow();
  });
  it('does not activate on failure and never downgrades a paid checkout', async () => {
    const { service, prisma, customers } = setup();
    const raw = JSON.stringify({
      event: 'payment.failed',
      payload: { payment: { entity: { order_id: 'order' } } },
    });
    await service.handleWebhook(
      raw,
      crypto
        .createHmac('sha256', 'test-webhook-secret')
        .update(raw)
        .digest('hex'),
    );
    expect(prisma.customerCheckout.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    expect(customers.settle).not.toHaveBeenCalled();
  });
  it('does not swallow settlement errors so the provider can retry', async () => {
    const { service, customers } = setup();
    customers.settle.mockRejectedValue(new Error('database unavailable'));
    const raw = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 'order', id: 'payment' } } },
    });
    await expect(
      service.handleWebhook(
        raw,
        crypto
          .createHmac('sha256', 'test-webhook-secret')
          .update(raw)
          .digest('hex'),
      ),
    ).rejects.toThrow('database unavailable');
  });
  it('rejects unverified frontend success and checks ownership before fetching payment', async () => {
    const { service, customers, payments } = setup();
    await expect(
      service.verifyRazorpayPayment(
        { id: 3 },
        {
          razorpay_order_id: 'order',
          razorpay_payment_id: 'payment',
          razorpay_signature: 'bad',
          planId: 1,
        },
      ),
    ).rejects.toThrow();
    expect(customers.authorize).toHaveBeenCalledWith({ id: 3 }, 9);
    expect(payments.fetch).not.toHaveBeenCalled();
    expect(customers.settle).not.toHaveBeenCalled();
  });
});
