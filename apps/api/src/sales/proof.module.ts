import { BadRequestException, Body, Controller, Delete, Get, Module, NotFoundException, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';

/** The browser shrinks the photo first; this is the most we keep per picture (about 2 MB of image). */
const MAX_BYTES = 2_000_000;
const MAX_PER_BILL = 4;

class ProofDto {
  @IsUUID() saleId: string;
  /** A JPEG, PNG or WebP picture as a data URL. */
  @IsString() @MaxLength(Math.ceil((MAX_BYTES * 4) / 3) + 100) @Matches(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, { message: 'image must be a JPEG, PNG or WebP picture' })
  image: string;
}

/**
 * Photos kept with a bill, mainly of the signed delivery slip. Anyone who can make bills can add and see them;
 * removing one needs the user-management permission, and every add and removal is audited.
 */
@Controller('delivery-proofs')
class ProofController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermissions('SALE_CREATE')
  async list(@Query('saleId') saleId?: string) {
    if (!saleId) throw new BadRequestException('saleId is required');
    const rows = await this.prisma.saleProof.findMany({ where: { saleId }, orderBy: { createdAt: 'asc' }, select: { id: true, mime: true, bytes: true, createdAt: true, createdById: true } });
    const users = await this.prisma.appUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, username: true } });
    return rows.map((r) => ({ id: r.id, mime: r.mime, bytes: r.bytes, at: r.createdAt, by: users.find((u) => u.id === r.createdById)?.username ?? null }));
  }

  @Post() @RequirePermissions('SALE_CREATE')
  async add(@Body() dto: ProofDto, @CurrentUser() u: AuthUser) {
    const sale = await this.prisma.sale.findUnique({ where: { id: dto.saleId }, select: { id: true, billNo: true, status: true } });
    if (!sale) throw new NotFoundException('Unknown bill');
    if (sale.status !== 'ACTIVE') throw new BadRequestException('This bill is cancelled');
    if ((await this.prisma.saleProof.count({ where: { saleId: sale.id } })) >= MAX_PER_BILL) throw new BadRequestException(`A bill can keep ${MAX_PER_BILL} photos`);
    const [head, b64] = dto.image.split(',');
    const data = Buffer.from(b64, 'base64');
    if (data.length > MAX_BYTES) throw new BadRequestException('That photo is too big');
    const row = await this.prisma.saleProof.create({ data: { saleId: sale.id, mime: head.slice(5, head.indexOf(';')), data, bytes: data.length, createdById: u.id } });
    await this.audit.log(u.id, 'PROOF_ADD', 'Sale', sale.id, undefined, { billNo: sale.billNo, bytes: data.length });
    return { id: row.id, bytes: row.bytes, at: row.createdAt };
  }

  @Get(':id/image') @RequirePermissions('SALE_CREATE')
  async image(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const row = await this.prisma.saleProof.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Unknown photo');
    res.set({ 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600' });
    return new StreamableFile(Buffer.from(row.data));
  }

  @Delete(':id') @RequirePermissions('USER_MANAGE')
  async remove(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const row = await this.prisma.saleProof.findUnique({ where: { id }, select: { id: true, saleId: true, bytes: true } });
    if (!row) throw new NotFoundException('Unknown photo');
    await this.prisma.saleProof.delete({ where: { id } });
    await this.audit.log(u.id, 'PROOF_REMOVE', 'Sale', row.saleId, { bytes: row.bytes }, undefined);
    return { ok: true };
  }
}

@Module({ controllers: [ProofController] })
export class ProofModule {}
