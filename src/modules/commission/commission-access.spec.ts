import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { CommissionController } from "./commission.controller";
import { MobileCommissionController } from "./mobile-commission.controller";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CustomerGuard } from "../../common/guards/customer.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { PERMISSIONS_KEY } from "../../common/decorators/permissions.decorator";

describe("Commission endpoint access contracts", () => {
  it("protects administration and configuration writes with existing guards and permissions", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CommissionController)).toEqual([
      JwtAuthGuard,
      CustomerGuard,
      PermissionsGuard,
    ]);
    for (const method of ["createConfiguration", "updateConfiguration"])
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          CommissionController.prototype[method],
        ),
      ).toEqual([{ module: "COMMISSION", action: "MANAGE" }]);
    for (const method of ["roles", "configurations", "preview"])
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          CommissionController.prototype[method],
        ),
      ).toEqual([{ module: "COMMISSION", action: "VIEW" }]);
  });
  it("takes tenant and audit actor from authenticated arguments, not submitted fields", async () => {
    const rules = { save: jest.fn() };
    const controller = new CommissionController(
      {} as any,
      {} as any,
      rules as any,
    );
    const body = { customerId: 999, createdById: 999, roleId: 11 };
    await controller.createConfiguration("2", { id: 7 }, body);
    expect(rules.save).toHaveBeenCalledWith(2, 7, body);
  });
  it("keeps mobile identity guarded and separate from caller-supplied filter IDs", async () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MobileCommissionController),
    ).toEqual([JwtAuthGuard, CustomerGuard]);
    const wallet = { transactions: jest.fn(), rules: jest.fn() };
    const controller = new MobileCommissionController(wallet as any);
    await controller.transactions("2", "7", {
      employeeId: 999,
      customerId: 999,
      roleId: 999,
    });
    await controller.rules("2", "7");
    expect(wallet.transactions).toHaveBeenCalledWith(2, 7, expect.any(Object));
    expect(wallet.rules).toHaveBeenCalledWith(2, 7);
  });
});
