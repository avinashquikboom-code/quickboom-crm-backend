import { Injectable, BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { UpdateSelfProfileDto, ChangeSelfPasswordDto, SelfActivityDto } from './dto/self-profile.dto';

@Injectable()
export class SelfProfileService {
  constructor(private readonly prisma: PrismaService, private readonly s3: S3Service) {}

  async update(userId: number, dto: UpdateSelfProfileDto) {
    try {
      await this.prisma.user.update({ where: { id: userId }, data: {
        firstName: dto.firstName, lastName: dto.lastName,
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
      } });
    } catch (error) {
      if (error.code === 'P2002') throw new ConflictException('This phone number is already in use.');
      throw error;
    }
    return { success: true };
  }

  async password(userId: number, dto: ChangeSelfPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect.');
    }
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException('Choose a different new password.');
    if (Buffer.byteLength(dto.newPassword, 'utf8') > 72) throw new BadRequestException('Password must not exceed 72 UTF-8 bytes.');
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({ where: { id: userId, passwordHash: user.passwordHash }, data: { passwordHash } });
      if (result.count !== 1) throw new ConflictException('Your password changed. Please sign in again.');
      await tx.refreshToken.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } });
    });
    return { success: true };
  }

  async photo(userId: number, file: Express.Multer.File) {
    if (!file || !file.buffer?.length || file.size > 5 * 1024 * 1024) throw new BadRequestException('Choose an image up to 5 MB.');
    const b = file.buffer;
    const type = b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
      : b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg'
      : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!type || type !== file.mimetype) throw new BadRequestException('Upload a valid JPG, PNG or WebP image.');
    const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
    const result = await this.s3.uploadFile({ ...file, originalname: `profile.${ext}` }, `profiles/${userId}`);
    try { await this.prisma.user.update({ where: { id: userId }, data: { avatar: result.imageUrl } }); }
    catch (error) { await this.s3.deleteFile(result.imageKey).catch(() => {}); throw error; }
    return { avatar: result.imageUrl };
  }

  async activity(userId: number, query: SelfActivityDto) {
    const page = query.page || 1, limit = query.limit || 10;
    const end = query.to ? new Date(query.to) : undefined;
    if (end && query.to.length === 10) end.setUTCHours(23,59,59,999);
    if (query.from && end && new Date(query.from) > end) throw new BadRequestException('Start date must precede end date.');
    const where = { userId, ...((query.from || end) ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(end ? { lte: end } : {}) } } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit,
        select: { id: true, description: true, action: true, module: true, createdAt: true, status: true, ipAddress: true, device: true } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }
}
