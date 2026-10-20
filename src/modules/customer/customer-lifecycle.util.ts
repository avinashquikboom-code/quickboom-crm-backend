import { Prisma } from "@prisma/client";
import { ConflictException, Logger } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { randomUUID } from "crypto";

const logger = new Logger("CustomerLifecycle");

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
  const customer = await tx.customer.upsert({
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

  // A Won Lead without usable contact details keeps its billing row but cannot
  // receive a login until a registered email or mobile is available.
  const normalizedEmail = lead.email?.trim().toLowerCase() || null;
  const rawPhone = lead.phone?.trim() || null;
  logger.log(
    `[CAL_TRACE] convertWonLead lead=${id} customer=${customer.id} assignedTeamId=${customer.assignedTeamId ?? null} hasUser=${Boolean(customer.userId)}`,
  );
  if (customer.userId || (!normalizedEmail && !rawPhone)) return;

  const digits = (rawPhone || "").replace(/\D/g, "");
  const phoneDigits = digits.length > 10 ? digits.slice(-10) : digits;
  const loginPhone = phoneDigits.length === 10 ? `+91${phoneDigits}` : rawPhone;
  const phoneVariants = rawPhone
    ? Array.from(new Set([rawPhone, digits, phoneDigits, `91${phoneDigits}`, `+91${phoneDigits}`, loginPhone].filter((value): value is string => Boolean(value))))
    : [];
  const existingUsers = await tx.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(normalizedEmail ? [{ email: { equals: normalizedEmail, mode: "insensitive" as const } }] : []),
        ...(phoneVariants.length ? [{ phone: { in: phoneVariants } }] : []),
      ],
    },
    include: { customerAccount: { select: { id: true } } },
  });
  if (existingUsers.length > 1) {
    throw new ConflictException("Lead contact details match multiple accounts; resolve the account before marking the Lead Won");
  }

  const existingUser = existingUsers[0];
  if (existingUser) {
    if (existingUser.accountType !== "CUSTOMER" || (existingUser.customerAccount && existingUser.customerAccount.id !== customer.id)) {
      throw new ConflictException("Lead contact details already belong to another account");
    }
    await tx.customer.update({ where: { id: customer.id }, data: { userId: existingUser.id } });
    return;
  }

  // User.email is required by the existing schema. Phone-only Leads receive
  // a non-deliverable address and authenticate with their registered mobile.
  const userEmail = normalizedEmail || `customer-${randomUUID()}@login.quickboom.invalid`;
  const passwordHash = await bcrypt.hash("123456", 12);
  const user = await tx.user.create({
    data: {
      email: userEmail,
      phone: loginPhone,
      passwordHash,
      firstName: firstName?.trim() || companyName,
      lastName: lastName?.trim() || "",
      accountType: "CUSTOMER",
      isActive: true,
    },
  });
  await tx.customer.update({ where: { id: customer.id }, data: { userId: user.id } });
}

export async function deleteCustomersForLeads(
  tx: any,
  leadIds: number[],
  now = new Date(),
) {
  if (!leadIds || !leadIds.length || !tx.customer?.findMany) return;

  const customers = await tx.customer.findMany({
    where: { originLeadId: { in: leadIds }, deletedAt: null },
    select: { id: true, userId: true },
  });

  if (!customers || !customers.length) return;

  const customerIds = customers.map((c: any) => c.id);
  const userIds = customers
    .map((c: any) => c.userId)
    .filter((id: any): id is number => typeof id === "number" && id > 0);

  // Soft-delete the customer accounts
  await tx.customer.updateMany({
    where: { id: { in: customerIds } },
    data: { deletedAt: now },
  });

  // Cancel any active or pending subscriptions
  if (tx.customerSubscription?.updateMany) {
    await tx.customerSubscription.updateMany({
      where: {
        customerId: { in: customerIds },
        status: { in: ["ACTIVE", "PENDING_ACTIVATION"] },
      },
      data: { status: "CANCELLED" },
    });
  }

  // Deactivate any customer user logins associated with these deleted customers
  if (userIds.length > 0 && tx.user?.updateMany) {
    await tx.user.updateMany({
      where: { id: { in: userIds }, accountType: "CUSTOMER" },
      data: { isActive: false, deletedAt: now },
    });
  }
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
