export enum SubscriptionBillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
}

export class CreateOrderDto {
  planId: number | string;
  billingCycle: SubscriptionBillingCycle;
  paymentMethod?: string;
  couponCode?: string;
}

export class RenewSubscriptionDto {
  billingCycle?: SubscriptionBillingCycle;
  paymentMethod?: string;
}
