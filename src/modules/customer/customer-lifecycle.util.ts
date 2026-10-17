import { Prisma } from "@prisma/client";

export async function convertWonLead(
  tx: Prisma.TransactionClient,
  lead: {
    id: number;
    status: string;
    companyName: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  },
) {
  if (lead.status !== "WON") return;
  const { id, companyName, firstName, lastName, email, phone } = lead;
  // The lead update holds its row lock; unique originLeadId also protects other callers.
  await tx.customer.upsert({
    where: { originLeadId: id },
    update: {},
    create: {
      originLeadId: id,
      companyName,
      firstName,
      lastName,
      email,
      phone,
      status: "INACTIVE",
    },
  });
}

export async function recalculateCustomer(
  tx: Prisma.TransactionClient,
  customerId: number,
  now = new Date(),
) {
  // All payment and cancellation writers acquire this lock before changing subscriptions.
  await tx.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${customerId} FOR UPDATE`;

  // Safely auto-activate eligible pending subscriptions whose activation date has arrived
  await tx.customerSubscription.updateMany({
    where: {
      customerId,
      status: 'PENDING_ACTIVATION',
      OR: [
        { activationDate: { lte: now } },
        { activationDate: null, startDate: { lte: now } },
      ],
      checkout: { status: 'PAID' },
    },
    data: { status: 'ACTIVE' },
  });

  await tx.customerSubscription.updateMany({
    where: { customerId, status: 'ACTIVE', endDate: { lte: now } },
    data: { status: 'EXPIRED' },
  });

  const active = await tx.customerSubscription.count({
    where: {
      customerId,
      status: 'ACTIVE',
      startDate: { lte: now },
      endDate: { gt: now },
      checkout: { status: 'PAID' },
    },
  });

  return tx.customer.update({
    where: { id: customerId },
    data: { status: active > 0 ? 'ACTIVE' : 'INACTIVE' },
  });
}
