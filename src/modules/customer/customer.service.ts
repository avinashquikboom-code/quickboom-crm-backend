import { Prisma } from "@prisma/client";
import * as bcrypt from "bcrypt";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { isUserAdmin, isUserSuperAdmin } from "../../common/utils/account.util";
import { subscriptionPrice } from "./billing-price.util";
import { recalculateCustomer } from "./customer-lifecycle.util";
import {
  calculateActivationDate,
  calculatePlanExpiry,
} from "../../common/utils/subscription-date.util";
import { BUSINESS_TIMEZONE } from "../../common/utils/timezone.util";

@Injectable()
export class CustomerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustomerService.name);
  private expiryTimer?: ReturnType<typeof setInterval>;
  private expiryRunning = false;
  onModuleInit() {
    // Run an initial check after 2 seconds of startup
    setTimeout(() => {
      this.activatePendingSubscriptions().catch((err) => {
        this.logger.error(
          `Initial pending subscription activation check failed: ${err?.message}`,
        );
      });
    }, 2000);

    this.expiryTimer = setInterval(async () => {
      if (this.expiryRunning) return;
      this.expiryRunning = true;
      try {
        await this.expire();
      } catch {
        this.logger.error(
          "Customer subscription expiry and activation reconciliation failed",
        );
      } finally {
        this.expiryRunning = false;
      }
    }, 60000);
    this.expiryTimer.unref();
  }
  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  constructor(private readonly prisma: PrismaService) {}

  async authorize(user: any, customerId?: number) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        deletedAt: null,
        ...(customerId ? { id: customerId } : { userId: Number(user.id) }),
      },
    });
    if (!customer) throw new NotFoundException("Customer account not found");
    if (!isUserAdmin(user) && customer.userId !== Number(user.id))
      throw new ForbiddenException("Customer access denied");
    return customer;
  }

  async list(user: any, search = "") {
    const where: any = isUserAdmin(user)
      ? { deletedAt: null, lead: { deletedAt: null } }
      : user.employee?.id
        ? {
            deletedAt: null,
            lead: {
              deletedAt: null,
              OR: [
                { createdById: Number(user.id) },
                { assignedToId: Number(user.employee.id) },
              ],
            },
          }
        : {
            userId: Number(user.id),
            deletedAt: null,
            lead: { deletedAt: null },
          };
    if (search.trim())
      where.companyName = { contains: search.trim(), mode: "insensitive" };
    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { id: "desc" },
    });
    const data = [];
    for (const customer of customers)
      data.push(await this.detail(user, customer.id, true));
    return {
      data,
      total: data.length,
      counts: {
        all: data.length,
        active: data.filter((c) => c.status === "ACTIVE").length,
        pendingActivation: data.filter(
          (c) => c.subscriptionStatus === "PENDING_ACTIVATION",
        ).length,
        inactive: data.filter((c) => c.status === "INACTIVE").length,
      },
    };
  }

  async detail(user: any, id: number, scopedList = false) {
    if (!scopedList) await this.authorize(user, id);
    return this.prisma.$transaction(async (tx) => {
      const customer = await recalculateCustomer(tx, id);
      if (customer.deletedAt)
        throw new NotFoundException("Customer account not found");
      if (tx.lead?.findUnique && customer.originLeadId) {
        const lead = await tx.lead.findUnique({
          where: { id: customer.originLeadId },
          select: { deletedAt: true },
        });
        if (lead?.deletedAt)
          throw new NotFoundException("Customer account not found");
      }
      const subscriptions = await tx.customerSubscription.findMany({
        where: { customerId: id },
        include: { plan: { select: { name: true } }, checkout: true },
        orderBy: { id: "desc" },
      });
      const now = new Date();
      const active = subscriptions.find(
        (s) =>
          s.status === "ACTIVE" &&
          s.startDate <= now &&
          s.endDate > now &&
          s.checkout?.status === "PAID",
      );
      const pendingActivation = subscriptions.find(
        (s) =>
          s.status === "PENDING_ACTIVATION" &&
          ((s.activationDate && s.activationDate > now) || s.startDate > now) &&
          s.checkout?.status === "PAID",
      );
      const currentSub = active || pendingActivation;
      const subStatus = active
        ? "ACTIVE"
        : pendingActivation
          ? "PENDING_ACTIVATION"
          : "INACTIVE";

      return {
        ...customer,
        assignedTeam: (customer as any).assignedTeamId
          ? await tx.team.findUnique({ where: { id: (customer as any).assignedTeamId },
              select: { id: true, name: true, isActive: true, _count: { select: { members: true } } } })
          : null,
        crmCompany: customer.crmCompanyId
          ? await tx.company.findUnique({
              where: { id: customer.crmCompanyId },
              select: { id: true, name: true },
            })
          : null,
        customerStatus: customer.status,
        name: customer.companyName,
        originLeadId: customer.originLeadId,
        subscriptionStatus: subStatus,
        hasUpcomingCall: false,
        planName: currentSub?.plan.name,
        subscriptionStartDate: currentSub?.startDate,
        subscriptionEndDate: currentSub?.endDate,
        activationDate: currentSub?.activationDate || currentSub?.startDate,
        purchaseDate: currentSub?.createdAt,
        subscriptions,
      };
    });
  }

  async linkUser(id: number, userId: number, actor: any) {
    if (!isUserAdmin(actor))
      throw new ForbiddenException("Administrator required");
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
    });
    if (!user) throw new BadRequestException("Active user not found");
    return this.prisma.customer.update({
      where: { id, deletedAt: null },
      data: { userId },
    });
  }

  async createAccount(id: number, password: string, actor: any) {
    if (!isUserAdmin(actor))
      throw new ForbiddenException("Administrator required");
    const passwordHash = await bcrypt.hash(password, 12);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${id} FOR UPDATE`;
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id, deletedAt: null },
      });
      if (customer.userId || !customer.email)
        throw new BadRequestException(
          "Customer needs an email and must not already have a login",
        );
      const user = await tx.user.create({
        data: {
          email: customer.email,
          firstName: customer.firstName || customer.companyName,
          lastName: customer.lastName || "",
          passwordHash,
          accountType: "CUSTOMER",
          isActive: true,
        },
      });
      return tx.customer.update({ where: { id }, data: { userId: user.id } });
    });
  }

  async remove(id: number, actor: any, cancelSubscriptions = true) {
    return this.bulkRemove([id], actor, cancelSubscriptions);
  }

  async assignTeam(customerId: number, teamId: number | null, actor: any) {
    if (!isUserAdmin(actor)) throw new ForbiddenException("Administrator required");
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, deletedAt: null, lead: { deletedAt: null } }, select: { id: true },
      });
      if (!customer) throw new NotFoundException("Customer account not found");
      if (teamId !== null) {
        const team = await tx.team.findFirst({ where: { id: teamId, isActive: true }, select: { id: true } });
        if (!team) throw new NotFoundException("Active team not found");
      }
      // Assign customer access only. Existing Work and WorkTask assignees are untouched.
      return (tx.customer as any).update({ where: { id: customerId }, data: { assignedTeamId: teamId },
        select: { id: true, assignedTeamId: true, assignedTeam: { select: { id: true, name: true, isActive: true } } },
      });
    });
  }

  async linkCrmCompany(customerId: number, companyId: number | null, actor: any) {
    if (!isUserAdmin(actor))
      throw new ForbiddenException("Administrator required");
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException("Customer account not found");
    if (companyId !== null) {
      const company = await this.prisma.company.findFirst({
        where: { id: companyId, deletedAt: null },
        select: { id: true },
      });
      if (!company) throw new NotFoundException("CRM company not found");
      const linked = await this.prisma.customer.findFirst({
        where: { crmCompanyId: companyId, NOT: { id: customerId } },
        select: { id: true },
      });
      if (linked) throw new ConflictException("CRM company is already linked to another customer");
    }
    try {
      return await this.prisma.customer.update({
        where: { id: customerId },
        data: { crmCompanyId: companyId },
        select: { id: true, crmCompanyId: true },
      });
    } catch (error: any) {
      if (error?.code === "P2002")
        throw new ConflictException("CRM company is already linked to another customer");
      throw error;
    }
  }

  async bulkRemove(rawIds: number[], actor: any, cancelSubscriptions = true) {
    if (!isUserAdmin(actor))
      throw new ForbiddenException("Administrator required");
    if (
      !Array.isArray(rawIds) ||
      !rawIds.length ||
      rawIds.length > 100 ||
      rawIds.some((id) => !Number.isSafeInteger(id) || id < 1)
    ) {
      throw new BadRequestException(
        "Provide between 1 and 100 valid customer IDs",
      );
    }
    const ids = [...new Set(rawIds)].sort((a, b) => a - b);
    return this.prisma.$transaction(async (tx) => {
      // Stable ordering avoids deadlocks between overlapping bulk deletions.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customer_accounts WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
      );
      const customers = await tx.customer.findMany({
        where: { id: { in: ids } },
        select: { id: true, userId: true, deletedAt: true, crmCompanyId: true },
      });
      if (customers.length !== ids.length)
        throw new NotFoundException("One or more customers were not found");
      const liveIds = customers
        .filter((customer) => !customer.deletedAt)
        .map((customer) => customer.id);
      if (!liveIds.length) return { deletedCount: 0, ids: [] };
      const crmCompanyIds = customers
        .filter((customer) => !customer.deletedAt && customer.crmCompanyId)
        .map((customer) => customer.crmCompanyId as number);

      if (cancelSubscriptions) {
        if (tx.customerSubscription?.updateMany) {
          await tx.customerSubscription.updateMany({
            where: {
              customerId: { in: liveIds },
              status: { in: ["ACTIVE", "PENDING_ACTIVATION"] },
            },
            data: { status: "CANCELLED" },
          });
        }
        if (tx.customerCheckout?.updateMany) {
          await tx.customerCheckout.updateMany({
            where: {
              customerId: { in: liveIds },
              status: { notIn: ["PAID", "CANCELLED"] },
            },
            data: { status: "CANCELLED" },
          });
        }
        const userIds = customers
          .map((c) => c.userId)
          .filter((uid): uid is number => typeof uid === "number" && uid > 0);
        if (userIds.length > 0 && tx.user?.updateMany) {
          await tx.user.updateMany({
            where: { id: { in: userIds } },
            data: { isActive: false },
          });
        }
      } else {
        const liveSubscription = await tx.customerSubscription.findFirst({
          where: {
            customerId: { in: liveIds },
            status: { in: ["ACTIVE", "PENDING_ACTIVATION"] },
            endDate: { gt: new Date() },
          },
          select: { customerId: true },
        });
        if (liveSubscription)
          throw new BadRequestException(
            `Customer #${liveSubscription.customerId} has an active or pending subscription. Cancel it before deleting.`,
          );
        const unsettledCheckout = await tx.customerCheckout.findFirst({
          where: {
            customerId: { in: liveIds },
            status: { notIn: ["PAID", "CANCELLED"] },
          },
          select: { customerId: true },
        });
        if (unsettledCheckout)
          throw new BadRequestException(
            `Customer #${unsettledCheckout.customerId} has an unresolved checkout. Resolve it before deleting.`,
          );
      }

      const deletionAt = new Date();
      const result = await tx.customer.updateMany({
        where: { id: { in: liveIds }, deletedAt: null },
        data: { deletedAt: deletionAt },
      });

      if (crmCompanyIds.length) {
        const contacts = await tx.contact.findMany({
          where: { companyId: { in: crmCompanyIds } },
          select: { id: true },
        });
        const contactIds = contacts.map((contact) => contact.id);
        if (contactIds.length) {
          await tx.invoice.deleteMany({ where: { contactId: { in: contactIds } } });
          await tx.visit.deleteMany({ where: { contactId: { in: contactIds } } });
          await tx.contact.updateMany({
            where: { id: { in: contactIds }, deletedAt: null },
            data: { deletedAt: deletionAt },
          });
        }
        await tx.visit.deleteMany({ where: { companyId: { in: crmCompanyIds } } });
        const linkedWork = await tx.work.findMany({
          where: { companyId: { in: crmCompanyIds } },
          select: { entitlementId: true, status: true },
        });
        const scheduledByEntitlement = new Map<number, number>();
        for (const work of linkedWork) {
          if (
            work.entitlementId &&
            work.status !== 'COMPLETED' &&
            work.status !== 'CANCELLED'
          ) {
            scheduledByEntitlement.set(
              work.entitlementId,
              (scheduledByEntitlement.get(work.entitlementId) || 0) + 1,
            );
          }
        }
        for (const [entitlementId, count] of scheduledByEntitlement) {
          await tx.planEntitlement.updateMany({
            where: { id: entitlementId, scheduledQty: { gte: count } },
            data: { scheduledQty: { decrement: count } },
          });
        }
        await tx.work.deleteMany({ where: { companyId: { in: crmCompanyIds } } });
        await tx.company.updateMany({
          where: { id: { in: crmCompanyIds }, deletedAt: null },
          data: { deletedAt: deletionAt },
        });
      }
      return { deletedCount: result.count, ids: liveIds };
    });
  }

  async countActiveCustomersForSuperAdmin(actor: any) {
    if (!isUserSuperAdmin(actor))
      throw new ForbiddenException("Super administrator required");
    return {
      totalCustomers: await this.prisma.customer.count({
        where: { deletedAt: null },
      }),
    };
  }

  async deleteAllForSuperAdmin(actor: any, confirmation: string) {
    if (!isUserSuperAdmin(actor))
      throw new ForbiddenException("Super administrator required");
    if (confirmation?.trim().toUpperCase() !== "DELETE ALL CUSTOMERS")
      throw new BadRequestException(
        'Confirmation mismatch. Type "DELETE ALL CUSTOMERS" to continue.',
      );

    // Freeze the target range before processing batches, so customers added
    // during this operation are not accidentally included.
    const highestCustomer = await this.prisma.customer.findFirst({
      where: { deletedAt: null },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (!highestCustomer)
      return { success: true, deletedCount: 0, message: "No active customers to delete." };

    let cursor = 0;
    let deletedCount = 0;
    while (cursor < highestCustomer.id) {
      const batch = await this.prisma.customer.findMany({
        where: { deletedAt: null, id: { gt: cursor, lte: highestCustomer.id } },
        orderBy: { id: "asc" },
        take: 100,
        select: { id: true },
      });
      if (!batch.length) break;

      const ids = batch.map((customer) => customer.id);
      try {
        const result = await this.bulkRemove(ids, actor, true);
        deletedCount += result.deletedCount;
      } catch (error: any) {
        throw new InternalServerErrorException(
          `Delete-all failed after ${deletedCount} customer(s). The current batch was rolled back; review the server error before retrying.`,
        );
      }
      cursor = ids[ids.length - 1];
    }

    return {
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} customer${deletedCount === 1 ? "" : "s"}.`,
    };
  }

  async quote(planId: number, cycle = "MONTHLY") {
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, isActive: true, deletedAt: null },
    });
    if (!plan) throw new BadRequestException("Plan unavailable");
    return {
      planId: plan.id,
      planName: plan.name,
      currency: "INR",
      ...subscriptionPrice(plan, cycle),
    };
  }

  async prepare(
    user: any,
    dto: {
      customerId?: number;
      planId: number | string;
      billingCycle?: string;
      idempotencyKey: string;
    },
  ) {
    const customer = await this.authorize(user, dto.customerId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${customer.id} FOR UPDATE`;
      const currentCustomer = await tx.customer.findFirst({
        where: { id: customer.id, deletedAt: null },
      });
      if (!currentCustomer)
        throw new NotFoundException("Customer account not found");
      const existing = await tx.customerCheckout.findUnique({
        where: {
          customerId_idempotencyKey: {
            customerId: customer.id,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (
          existing.planId !== Number(dto.planId) ||
          existing.billingCycle !== (dto.billingCycle || "MONTHLY")
        )
          throw new BadRequestException(
            "Idempotency key already used for another purchase",
          );
        return existing;
      }
      const { planId, planName, currency, ...price } = await this.quote(
        Number(dto.planId),
        dto.billingCycle,
      );
      const prepared = await tx.customerCheckout.upsert({
        where: {
          customerId_idempotencyKey: {
            customerId: customer.id,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        update: {},
        create: {
          customerId: customer.id,
          planId,
          idempotencyKey: dto.idempotencyKey,
          ...price,
        },
      });
      if (
        prepared.planId !== planId ||
        prepared.billingCycle !== price.billingCycle
      )
        throw new BadRequestException(
          "Idempotency key already used for another purchase",
        );
      return prepared;
    });
  }

  async settle(
    orderId: string,
    payment: {
      id: string;
      order_id: string;
      status: string;
      amount: number;
      currency: string;
    },
  ) {
    const checkout = await this.prisma.customerCheckout.findUnique({
      where: { orderId },
    });
    if (!checkout) throw new NotFoundException("Checkout not found");
    if (
      payment.order_id !== orderId ||
      payment.status !== "captured" ||
      payment.currency !== "INR" ||
      Number(payment.amount) !== checkout.totalPaise
    )
      throw new BadRequestException(
        "Payment is not a matching captured payment",
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${checkout.customerId} FOR UPDATE`;
      const current = await tx.customerCheckout.findUniqueOrThrow({
        where: { id: checkout.id },
      });
      if (current.status === "PAID")
        return tx.customerSubscription.findUnique({
          where: { checkoutId: current.id },
        });
      const purchaseDate = new Date();
      const activationDate = calculateActivationDate(
        purchaseDate,
        BUSINESS_TIMEZONE,
      );
      const startDate = activationDate;
      const endDate = calculatePlanExpiry(
        startDate,
        current.billingCycle === "YEARLY" ? 12 : 1,
      );
      const plan = await tx.plan.findUniqueOrThrow({
        where: { id: current.planId },
      });
      const history = await tx.paymentHistory.create({
        data: {
          amount: current.taxablePaise / 100,
          currency: "INR",
          paymentMethod: "RAZORPAY",
          paymentId: payment.id,
          orderId,
          status: "SUCCESS",
          planId: current.planId,
          planName: plan.name,
          billingCycle: current.billingCycle,
          originalAmount: current.basePaise / 100,
          discountAmount: current.discountPaise / 100,
          taxAmount: current.gstPaise / 100,
          totalAmount: current.totalPaise / 100,
        },
      });
      await tx.customerCheckout.update({
        where: { id: current.id },
        data: {
          status: "PAID",
          paymentId: payment.id,
          paymentHistoryId: history.id,
        },
      });
      const sub = await tx.customerSubscription.create({
        data: {
          customerId: current.customerId,
          planId: current.planId,
          checkoutId: current.id,
          startDate,
          endDate,
          activationDate,
          status: "PENDING_ACTIVATION",
          createdAt: purchaseDate,
        },
      });
      await recalculateCustomer(tx, current.customerId, purchaseDate);
      return sub;
    });
  }

  async activatePendingSubscriptions(now = new Date()) {
    const pendingSubs = await this.prisma.customerSubscription.findMany({
      where: {
        customer: { deletedAt: null },
        status: "PENDING_ACTIVATION",
        OR: [
          { activationDate: { lte: now } },
          { activationDate: null, startDate: { lte: now } },
        ],
        checkout: { status: "PAID" },
      },
      include: { checkout: true },
      orderBy: { id: "asc" },
    });

    let activatedCount = 0;
    for (const sub of pendingSubs) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${sub.customerId} FOR UPDATE`;
          const currentSub = await tx.customerSubscription.findUnique({
            where: { id: sub.id },
          });
          const currentCheckout = await tx.customerCheckout.findUnique({
            where: { id: sub.checkoutId },
          });

          if (!currentSub || currentSub.status !== "PENDING_ACTIVATION") return;
          if (!currentCheckout || currentCheckout.status !== "PAID") return;
          const actDate = currentSub.activationDate ?? currentSub.startDate;
          if (actDate > now) return;

          await tx.customerSubscription.update({
            where: { id: sub.id },
            data: { status: "ACTIVE" },
          });
          await recalculateCustomer(tx, sub.customerId, now);
          activatedCount++;
        });
      } catch (err: any) {
        this.logger.error(
          `Failed to activate subscription #${sub.id}: ${err?.message}`,
        );
      }
    }
    return { activatedCount, totalChecked: pendingSubs.length };
  }

  async cancel(id: number, user: any) {
    const sub = await this.prisma.customerSubscription.findUnique({
      where: { id },
    });
    if (!sub) throw new NotFoundException("Subscription not found");
    await this.authorize(user, sub.customerId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${sub.customerId} FOR UPDATE`;
      const updated = await tx.customerSubscription.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      await recalculateCustomer(tx, sub.customerId);
      return updated;
    });
  }

  async expire() {
    await this.activatePendingSubscriptions();
    const customers = await this.prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    for (const customer of customers)
      await this.prisma.$transaction((tx) =>
        recalculateCustomer(tx, customer.id),
      );
    return { checked: customers.length };
  }
}
