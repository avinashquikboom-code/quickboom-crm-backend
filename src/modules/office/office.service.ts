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
        { city: { contains: s, mode: 'insensitive' } },
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
      data: items.map((o) => ({
        id: o.id,
        customerId: o.customerId,
        name: o.name,
        city: o.city || '',
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
          },
          take: 20,
        },
      },
    });

    if (!office) {
      throw new NotFoundException(`Office #${id} not found`);
    }

    return {
      ...office,
      status: office.isActive ? 'ACTIVE' : 'INACTIVE',
      employeesCount: office._count.employees,
      attendancesCount: office._count.attendances,
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

    return this.prisma.branchGeofence.create({
      data: {
        customerId: numCustomerId,
        name: trimmedName,
        city: dto.city?.trim() || null,
        latitude: Number(dto.latitude),
        longitude: Number(dto.longitude),
        radiusMeters: dto.radiusMeters ? Number(dto.radiusMeters) : 200.0,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : true,
      },
    });
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

    if (dto.city !== undefined) data.city = dto.city.trim() || null;
    if (dto.latitude !== undefined) data.latitude = Number(dto.latitude);
    if (dto.longitude !== undefined) data.longitude = Number(dto.longitude);
    if (dto.radiusMeters !== undefined) data.radiusMeters = Number(dto.radiusMeters);
    if (dto.isActive !== undefined) data.isActive = Boolean(dto.isActive);

    return this.prisma.branchGeofence.update({
      where: { id },
      data,
    });
  }

  async remove(customerId: number | string | undefined, id: number) {
    const numCustomerId = await this.resolveCustomerId(customerId);
    const office = await this.prisma.branchGeofence.findFirst({
      where: { id, customerId: numCustomerId },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    });

    if (!office) {
      throw new NotFoundException(`Office #${id} not found`);
    }

    // Safe deactivation if employees are assigned
    if (office._count.employees > 0) {
      await this.prisma.branchGeofence.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        success: true,
        message: `Office "${office.name}" is assigned to ${office._count.employees} employees. It has been deactivated safely to preserve historical attendance.`,
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
