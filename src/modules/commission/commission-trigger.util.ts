import { Logger } from '@nestjs/common';
import type { CommissionService } from './commission.service';

export interface QualifyingPayment {
  id: number;
  customerId: number;
  amount: number;
  planId?: number | null;
  orderId?: string | null;
}

/**
 * Runs after the payment transaction has committed. Commission failures are
 * logged and never roll back or fail the customer's plan purchase.
 */
export async function awardCommissionForPayment(
  commissionService: CommissionService | undefined,
  logger: Logger,
  payment: QualifyingPayment | null | undefined,
  source: string,
): Promise<void> {
  if (!commissionService || !payment?.id) return;
  try {
    await commissionService.calculateAndAwardCommission({
      customerId: payment.customerId,
      purchaseId: payment.id,
      purchaseAmount: Number(payment.amount),
      planId: payment.planId ?? null,
      orderId: payment.orderId ?? null,
    });
  } catch (err: any) {
    logger.error(
      `[COMMISSION_WARNING] Failed to award commission (${source}) for payment #${payment.id}: ${err?.message}`,
      err?.stack,
    );
  }
}
