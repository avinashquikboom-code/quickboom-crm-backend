import { SetMetadata } from "@nestjs/common";
export const CustomerBillingAccess = () =>
  SetMetadata("customerBillingAccess", true);
