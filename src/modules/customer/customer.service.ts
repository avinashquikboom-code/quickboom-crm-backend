import { extractDeliverableQuotas, generateAllPlanWorkflowActivities } from "../../common/utils/plan-deliverable.util";
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

  async list(user: any, search = "", status?: string) {
    // Resolve the canonical employee through the authenticated user, not a lead ID
    // or an optional employee object in the session payload.
    const employee = !isUserAdmin(user) && user.accountType !== "CUSTOMER"
      ? await this.prisma.employee.findUnique({
          where: { userId: Number(user.id) },
          select: { id: true, status: true, mobileLoginEnabled: true },
        })
      : null;
    const activeEmployee = employee?.status === "ACTIVE" && employee.mobileLoginEnabled;

    // Fetch upcoming leads (leads in FINAL_CALL stage)
    let upcomingItems: any[] = [];
    if (this.prisma.lead?.findMany) {
      const leadWhere: Prisma.LeadWhereInput = {
        status: "FINAL_CALL" as any,
        deletedAt: null,
      };

      if (!isUserAdmin(user)) {
        if (activeEmployee) {
          leadWhere.AND = [
            {
              OR: [
                { createdById: Number(user.id) },
                { assignedToId: employee.id },
              ],
            },
          ];
        } else {
          leadWhere.createdById = Number(user.id);
        }
      }

      if (search.trim()) {
        const searchClause: Prisma.LeadWhereInput = {
          OR: [
            { companyName: { contains: search.trim(), mode: "insensitive" } },
            { firstName: { contains: search.trim(), mode: "insensitive" } },
            { lastName: { contains: search.trim(), mode: "insensitive" } },
            { phone: { contains: search.trim(), mode: "insensitive" } },
          ],
        };
        if (leadWhere.AND) {
          (leadWhere.AND as Prisma.LeadWhereInput[]).push(searchClause);
        } else {
          leadWhere.AND = [searchClause];
        }
      }

      const upcomingLeads = await this.prisma.lead.findMany({
        where: leadWhere,
        include: {
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
            },
          },
          customer: {
            select: {
              id: true,
              status: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      upcomingItems = upcomingLeads.map((lead) => {
        const assignedName = lead.assignedTo
          ? [lead.assignedTo.firstName, lead.assignedTo.lastName].filter(Boolean).join(" ")
          : "Unassigned";
        const contactPerson =
          [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
          lead.companyName;
        const customerId = lead.customer?.id
          ? `CUST-${String(lead.customer.id).padStart(4, "0")}`
          : `LEAD-${String(lead.id).padStart(4, "0")}`;

        return {
          id: lead.customer?.id ?? lead.id,
          customerId,
          customerCode: customerId,
          originLeadId: lead.id,
          leadId: String(lead.id),
          name: lead.companyName,
          companyName: lead.companyName,
          businessName: lead.companyName,
          customerName: contactPerson,
          contactPerson,
          email: lead.email,
          phone: lead.phone,
          address: lead.address,
          city: lead.city,
          state: lead.state,
          pincode: lead.pincode,
          source: lead.source,
          status: "UPCOMING" as const,
          customerStatus: "UPCOMING" as const,
          leadStatus: lead.status,
          leadStageName: "Final Call",
          leadStageColor: "#EA580C",
          assignedToId: lead.assignedToId,
          assignedEmployee: assignedName,
          assignedEmployeeCode: lead.assignedTo?.employeeCode,
          hasUpcomingCall: true,
          upcomingCallType: "Final Call",
          upcomingCallDate: lead.updatedAt
            ? lead.updatedAt.toISOString()
            : lead.createdAt.toISOString(),
          upcomingCallTime: "11:00 AM",
          planName: null,
          subscriptionStatus: "NO_PLAN",
          createdAt: lead.createdAt.toISOString(),
          updatedAt: lead.updatedAt.toISOString(),
        };
      });
    }

    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      lead: { deletedAt: null },
      ...(!isUserAdmin(user) ? activeEmployee ? {
        OR: [
          { lead: { createdById: Number(user.id) } },
          { lead: { assignedToId: employee.id } },
          { assignedTeam: { isActive: true, OR: [
            { leaderId: employee.id },
            { members: { some: { employeeId: employee.id } } },
          ] } },
          { works: { some: {
            status: { not: "CANCELLED" },
            OR: [
              { assignedToId: employee.id },
              { editorId: employee.id },
              { tasks: { some: { assignedToId: employee.id } } },
              { team: { isActive: true, OR: [
                { leaderId: employee.id },
                { members: { some: { employeeId: employee.id } } },
              ] } },
            ],
          } } },
          // Retained work may be linked through the customer's CRM company.
          { crmCompany: { deletedAt: null, works: { some: {
            customerId: null, status: { not: "CANCELLED" },
            OR: [
              { assignedToId: employee.id },
              { editorId: employee.id },
              { tasks: { some: { assignedToId: employee.id } } },
              { team: { isActive: true, OR: [
                { leaderId: employee.id },
                { members: { some: { employeeId: employee.id } } },
              ] } },
            ],
          } } } },
        ],
      } : { userId: Number(user.id) } : {}),
    };
    if (search.trim())
      where.companyName = { contains: search.trim(), mode: "insensitive" };
    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { id: "desc" },
    });
    const customerDetails = [];
    for (const customer of customers)
      customerDetails.push(await this.detail(user, customer.id, true));

    const upcomingLeadIds = new Set(upcomingItems.map((u) => u.originLeadId).filter(Boolean));
    const activeList = customerDetails.filter((c) => c.status === "ACTIVE");
    const inactiveList = customerDetails.filter(
      (c) =>
        c.status === "INACTIVE" &&
        !upcomingLeadIds.has(c.originLeadId) &&
        c.leadStatus !== "FINAL_CALL",
    );
    const pendingList = customerDetails.filter(
      (c) => c.subscriptionStatus === "PENDING_ACTIVATION" && c.status !== "ACTIVE",
    );
    const upcomingList = upcomingItems;

    const counts = {
      all: activeList.length + upcomingList.length + inactiveList.length,
      active: activeList.length,
      upcoming: upcomingList.length,
      inactive: inactiveList.length,
      pendingActivation: pendingList.length,
    };

    const normalizedStatus = status?.trim().toUpperCase();
    let data: any[];
    if (normalizedStatus === "UPCOMING") {
      data = upcomingList;
    } else if (normalizedStatus === "INACTIVE") {
      data = inactiveList;
    } else if (normalizedStatus === "ACTIVE") {
      data = activeList;
    } else if (normalizedStatus === "PENDING_ACTIVATION") {
      data = pendingList;
    } else {
      // "ALL" or undefined
      data = [...upcomingList, ...inactiveList, ...activeList];
    }

    return {
      data,
      total: data.length,
      counts,
    };
  }

  async detail(user: any, id: number, scopedList = false) {
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException("Customer ID must be a positive integer");
    }
    if (!scopedList) await this.authorize(user, id);
    return this.prisma.$transaction(async (tx) => {
      const customer = await recalculateCustomer(tx, id);
      if (customer.deletedAt)
        throw new NotFoundException("Customer account not found");
      let originatingLead: any = null;
      if (tx.lead?.findUnique && customer.originLeadId) {
        originatingLead = await tx.lead.findUnique({
          where: { id: customer.originLeadId },
          select: {
            deletedAt: true,
            status: true,
            phone: true,
            email: true,
            assignedToId: true,
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
              },
            },
          },
        });
        if (originatingLead?.deletedAt)
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
      // A purchase survives expiry/cancellation; registration and pending checkout
      // timestamps are not purchases. createdAt is saved at captured-payment confirmation.
      const latestPurchase = subscriptions
        .filter(subscription => subscription.checkout?.status === "PAID")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const currentSub = active || pendingActivation;
      const subStatus = active
        ? "ACTIVE"
        : pendingActivation
          ? "PENDING_ACTIVATION"
          : "INACTIVE";

      const assignedEmployee = originatingLead?.assignedTo
        ? [originatingLead.assignedTo.firstName, originatingLead.assignedTo.lastName].filter(Boolean).join(" ")
        : "Unassigned";

      return {
        ...customer,
        // The list and details API share the persisted customer primary key.
        // Display codes never act as identifiers or encode an originating lead.
        id: customer.id,
        customerId: `CUST-${String(customer.id).padStart(4, '0')}`,
        customerCode: `CUST-${String(customer.id).padStart(4, '0')}`,
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
        leadId: customer.originLeadId ? String(customer.originLeadId) : '',
        subscriptionStatus: subStatus,
        hasUpcomingCall: false,
        planName: currentSub?.plan.name,
        subscriptionStartDate: currentSub?.startDate,
        subscriptionEndDate: currentSub?.endDate,
        activationDate: currentSub?.activationDate || currentSub?.startDate,
        purchaseDate: latestPurchase?.createdAt ?? null,
        assignedToId: originatingLead?.assignedToId ?? null,
        assignedEmployee,
        assignedEmployeeCode: originatingLead?.assignedTo?.employeeCode,
        leadStatus: originatingLead?.status ?? null,
        leadStageName: originatingLead?.status === "WON" ? "Won" : (originatingLead?.status || null),
        phone: customer.phone || originatingLead?.phone || null,
        email: customer.email || originatingLead?.email || null,
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

  async getAssignedTeam(customerId: number, actor: any) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, assignedTeamId: true },
    });
    if (!customer) throw new NotFoundException('Customer account not found');
    if (!customer.assignedTeamId) {
      return {
        id: customer.id,
        customerId: customer.id,
        assignedTeamId: null,
        team: null,
        assignedTeam: null,
      };
    }
    const team = await this.prisma.team.findUnique({
      where: { id: customer.assignedTeamId },
      include: {
        leader: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, employeeCode: true },
        },
        members: {
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, email: true, phone: true, employeeCode: true },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    return {
      id: customer.id,
      customerId: customer.id,
      assignedTeamId: customer.assignedTeamId,
      team,
      assignedTeam: team,
    };
  }

  // Called only by customer-locked writers; calendar reads never generate work.
  private async ensurePurchasedSchedules(tx: Prisma.TransactionClient, customerId: number) {
    if (typeof (tx as any)?.customer?.findFirst !== 'function') return;
    const customer = await tx.customer.findFirst({
      where: { id: customerId, deletedAt: null, lead: { deletedAt: null },
        assignedTeam: { isActive: true } },
    });
    if (!customer) {
      const current = await tx.customer.findUnique({
        where: { id: customerId },
        select: { deletedAt: true, assignedTeamId: true, originLeadId: true },
      });
      this.logger.warn(
        `[CAL_TRACE] ensurePurchasedSchedules skipped customer=${customerId} reason=no_active_team_or_deleted ` +
        `assignedTeamId=${current?.assignedTeamId ?? null} deleted=${Boolean(current?.deletedAt)} originLeadId=${current?.originLeadId ?? null}`,
      );
      return;
    }
    const subscriptions = await tx.customerSubscription.findMany({
      where: { customerId, status: { in: ["ACTIVE", "PENDING_ACTIVATION"] },
        endDate: { gt: new Date() }, checkout: { status: "PAID" } },
      include: { plan: true },
    });
    this.logger.log(
      `[CAL_TRACE] ensurePurchasedSchedules customer=${customerId} team=${customer.assignedTeamId} eligibleSubscriptions=${subscriptions.length}`,
    );
    for (const sub of subscriptions) {
      // Generation is atomic. Once present, retain its original plan dates and history.
      if (await tx.work.count({ where: { subscriptionId: sub.id } })) {
        this.logger.log(`[CAL_TRACE] work already generated customer=${customerId} subscription=${sub.id}`);
        continue;
      }
      const activities = generateAllPlanWorkflowActivities(
        sub.activationDate ?? sub.startDate, sub.endDate,
        extractDeliverableQuotas(sub.plan.features),
      );
      await tx.work.createMany({
        skipDuplicates: true,
        data: activities.map(activity => ({
          customerId, subscriptionId: sub.id,
          activityKey: JSON.stringify([activity.serviceName, activity.itemNumber, activity.activityType, activity.stepOrder]),
          planId: sub.planId, companyId: customer.crmCompanyId,
          title: activity.title, description: activity.description, workType: activity.workType,
          scheduledDate: activity.scheduledDate, scheduledTime: activity.scheduledTime,
          status: "SCHEDULED",
          // Team visibility uses Customer.assignedTeamId; no individual is invented.
        })),
      });
      this.logger.log(
        `[CAL_TRACE] work generated customer=${customerId} subscription=${sub.id} plan=${sub.planId} team=${customer.assignedTeamId} activities=${activities.length}`,
      );
    }
  }

  async assignTeam(customerId: number, teamId: number | null, actor: any) {
    if (!isUserAdmin(actor)) throw new ForbiddenException("Administrator required");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${customerId} FOR UPDATE`;
      const customer = await tx.customer.findFirst({
        where: { id: customerId, deletedAt: null }, select: { id: true },
      });
      if (!customer) throw new NotFoundException("Customer account not found");
      if (teamId !== null) {
        const team = await tx.team.findFirst({ where: { id: teamId, isActive: true }, select: { id: true } });
        if (!team) throw new NotFoundException("Active team not found");
      }
      // Assign customer access only. Existing Work and WorkTask assignees are untouched.
      const updated = await (tx.customer as any).update({
        where: { id: customerId },
        data: { assignedTeamId: teamId },
        select: {
          id: true,
          assignedTeamId: true,
          assignedTeam: {
            select: {
              id: true,
              name: true,
              isActive: true,
              leader: {
                select: { id: true, firstName: true, lastName: true },
              },
              members: {
                include: {
                  employee: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                },
              },
            },
          },
        },
      });
      await this.ensurePurchasedSchedules(tx, customerId);
      return {
        ...updated,
        team: updated.assignedTeam,
      };
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
      if (current.status === "PAID") {
        await this.ensurePurchasedSchedules(tx, current.customerId);
        return tx.customerSubscription.findUnique({ where: { checkoutId: current.id } });
      }
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
      await this.ensurePurchasedSchedules(tx, current.customerId);
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
          await this.ensurePurchasedSchedules(tx, sub.customerId);
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
