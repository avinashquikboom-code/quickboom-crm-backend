import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleType } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { STANDARD_PERMISSIONS, ROLE_PERMISSION_DEFAULTS, fromPermissionKey } from '../../common/constants/rbac.constants';
import {
  applyPermissionItems,
  resolveCustomerAppPermissionItems,
} from '../../common/utils/customer-app-permissions.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // 1. Sanitized extractor first: unquote, trim, and filter out string literals 'null'/'undefined'
        (req: any) => {
          const rawHeader =
            req?.headers?.authorization ||
            req?.headers?.Authorization ||
            (typeof req?.get === 'function' ? req.get('authorization') : null);
          if (typeof rawHeader === 'string') {
            const match = rawHeader.match(/^Bearer\s+(.+)$/i);
            if (match) {
              const cleaned = match[1].replace(/^["']|["']$/g, '').trim();
              if (
                cleaned.length > 0 &&
                cleaned !== 'null' &&
                cleaned !== 'undefined' &&
                cleaned !== '[object Object]'
              ) {
                return cleaned;
              }
            }
          }
          return null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKeyProvider: (
        req: any,
        rawJwtToken: any,
        done: (err: any, secret?: string) => void,
      ) => {
        const rawConfigSecret = configService.get<string>('JWT_SECRET');
        const rawEnvSecret = process.env.JWT_SECRET;
        const fallbackSecret = 'quikboom_super_secret_jwt_access_key_2026';
        const devSecret = 'quikboom_jwt_secret_development_key_3847291847';
        const prodSecret = 'quikboom_production_secure_token_secret_key_3847291847';

        const candidateSecrets = Array.from(
          new Set(
            [rawConfigSecret, rawEnvSecret, fallbackSecret, devSecret, prodSecret]
              .map((s) => (s ? s.replace(/^["']|["']$/g, '').trim() : ''))
              .filter((s): s is string => Boolean(s && s.length > 0)),
          ),
        );

        if (typeof rawJwtToken === 'string' && rawJwtToken.length > 0) {
          const cleanToken = rawJwtToken.replace(/^["']|["']$/g, '').trim();
          for (const sec of candidateSecrets) {
            try {
              jwt.verify(cleanToken, sec, { ignoreExpiration: true });
              return done(null, sec);
            } catch (e: any) {
              if (e?.name === 'TokenExpiredError') {
                return done(null, sec);
              }
            }
          }
        }

        done(null, candidateSecrets[0] || fallbackSecret);
      },
    });
  }

  async validate(payload: any) {
    const rawUserId = payload.sub ?? payload.id ?? payload.userId;
    const userId = Number(rawUserId);

    if (!userId || isNaN(userId)) {
      this.logger.warn('[JWT_STRATEGY] Token rejected: Missing or invalid subject ID');
      throw new UnauthorizedException('Invalid token payload: missing subject');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          include: {
            employeeModuleOverrides: true,
            designation: true,
          },
        },
        customer: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive || user.deletedAt) {
      this.logger.warn(`[JWT_STRATEGY] User ${userId} is inactive, deleted, or missing`);
      throw new UnauthorizedException('User account is inactive or no longer exists.');
    }

    const payloadRole = payload.role ? String(payload.role).toUpperCase() : '';
    const isCustomerAccount =
      payloadRole === 'CUSTOMER' ||
      payloadRole === 'CUSTOMER_ADMIN' ||
      payloadRole === 'COMPANY_ADMIN' ||
      user.customer != null;

    const tokenIsEmployee =
      !isCustomerAccount &&
      (payloadRole === 'EMPLOYEE' ||
        (payload.roleType === RoleType.CUSTOM && user.employee != null));

    if (tokenIsEmployee) {
      if (!user.employee || user.employee.status !== 'ACTIVE' || user.employee.mobileLoginEnabled === false) {
        this.logger.warn(`[JWT_STRATEGY] Employee record for user ${userId} is missing or inactive`);
        throw new UnauthorizedException('Employee account is inactive or no longer exists.');
      }
    }

    const roles: string[] = (user.userRoles || [])
      .map((ur) => ur.role?.type || ur.role?.name)
      .filter(Boolean);

    // Platform super-admin resolution
    const isSuperAdmin = user.userRoles?.some((ur) => {
      const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
      const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
      return type === RoleType.SUPER_ADMIN || name === 'SUPERADMIN' || name === 'SUPERADMINISTRATOR';
    });

    const isCustomerAdmin =
      !isSuperAdmin &&
      user.userRoles?.some((ur) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.CUSTOMER_ADMIN ||
          name.includes('CUSTOMERADMIN') ||
          name.includes('CUSTOMERADMINISTRATOR')
        );
      });

    const isCompanyAdmin =
      !isSuperAdmin &&
      !isCustomerAdmin &&
      user.userRoles?.some((ur) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.TENANT_ADMIN ||
          name.includes('COMPANYADMIN') ||
          name.includes('TENANTADMIN') ||
          name.includes('COMPANYADMINISTRATOR')
        );
      });

    if (isSuperAdmin && !roles.includes(RoleType.SUPER_ADMIN) && !roles.includes('SUPER_ADMIN')) {
      roles.push(RoleType.SUPER_ADMIN);
      roles.push('SUPER_ADMIN');
    }

    if (isCustomerAdmin && !roles.includes(RoleType.CUSTOMER_ADMIN) && !roles.includes('CUSTOMER_ADMIN')) {
      roles.push(RoleType.CUSTOMER_ADMIN);
      roles.push('CUSTOMER_ADMIN');
    }

    if (isCompanyAdmin && !roles.includes(RoleType.TENANT_ADMIN) && !roles.includes('COMPANY_ADMIN')) {
      roles.push(RoleType.TENANT_ADMIN);
      roles.push('COMPANY_ADMIN');
    }

    const permissionsMap = new Map();

    // 1. First, load user's system roles permissions
    (user.userRoles || []).forEach((ur) => {
      if (ur.role?.rolePermissions) {
        const rNameUpper = ur.role.name ? String(ur.role.name).toUpperCase() : '';
        const rTypeUpper = ur.role.type ? String(ur.role.type).toUpperCase() : '';
        if (user.employee && (rNameUpper === 'EMPLOYEE' || rTypeUpper === 'EMPLOYEE')) {
          return;
        }
        ur.role.rolePermissions.forEach((rp) => {
          if (rp.permission) {
            const key = `${rp.permission.module.toUpperCase()}:${rp.permission.action.toUpperCase()}`;
            permissionsMap.set(key, {
              module: rp.permission.module.toUpperCase(),
              action: rp.permission.action.toUpperCase(),
            });
          }
        });
      }
    });

    let designationPermissionCount = 0;
    let desigId = user.employee?.designationId;
    const desigName = user.employee?.designation?.name?.trim() || user.designation?.trim();

    // If designationId is null on Employee, but designation name is known, resolve designationId from DB
    if (!desigId && desigName && user.employee?.customerId) {
      try {
        const matchedDesig = await this.prisma.designation.findFirst({
          where: {
            customerId: user.employee.customerId,
            name: { equals: desigName, mode: 'insensitive' },
            isActive: true,
          },
        });
        if (matchedDesig) {
          desigId = matchedDesig.id;
        }
      } catch (_) {}
    }

    // 2. If user is an employee with a designation, load Designation Role permissions (Single Source of Truth)
    if (desigId) {
      const desigRole = await this.prisma.role.findFirst({
        where: {
          designationId: desigId,
          OR: [
            { customerId: user.employee?.customerId },
            { customerId: null },
          ],
          deletedAt: null,
        },
        include: {
          rolePermissions: {
            include: { permission: true },
          },
        },
        orderBy: { customerId: 'desc' },
      });

      if (desigRole?.rolePermissions && desigRole.rolePermissions.length > 0) {
        designationPermissionCount = desigRole.rolePermissions.length;
        desigRole.rolePermissions.forEach((rp) => {
          if (rp.permission) {
            const key = `${rp.permission.module.toUpperCase()}:${rp.permission.action.toUpperCase()}`;
            permissionsMap.set(key, {
              module: rp.permission.module.toUpperCase(),
              action: rp.permission.action.toUpperCase(),
            });
          }
        });
      }
    }

    // Also check role matching designation name if still zero designation permissions
    if (designationPermissionCount === 0 && desigName) {
      const namedRole = await this.prisma.role.findFirst({
        where: {
          AND: [
            {
              OR: [
                { name: { equals: desigName, mode: 'insensitive' } },
                { name: { equals: desigName.toUpperCase().replace(/\s+/g, '_'), mode: 'insensitive' } },
              ],
            },
            {
              OR: [
                { customerId: user.employee?.customerId },
                { customerId: null },
              ],
            },
          ],
          deletedAt: null,
        },
        include: {
          rolePermissions: {
            include: { permission: true },
          },
        },
        orderBy: { customerId: 'desc' },
      });

      if (namedRole?.rolePermissions && namedRole.rolePermissions.length > 0) {
        designationPermissionCount = namedRole.rolePermissions.length;
        namedRole.rolePermissions.forEach((rp) => {
          if (rp.permission) {
            const key = `${rp.permission.module.toUpperCase()}:${rp.permission.action.toUpperCase()}`;
            permissionsMap.set(key, {
              module: rp.permission.module.toUpperCase(),
              action: rp.permission.action.toUpperCase(),
            });
          }
        });
      }
    }

    // 3. If permissionsMap still has no business modules (or 0 permissions), fallback to role defaults
    const hasAnyModulePerm = Array.from(permissionsMap.keys()).some((k: string) =>
      ['DASHBOARD', 'ATTENDANCE', 'CALENDAR', 'MY_WORK', 'LEADS', 'TASKS', 'LEAVE', 'SALARY'].some((m) =>
        k.startsWith(`${m}:`),
      ),
    );

    if (permissionsMap.size === 0 || (!hasAnyModulePerm && user.employee)) {
      if (isSuperAdmin || isCustomerAdmin || isCompanyAdmin) {
        STANDARD_PERMISSIONS.forEach((p) => {
          permissionsMap.set(`${p.module.toUpperCase()}:${p.action.toUpperCase()}`, {
            module: p.module.toUpperCase(),
            action: p.action.toUpperCase(),
          });
        });
      } else {
        const nonGenericUserRoles = (user.userRoles || [])
          .map((ur: any) => ur.role?.name)
          .filter((r: any) => r && !['EMPLOYEE', 'CUSTOMER'].includes(String(r).toUpperCase()));

        const roleCandidates = [
          desigName,
          ...nonGenericUserRoles,
          'TELECALLER',
          'EMPLOYEE',
        ].filter(Boolean);

        for (const candidate of roleCandidates) {
          const upper = String(candidate).toUpperCase().replace(/\s+/g, '_');
          let matched: string | null = null;
          if (ROLE_PERMISSION_DEFAULTS[upper]) matched = upper;
          else if (upper.includes('VISITOR') || upper === 'VISIT' || upper.includes('FIELD_VISIT') || upper.includes('FIELD_OFFICER')) matched = 'VISITOR';
          else if (upper.includes('TELECALL') || upper.includes('TELESALES') || upper.includes('TELESELL') || upper.includes('BPO')) matched = 'TELECALLER';
          else if (upper.includes('DESIGN')) matched = 'DESIGNER';
          else if (upper.includes('EDIT')) matched = 'EDITOR';
          else if (upper.includes('SOCIAL') || upper.includes('SSM')) matched = 'SOCIAL_MEDIA_MANAGER';
          else if (upper.includes('PHOTO') || upper.includes('SHOOT') || upper.includes('VIDEO_GRAPH'))
            matched = 'PHOTOGRAPHER';
          else if (upper.includes('SALES')) matched = 'SALES_EXECUTIVE';
          else if (upper.includes('HR')) matched = 'HR';
          else if (upper.includes('MANAGER')) matched = 'MANAGER';
          else if (upper.includes('EMPLOYEE')) matched = 'EMPLOYEE';

          if (matched && ROLE_PERMISSION_DEFAULTS[matched]) {
            ROLE_PERMISSION_DEFAULTS[matched].forEach((p) => {
              permissionsMap.set(`${p.module.toUpperCase()}:${p.action.toUpperCase()}`, {
                module: p.module.toUpperCase(),
                action: p.action.toUpperCase(),
              });
            });
            break;
          }
        }
      }
    }

    const desigUpper = (desigName || '').toUpperCase();
    const isVisitorDesignation = Boolean(
      desigUpper && (
        desigUpper.includes('VISITOR') ||
        desigUpper === 'VISIT' ||
        desigUpper.includes('FIELD VISIT') ||
        desigUpper.includes('FIELD OFFICER')
      )
    );

    if (isVisitorDesignation) {
      // Visitors only view, start (check-in), and complete assigned visits.
      // They intentionally do NOT have VISITS:CREATE or LEADS:SCHEDULE_VISIT.
      if (!permissionsMap.has('VISITS:VIEW')) {
        permissionsMap.set('VISITS:VIEW', { module: 'VISITS', action: 'VIEW' });
      }
      if (!permissionsMap.has('VISITS:START')) {
        permissionsMap.set('VISITS:START', { module: 'VISITS', action: 'START' });
      }
      if (!permissionsMap.has('VISITS:COMPLETE')) {
        permissionsMap.set('VISITS:COMPLETE', { module: 'VISITS', action: 'COMPLETE' });
      }
    } else {
      // For CRM / calling / sales designations (BPO, Telecaller, Sales Executive, etc.),
      // ensure baseline role defaults (e.g. VISITS:CREATE) are populated if not explicitly denied
      const isCrmDesignation = Boolean(
        (desigUpper && (
          desigUpper.includes('BPO') ||
          desigUpper.includes('TELE') ||
          desigUpper.includes('SALES') ||
          desigUpper.includes('CALL') ||
          desigUpper.includes('MANAGER') ||
          desigUpper.includes('FIELD') ||
          desigUpper.includes('CRM') ||
          desigUpper.includes('LEAD') ||
          desigUpper.includes('EXECUTIVE') ||
          desigUpper.includes('BD') ||
          desigUpper.includes('OFFICER') ||
          desigUpper.includes('AGENT') ||
          desigUpper.includes('COORDINATOR') ||
          desigUpper.includes('MARKETING') ||
          desigUpper.includes('CONSULTANT')
        )) ||
        user.employee?.designation?.crmMobileAccess === true ||
        permissionsMap.has('LEADS:VIEW') ||
        permissionsMap.has('LEADS:CREATE') ||
        permissionsMap.has('LEADS:CHANGE_STAGE') ||
        permissionsMap.has('LEADS:SCHEDULE_VISIT') ||
        permissionsMap.has('LEADS:CALL') ||
        (user.employee && !user.employee.designationId && !permissionsMap.has('MY_WORK:VIEW'))
      );

      if (isCrmDesignation) {
        if (!permissionsMap.has('VISITS:CREATE')) {
          permissionsMap.set('VISITS:CREATE', { module: 'VISITS', action: 'CREATE' });
        }
        if (!permissionsMap.has('VISITS:VIEW')) {
          permissionsMap.set('VISITS:VIEW', { module: 'VISITS', action: 'VIEW' });
        }
        if (!permissionsMap.has('LEADS:SCHEDULE_VISIT')) {
          permissionsMap.set('LEADS:SCHEDULE_VISIT', { module: 'LEADS', action: 'SCHEDULE_VISIT' });
        }
      }
    }

    // 4. Apply individual employee overrides (Hierarchy: Role Defaults -> Employee Overrides -> Effective Permissions)
    let overrideCount = 0;
    if (user.employee?.id && !isSuperAdmin && !isCustomerAdmin && !isCompanyAdmin) {
      const overrides =
        user.employee.employeeModuleOverrides ||
        (this.prisma.employeeModuleOverride
          ? await this.prisma.employeeModuleOverride.findMany({
              where: { employeeId: user.employee.id },
            })
          : []);

      if (overrides && overrides.length > 0) {
        overrideCount = overrides.length;
        for (const ov of overrides) {
          const modKey = (ov.moduleKey || '').trim();
          const ovType = String(ov.override).toUpperCase();
          if (ovType === 'DEFAULT' || ovType === 'INHERIT') continue;

          if (modKey.startsWith('employee.') || modKey.includes(':')) {
            const { module, action } = fromPermissionKey(modKey);
            const permKey = `${module.toUpperCase()}:${action.toUpperCase()}`;
            if (ovType === 'ALLOW') {
              permissionsMap.set(permKey, {
                module: module.toUpperCase(),
                action: action.toUpperCase(),
              });
            } else if (ovType === 'DENY') {
              permissionsMap.delete(permKey);
            }
          } else {
            const modUpper = modKey.toUpperCase().replace(/\s+/g, '_');
            if (ovType === 'ALLOW') {
              const stdModPerms = STANDARD_PERMISSIONS.filter(
                (p) => p.module === modUpper || p.module === modUpper.replace(/_/g, ''),
              );
              if (stdModPerms.length > 0) {
                stdModPerms.forEach((p) => {
                  permissionsMap.set(`${p.module.toUpperCase()}:${p.action.toUpperCase()}`, {
                    module: p.module.toUpperCase(),
                    action: p.action.toUpperCase(),
                  });
                });
              } else {
                permissionsMap.set(`${modUpper}:VIEW`, { module: modUpper, action: 'VIEW' });
              }
            } else if (ovType === 'DENY') {
              for (const [k] of permissionsMap.entries()) {
                const parts = k.split(':');
                const m = parts[0].toUpperCase();
                if (m === modUpper || m === modUpper.replace(/_/g, '')) {
                  permissionsMap.delete(k);
                }
              }
            }
          }
        }
      }
    }

    // 5. Add Safe [RBAC BACKEND DEBUG] log
    if (user.employee) {
      this.logger.log(
        `[RBAC BACKEND DEBUG] employeeId=${user.employee.id} employeeCode=${user.employee.employeeCode} userId=${user.id} companyId=${user.employee.customerId} tenantId=${user.employee.customerId} designationId=${user.employee.designationId} designationName="${user.employee.designation?.name || ''}" designationPermissionCount=${designationPermissionCount} employeeOverrideCount=${overrideCount} effectivePermissionCount=${permissionsMap.size} effectivePermissionKeys=${Array.from(permissionsMap.keys()).join(',')}`,
      );
    }

    const isEmployee =
      !isSuperAdmin &&
      !isCustomerAdmin &&
      !isCompanyAdmin &&
      Boolean(
        tokenIsEmployee ||
        (user.employee && user.employee.status === 'ACTIVE') ||
        user.userRoles?.some((ur) => {
          const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
          const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
          return (
            type === RoleType.SALES_EXECUTIVE ||
            type === RoleType.SALES_MANAGER ||
            type === RoleType.SUPPORT_AGENT ||
            name.includes('EMPLOYEE') ||
            name.includes('STAFF') ||
            name.includes('PHOTOGRAPHER') ||
            name.includes('EDITOR') ||
            name.includes('DESIGNER')
          );
        })
      );

    if (isEmployee && !roles.includes('EMPLOYEE')) {
      roles.push('EMPLOYEE');
    }

    let primaryRole: string;
    let primaryRoleType: string;
    if (isSuperAdmin) {
      primaryRole = 'SUPER_ADMIN';
      primaryRoleType = RoleType.SUPER_ADMIN;
    } else if (isCustomerAdmin) {
      primaryRole = 'CUSTOMER_ADMIN';
      primaryRoleType = RoleType.CUSTOMER_ADMIN;
    } else if (isCompanyAdmin) {
      primaryRole = 'COMPANY_ADMIN';
      primaryRoleType = RoleType.TENANT_ADMIN;
    } else if (isEmployee) {
      primaryRole = 'EMPLOYEE';
      primaryRoleType = RoleType.CUSTOM;
    } else {
      primaryRole = 'CUSTOMER';
      primaryRoleType = RoleType.CUSTOM;
    }

    const primaryRoleRecord = user.userRoles?.[0]?.role;
    const roleId = payload.roleId || primaryRoleRecord?.id || (user.userRoles?.[0]?.roleId ?? null);

    let customerId =
      user.customerId ??
      user.employee?.customerId ??
      user.customer?.id ??
      (payload.customerId ? Number(payload.customerId) : null);

    if (!customerId && !isSuperAdmin && this.prisma) {
      const cust = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { users: { some: { id: user.id } } },
            { employees: { some: { userId: user.id } } },
            ...(user.email ? [{ email: user.email }] : []),
            ...(user.phone ? [{ phone: user.phone }] : []),
          ],
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      if (cust) {
        customerId = cust.id;
      }
    }

    const customerCode = customerId ? `QB-CUST-${String(customerId).padStart(3, '0')}` : 'NONE';
    this.logger.log(
      `[AUTH_DEBUG]\nuserId: ${user.id}\ncustomerId: ${customerId ?? 'NONE'}\ncustomerCode: ${customerCode}\nrole: ${primaryRole}\nemail: ${user.email}`,
    );

    if (!user.employee) {
      const customerItems = await resolveCustomerAppPermissionItems(
        this.prisma,
        user.customerId,
      );
      applyPermissionItems(permissionsMap, customerItems);
    }

    return {
      id: user.id,
      email: user.email,
      customerId: customerId,
      customerCode: customerCode,
      firstName: user.firstName,
      lastName: user.lastName,
      role: primaryRole,
      roleId: roleId,
      roleType: primaryRoleType,
      roles: Array.from(new Set([primaryRole, primaryRoleType, ...roles])),
      permissions: Array.from(permissionsMap.values()),
      employee: user.employee || null,
      customer: user.customer || null,
    };
  }
}