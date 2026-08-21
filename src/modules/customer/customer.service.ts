import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(search?: string, isActive?: boolean, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const where: any = {
      deletedAt: null,
    };

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          subscriptions: {
            include: {
              plan: true,
            },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: {
              users: true,
              leads: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const formatted = items.map((c) => {
      const activeSub = c.subscriptions[0];
      const planName = activeSub?.plan?.name || 'Starter Plan';
      const mrr = activeSub?.plan?.monthlyPrice ? `₹${Number(activeSub.plan.monthlyPrice).toLocaleString('en-IN')}` : '₹4,999';

      return {
        id: c.id,
        name: c.name,
        domain: c.domain,
        email: c.email,
        phone: c.phone,
        city: c.city,
        state: c.state,
        isActive: c.isActive,
        status: c.isActive ? 'active' : 'inactive',
        plan: planName,
        users: c._count.users || 1,
        leads: c._count.leads || 0,
        storage: `${(Number(c.storageUsed) / (1024 * 1024)).toFixed(1)} MB`,
        mrr,
        createdAt: c.createdAt,
      };
    });

    return {
      items: formatted,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number | string) {
    const numericId = Number(id);
    const customer = await this.prisma.customer.findUnique({
      where: { id: numericId },
      include: {
        subscriptions: {
          include: {
            plan: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        _count: {
          select: {
            users: true,
            leads: true,
            deals: true,
            contacts: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    const activeSub = customer.subscriptions[0];

    return {
      ...customer,
      plan: activeSub?.plan?.name || 'Starter Plan',
      subscriptionStatus: activeSub?.status || 'ACTIVE',
      userCount: customer._count.users,
      leadCount: customer._count.leads,
      dealCount: customer._count.deals,
      contactCount: customer._count.contacts,
    };
  }

  async create(dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        name: dto.name,
        domain: dto.domain,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        userLimit: dto.userLimit || 15,
        leadLimit: dto.leadLimit || 1000,
      },
    });
  }

  async update(id: number | string, dto: UpdateCustomerDto) {
    const numericId = Number(id);
    await this.findOne(numericId);
    return this.prisma.customer.update({
      where: { id: numericId },
      data: dto,
    });
  }

  async remove(id: number | string) {
    const numericId = Number(id);
    await this.findOne(numericId);
    return this.prisma.customer.update({
      where: { id: numericId },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }
}
