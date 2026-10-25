import { createParamDecorator } from '@nestjs/common';

/** Compatibility decorator for existing controllers in the single-organization app.
 * Tenant headers and old JWT tenant claims no longer select database records.
 */
export const CurrentCustomer = createParamDecorator(() => undefined);
