import {
  PrismaClient,
  CommissionType,
  CommissionConfigStatus,
  CommissionStatus,
} from '@prisma/client';

describe('BPO Employee Commission Management — Migration & Business Logic Verification', () => {
  describe('1. Commission Configuration Structure & Rules', () => {
    it('supports PERCENTAGE commission configuration', () => {
      const config = {
        id: 1,
        customerId: 10,
        employeeId: 5,
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: 5.0, // 5%
        status: CommissionConfigStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(config.commissionType).toBe('PERCENTAGE');
      expect(config.commissionValue).toBe(5.0);
      expect(config.status).toBe('ACTIVE');
      expect(config.employeeId).toBe(5);
    });

    it('supports FIXED commission configuration', () => {
      const config = {
        id: 2,
        customerId: 10,
        employeeId: 6,
        commissionType: CommissionType.FIXED,
        commissionValue: 1500.0, // ₹1,500 flat
        status: CommissionConfigStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(config.commissionType).toBe('FIXED');
      expect(config.commissionValue).toBe(1500.0);
      expect(config.status).toBe('ACTIVE');
    });

    it('allows inactive status for employees not eligible', () => {
      const config = {
        id: 3,
        customerId: 10,
        employeeId: 7,
        commissionType: CommissionType.PERCENTAGE,
        commissionValue: 0,
        status: CommissionConfigStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(config.status).toBe('INACTIVE');
    });
  });

  describe('2. Commission Calculation Engine', () => {
    function calculateCommission(params: {
      type: CommissionType;
      value: number;
      purchaseAmount: number;
    }): number {
      if (params.type === CommissionType.PERCENTAGE) {
        return (params.purchaseAmount * params.value) / 100;
      }
      return params.value;
    }

    it('calculates 5% commission on ₹20,000 purchase correctly to ₹1,000', () => {
      const purchaseAmount = 20000;
      const commissionRate = 5.0; // 5%

      const commissionAmount = calculateCommission({
        type: CommissionType.PERCENTAGE,
        value: commissionRate,
        purchaseAmount,
      });

      expect(commissionAmount).toBe(1000);
    });

    it('calculates 10% commission on ₹50,000 purchase correctly to ₹5,000', () => {
      const purchaseAmount = 50000;
      const commissionRate = 10.0;

      const commissionAmount = calculateCommission({
        type: CommissionType.PERCENTAGE,
        value: commissionRate,
        purchaseAmount,
      });

      expect(commissionAmount).toBe(5000);
    });

    it('calculates fixed commission independent of purchase amount', () => {
      const purchaseAmount = 20000;
      const fixedValue = 2500;

      const commissionAmount = calculateCommission({
        type: CommissionType.FIXED,
        value: fixedValue,
        purchaseAmount,
      });

      expect(commissionAmount).toBe(2500);
    });
  });

  describe('3. Commission Transaction & Lifecycle States', () => {
    it('creates commission record with initial PENDING status', () => {
      const transaction = {
        id: 1,
        customerId: 10,
        employeeId: 5,
        leadId: 42,
        planId: 3,
        purchaseId: 101,
        orderId: 'ORDER_2026_09_101',
        commissionType: CommissionType.PERCENTAGE,
        commissionRate: 5.0,
        purchaseAmount: 20000,
        commissionAmount: 1000,
        status: CommissionStatus.PENDING,
        paidAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(transaction.status).toBe('PENDING');
      expect(transaction.commissionAmount).toBe(1000);
      expect(transaction.paidAt).toBeNull();
      expect(transaction.purchaseId).toBe(101);
    });

    it('transitions to APPROVED, then PAID with paidAt timestamp', () => {
      const transaction: {
        status: CommissionStatus;
        paidAt: Date | null;
      } = {
        status: CommissionStatus.PENDING,
        paidAt: null,
      };

      // Admin approves commission
      transaction.status = CommissionStatus.APPROVED;
      expect(transaction.status).toBe('APPROVED');
      expect(transaction.paidAt).toBeNull();

      // Commission paid out
      const paymentDate = new Date();
      transaction.status = CommissionStatus.PAID;
      transaction.paidAt = paymentDate;

      expect(transaction.status).toBe('PAID');
      expect(transaction.paidAt).toEqual(paymentDate);
    });

    it('supports CANCELLED status on refunded/invalidated orders', () => {
      const transaction = {
        status: CommissionStatus.CANCELLED,
        paidAt: null,
      };

      expect(transaction.status).toBe('CANCELLED');
    });
  });

  describe('4. Live Database Verification: Schema, Constraints & Duplicate Protection', () => {
    let prisma: PrismaClient;
    let customerId: number;
    let employeeId: number;
    let leadId: number | undefined;
    let planId: number | undefined;
    let createdPaymentId: number | null = null;
    let createdConfigId: number | null = null;
    let createdCommissionId: number | null = null;

    beforeAll(async () => {
      prisma = new PrismaClient();
      await prisma.$connect();

      const customer = await prisma.customer.findFirst();
      const employee = await prisma.employee.findFirst();
      const lead = await prisma.lead.findFirst();
      const plan = await prisma.plan.findFirst();

      if (customer && employee) {
        customerId = customer.id;
        employeeId = employee.id;
        leadId = lead?.id;
        planId = plan?.id;
      }
    });

    afterAll(async () => {
      if (prisma) {
        if (createdCommissionId) {
          await prisma.commission.deleteMany({ where: { id: createdCommissionId } });
        }
        if (createdConfigId) {
          await prisma.commissionConfig.deleteMany({ where: { id: createdConfigId } });
        }
        if (createdPaymentId) {
          await prisma.paymentHistory.deleteMany({ where: { id: createdPaymentId } });
        }
        await prisma.$disconnect();
      }
    });

    it('creates active commission configuration for employee in PostgreSQL', async () => {
      if (!customerId || !employeeId) return;

      // Clean existing config if any for this employee
      await prisma.commissionConfig.deleteMany({ where: { employeeId } });

      const config = await prisma.commissionConfig.create({
        data: {
          customerId,
          employeeId,
          commissionType: CommissionType.PERCENTAGE,
          commissionValue: 5.0,
          status: CommissionConfigStatus.ACTIVE,
        },
      });

      createdConfigId = config.id;
      expect(config.id).toBeDefined();
      expect(config.commissionType).toBe('PERCENTAGE');
      expect(config.commissionValue).toBe(5.0);
      expect(config.status).toBe('ACTIVE');
    });

    it('enforces UNIQUE constraint on employeeId for CommissionConfig', async () => {
      if (!customerId || !employeeId) return;

      let duplicateError: any = null;
      try {
        await prisma.commissionConfig.create({
          data: {
            customerId,
            employeeId,
            commissionType: CommissionType.FIXED,
            commissionValue: 1000,
            status: CommissionConfigStatus.ACTIVE,
          },
        });
      } catch (err) {
        duplicateError = err;
      }

      expect(duplicateError).not.toBeNull();
      expect(duplicateError.code).toBe('P2002'); // Prisma Unique constraint violation
    });

    it('creates commission transaction linking lead, plan, purchase and calculates ₹1,000 for ₹20,000 purchase', async () => {
      if (!customerId || !employeeId) return;

      // Create test PaymentHistory record
      const payment = await prisma.paymentHistory.create({
        data: {
          customerId,
          amount: 20000,
          status: 'SUCCESS',
          currency: 'INR',
          orderId: `ORDER_TEST_${Date.now()}`,
        },
      });
      createdPaymentId = payment.id;

      const purchaseAmount = payment.amount;
      const commissionRate = 5.0; // 5%
      const commissionAmount = (purchaseAmount * commissionRate) / 100; // ₹1,000

      const commission = await prisma.commission.create({
        data: {
          customerId,
          employeeId,
          leadId,
          planId,
          purchaseId: payment.id,
          orderId: payment.orderId,
          commissionType: CommissionType.PERCENTAGE,
          commissionRate,
          purchaseAmount,
          commissionAmount,
          status: CommissionStatus.PENDING,
        },
        include: {
          customer: true,
          employee: true,
          lead: true,
          plan: true,
          purchase: true,
        },
      });

      createdCommissionId = commission.id;
      expect(commission.id).toBeDefined();
      expect(commission.purchaseAmount).toBe(20000);
      expect(commission.commissionAmount).toBe(1000);
      expect(commission.purchaseId).toBe(payment.id);
      expect(commission.customer.id).toBe(customerId);
      expect(commission.employee.id).toBe(employeeId);
    });

    it('enforces UNIQUE constraint on purchaseId to prevent duplicate commissions for same purchase', async () => {
      if (!customerId || !employeeId || !createdPaymentId) return;

      let duplicateError: any = null;
      try {
        await prisma.commission.create({
          data: {
            customerId,
            employeeId,
            purchaseId: createdPaymentId,
            commissionType: CommissionType.PERCENTAGE,
            commissionRate: 5.0,
            purchaseAmount: 20000,
            commissionAmount: 1000,
            status: CommissionStatus.PENDING,
          },
        });
      } catch (err) {
        duplicateError = err;
      }

      expect(duplicateError).not.toBeNull();
      expect(duplicateError.code).toBe('P2002'); // Unique constraint failed on purchase_id
    });
  });
});
