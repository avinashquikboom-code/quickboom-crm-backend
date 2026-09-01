import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOfficeDto, UpdateOfficeDto } from './dto/office.dto';

@Injectable()
export class OfficeService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCustomerId(customerId?: number | string): Promise<number> {
    if (customerId !== undefined && customerId !== null) {
      const num = Number(customerId);
      if (!isNaN(num) && num > 0) return num;
    }
    const firstCust = await this.prisma.customer.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    return firstCust ? firstCust.id : 1;
  }

  async findAll(
    customerId?: number | string,
    query?: { search?: string; isActive?: boolean; status?: string; page?: number; limit?: number },
  ) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? query.limit : 100;
    const skip = (page - 1) * limit;

    const where: any = {
      customerId: numCustomerId,
    };

    if (query?.isActive !== undefined) {
      where.isActive = query.isActive;
    } else if (query?.status) {
      const st = query.status.toUpperCase();
      if (st === 'ACTIVE') where.isActive = true;
      else if (st === 'INACTIVE') where.isActive = false;
    }

    if (query?.search && query.search.trim().length > 0) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s, mode: 'insensitive' } },
        { city: { contains: s, mode: 'insensitive' } },
        { address: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.branchGeofence.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: {
              employees: true,
              attendances: true,
            },
          },
        },
      }),
      this.prisma.branchGeofence.count({ where }),
    ]);

    return {
      success: true,
      data: items.map((o) => ({
        id: o.id,
        customerId: o.customerId,
        name: o.name,
        code: o.code || '',
        address: o.address || '',
        city: o.city || '',
        state: o.state || '',
        country: o.country || 'India',
        postalCode: o.postalCode || '',
        latitude: o.latitude,
        longitude: o.longitude,
        radiusMeters: o.radiusMeters,
        isActive: o.isActive,
        status: o.isActive ? 'ACTIVE' : 'INACTIVE',
        employeesCount: o._count.employees,
        attendancesCount: o._count.attendances,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const office = await this.prisma.branchGeofence.findFirst({
      where: { id, customerId: numCustomerId },
      include: {
        _count: {
          select: {
            employees: true,
            attendances: true,
          },
        },
        employees: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            status: true,
            designation: { select: { name: true } },
            department: { select: { name: true } },
          },
          take: 50,
        },
      },
    });

    if (!office) {
      throw new NotFoundException(`Office #${id} not found`);
    }

    return {
      success: true,
      data: {
        id: office.id,
        customerId: office.customerId,
        name: office.name,
        code: office.code || '',
        address: office.address || '',
        city: office.city || '',
        state: office.state || '',
        country: office.country || 'India',
        postalCode: office.postalCode || '',
        latitude: office.latitude,
        longitude: office.longitude,
        radiusMeters: office.radiusMeters,
        isActive: office.isActive,
        status: office.isActive ? 'ACTIVE' : 'INACTIVE',
        employeesCount: office._count.employees,
        attendancesCount: office._count.attendances,
        employees: office.employees.map((e) => ({
          id: e.id,
          employeeCode: e.employeeCode,
          name: `${e.firstName} ${e.lastName}`.trim(),
          email: e.email,
          designation: e.designation?.name || 'Staff',
          department: e.department?.name || 'General',
          status: e.status,
        })),
        createdAt: office.createdAt,
        updatedAt: office.updatedAt,
      },
    };
  }

  async create(customerId: number | string | undefined, dto: CreateOfficeDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const trimmedName = dto.name.trim();

    if (!trimmedName) {
      throw new BadRequestException('Office name cannot be empty');
    }

    const existing = await this.prisma.branchGeofence.findFirst({
      where: {
        customerId: numCustomerId,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new ConflictException(`Office with name "${trimmedName}" already exists`);
    }

    if (dto.code && dto.code.trim()) {
      const codeDup = await this.prisma.branchGeofence.findFirst({
        where: {
          customerId: numCustomerId,
          code: { equals: dto.code.trim(), mode: 'insensitive' },
        },
      });
      if (codeDup) {
        throw new ConflictException(`Office with code "${dto.code.trim()}" already exists`);
      }
    }

    const created = await this.prisma.branchGeofence.create({
      data: {
        customerId: numCustomerId,
        name: trimmedName,
        code: dto.code?.trim().toUpperCase() || null,
        address: dto.address?.trim() || null,
        city: dto.city?.trim() || null,
        state: dto.state?.trim() || null,
        country: dto.country?.trim() || 'India',
        postalCode: dto.postalCode?.trim() || null,
        latitude: Number(dto.latitude),
        longitude: Number(dto.longitude),
        radiusMeters: dto.radiusMeters ? Number(dto.radiusMeters) : 200.0,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
      },
    });

    return {
      success: true,
      message: `Office "${created.name}" created successfully.`,
      data: created,
    };
  }

  async update(customerId: number | string | undefined, id: number, dto: UpdateOfficeDto) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const office = await this.prisma.branchGeofence.findFirst({
      where: { id, customerId: numCustomerId },
    });

    if (!office) {
      throw new NotFoundException(`Office #${id} not found`);
    }

    const data: any = {};

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) throw new BadRequestException('Office name cannot be empty');

      const dup = await this.prisma.branchGeofence.findFirst({
        where: {
          customerId: numCustomerId,
          name: { equals: trimmed, mode: 'insensitive' },
          NOT: { id },
        },
      });

      if (dup) {
        throw new ConflictException(`Another office with name "${trimmed}" already exists`);
      }
      data.name = trimmed;
    }

    if (dto.code !== undefined) {
      const codeTrimmed = dto.code ? dto.code.trim().toUpperCase() : null;
      if (codeTrimmed) {
        const codeDup = await this.prisma.branchGeofence.findFirst({
          where: {
            customerId: numCustomerId,
            code: { equals: codeTrimmed, mode: 'insensitive' },
            NOT: { id },
          },
        });
        if (codeDup) {
          throw new ConflictException(`Another office with code "${codeTrimmed}" already exists`);
        }
      }
      data.code = codeTrimmed;
    }

    if (dto.address !== undefined) data.address = dto.address.trim() || null;
    if (dto.city !== undefined) data.city = dto.city.trim() || null;
    if (dto.state !== undefined) data.state = dto.state.trim() || null;
    if (dto.country !== undefined) data.country = dto.country.trim() || 'India';
    if (dto.postalCode !== undefined) data.postalCode = dto.postalCode.trim() || null;
    if (dto.latitude !== undefined) data.latitude = Number(dto.latitude);
    if (dto.longitude !== undefined) data.longitude = Number(dto.longitude);
    if (dto.radiusMeters !== undefined) data.radiusMeters = Number(dto.radiusMeters);
    if (dto.isActive !== undefined) data.isActive = Boolean(dto.isActive);

    const updated = await this.prisma.branchGeofence.update({
      where: { id },
      data,
    });

    return {
      success: true,
      message: `Office "${updated.name}" updated successfully.`,
      data: updated,
    };
  }

  async toggleStatus(customerId: number | string | undefined, id: number, isActive: boolean) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const office = await this.prisma.branchGeofence.findFirst({
      where: { id, customerId: numCustomerId },
    });

    if (!office) {
      throw new NotFoundException(`Office #${id} not found`);
    }

    const updated = await this.prisma.branchGeofence.update({
      where: { id },
      data: { isActive },
    });

    return {
      success: true,
      message: `Office "${updated.name}" is now ${isActive ? 'ACTIVE' : 'INACTIVE'}.`,
      data: updated,
    };
  }

  async remove(customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const office = await this.prisma.branchGeofence.findFirst({
      where: { id, customerId: numCustomerId },
      include: {
        _count: {
          select: { employees: true, attendances: true },
        },
      },
    });

    if (!office) {
      throw new NotFoundException(`Office #${id} not found`);
    }

    // Safe deactivation if employees or attendance records are linked
    if (office._count.employees > 0 || office._count.attendances > 0) {
      await this.prisma.branchGeofence.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        success: true,
        message: `Office "${office.name}" has ${office._count.employees} employees and ${office._count.attendances} attendance logs. It has been deactivated safely to preserve historical records.`,
        deactivated: true,
      };
    }

    await this.prisma.branchGeofence.delete({
      where: { id },
    });

    return {
      success: true,
      message: `Office "${office.name}" deleted successfully.`,
      deleted: true,
    };
  }
}
