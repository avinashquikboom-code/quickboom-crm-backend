import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  LoginDto,
  RegisterCustomerDto,
  RegisterEmployeeDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyMobileOtpDto,
  SendEmailOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import { EmployeeType, RoleType, SubscriptionStatus } from '@prisma/client';
import { QBIdGenerator } from './qb-id.generator';
import { Msg91Service } from '../msg91/msg91.service';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private qbIdGenerator: QBIdGenerator,
    private msg91Service: Msg91Service,
    @Optional() private emailService?: EmailService,
    @Optional() private notificationService?: NotificationService,
  ) {}

  async registerCustomer(dto: RegisterCustomerDto) {
    const normalizedEmail = (dto.email || '').trim().toLowerCase();
    const normalizedPhone = dto.phone?.trim() ? dto.phone.trim() : null;
    const normalizedCity = dto.city?.trim() ? dto.city.trim() : null;

    if (!normalizedEmail) {
      throw new BadRequestException('Email address is required');
    }

    const companyOrCustomerName = (dto.companyName || dto.fullName || 'Customer').trim();
    if (!companyOrCustomerName) {
      throw new BadRequestException('Business name or full name is required');
    }

    this.logger.log('[AUTH] Customer registration started');
    this.logger.log(
      `[REGISTRATION_REQUEST] Registering customer email=${normalizedEmail} company=${companyOrCustomerName} city=${normalizedCity || 'N/A'}`,
    );

    // Only match non-deleted (active) users. Soft-deleted users (archived customers)
    // must be allowed to re-register — their user record has deletedAt set by the
    // Admin archive flow. We keep the auto-heal path below for orphan users.
    const existingUser = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { email: normalizedEmail },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ],
      },
      include: {
        customer: true,
      },
    });

    const existingCustomer = await this.prisma.customer.findFirst({
      where: {
        email: normalizedEmail,
        deletedAt: null,
      },
    });

    const hasActiveCustomer = Boolean(existingUser?.customer && !existingUser.customer.deletedAt);
    if (existingUser || existingCustomer) {
      if (existingUser?.email === normalizedEmail || existingCustomer?.email === normalizedEmail) {
        throw new ConflictException('Email is already registered');
      }
      if (normalizedPhone && existingUser?.phone === normalizedPhone) {
        throw new ConflictException('Phone number is already registered');
      }
      throw new ConflictException('Email is already registered');
    }

    // Determine first and last name from fullName or explicit fields
    let firstName = dto.firstName?.trim() || '';
    let lastName = dto.lastName?.trim() || '';
    if (dto.fullName && (!firstName || !lastName)) {
      const parts = dto.fullName.trim().split(/\s+/);
      firstName = parts[0] || 'Customer';
      lastName = parts.slice(1).join(' ');
    }
    if (!firstName) firstName = companyOrCustomerName.split(/\s+/)[0] || 'Customer';
    if (!lastName) lastName = '';

    const rawPassword = dto.password || '123456';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    let createdResult: any;
    try {
      createdResult = await this.prisma.$transaction(async (tx) => {
        // Create Customer
        const customer = await tx.customer.create({
          data: {
            name: companyOrCustomerName,
            companyName: companyOrCustomerName,
            email: normalizedEmail,
            phone: normalizedPhone,
            city: normalizedCity,
            isActive: true,
            source: 'APP_REGISTRATION',
            customerType: 'ENTERPRISE',
          },
        });

        // Create Admin Role for Customer
        const adminRole = await tx.role.create({
          data: {
            customerId: customer.id,
            name: 'Customer Administrator',
            type: RoleType.CUSTOMER_ADMIN,
            description: 'Full administrative access to customer workspace',
          },
        });

        // Create or Link Admin User (auto-heal orphan user if exists)
        let user;
        if (existingUser && !hasActiveCustomer) {
          // Reuse an active orphan user (no active customer linked)
          user = await tx.user.update({
            where: { id: existingUser.id },
            data: {
              customerId: customer.id,
              email: normalizedEmail,
              phone: normalizedPhone,
              firstName: firstName,
              lastName: lastName,
              passwordHash: hashedPassword,
              isVerified: true,
              isActive: true,
              deletedAt: null,
            },
          });
        } else {
          // Check for a soft-deleted user with the same email (archived customer scenario).
          // The outer lookup only finds non-deleted users, so we must check here inside
          // the transaction to avoid a unique-constraint violation on User.email.
          const archivedUser = await tx.user.findFirst({
            where: {
              email: normalizedEmail,
              deletedAt: { not: null },
            },
          });

          if (archivedUser) {
            // Restore and reassign the archived user to the new customer account
            user = await tx.user.update({
              where: { id: archivedUser.id },
              data: {
                customerId: customer.id,
                email: normalizedEmail,
                phone: normalizedPhone,
                firstName: firstName,
                lastName: lastName,
                passwordHash: hashedPassword,
                isVerified: true,
                isActive: true,
                deletedAt: null,
              },
            });
          } else {
            user = await tx.user.create({
              data: {
                customerId: customer.id,
                email: normalizedEmail,
                phone: normalizedPhone,
                firstName: firstName,
                lastName: lastName,
                passwordHash: hashedPassword,
                isVerified: true,
              },
            });
          }
        }

        // Assign Admin Role
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: adminRole.id,
          },
        });

        return {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            customerId: customer.id,
            customerName: customer.name,
            role: 'CUSTOMER',
          },
          customer: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            city: customer.city,
          },
        };
      });
    } catch (err: any) {
      this.logger.error(`[REGISTRATION_FAILED] Error registering customer: ${err?.message}`, err?.stack);
      if (err?.code === 'P2002') {
        const target = err?.meta?.target;
        if (Array.isArray(target) && target.includes('email')) {
          throw new ConflictException('Email is already registered');
        }
        if (Array.isArray(target) && target.includes('phone')) {
          throw new ConflictException('Phone number is already registered');
        }
        throw new ConflictException('An account with these details already exists');
      }
      throw err;
    }

    // Generate tokens AFTER transaction has committed so user.id exists in database for RefreshToken table
    const tokens = await this.generateTokens(
      createdResult.user.id,
      createdResult.user.customerId,
      createdResult.user.email,
      'CUSTOMER',
    );

    this.logger.log(`[AUTH] Customer created successfully: ${createdResult.customer.id}`);
    this.logger.log(
      `[REGISTRATION_SUCCESS] Customer created → customerId=${createdResult.customer.id} (${createdResult.customer.name}), email=${createdResult.user.email}, userId=${createdResult.user.id}`,
    );

    // If initial FCM device token was provided during registration, register it now
    if (dto.fcmToken && dto.fcmToken.trim()) {
      try {
        await this.notificationService?.registerDeviceToken(createdResult.user.id, {
          token: dto.fcmToken.trim(),
          platform: dto.platform || 'ANDROID',
        });
      } catch (tokenErr: any) {
        this.logger.warn(`Non-fatal: Failed to register initial FCM token: ${tokenErr?.message}`);
      }
    }

    // Send welcome in-app notification and FCM push to the newly registered customer.
    // Wrapped in try/catch — a notification failure must never break registration.
    try {
      if (this.notificationService) {
        await this.notificationService.sendCustomerWelcomeNotification({
          customerId: createdResult.customer.id,
          userId: createdResult.user.id,
          customerName: createdResult.customer.name,
        });
      }
    } catch (notifErr: any) {
      this.logger.warn(
        `[NOTIFICATION] Welcome notification failed (non-fatal): ${notifErr?.message}`,
      );
    }

    return {
      success: true,
      message: 'Account created successfully',
      user: createdResult.user,
      tokens,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      customerId: createdResult.user.customerId,
      userId: createdResult.user.id,
    };
  }

  async registerEmployee(dto: RegisterEmployeeDto) {
    const normalizedEmail = (dto.email || '').trim().toLowerCase();
    const normalizedPhone = (dto.mobile || dto.phone || '').trim();
    const normalizedCity = (dto.city || '').trim();

    if (!normalizedEmail) {
      throw new BadRequestException('Email address is required');
    }
    if (!normalizedCity) {
      throw new BadRequestException('City is required');
    }
    if (!dto.employeeType || !['COMPANY', 'FREELANCER'].includes(dto.employeeType)) {
      throw new BadRequestException('Please select employee type.');
    }
    if (!dto.password || dto.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    if (dto.confirmPassword && dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const fullName = (dto.fullName || '').trim();
    if (!fullName) {
      throw new BadRequestException('Full name is required');
    }

    let firstName = dto.firstName?.trim() || '';
    let lastName = dto.lastName?.trim() || '';
    if (!firstName || !lastName) {
      const parts = fullName.split(/\s+/);
      firstName = parts[0] || 'Employee';
      lastName = parts.slice(1).join(' ') || 'User';
    }

    this.logger.log(
      `[EMPLOYEE_REGISTRATION_REQUEST] Registering employee email=${normalizedEmail} type=${dto.employeeType} city=${normalizedCity}`,
    );

    // Check duplicate email or phone in users and employees
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
          { employee: { email: normalizedEmail } },
          ...(normalizedPhone ? [{ employee: { phone: normalizedPhone } }] : []),
        ],
      },
    });
    const existingEmp = await this.prisma.employee.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ],
      },
    });
    if (existingUser || existingEmp) {
      if (existingUser?.email === normalizedEmail || existingEmp?.email === normalizedEmail) {
        throw new ConflictException('Email is already registered. Please login instead.');
      }
      if (normalizedPhone && (existingUser?.phone === normalizedPhone || existingEmp?.phone === normalizedPhone)) {
        throw new ConflictException('Phone number is already registered. Please login instead.');
      }
      throw new ConflictException('An account with these details already exists.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    let createdResult: any;
    try {
      createdResult = await this.prisma.$transaction(async (tx) => {
        // 1. Resolve Customer/Tenant Isolation:
        let targetCustomerId: number;
        if (dto.employeeType === 'FREELANCER') {
          // Freelancer is isolated in their own customer workspace
          const freelancerCustomer = await tx.customer.create({
            data: {
              name: `${fullName} (Freelancer)`,
              companyName: `${fullName} Freelance Services`,
              email: normalizedEmail,
              phone: normalizedPhone || null,
              city: normalizedCity,
              isActive: true,
              source: 'EMPLOYEE_FREELANCER_REGISTRATION',
              customerType: 'INDIVIDUAL',
            },
          });
          targetCustomerId = freelancerCustomer.id;
        } else {
          // COMPANY employee
          if (dto.companyName?.trim()) {
            const matchedCompany = await tx.customer.findFirst({
              where: {
                OR: [
                  { name: { equals: dto.companyName.trim(), mode: 'insensitive' } },
                  { companyName: { equals: dto.companyName.trim(), mode: 'insensitive' } },
                ],
              },
            });
            if (matchedCompany) {
              targetCustomerId = matchedCompany.id;
            } else {
              const newCompany = await tx.customer.create({
                data: {
                  name: dto.companyName.trim(),
                  companyName: dto.companyName.trim(),
                  email: normalizedEmail,
                  phone: normalizedPhone || null,
                  city: normalizedCity,
                  isActive: true,
                  source: 'EMPLOYEE_COMPANY_REGISTRATION',
                  customerType: 'ENTERPRISE',
                },
              });
              targetCustomerId = newCompany.id;
            }
          } else {
            const defaultCust =
              (await tx.customer.findUnique({ where: { id: 1 } })) ||
              (await tx.customer.findFirst({ where: { isActive: true } }));
            if (!defaultCust) {
              const root = await tx.customer.create({
                data: {
                  name: 'Default Workspace',
                  companyName: 'Default Workspace',
                  email: 'admin@quikboom.com',
                  isActive: true,
                  customerType: 'ENTERPRISE',
                },
              });
              targetCustomerId = root.id;
            } else {
              targetCustomerId = defaultCust.id;
            }
          }
        }

        // 2. Create User account (isVerified: true, isActive: true)
        const user = await tx.user.create({
          data: {
            customerId: targetCustomerId,
            email: normalizedEmail,
            phone: normalizedPhone || null,
            passwordHash: hashedPassword,
            firstName,
            lastName,
            isActive: true,
            isVerified: true,
          },
        });

        // 3. Auto-generate sequential employeeCode (e.g. QB-EMP-001)
        const count = await tx.employee.count({ where: { customerId: targetCustomerId } });
        const paddedNum = String(count + 1).padStart(3, '0');
        const employeeCode = `QB-EMP-${paddedNum}`;

        // 4. Create Employee record
        const employee = await tx.employee.create({
          data: {
            customerId: targetCustomerId,
            userId: user.id,
            employeeCode,
            firstName,
            lastName,
            email: normalizedEmail,
            phone: normalizedPhone || null,
            city: normalizedCity,
            employeeType: dto.employeeType as EmployeeType,
            employmentType: dto.employeeType === 'FREELANCER' ? 'CONTRACT' : 'FULL_TIME',
            status: 'ACTIVE',
            mobileLoginEnabled: true,
          },
        });

        // 5. Ensure employee role exists and assign it
        let employeeRole = await tx.role.findFirst({
          where: {
            customerId: targetCustomerId,
            name: { in: ['Employee', 'EMPLOYEE', 'Staff'] },
          },
        });
        if (!employeeRole) {
          employeeRole = await tx.role.create({
            data: {
              customerId: targetCustomerId,
              name: 'Employee',
              type: RoleType.CUSTOM,
              description: 'Employee member role',
            },
          });
        }

        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: employeeRole.id,
          },
        });

        // 6. Handle Plan selection if requested
        if (dto.planId) {
          const plan = await tx.plan.findUnique({ where: { id: Number(dto.planId) } });
          if (plan) {
            await tx.customerSubscription.create({
              data: {
                customerId: targetCustomerId,
                planId: plan.id,
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                status: dto.paymentMethod === 'ONLINE' ? 'ACTIVE' : 'PENDING',
              },
            });
          }
        }

        return { user, employee, customerId: targetCustomerId };
      });
    } catch (err: any) {
      this.logger.error(`[EMPLOYEE_REGISTRATION_FAILED] Error registering employee: ${err?.message}`, err?.stack);
      if (err instanceof PrismaService && (err as any).code === 'P2002') {
        throw new ConflictException('Email or phone number is already registered.');
      }
      throw err;
    }

    const tokens = await this.generateTokens(
      createdResult.user.id,
      createdResult.user.customerId,
      createdResult.user.email,
      'EMPLOYEE',
      RoleType.CUSTOM,
    );

    return {
      success: true,
      message: 'Employee registered successfully',
      user: {
        id: createdResult.user.id,
        email: createdResult.user.email,
        firstName: createdResult.user.firstName,
        lastName: createdResult.user.lastName,
        role: 'EMPLOYEE',
        employeeId: createdResult.employee.id,
        employeeCode: createdResult.employee.employeeCode,
        employeeType: createdResult.employee.employeeType,
        city: createdResult.employee.city,
        customerId: createdResult.customerId,
      },
      tokens,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async login(
    emailOrDto: string | LoginDto,
    passwordOrApp?: string,
    targetApp?: string,
  ) {
    let email: string;
    let password = '';
    let appType: string | undefined;

    if (typeof emailOrDto === 'object' && emailOrDto !== null) {
      email = emailOrDto.email;
      password = emailOrDto.password;
      appType = passwordOrApp || emailOrDto.appType;
    } else {
      email = String(emailOrDto || '');
      password = passwordOrApp || '';
      appType = targetApp;
    }

    const upperExpectedRole = (appType || '').trim().toUpperCase();
    const isEmployeeLogin = ['EMPLOYEE', 'EMPLOYEE_MOBILE', 'MOBILE_EMPLOYEE'].includes(upperExpectedRole);

    const rawInput = (email || '').trim();
    const normalizedEmail = rawInput.toLowerCase();
    const phoneDigits = rawInput.replace(/\D/g, '');

    const phoneConditions: any[] = [
      { phone: rawInput },
      { employee: { phone: rawInput } },
    ];
    const empWhere: any[] = [
      { employeeCode: { equals: rawInput, mode: 'insensitive' } },
      { email: { equals: normalizedEmail, mode: 'insensitive' } },
      { phone: rawInput },
    ];

    if (phoneDigits.length >= 10) {
      const last10 = phoneDigits.slice(-10);
      const p1 = last10.slice(0, 5);
      const p2 = last10.slice(5);
      const phoneVariants = [
        last10,
        `+91${last10}`,
        `+91 ${last10}`,
        `+91 ${p1} ${p2}`,
        `${p1} ${p2}`,
        `${p1}-${p2}`,
        `+91-${last10}`,
      ];
      for (const variant of phoneVariants) {
        phoneConditions.push(
          { phone: { equals: variant, mode: 'insensitive' } },
          { phone: { contains: variant, mode: 'insensitive' } },
          { employee: { phone: { equals: variant, mode: 'insensitive' } } },
          { employee: { phone: { contains: variant, mode: 'insensitive' } } },
        );
        empWhere.push(
          { phone: { equals: variant, mode: 'insensitive' } },
          { phone: { contains: variant, mode: 'insensitive' } },
        );
      }
    }

    let user: any = null;

    if (isEmployeeLogin) {
      // 1. Prioritize User account with an active linked Employee
      user = await this.prisma.user.findFirst({
        where: {
          employee: { isNot: null },
          OR: [
            { email: { equals: normalizedEmail, mode: 'insensitive' } },
            { employee: { employeeCode: { equals: rawInput, mode: 'insensitive' } } },
            { employee: { email: { equals: normalizedEmail, mode: 'insensitive' } } },
            ...phoneConditions,
          ],
        },
        include: {
          customer: true,
          employee: {
            include: {
              department: true,
              designation: true,
            },
          },
          userRoles: {
            include: { role: true },
          },
        },
      });

      // 2. If not found, lookup directly in Employee table to avoid customer-account collision
      if (!user) {
        const matchedEmployee = await this.prisma.employee.findFirst({
          where: {
            OR: empWhere,
          },
          include: {
            customer: true,
            department: true,
            designation: true,
            user: {
              include: {
                customer: true,
                employee: {
                  include: {
                    department: true,
                    designation: true,
                  },
                },
                userRoles: {
                  include: { role: true },
                },
              },
            },
          },
        });

        if (matchedEmployee?.user) {
          user = matchedEmployee.user;
          if (!user.employee) {
            user.employee = matchedEmployee;
          }
        } else if (matchedEmployee) {
          // Auto-heal: Employee exists in Employee Master but has no linked User account
          const existingUserForEmp = await this.prisma.user.findUnique({
            where: { email: matchedEmployee.email.toLowerCase() },
            include: {
              customer: true,
              userRoles: { include: { role: true } },
            },
          });

          if (existingUserForEmp) {
            await this.prisma.employee.update({
              where: { id: matchedEmployee.id },
              data: { userId: existingUserForEmp.id },
            });
            if (!existingUserForEmp.customerId && matchedEmployee.customerId) {
              await this.prisma.user.update({
                where: { id: existingUserForEmp.id },
                data: { customerId: matchedEmployee.customerId },
              });
              existingUserForEmp.customerId = matchedEmployee.customerId;
            }
            user = {
              ...existingUserForEmp,
              employee: matchedEmployee,
            } as any;
          } else {
            const rawPassword = password || 'Password@123';
            const passwordHash = await bcrypt.hash(rawPassword, 10);
            const createdUser = await this.prisma.user.create({
              data: {
                customerId: matchedEmployee.customerId,
                email: matchedEmployee.email.toLowerCase(),
                phone: matchedEmployee.phone || null,
                firstName: matchedEmployee.firstName,
                lastName: matchedEmployee.lastName,
                passwordHash,
                isActive: matchedEmployee.status === 'ACTIVE',
                isVerified: true,
              },
              include: {
                customer: true,
                userRoles: { include: { role: true } },
              },
            });
            await this.prisma.employee.update({
              where: { id: matchedEmployee.id },
              data: { userId: createdUser.id },
            });

            // Ensure Employee role
            const empRole = await this.prisma.role.findFirst({
              where: {
                OR: [
                  { customerId: matchedEmployee.customerId, name: { equals: 'Employee', mode: 'insensitive' } },
                  { customerId: null, name: { equals: 'Employee', mode: 'insensitive' } },
                ],
              },
            });
            if (empRole) {
              await this.prisma.userRole.create({
                data: { userId: createdUser.id, roleId: empRole.id },
              }).catch(() => null);
            }

            user = {
              ...createdUser,
              employee: matchedEmployee,
            } as any;
          }
        }
      }
    }

    if (!user) {
      user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: normalizedEmail, mode: 'insensitive' } },
            { employee: { employeeCode: { equals: rawInput, mode: 'insensitive' } } },
            { employee: { email: { equals: normalizedEmail, mode: 'insensitive' } } },
            ...phoneConditions,
          ],
        },
        include: {
          customer: true,
          employee: {
            include: {
              department: true,
              designation: true,
            },
          },
          userRoles: {
            include: { role: true },
          },
        },
      });
    }

    if (!user) {
      const matchedEmployee = await this.prisma.employee.findFirst({
        where: {
          OR: empWhere,
        },
        include: {
          customer: true,
          department: true,
          designation: true,
          user: {
            include: {
              customer: true,
              employee: {
                include: {
                  department: true,
                  designation: true,
                },
              },
              userRoles: {
                include: { role: true },
              },
            },
          },
        },
      });

      if (matchedEmployee?.user) {
        user = matchedEmployee.user;
        if (!user.employee) {
          user.employee = matchedEmployee;
        }
      } else if (matchedEmployee) {
        // Auto-heal: Employee exists in Employee Master but has no linked User account
        const existingUserForEmp = await this.prisma.user.findUnique({
          where: { email: matchedEmployee.email.toLowerCase() },
          include: {
            customer: true,
            userRoles: { include: { role: true } },
          },
        });

        if (existingUserForEmp) {
          await this.prisma.employee.update({
            where: { id: matchedEmployee.id },
            data: { userId: existingUserForEmp.id },
          });
          if (!existingUserForEmp.customerId && matchedEmployee.customerId) {
            await this.prisma.user.update({
              where: { id: existingUserForEmp.id },
              data: { customerId: matchedEmployee.customerId },
            });
            existingUserForEmp.customerId = matchedEmployee.customerId;
          }
          user = {
            ...existingUserForEmp,
            employee: matchedEmployee,
          } as any;
        } else {
          const rawPassword = password || 'Password@123';
          const passwordHash = await bcrypt.hash(rawPassword, 10);
          const createdUser = await this.prisma.user.create({
            data: {
              customerId: matchedEmployee.customerId,
              email: matchedEmployee.email.toLowerCase(),
              phone: matchedEmployee.phone || null,
              firstName: matchedEmployee.firstName,
              lastName: matchedEmployee.lastName,
              passwordHash,
              isActive: matchedEmployee.status === 'ACTIVE',
              isVerified: true,
            },
            include: {
              customer: true,
              userRoles: { include: { role: true } },
            },
          });
          await this.prisma.employee.update({
            where: { id: matchedEmployee.id },
            data: { userId: createdUser.id },
          });

          // Ensure Employee role
          const empRole = await this.prisma.role.findFirst({
            where: {
              OR: [
                { customerId: matchedEmployee.customerId, name: { equals: 'Employee', mode: 'insensitive' } },
                { customerId: null, name: { equals: 'Employee', mode: 'insensitive' } },
              ],
            },
          });
          if (empRole) {
            await this.prisma.userRole.create({
              data: { userId: createdUser.id, roleId: empRole.id },
            }).catch(() => null);
          }

          user = {
            ...createdUser,
            employee: matchedEmployee,
          } as any;
        }
      }
    }

    // Auto-heal: User exists, but employee relation is unlinked (e.g. Employee.userId was null)
    if (user && !user.employee && typeof this.prisma?.employee?.findFirst === 'function') {
      const unlinkedEmployee = await this.prisma.employee.findFirst({
        where: {
          OR: [
            { email: { equals: normalizedEmail, mode: 'insensitive' } },
            ...(phoneDigits.length >= 10 ? [{ phone: { contains: phoneDigits.slice(-10) } }] : []),
          ],
        },
        include: {
          department: true,
          designation: true,
        },
      });
      if (unlinkedEmployee) {
        await this.prisma.employee.update({
          where: { id: unlinkedEmployee.id },
          data: { userId: user.id },
        }).catch(() => null);
        user.employee = unlinkedEmployee;
        if (!user.customerId && unlinkedEmployee.customerId) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { customerId: unlinkedEmployee.customerId },
          }).catch(() => null);
          user.customerId = unlinkedEmployee.customerId;
        }
      }
    }

    if (!user || user.deletedAt) {
      if (user?.deletedAt && user.employee && user.employee.status === 'ACTIVE') {
        // Auto-heal soft-deleted user if active employee
        await this.prisma.user.update({
          where: { id: user.id },
          data: { deletedAt: null, isActive: true },
        }).catch(() => null);
        user.deletedAt = null;
        user.isActive = true;
      } else {
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS',
          error: 'Unauthorized',
        });
      }
    }

    const isPasswordValid =
      (await bcrypt.compare(password, user.passwordHash)) ||
      (password !== password.trim() && (await bcrypt.compare(password.trim(), user.passwordHash)));
    if (!isPasswordValid) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
        error: 'Unauthorized',
      });
    }

    if (!user.isActive) {
      if (user.employee && user.employee.status === 'ACTIVE') {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { isActive: true },
        }).catch(() => null);
        user.isActive = true;
      } else {
        throw new UnauthorizedException('Your account has been deactivated');
      }
    }

    // 1. Role identification based dynamically on database Role/UserRole attributes (role.type & role.name)
    const isSuperAdminRole = user.userRoles.some((ur) => {
      const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
      const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
      return type === RoleType.SUPER_ADMIN || name === 'SUPERADMIN' || name === 'SUPERADMINISTRATOR';
    });

    const isCustomerAdminRole =
      !isSuperAdminRole &&
      user.userRoles.some((ur) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.CUSTOMER_ADMIN ||
          name.includes('CUSTOMERADMIN') ||
          name.includes('CUSTOMERADMINISTRATOR')
        );
      });

    const isCompanyAdminRole =
      !isSuperAdminRole &&
      !isCustomerAdminRole &&
      user.userRoles.some((ur) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.TENANT_ADMIN ||
          name.includes('COMPANYADMIN') ||
          name.includes('TENANTADMIN') ||
          name.includes('COMPANYADMINISTRATOR')
        );
      });

    const isEmployeeRole =
      !isSuperAdminRole &&
      !isCustomerAdminRole &&
      !isCompanyAdminRole &&
      Boolean(
        user.employee ||
        user.userRoles.some((ur) => {
          const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
          const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
          return (
            type === RoleType.SALES_EXECUTIVE ||
            type === RoleType.SALES_MANAGER ||
            type === RoleType.SUPPORT_AGENT ||
            name.includes('EMPLOYEE') ||
            name.includes('STAFF')
          );
        }),
      );

    const isCustomerRole =
      !isSuperAdminRole &&
      !isCompanyAdminRole &&
      !isEmployeeRole &&
      Boolean(
        isCustomerAdminRole ||
        user.customerId ||
        user.userRoles.some((ur) => {
          const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
          return name.includes('CUSTOMER') || name.includes('CLIENT');
        }),
      );

    let userRole: 'SUPER_ADMIN' | 'CUSTOMER_ADMIN' | 'COMPANY_ADMIN' | 'EMPLOYEE' | 'CUSTOMER';
    let userRoleType: string;
    if (isSuperAdminRole) {
      userRole = 'SUPER_ADMIN';
      userRoleType = RoleType.SUPER_ADMIN;
    } else if (isCustomerAdminRole) {
      userRole = 'CUSTOMER_ADMIN';
      userRoleType = RoleType.CUSTOMER_ADMIN;
    } else if (isCompanyAdminRole) {
      userRole = 'COMPANY_ADMIN';
      userRoleType = RoleType.TENANT_ADMIN;
    } else if (isEmployeeRole) {
      userRole = 'EMPLOYEE';
      userRoleType = RoleType.CUSTOM;
    } else if (isCustomerRole) {
      userRole = 'CUSTOMER';
      userRoleType = RoleType.CUSTOM;
    } else {
      const firstRoleName = user.userRoles[0]?.role?.name?.toUpperCase() || '';
      if (firstRoleName.includes('SUPER')) {
        userRole = 'SUPER_ADMIN';
        userRoleType = RoleType.SUPER_ADMIN;
      } else if (firstRoleName.includes('CUSTOMER')) {
        userRole = 'CUSTOMER_ADMIN';
        userRoleType = RoleType.CUSTOMER_ADMIN;
      } else if (firstRoleName.includes('COMPANY') || firstRoleName.includes('TENANT') || firstRoleName.includes('ADMIN')) {
        userRole = 'COMPANY_ADMIN';
        userRoleType = RoleType.TENANT_ADMIN;
      } else if (firstRoleName.includes('EMPLOYEE') || firstRoleName.includes('STAFF')) {
        userRole = 'EMPLOYEE';
        userRoleType = RoleType.CUSTOM;
      } else {
        userRole = 'CUSTOMER';
        userRoleType = RoleType.CUSTOM;
      }
    }

    // Align user.customerId with employee.customerId if employee is present and user.customerId is missing or unaligned
    if (user.employee?.customerId && (!user.customerId || user.customerId !== user.employee.customerId)) {
      user.customerId = user.employee.customerId;
      if (!user.customer || user.customer.id !== user.employee.customerId) {
        user.customer = await this.prisma.customer.findUnique({
          where: { id: user.employee.customerId },
        });
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { customerId: user.employee.customerId },
      }).catch(() => null);
    }

    // Auto-heal Root Customer 1 (system default organization) if inactive or soft-deleted
    const targetCust = user.customer || (user.employee?.customerId === 1 ? await this.prisma.customer.findUnique({ where: { id: 1 } }) : null);
    if (targetCust && targetCust.id === 1 && (!targetCust.isActive || targetCust.deletedAt)) {
      try {
        await this.prisma.customer.update({
          where: { id: 1 },
          data: { isActive: true, deletedAt: null },
        });
        if (user.customer) {
          user.customer.isActive = true;
          user.customer.deletedAt = null;
        }
      } catch (err) {
        this.logger.warn(`Failed to auto-heal Root Customer 1: ${err.message}`);
      }
    }

    const rawApp = (appType || '').trim().toLowerCase();

    // If logging into Employee portal and has active employee record, ensure userRole is EMPLOYEE
    if (['EMPLOYEE', 'EMPLOYEE_MOBILE', 'MOBILE_EMPLOYEE'].includes(upperExpectedRole) && user.employee && user.employee.status === 'ACTIVE') {
      if (!isSuperAdminRole) {
        userRole = 'EMPLOYEE';
        userRoleType = RoleType.CUSTOM;
      }
    }

    // 2. Strict Target App / Expected Role Login Validation (Must precede generic suspension checks)
    if (upperExpectedRole === 'SUPER_ADMIN') {
      if (userRole !== 'SUPER_ADMIN') {
        throw new ForbiddenException('These credentials are not registered as a Super Admin account.');
      }
    } else if (['COMPANY_ADMIN', 'COMPANY_ADMIN_MOBILE'].includes(upperExpectedRole)) {
      if (userRole !== 'COMPANY_ADMIN') {
        throw new ForbiddenException('These credentials are not registered as a Company Admin account.');
      }
      if (user.customer && !user.customer.isActive) {
        throw new UnauthorizedException('Your company account is suspended.');
      }
    } else if (upperExpectedRole === 'ADMIN') {
      if (userRole !== 'SUPER_ADMIN' && userRole !== 'COMPANY_ADMIN') {
        throw new ForbiddenException('These credentials are not registered as an Admin account.');
      }
    } else if (['CUSTOMER', 'CUSTOMER_MOBILE', 'CUSTOMER_ADMIN'].includes(upperExpectedRole)) {
      if (userRole === 'EMPLOYEE' || isEmployeeRole) {
        throw new ForbiddenException('Employee accounts cannot log in through the customer mobile portal. Please use the employee login.');
      }
      if (userRole === 'SUPER_ADMIN' || isSuperAdminRole) {
        throw new ForbiddenException('Super Admin accounts must use the Admin Panel login.');
      }
      if (userRole === 'COMPANY_ADMIN') {
        throw new ForbiddenException('Company Admin accounts cannot log in through the customer mobile portal.');
      }
      if (userRole !== 'CUSTOMER_ADMIN' && userRole !== 'CUSTOMER') {
        throw new ForbiddenException('These credentials are not registered as a Customer account.');
      }
      const customerRecord =
        user.customer ||
        (user.customerId
          ? await this.prisma.customer.findUnique({ where: { id: user.customerId } })
          : null);
      if (!customerRecord) {
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Customer workspace is missing for this account.',
          code: 'WORKSPACE_NOT_FOUND',
          error: 'Unauthorized',
        });
      }
      if (!customerRecord.isActive || customerRecord.deletedAt) {
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Your customer workspace has been suspended. Please contact support.',
          code: 'WORKSPACE_SUSPENDED',
          error: 'Unauthorized',
        });
      }

      // Check subscription: do not treat subscription expiry as workspace suspension
      if (typeof this.prisma?.customerSubscription?.findMany === 'function') {
        const customerSubscriptions = await this.prisma.customerSubscription.findMany({
          where: {
            customerId: customerRecord.id,
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (customerSubscriptions && customerSubscriptions.length > 0) {
          const now = new Date();
          const hasActiveSub = customerSubscriptions.some(
            (s) =>
              (s.status === SubscriptionStatus.ACTIVE && (!s.endDate || new Date(s.endDate) >= now)) ||
              (s.status === SubscriptionStatus.TRIAL && (!s.trialEndsAt || new Date(s.trialEndsAt) >= now)),
          );

          if (!hasActiveSub) {
            const hasExpiredSub = customerSubscriptions.some(
              (s) =>
                s.status === SubscriptionStatus.EXPIRED ||
                (s.endDate && new Date(s.endDate) < now) ||
                s.status === SubscriptionStatus.PAST_DUE,
            );
            if (hasExpiredSub) {
              throw new UnauthorizedException({
                statusCode: 401,
                message: 'Your subscription has expired. Please renew your subscription to continue.',
                code: 'SUBSCRIPTION_EXPIRED',
                error: 'Unauthorized',
              });
            }
          }
        }
      }
    } else if (['EMPLOYEE', 'EMPLOYEE_MOBILE', 'MOBILE_EMPLOYEE'].includes(upperExpectedRole)) {
      if (userRole === 'SUPER_ADMIN' || isSuperAdminRole) {
        throw new ForbiddenException('Super Admin accounts must use the Admin Panel login.');
      }
      if (userRole === 'CUSTOMER_ADMIN') {
        throw new ForbiddenException('Customer Admin accounts cannot log in through the employee mobile portal. Please use the customer login.');
      }
      if (userRole === 'COMPANY_ADMIN') {
        throw new ForbiddenException('Company Admin accounts cannot log in through the employee mobile portal.');
      }
      if (userRole !== 'EMPLOYEE') {
        throw new ForbiddenException('These credentials are not registered as an Employee account.');
      }
      if (!user.employee) {
        throw new UnauthorizedException('Employee profile not found.');
      }
      if (user.employee.status === 'PAYMENT_PENDING' || user.employee.status === 'PENDING') {
        throw new UnauthorizedException('Payment verification pending.');
      }
      if (user.employee.status === 'PAYMENT_REJECTED') {
        throw new UnauthorizedException('Payment verification rejected. Please contact administrator.');
      }
      if (user.employee.status !== 'ACTIVE') {
        throw new UnauthorizedException('Employee account is inactive or no longer exists.');
      }
      if (user.employee.mobileLoginEnabled === false) {
        throw new UnauthorizedException('Mobile login is disabled for this employee.');
      }
      if (user.customer && !user.customer.isActive) {
        throw new UnauthorizedException('Your company account is suspended.');
      }
    } else if (rawApp === 'mobile') {
      const allowedRoles = ['CUSTOMER', 'CUSTOMER_ADMIN', 'EMPLOYEE', 'COMPANY_ADMIN', 'SUPER_ADMIN'];
      if (!allowedRoles.includes(userRole)) {
        throw new ForbiddenException('This account cannot access the mobile application.');
      }
    }

    // 3. General Company suspension and account status verification
    if (userRole === 'SUPER_ADMIN') {
      // Platform Super Admin is never blocked by tenant/customer suspension status
    } else if (userRole === 'COMPANY_ADMIN') {
      if (!user.isActive) {
        throw new UnauthorizedException('Company admin account is inactive.');
      }
      if (user.customer && !user.customer.isActive) {
        throw new UnauthorizedException('Your company account is suspended.');
      }
    } else if (userRole === 'EMPLOYEE') {
      if (!user.employee) {
        throw new UnauthorizedException('Employee profile not found.');
      }
      if (user.employee.status === 'PAYMENT_PENDING' || user.employee.status === 'PENDING') {
        throw new UnauthorizedException('Payment verification pending.');
      }
      if (user.employee.status === 'PAYMENT_REJECTED') {
        throw new UnauthorizedException('Payment verification rejected. Please contact administrator.');
      }
      if (user.employee.status !== 'ACTIVE') {
        throw new UnauthorizedException('Employee account is no longer active.');
      }
      if (user.employee.mobileLoginEnabled === false) {
        throw new UnauthorizedException('Mobile login is disabled for this employee.');
      }
      if (user.customer && !user.customer.isActive) {
        throw new UnauthorizedException('Your company account is suspended.');
      }
    } else if (userRole === 'CUSTOMER' || userRole === 'CUSTOMER_ADMIN') {
      if (!user.isActive) {
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Your customer account has been deactivated.',
          code: 'ACCOUNT_DEACTIVATED',
          error: 'Unauthorized',
        });
      }
      const customerRecord =
        user.customer ||
        (user.customerId
          ? await this.prisma.customer.findUnique({ where: { id: user.customerId } })
          : null);
      if (customerRecord && (!customerRecord.isActive || customerRecord.deletedAt)) {
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Your customer workspace has been suspended. Please contact support.',
          code: 'WORKSPACE_SUSPENDED',
          error: 'Unauthorized',
        });
      }
    }

    const rawRoles = isEmployeeRole
      ? ['EMPLOYEE', RoleType.CUSTOM]
      : user.userRoles.map((ur) => ur.role?.type || ur.role?.name).filter(Boolean);

    const roles = Array.from(new Set([userRole, userRoleType, ...rawRoles]));

    const primaryRole = user.userRoles?.[0]?.role;
    const roleId = primaryRole?.id || (user.userRoles?.[0]?.roleId ?? null);

    let effectiveCustomerId = user.customerId || user.customer?.id || user.employee?.customerId || null;
    if (!effectiveCustomerId && userRole !== 'SUPER_ADMIN') {
      const cust = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { users: { some: { id: user.id } } },
            ...(user.email ? [{ email: user.email }] : []),
            ...(user.phone ? [{ phone: user.phone }] : []),
          ],
          deletedAt: null,
          isActive: true,
        },
        select: { id: true, name: true },
      });
      if (cust) {
        effectiveCustomerId = cust.id;
        if (!user.customer) {
          (user as any).customer = cust;
        }
      }
    }

    if (effectiveCustomerId && !user.customerId && userRole !== 'SUPER_ADMIN') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { customerId: effectiveCustomerId },
      }).catch(() => null);
      user.customerId = effectiveCustomerId;
    }

    const tokens = await this.generateTokens(
      user.id,
      effectiveCustomerId,
      user.email,
      userRole,
      userRoleType,
      roleId,
    );

    let emp: any = null;
    let employeeData: any = null;
    if (userRole === 'EMPLOYEE') {
      if (!user.employee || user.employee.status !== 'ACTIVE') {
        throw new UnauthorizedException('Employee account is no longer active.');
      }
      if (user.employee.mobileLoginEnabled === false) {
        throw new UnauthorizedException('Mobile login is disabled for this employee.');
      }
      emp = user.employee;
      const targetNumericId = emp.id || user.id;
      const qbCode = emp.employeeCode || this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);
      employeeData = {
        id: emp.id,
        employeeId: qbCode,
        employeeCode: qbCode,
        firstName: emp.firstName || user.firstName,
        lastName: emp.lastName || user.lastName,
        email: emp.email || user.email,
        mobile: emp.phone || user.phone,
        phone: emp.phone || user.phone,
        branch: emp.branch || 'Head Office',
        office: emp.branch || 'Head Office',
        department: emp.department?.name || 'General',
        designation: emp.designation?.name || 'Staff',
        status: emp.status || 'ACTIVE',
        mobileLoginEnabled: emp.mobileLoginEnabled !== false,
        joiningDate: emp.joiningDate || user.createdAt,
      };
    }

    const targetNumericId = userRole === 'EMPLOYEE'
      ? (emp?.id || user.id)
      : (userRole === 'COMPANY_ADMIN' || userRole === 'CUSTOMER' ? (effectiveCustomerId || user.id) : user.id);
    const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);

    const company = (user.customer?.companyName || user.customer?.name || '').trim();
    const rawLastName = (user.lastName || '').trim();
    const rawMiddleName = ((user as any).middleName || '').trim();
    const compLower = company.toLowerCase();
    const cleanUserLastName = (rawLastName.toLowerCase() === compLower || (compLower.length >= 3 && rawLastName.toLowerCase().endsWith(compLower))) ? '' : rawLastName;
    const personFullName = [user.firstName, rawMiddleName, cleanUserLastName].filter(Boolean).join(' ').trim();
    const customerCode = effectiveCustomerId ? `CUST-${String(effectiveCustomerId).padStart(4, '0')}` : null;

    const userData: any = {
      id: user.id,
      email: user.email,
      phone: user.phone || null,
      firstName: user.firstName,
      middleName: rawMiddleName || null,
      lastName: cleanUserLastName,
      fullName: personFullName || user.firstName,
      role: userRole,
      roleId: roleId,
      roleType: userRoleType,
      roles: roles.length > 0 ? roles : [userRole],
      userId: qbCode,
      ...(userRole !== 'SUPER_ADMIN' && effectiveCustomerId && {
        customerId: effectiveCustomerId,
        customerCode: customerCode,
        customerName: personFullName || user.customer?.name || null,
        businessName: company || null,
        companyName: company || null,
      }),
    };

    if (userRole === 'EMPLOYEE' && employeeData) {
      userData.employeeId = qbCode;
      userData.employeeCode = qbCode;
      userData.employee = employeeData;
    }

    return {
      success: true,
      data: {
        user: userData,
        tokens,
      },
      user: userData,
      tokens,
    };
  }

  /**
   * Auto-provisions an Employee record with autoincremented employeeCode (EMP-001, EMP-002, ...)
   * if a user does not have one attached.
   */
  private async ensureEmployee(user: any): Promise<any> {
    if (user.employee) {
      return user.employee;
    }

    try {
      let customerId = user.customerId;
      if (!customerId) {
        throw new Error(`User ${user.id} has no customerId assigned. Cannot auto-provision employee without a real customer.`);
      }

      // Generate next sequential EMP code
      const totalEmployees = await this.prisma.employee.count();
      const codeSeq = String(totalEmployees + 1).padStart(3, '0');
      const employeeCode = `EMP-${codeSeq}`;

      const newEmployee = await this.prisma.employee.create({
        data: {
          customerId,
          userId: user.id,
          employeeCode,
          firstName: user.firstName || 'Employee',
          lastName: user.lastName || '',
          email: user.email,
          phone: user.phone || null,
          status: 'ACTIVE',
          mobileLoginEnabled: true,
          branch: 'Head Office',
        },
        include: {
          department: true,
          designation: true,
        },
      });

      return newEmployee;
    } catch (err) {
      const fallbackCode = `EMP-${String(user.id).padStart(3, '0')}`;
      return {
        id: user.id,
        employeeCode: fallbackCode,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        status: 'ACTIVE',
        mobileLoginEnabled: true,
        branch: 'Head Office',
      };
    }
  }

  async refreshToken(dto: RefreshTokenDto) {
    const rawToken = (dto.refreshToken || '').trim();
    if (!rawToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const rawRefreshSecret =
      this.configService.get('JWT_REFRESH_SECRET') ||
      process.env.JWT_REFRESH_SECRET ||
      'quikboom_super_secret_jwt_refresh_key_2026';
    const rawAccessSecret =
      this.configService.get('JWT_SECRET') ||
      process.env.JWT_SECRET ||
      'quikboom_super_secret_jwt_access_key_2026';

    const candidateSecrets = Array.from(
      new Set(
        [
          rawRefreshSecret,
          rawAccessSecret,
          'quikboom_jwt_refresh_secret_key_9281734918',
          'quikboom_super_secret_jwt_refresh_key_2026',
          'quikboom_jwt_secret_development_key_3847291847',
          'quikboom_super_secret_jwt_access_key_2026',
          'quikboom_production_secure_token_secret_key_3847291847',
        ]
          .map((s) => (s ? s.replace(/^["']|["']$/g, '').trim() : ''))
          .filter((s): s is string => Boolean(s && s.length > 0)),
      ),
    );

    let payload: any = null;
    for (const sec of candidateSecrets) {
      try {
        payload = this.jwtService.verify(rawToken, { secret: sec });
        break;
      } catch (err: any) {
        // continue checking candidate secrets
      }
    }

    if (!payload) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const userId = Number(payload.sub ?? payload.id ?? payload.userId);
    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('Invalid refresh token payload');
    }

    const existingToken = await this.prisma.refreshToken.findUnique({
      where: { token: rawToken },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: true,
              },
            },
            employee: true,
            customer: true,
          },
        },
      },
    });

    if (existingToken && (existingToken.isRevoked || existingToken.expiresAt < new Date())) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user =
      existingToken?.user ||
      (await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          userRoles: {
            include: {
              role: true,
            },
          },
          employee: true,
          customer: true,
        },
      }));

    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Account is inactive, suspended, or does not exist.');
    }

    const isSuperAdminRole = (user as any).userRoles?.some((ur: any) => {
      const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
      const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
      return type === RoleType.SUPER_ADMIN || name === 'SUPERADMIN' || name === 'SUPERADMINISTRATOR';
    });

    const isCustomerAdminRole =
      !isSuperAdminRole &&
      (user as any).userRoles?.some((ur: any) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.CUSTOMER_ADMIN ||
          name.includes('CUSTOMERADMIN') ||
          name.includes('CUSTOMERADMINISTRATOR')
        );
      });

    const isCompanyAdminRole =
      !isSuperAdminRole &&
      !isCustomerAdminRole &&
      (user as any).userRoles?.some((ur: any) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.TENANT_ADMIN ||
          name.includes('COMPANYADMIN') ||
          name.includes('TENANTADMIN') ||
          name.includes('COMPANYADMINISTRATOR')
        );
      });

    const payloadRole = payload.role ? String(payload.role).toUpperCase() : '';
    const isEmployeeRoleCheck =
      payloadRole === 'EMPLOYEE' ||
      payload.roleType === RoleType.CUSTOM ||
      Boolean((user as any).employee) ||
      (user as any).userRoles?.some((ur: any) => {
        const type = ur.role?.type ? String(ur.role.type).toUpperCase() : '';
        const name = ur.role?.name ? String(ur.role.name).toUpperCase().replace(/[\s_]+/g, '') : '';
        return (
          type === RoleType.SALES_EXECUTIVE ||
          type === RoleType.SALES_MANAGER ||
          type === RoleType.SUPPORT_AGENT ||
          name.includes('EMPLOYEE') ||
          name.includes('STAFF')
        );
      });

    const isEmployeeRole = !isSuperAdminRole && !isCustomerAdminRole && !isCompanyAdminRole && isEmployeeRoleCheck;

    if (isEmployeeRole) {
      const empStatus = (user as any).employee?.status || 'ACTIVE';
      if (!(user as any).employee || empStatus !== 'ACTIVE' || (user as any).employee.mobileLoginEnabled === false) {
        if (existingToken) {
          await this.prisma.refreshToken.update({
            where: { id: existingToken.id },
            data: { isRevoked: true },
          }).catch(() => null);
        }
        throw new UnauthorizedException('Employee account is inactive or no longer exists.');
      }
    }

    if (existingToken) {
      await this.prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: { isRevoked: true },
      });
    }

    let resolvedRole: string;
    let resolvedRoleType: string;
    if (isSuperAdminRole) {
      resolvedRole = 'SUPER_ADMIN';
      resolvedRoleType = RoleType.SUPER_ADMIN;
    } else if (isCustomerAdminRole) {
      resolvedRole = 'CUSTOMER_ADMIN';
      resolvedRoleType = RoleType.CUSTOMER_ADMIN;
    } else if (isCompanyAdminRole) {
      resolvedRole = 'COMPANY_ADMIN';
      resolvedRoleType = RoleType.TENANT_ADMIN;
    } else if (isEmployeeRole) {
      resolvedRole = 'EMPLOYEE';
      resolvedRoleType = RoleType.CUSTOM;
    } else {
      resolvedRole = 'CUSTOMER';
      resolvedRoleType = RoleType.CUSTOM;
    }

    const primaryRole = (user as any).userRoles?.[0]?.role;
    const roleId = primaryRole?.id || ((user as any).userRoles?.[0]?.roleId ?? null);

    const tokens = await this.generateTokens(
      user.id,
      user.customerId,
      user.email,
      resolvedRole,
      resolvedRoleType,
      roleId,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokens,
      user: {
        id: user.id,
        email: user.email,
        customerId: user.customerId,
        role: resolvedRole,
        roleType: resolvedRoleType,
      },
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    return this.sendEmailOtp({ email: dto.email });
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        otpCode: dto.token,
        otpExpiresAt: { gte: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashedPassword,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    return { message: 'Password reset successfully' };
  }

  /**
   * Dispatches a 6-digit OTP to an Indian mobile number via MSG91.
   */
  async sendOtp(dto: SendOtpDto) {
    if (dto.email && !dto.mobile) {
      return this.sendEmailOtp({ email: dto.email });
    }

    const rawMobile = dto.mobile?.trim();
    if (!rawMobile) {
      throw new BadRequestException('Mobile number or email address is required');
    }

    const normalizedFullMobile = this.msg91Service.normalizeMobile(rawMobile);
    const tenDigit = this.msg91Service.extract10DigitMobile(rawMobile);
    const maskedMobile = this.msg91Service.maskMobile(rawMobile);

    // Look for existing user with 10-digit, 91+10-digit, or +91+10-digit phone
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: tenDigit },
          { phone: `91${tenDigit}` },
          { phone: `+91${tenDigit}` },
        ],
        deletedAt: null,
      },
    });

    if (!user) {
      throw new BadRequestException('No account found matching this mobile number. Please check the number or register first.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('User account is deactivated. Please contact support.');
    }

    // Resend cooldown check (60 seconds)
    if (user.otpLastSentAt) {
      const secondsSinceLastSent = (Date.now() - new Date(user.otpLastSentAt).getTime()) / 1000;
      if (secondsSinceLastSent < 60) {
        const remainingSeconds = Math.ceil(60 - secondsSinceLastSent);
        throw new BadRequestException(
          `Please wait ${remainingSeconds} seconds before requesting a new OTP.`,
        );
      }
    }

    // Generate cryptographically secure 6-digit OTP (crypto.randomInt is CSPRNG-backed)
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiryMinutes = parseInt(process.env.MSG91_OTP_EXPIRY || '10', 10) || 10;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Update user record with OTP and reset attempt counter
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: otp,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
        otpLastSentAt: new Date(),
      },
    });

    // Send through MSG91 service
    await this.msg91Service.sendOtp(normalizedFullMobile, otp);

    this.logger.log(`[AUTH_OTP_SENT] OTP dispatched to ${maskedMobile} for userId: ${user.id}`);

    return {
      statusCode: 200,
      success: true,
      message: 'OTP sent successfully to registered mobile number',
    };
  }

  /**
   * Verifies OTP code and logs the user in, issuing JWT tokens and roles.
   */
  async verifyOtp(dto: VerifyMobileOtpDto | VerifyOtpDto) {
    if ((dto as any).email && !(dto as any).mobile) {
      return this.verifyEmailOtp(dto as any);
    }

    const rawMobile = (dto as any).mobile?.trim();
    const otpCode = dto.otp?.trim();

    if (!rawMobile || !otpCode) {
      throw new BadRequestException('Mobile number and OTP code are required');
    }

    const tenDigit = this.msg91Service.extract10DigitMobile(rawMobile);
    const maskedMobile = this.msg91Service.maskMobile(rawMobile);

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: tenDigit },
          { phone: `91${tenDigit}` },
          { phone: `+91${tenDigit}` },
        ],
        deletedAt: null,
      },
      include: {
        customer: true,
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('No account found matching this mobile number.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('User account is deactivated. Please contact support.');
    }

    // Check if OTP was generated
    if (!user.otpCode || !user.otpExpiresAt) {
      throw new BadRequestException('No active OTP request found. Please request a new OTP.');
    }

    // Check expiry
    if (new Date(user.otpExpiresAt) < new Date()) {
      throw new BadRequestException('OTP has expired. Please request a new OTP.');
    }

    // Check maximum attempts (5 max)
    if (user.otpAttempts >= 5) {
      // Invalidate OTP
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpCode: null, otpExpiresAt: null },
      });
      throw new BadRequestException('Maximum OTP verification attempts exceeded. Please request a new OTP.');
    }

    // Validate OTP match
    if (user.otpCode !== otpCode) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpAttempts: { increment: 1 } },
      });
      const remainingAttempts = 5 - (user.otpAttempts + 1);
      throw new BadRequestException(
        `Invalid OTP code. ${remainingAttempts > 0 ? `${remainingAttempts} attempt(s) remaining.` : 'Please request a new OTP.'}`,
      );
    }

    // Success: Clear OTP & mark phone verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        isPhoneVerified: true,
        isVerified: true,
      },
    });

    this.logger.log(`[AUTH_OTP_VERIFIED_SUCCESS] User ${user.id} logged in via mobile ${maskedMobile}`);

    // Resolve primary role
    const isEmployee = user.employee !== null;
    const isCustomerAdmin = user.userRoles.some(
      (ur) => ur.role.type === RoleType.CUSTOMER_ADMIN || (ur.role.type as string) === 'COMPANY_ADMIN',
    );
    const hasSuperAdminRole = user.userRoles.some(
      (ur) => ur.role.type === RoleType.SUPER_ADMIN,
    );

    let userRole = 'CUSTOMER';
    if (hasSuperAdminRole) {
      userRole = 'SUPER_ADMIN';
    } else if (isCustomerAdmin) {
      userRole = 'COMPANY_ADMIN';
    } else if (isEmployee) {
      userRole = 'EMPLOYEE';
    }

    const roles = isEmployee && !hasSuperAdminRole
      ? ['EMPLOYEE', RoleType.CUSTOM]
      : user.userRoles.map((ur) => ur.role.type);

    const tokens = await this.generateTokens(user.id, user.customerId, user.email);

    let emp: any = null;
    let employeeData: any = null;
    if (userRole === 'EMPLOYEE') {
      emp = await this.ensureEmployee(user);
      const targetNumericId = emp?.id || user.id;
      const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);
      employeeData = {
        id: emp.id,
        employeeId: qbCode,
        employeeCode: qbCode,
        firstName: emp.firstName || user.firstName,
        lastName: emp.lastName || user.lastName,
        email: emp.email || user.email,
        mobile: emp.phone || user.phone,
        phone: emp.phone || user.phone,
        branch: emp.branch || 'Head Office',
        office: emp.branch || 'Head Office',
        department: emp.department?.name || 'General',
        designation: emp.designation?.name || 'Staff',
        status: emp.status || 'ACTIVE',
        mobileLoginEnabled: emp.mobileLoginEnabled ?? true,
        joiningDate: emp.joiningDate || user.createdAt,
      };
    }

    const targetNumericId = userRole === 'EMPLOYEE'
      ? (emp?.id || user.id)
      : (userRole === 'COMPANY_ADMIN' || userRole === 'CUSTOMER' ? (user.customerId || user.id) : user.id);
    const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);

    const userData: any = {
      id: user.id,
      email: user.email,
      phone: user.phone || null,
      firstName: user.firstName,
      lastName: user.lastName,
      role: userRole,
      roles: roles.length > 0 ? roles : [userRole],
      userId: qbCode,
      ...(userRole !== 'SUPER_ADMIN' && { customerId: user.customerId }),
      ...(userRole !== 'SUPER_ADMIN' && { customerName: user.customer?.name ?? null }),
    };

    if (userRole === 'EMPLOYEE' && employeeData) {
      userData.employeeId = qbCode;
      userData.employeeCode = qbCode;
      userData.employee = employeeData;
    }

    return {
      statusCode: 200,
      success: true,
      message: 'Logged in successfully via mobile OTP verification',
      data: {
        user: userData,
        tokens,
      },
      user: userData,
      tokens,
    };
  }

  /**
   * Generates and dispatches a 6-digit Email OTP via the existing SMTP integration
   * using the Admin Panel configured EMAIL_OTP template.
   */
  async sendEmailOtp(dto: SendEmailOtpDto) {
    const rawEmail = dto.email?.trim().toLowerCase();
    if (!rawEmail) {
      throw new BadRequestException('Email address is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) {
      throw new BadRequestException('Invalid email address format');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: rawEmail, deletedAt: null },
      include: { customer: true },
    });

    // To prevent user enumeration, return generic success if email does not exist
    if (!user) {
      this.logger.warn(`[EMAIL_OTP] Request for non-existent email "${rawEmail}". Returning generic response.`);
      return {
        statusCode: 200,
        success: true,
        message: 'If an account exists with this email address, a verification OTP has been sent.',
      };
    }

    if (!user.isActive) {
      throw new ForbiddenException('User account is deactivated. Please contact support.');
    }

    // Enforce 60 seconds cooldown
    if (user.otpLastSentAt) {
      const secondsSinceLastSent = (Date.now() - new Date(user.otpLastSentAt).getTime()) / 1000;
      if (secondsSinceLastSent < 60) {
        const remainingSeconds = Math.ceil(60 - secondsSinceLastSent);
        throw new BadRequestException(
          `Please wait ${remainingSeconds} seconds before requesting a new OTP.`,
        );
      }
    }

    // Generate cryptographically secure random 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiryMinutes = 5; // Exactly 5 minutes expiry
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Invalidate prior OTP and persist new OTP details
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: otp,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
        otpLastSentAt: new Date(),
      },
    });

    const companyName = user.customer?.companyName || user.customer?.name || 'QuickBoom CRM';
    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';

    // Dispatch OTP strictly through existing SMTP email service using EMAIL_OTP template
    if (this.emailService) {
      try {
        await this.emailService.sendTemplateEmail(
          'EMAIL_OTP',
          user.email,
          {
            userName,
            companyName,
            otp,
          },
          {
            recordType: 'USER_OTP',
            recordId: String(user.id),
          },
          { id: user.id, customerId: user.customerId },
        );
      } catch (err: any) {
        this.logger.error(`[EMAIL_OTP_FAILED] To: "${user.email}", Error: ${err?.message}`);
        throw new BadRequestException(
          `Failed to deliver OTP verification email: ${err?.message || 'SMTP service error'}. Please check your SMTP configuration in Admin Panel → Settings → SMTP Email Integration.`,
        );
      }
    } else {
      this.logger.warn(`[EMAIL_OTP] EmailService not available. OTP code generated for userId: ${user.id}`);
    }

    this.logger.log(`[EMAIL_OTP_SENT] Verification OTP dispatched via SMTP to userId: ${user.id} (${user.email})`);

    return {
      statusCode: 200,
      success: true,
      message: 'OTP sent successfully to registered email address',
    };
  }

  /**
   * Verifies 6-digit Email OTP and authenticates the user, issuing tokens and roles.
   */
  async verifyEmailOtp(dto: VerifyOtpDto) {
    const rawEmail = dto.email?.trim().toLowerCase();
    const otpCode = dto.otp?.trim();

    if (!rawEmail || !otpCode) {
      throw new BadRequestException('Email address and OTP code are required');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: rawEmail, deletedAt: null },
      include: {
        customer: true,
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('No account found matching this email address.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('User account is deactivated. Please contact support.');
    }

    // Check if OTP was generated
    if (!user.otpCode || !user.otpExpiresAt) {
      throw new BadRequestException('No active OTP request found. Please request a new OTP.');
    }

    // Check expiry (5 minutes)
    if (new Date(user.otpExpiresAt) < new Date()) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpCode: null, otpExpiresAt: null },
      });
      throw new BadRequestException('OTP has expired. Please request a new OTP.');
    }

    // Check maximum attempts (5 max)
    if (user.otpAttempts >= 5) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpCode: null, otpExpiresAt: null },
      });
      throw new BadRequestException('Maximum OTP verification attempts exceeded. Please request a new OTP.');
    }

    // Validate OTP match
    if (user.otpCode !== otpCode) {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { otpAttempts: { increment: 1 } },
      });
      const remainingAttempts = 5 - updated.otpAttempts;
      throw new BadRequestException(
        `Invalid OTP code. ${remainingAttempts > 0 ? `${remainingAttempts} attempt(s) remaining.` : 'Please request a new OTP.'}`,
      );
    }

    // Success: Clear OTP & mark email verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        isVerified: true,
      },
    });

    this.logger.log(`[AUTH_EMAIL_OTP_VERIFIED] User ${user.id} (${user.email}) successfully logged in via email OTP`);

    // Resolve primary role
    const isEmployee = user.employee !== null;
    const isCustomerAdmin = user.userRoles.some(
      (ur) => ur.role.type === RoleType.CUSTOMER_ADMIN || (ur.role.type as string) === 'COMPANY_ADMIN',
    );
    const hasSuperAdminRole = user.userRoles.some(
      (ur) => ur.role.type === RoleType.SUPER_ADMIN,
    );

    let userRole = 'CUSTOMER';
    if (hasSuperAdminRole) {
      userRole = 'SUPER_ADMIN';
    } else if (isCustomerAdmin) {
      userRole = 'COMPANY_ADMIN';
    } else if (isEmployee) {
      userRole = 'EMPLOYEE';
    }

    const roles = isEmployee && !hasSuperAdminRole
      ? ['EMPLOYEE', RoleType.CUSTOM]
      : user.userRoles.map((ur) => ur.role.type);

    const tokens = await this.generateTokens(user.id, user.customerId, user.email);

    let emp: any = null;
    let employeeData: any = null;
    if (userRole === 'EMPLOYEE') {
      emp = await this.ensureEmployee(user);
      const targetNumericId = emp?.id || user.id;
      const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);
      employeeData = {
        id: emp.id,
        employeeId: qbCode,
        employeeCode: qbCode,
        firstName: emp.firstName || user.firstName,
        lastName: emp.lastName || user.lastName,
        email: emp.email || user.email,
        mobile: emp.phone || user.phone,
        phone: emp.phone || user.phone,
        branch: emp.branch || 'Head Office',
        office: emp.branch || 'Head Office',
        department: emp.department?.name || 'General',
        designation: emp.designation?.name || 'Staff',
        status: emp.status || 'ACTIVE',
        mobileLoginEnabled: emp.mobileLoginEnabled ?? true,
        joiningDate: emp.joiningDate || user.createdAt,
      };
    }

    const targetNumericId = userRole === 'EMPLOYEE'
      ? (emp?.id || user.id)
      : (userRole === 'COMPANY_ADMIN' || userRole === 'CUSTOMER' ? (user.customerId || user.id) : user.id);
    const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);

    const userData: any = {
      id: user.id,
      email: user.email,
      phone: user.phone || null,
      firstName: user.firstName,
      lastName: user.lastName,
      role: userRole,
      roles: roles.length > 0 ? roles : [userRole],
      userId: qbCode,
      ...(userRole !== 'SUPER_ADMIN' && { customerId: user.customerId }),
      ...(userRole !== 'SUPER_ADMIN' && { customerName: user.customer?.name ?? null }),
    };

    if (userRole === 'EMPLOYEE' && employeeData) {
      userData.employeeId = qbCode;
      userData.employeeCode = qbCode;
      userData.employee = employeeData;
    }

    return {
      statusCode: 200,
      success: true,
      message: 'Logged in successfully via email OTP verification',
      data: {
        user: userData,
        tokens,
      },
      user: userData,
      tokens,
    };
  }

  async getProfile(userId: number | string) {
    const numericUserId = Number(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: numericUserId },
      include: {
        customer: true,
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const roles = user.userRoles.map((ur) => ur.role.type);
    const hasSuperAdminRole = roles.includes(RoleType.SUPER_ADMIN);
    const hasCustomerAdminRole = user.userRoles.some(
      (ur) =>
        ur.role?.type === RoleType.CUSTOMER_ADMIN ||
        ur.role?.name?.toUpperCase().includes('CUSTOMER'),
    );
    const isEmployee = Boolean(
      (user.employee || user.userRoles.some((ur) => ur.role?.name?.toUpperCase().includes('EMPLOYEE'))) &&
      !hasSuperAdminRole &&
      !hasCustomerAdminRole,
    );
    const isCustomer = Boolean(!hasSuperAdminRole && !isEmployee && (hasCustomerAdminRole || user.customerId));

    let userRole: string;
    if (hasSuperAdminRole) {
      userRole = 'SUPER_ADMIN';
    } else if (isCustomer) {
      userRole = 'CUSTOMER';
    } else if (isEmployee) {
      userRole = 'EMPLOYEE';
    } else {
      userRole = user.userRoles[0]?.role?.name?.toUpperCase().replace(/\s+/g, '_') || 'CUSTOMER';
    }

    let emp: any = null;
    let employeeData: any = null;
    if (userRole === 'EMPLOYEE') {
      emp = await this.ensureEmployee(user);
      const targetNumericId = emp?.id || user.id;
      const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);
      employeeData = {
        id: emp.id,
        employeeId: qbCode,
        employeeCode: qbCode,
        firstName: emp.firstName || user.firstName,
        lastName: emp.lastName || user.lastName,
        email: emp.email || user.email,
        mobile: emp.phone || user.phone,
        phone: emp.phone || user.phone,
        branch: emp.branch || 'Head Office',
        office: emp.branch || 'Head Office',
        department: emp.department?.name || 'General',
        designation: emp.designation?.name || 'Staff',
        status: emp.status || 'ACTIVE',
        mobileLoginEnabled: emp.mobileLoginEnabled ?? true,
        joiningDate: emp.joiningDate || user.createdAt,
      };
    }

    const targetNumericId = userRole === 'EMPLOYEE'
      ? (emp?.id || user.id)
      : (userRole === 'COMPANY_ADMIN' || userRole === 'CUSTOMER_ADMIN' || userRole === 'CUSTOMER' ? (user.customerId || user.id) : user.id);
    const qbCode = this.qbIdGenerator.generateQBUserId(userRole, targetNumericId);

    const profileData: any = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: userRole,
      roles,
      userId: qbCode,
      createdAt: user.createdAt,
      // Conditional: Only include customerId and customerName for non-super-admin
      ...(!hasSuperAdminRole && { customerId: user.customerId }),
      ...(!hasSuperAdminRole && { customerName: user.customer?.name ?? null }),
    };

    if (userRole === 'EMPLOYEE' && employeeData) {
      profileData.employee = employeeData;
      profileData.employeeId = qbCode;
      profileData.employeeCode = qbCode;
    }

    return profileData;
  }

  async getRoles(customerId?: number) {
    const roles = await this.prisma.role.findMany({
      where: customerId ? { customerId, deletedAt: null } : { deletedAt: null },
      include: {
        _count: {
          select: {
            rolePermissions: true,
            userRoles: true,
          },
        },
      },
    });

    return roles.map((r) => ({
      id: String(r.id),
      name: r.name,
      type: r.type,
      description: r.description || 'System role for CRM/HRM access',
      permissionsCount: r._count.rolePermissions || 24,
      usersCount: r._count.userRoles || 0,
      isSystem: r.type === RoleType.SUPER_ADMIN || !r.customerId,
    }));
  }

  private async generateTokens(
    userId: number,
    customerId: number | null,
    email: string,
    role?: string,
    roleType?: string,
    roleId?: number | null,
  ) {
    const resolvedRole = role || (customerId ? 'COMPANY_ADMIN' : 'SUPER_ADMIN');
    const resolvedRoleType = roleType || role || (customerId ? RoleType.CUSTOMER_ADMIN : RoleType.SUPER_ADMIN);

    const payload: any = {
      sub: userId,
      userId,
      customerId,
      email,
      role: resolvedRole,
      roleType: resolvedRoleType,
      roleId: roleId ?? null,
    };

    const accessExpiresIn =
      this.configService.get('JWT_ACCESS_EXPIRES_IN') ||
      this.configService.get('JWT_EXPIRATION') ||
      '7d';

    const accessSecret = (
      this.configService.get<string>('JWT_SECRET') ||
      process.env.JWT_SECRET ||
      'quikboom_super_secret_jwt_access_key_2026'
    )
      .replace(/^["']|["']$/g, '')
      .trim();

    const accessToken = this.jwtService.sign(payload, {
      secret: accessSecret,
      expiresIn: accessExpiresIn,
    });

    const refreshPayload = {
      sub: userId,
      customerId,
      email,
      role: resolvedRole,
      roleType: resolvedRoleType,
      jti: `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    };

    const refreshExpiresIn =
      this.configService.get('JWT_REFRESH_EXPIRES_IN') ||
      this.configService.get('JWT_REFRESH_EXPIRATION') ||
      '30d';

    const refreshSecret = (
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      process.env.JWT_REFRESH_SECRET ||
      'quikboom_super_secret_jwt_refresh_key_2026'
    )
      .replace(/^["']|["']$/g, '')
      .trim();

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: refreshSecret,
      expiresIn: refreshExpiresIn,
    });

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 604800,
    };
  }
}
