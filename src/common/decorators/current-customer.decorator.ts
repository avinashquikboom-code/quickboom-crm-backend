import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentCustomer = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();

    // CustomerGuard explicitly sets request.customerId:
    //   - SUPER_ADMIN with no target customer => undefined  (global platform view)
    //   - SUPER_ADMIN with explicit target    => <number>   (scoped view)
    //   - Normal tenant user                 => <number>   (their own customerId)
    //
    // We check for the presence of the property first so that the intentional
    // `undefined` set by the guard is honoured and NOT overridden by user.customerId.
    if ('customerId' in request) {
      return request.customerId ?? undefined;
    }

    // Fallback for routes where CustomerGuard is not applied (e.g. public routes).
    return request.user?.customerId ?? request.headers['x-customer-id'];
  },
);
