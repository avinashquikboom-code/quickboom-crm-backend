import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { WorkType } from "@prisma/client";
import { WorkService } from "./work.service";
import { CreateWorkDto } from "./dto/work.dto";

function fixture() {
  const prisma: any = {
    customer: {
      findFirst: jest.fn(async () => ({ id: 1, crmCompanyId: null })),
      findUnique: jest.fn(async () => ({ id: 1, assignedTeamId: null })),
    },
    attendancePolicy: { findFirst: jest.fn(async () => null) },
    customerSubscription: {
      findUnique: jest.fn(async () => ({
        id: 9,
        customerId: 1,
        status: "ACTIVE",
        endDate: new Date("2099-01-01"),
      })),
      findFirst: jest.fn(async () => null),
    },
    planEntitlement: {
      findFirst: jest.fn(async () => ({
        id: 5,
        planId: 2,
        totalQty: 3,
        usedQty: 0,
        scheduledQty: 0,
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(),
    },
    workTask: { createMany: jest.fn(async () => ({ count: 3 })) },
    work: { create: jest.fn(async ({ data }) => ({ id: 10, ...data })) },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, service: new WorkService(prisma) };
}
const dto = {
  title: "Content",
  scheduledDate: "2026-10-26T04:30:00.000Z",
  workType: WorkType.CONTENT_WRITING,
  subscriptionId: 9,
};

describe("Work production build regressions", () => {
  it("reserves quota once and saves the validated subscription link", async () => {
    const { prisma, service } = fixture();
    const result = await service.create(1, dto);
    expect(result.subscriptionId).toBe(9);
    expect(prisma.planEntitlement.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.planEntitlement.update).not.toHaveBeenCalled();
    expect(prisma.planEntitlement.findFirst).toHaveBeenCalledWith({
      where: {
        serviceName: expect.any(String),
        works: { some: { customerId: 1 } },
      },
    });
    expect(prisma.work.create.mock.calls[0][0].data.assignedToId).toBeNull();
  });
  it("rejects subscriptions owned by another customer before creating work", async () => {
    const { prisma, service } = fixture();
    prisma.customerSubscription.findUnique.mockResolvedValue({
      id: 9,
      customerId: 2,
      status: "ACTIVE",
      endDate: new Date("2099-01-01"),
    });
    await expect(service.create(1, dto)).rejects.toThrow(
      "Active subscription for this customer required",
    );
    expect(prisma.work.create).not.toHaveBeenCalled();
  });
  it("rejects expired subscriptions even if their status still says active", async () => {
    const { prisma, service } = fixture();
    prisma.customerSubscription.findUnique.mockResolvedValue({
      id: 9,
      customerId: 1,
      status: "ACTIVE",
      endDate: new Date("2000-01-01"),
    });
    await expect(service.create(1, dto)).rejects.toThrow(
      "Active subscription for this customer required",
    );
  });
  it("rejects exhausted entitlements instead of reserving quota", async () => {
    const { prisma, service } = fixture();
    prisma.planEntitlement.findFirst.mockResolvedValue({
      id: 5,
      planId: 2,
      totalQty: 3,
      usedQty: 3,
      scheduledQty: 0,
    });
    await expect(service.create(1, dto)).rejects.toThrow(
      "Work quota exhausted",
    );
    expect(prisma.work.create).not.toHaveBeenCalled();
  });
  it("documents and validates a positive subscription ID", async () => {
    const good = plainToInstance(CreateWorkDto, {
      ...dto,
      subscriptionId: "9",
    });
    expect(good.subscriptionId).toBe(9);
    expect(await validate(good)).toHaveLength(0);
    const bad = plainToInstance(CreateWorkDto, { ...dto, subscriptionId: -1 });
    expect(
      (await validate(bad)).some(
        (error) => error.property === "subscriptionId",
      ),
    ).toBe(true);
  });
});
