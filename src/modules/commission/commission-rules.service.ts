import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

const effective = (date: Date) => [
  { OR: [{ startsAt: null }, { startsAt: { lte: date } }] },
  { OR: [{ endsAt: null }, { endsAt: { gte: date } }] },
];
export function fullSaleCommission(
  amount: number | string | Prisma.Decimal,
  rate: number | string | Prisma.Decimal,
) {
  return new Prisma.Decimal(amount)
    .mul(rate)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

@Injectable()
export class CommissionRulesService {
  constructor(private readonly prisma: PrismaService) {}
  private tenant(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new BadRequestException("Select a valid tenant.");
  }
  async roles(customerId: number, db: Prisma.TransactionClient = this.prisma) {
    this.tenant(customerId);
    return db.role.findMany({
      where: { customerId, deletedAt: null },
      select: { id: true, name: true, designationId: true },
      orderBy: { name: "asc" },
    });
  }
  async resolveRole(employee: any, db: Prisma.TransactionClient = this.prisma) {
    this.tenant(employee.customerId);
    // A designation's linked managed role is the business role, ahead of generic account roles.
    const designated = employee.designationId
      ? await db.role.findFirst({
          where: {
            designationId: employee.designationId,
            customerId: employee.customerId,
            deletedAt: null,
          },
        })
      : null;
    if (designated) return designated;
    if (!employee.userId)
      throw new BadRequestException(
        "Employee has no assigned commission role.",
      );
    const roles = await db.role.findMany({
      where: {
        customerId: employee.customerId,
        deletedAt: null,
        userRoles: { some: { userId: employee.userId } },
      },
    });
    if (roles.length !== 1)
      throw new BadRequestException(
        "COMMISSION_ROLE_UNRESOLVED: assign one eligible employee role or a designation-linked role.",
      );
    return roles[0];
  }
  async applicable(
    customerId: number,
    roleId: number,
    at: Date,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    this.tenant(customerId);
    if (!Number.isSafeInteger(roleId) || roleId <= 0 || !Number.isFinite(+at))
      throw new BadRequestException("Invalid role or calculation date.");
    const configs = await db.commissionConfig.findMany({
      where: {
        customerId,
        roleId,
        role: { deletedAt: null, customerId },
        status: "ACTIVE",
        AND: effective(at),
      },
      include: {
        slabs: {
          where: { isActive: true, AND: effective(at) },
          orderBy: [{ displayOrder: "asc" }, { minAmount: "asc" }],
        },
        role: { select: { id: true, name: true } },
      },
    });
    if (configs.length > 1)
      throw new ConflictException(
        "Multiple active commission configurations match this role and date.",
      );
    return configs[0] || null;
  }
  async select(
    customerId: number,
    roleId: number,
    amount: number,
    at: Date,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(+at))
      throw new BadRequestException("Invalid sale amount or calculation date.");
    const configuration = await this.applicable(customerId, roleId, at, db);
    const matches =
      configuration?.slabs.filter(
        (s) =>
          new Prisma.Decimal(amount).gte(s.minAmount) &&
          (s.maxAmount === null || new Prisma.Decimal(amount).lte(s.maxAmount)),
      ) || [];
    if (!configuration || matches.length === 0)
      throw new BadRequestException(
        "COMMISSION_SLAB_MISSING: no active slab for this employee role, tenant, amount and payment date.",
      );
    if (matches.length !== 1)
      throw new ConflictException(
        "Overlapping commission slabs require administrator correction.",
      );
    const slab = matches[0];
    const total = fullSaleCommission(amount, slab.ratePercent);
    // The existing engine and report calculator allocate to one employee; do not invent a TL split.
    return {
      configuration,
      slab,
      saleAmount: amount,
      total,
      employeeAmount: total,
      leaderAmount: 0,
      allocationPolicy: "EXISTING_SINGLE_RECIPIENT",
    };
  }
  async list(customerId: number) {
    this.tenant(customerId);
    return this.prisma.commissionConfig.findMany({
      where: { customerId, roleId: { not: null } },
      include: {
        role: { select: { id: true, name: true } },
        slabs: { orderBy: [{ displayOrder: "asc" }, { minAmount: "asc" }] },
      },
      orderBy: { createdAt: "desc" },
    });
  }
  private date(value: unknown, label: string): Date | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || !Number.isFinite(+new Date(value)))
      throw new BadRequestException(`Invalid ${label}.`);
    const date = new Date(value);
    if (label === "end date" && value.length === 10)
      date.setUTCHours(23, 59, 59, 999);
    return date;
  }
  private money(
    value: unknown,
    label: string,
    max = Number.MAX_SAFE_INTEGER / 100,
  ) {
    if (value === "" || value === null || typeof value === "boolean")
      throw new BadRequestException(`${label} is required.`);
    const n = Number(value);
    if (
      !Number.isFinite(n) ||
      n < 0 ||
      n > max ||
      new Prisma.Decimal(String(value)).decimalPlaces() > 2
    )
      throw new BadRequestException(
        `${label} must be nonnegative with at most two decimal places${max === 100 ? " and at most 100%" : ""}.`,
      );
    return n;
  }
  async save(customerId: number, actorId: number, body: any, id?: number) {
    this.tenant(customerId);
    const roleId = Number(body.roleId);
    if (
      !Number.isSafeInteger(roleId) ||
      roleId <= 0 ||
      typeof body.name !== "string" ||
      !body.name.trim()
    )
      throw new BadRequestException(
        "Configuration name and role are required.",
      );
    if (
      !["ACTIVE", "INACTIVE"].includes(body.status) ||
      body.calculationBasis !== "FULL_PAYMENT_AMOUNT"
    )
      throw new BadRequestException("Invalid status or calculation basis.");
    const startsAt = this.date(body.startsAt, "start date"),
      endsAt = this.date(body.endsAt, "end date");
    if (!startsAt || (endsAt && endsAt < startsAt))
      throw new BadRequestException(
        "Valid effective start/end dates are required.",
      );
    if (
      !Array.isArray(body.slabs) ||
      !body.slabs.length ||
      body.slabs.length > 100
    )
      throw new BadRequestException("Provide between 1 and 100 slabs.");
    const slabs = body.slabs.map((s: any, index: number) => {
      if (
        typeof s.name !== "string" ||
        !s.name.trim() ||
        typeof s.isActive !== "boolean"
      )
        throw new BadRequestException(
          "Each slab needs a name and active status.",
        );
      const minAmount = this.money(s.minAmount, "Minimum sale"),
        maxAmount =
          s.maxAmount === null || s.maxAmount === ""
            ? null
            : this.money(s.maxAmount, "Maximum sale");
      if (maxAmount !== null && minAmount > maxAmount)
        throw new BadRequestException("Minimum sale exceeds maximum sale.");
      return {
        id: s.id == null ? undefined : Number(s.id),
        name: s.name.trim(),
        minAmount,
        maxAmount,
        ratePercent: this.money(s.ratePercent, "Commission percentage", 100),
        isActive: s.isActive,
        displayOrder: index,
      };
    });
    const slabIds = slabs.filter((s) => s.id !== undefined).map((s) => s.id);
    if (
      slabIds.some((s) => !Number.isSafeInteger(s) || s <= 0) ||
      new Set(slabIds).size !== slabIds.length
    )
      throw new BadRequestException(
        "Slab identifiers must be valid and unique.",
      );
    const sorted = slabs
      .filter((s) => s.isActive)
      .sort((a, b) => a.minAmount - b.minAmount);
    if (body.status === "ACTIVE" && !sorted.length)
      throw new BadRequestException(
        "An active configuration needs an active slab.",
      );
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      if (
        previous.maxAmount === null ||
        sorted[i].minAmount <= previous.maxAmount
      )
        throw new ConflictException("Active sale ranges overlap.");
      if (
        new Prisma.Decimal(sorted[i].minAmount)
          .minus(previous.maxAmount)
          .gt("0.01") &&
        body.allowGaps !== true
      )
        throw new BadRequestException(
          "Ranges have a gap. Use previous maximum + ₹0.01, or explicitly allow gaps.",
        );
    }
    return this.prisma.$transaction(async (tx) => {
      // Serialize all configuration writes for the tenant, including changes of role.
      // PostgreSQL returns void here; execute without deserializing a result row.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(27114, ${customerId}::int)`;
      const role = await tx.role.findFirst({ where: { id: roleId, customerId, deletedAt: null } });
      if (!role) throw new BadRequestException('Role does not belong to this tenant.');
      const current = id ? await tx.commissionConfig.findFirst({ where: { id, customerId, roleId: { not: null } }, include: { slabs: true } }) : null;
      if (id && !current) throw new NotFoundException('Commission configuration not found.');
      if (body.status === 'ACTIVE') {
        const conflicts = await tx.commissionConfig.findMany({
          where: {
            customerId,
            roleId,
            status: 'ACTIVE',
            ...(id ? { id: { not: id } } : {}),
            AND: [
              { OR: [{ endsAt: null }, { endsAt: { gte: startsAt } }] },
              ...(endsAt ? [{ OR: [{ startsAt: null }, { startsAt: { lte: endsAt } }] }] : []),
            ],
          },
          select: { id: true, name: true, startsAt: true, endsAt: true },
        });
        if (conflicts.length) {
          const descriptions = conflicts.map((conflict: any) => {
            const start = conflict.startsAt ? new Date(conflict.startsAt).toISOString().slice(0, 10) : 'unbounded';
            const end = conflict.endsAt ? new Date(conflict.endsAt).toISOString().slice(0, 10) : 'no end date';
            return `#${conflict.id} (${conflict.name}, ${start} to ${end}; edit with PATCH /commissions/configs/rules/${conflict.id})`;
          }).join(', ');
          throw new ConflictException(
            `An active configuration already covers this role and effective period: ${descriptions}. Edit an existing rule or choose a non-overlapping period.`,
          );
        }
      }
      const history = Array.isArray(current?.history)
        ? [...current.history]
        : [];
      if (current)
        history.push(
          JSON.parse(
            JSON.stringify({
              ...current,
              history: undefined,
              changedAt: new Date(),
              changedById: actorId,
            }),
          ),
        );
      const data = {
        roleId,
        name: body.name.trim(),
        description:
          typeof body.description === "string" ? body.description.trim() : "",
        calculationBasis: "FULL_PAYMENT_AMOUNT",
        status: body.status,
        startsAt,
        endsAt,
        history: history as Prisma.InputJsonValue,
      };
      const config = current
        ? await tx.commissionConfig.update({ where: { id }, data })
        : await tx.commissionConfig.create({
            data: { ...data, customerId, createdById: actorId },
          });
      const savedSlabIds: number[] = [];
      for (const slab of slabs) {
        const { id: slabId, ...values } = slab;
        if (slabId && !current?.slabs.some((s) => s.id === slabId))
          throw new BadRequestException(
            "Slab is not part of this configuration.",
          );
        if (slabId) {
          await tx.commissionSlab.update({
            where: { id: slabId },
            data: { ...values, roles: [roleId] },
          });
          savedSlabIds.push(slabId);
        } else {
          const created = await tx.commissionSlab.create({
            data: {
              ...values,
              customerId,
              configurationId: config.id,
              roles: [roleId],
            },
          });
          savedSlabIds.push(created.id);
        }
      }
      // Removed slabs are deactivated, never deleted; snapshot history is retained.
      if (current)
        await tx.commissionSlab.updateMany({
          where: { configurationId: id, id: { notIn: savedSlabIds } },
          data: { isActive: false },
        });
      return config;
    });
  }
}
