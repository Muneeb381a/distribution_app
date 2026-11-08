import { BadRequestException, Body, ConflictException, Controller, Get, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';

const KINDS = ['PICKUP', 'LOADER', 'TRUCK', 'VAN', 'BIKE', 'OTHER'] as const;
const KIND_LABEL: Record<(typeof KINDS)[number], string> = { PICKUP: 'Pickup', LOADER: 'Loader', TRUCK: 'Truck', VAN: 'Van', BIKE: 'Bike', OTHER: 'Vehicle' };

class VehicleDto {
  /** Number plate, e.g. LEB-1234. */
  @IsString() @MaxLength(20) regNo: string;
  @IsIn(KINDS) vehicleKind: (typeof KINDS)[number];
  /** What the team calls it; the kind and plate are used when left out. */
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @ValidateIf((o: VehicleDto) => !!o.driverId) @IsUUID() driverId?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class UpdateVehicleDto {
  @IsOptional() @IsString() @MaxLength(20) regNo?: string;
  @IsOptional() @IsIn(KINDS) vehicleKind?: (typeof KINDS)[number];
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  /** Empty string clears the driver. */
  @IsOptional() @IsString() driverId?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** "lea 1234" and "LEA-1234" are the same plate. */
const plate = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
const plateKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

@Controller('vehicles')
class VehiclesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Every vehicle with its usual driver, and the trip it is out on right now (if any). */
  @Get()
  async list() {
    const rows = await this.prisma.location.findMany({
      where: { type: 'VEHICLE' },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        driver: { select: { id: true, name: true } },
        trips: { where: { status: 'OPEN' }, take: 1, select: { id: true, tripNo: true, openedAt: true, salesman: { select: { id: true, name: true } } } },
        _count: { select: { trips: true } },
      },
    });
    return rows.map(({ trips, _count, ...v }) => ({ ...v, onTrip: trips[0] ?? null, tripCount: _count.trips }));
  }

  @Post() @RequirePermissions('MASTER_DATA_EDIT')
  async create(@Body() dto: VehicleDto, @CurrentUser() u: AuthUser) {
    const regNo = plate(dto.regNo);
    if (!regNo) throw new BadRequestException('Enter the number plate');
    await this.checkFree(regNo);
    await this.checkDriver(dto.driverId);
    const name = dto.name?.trim() || `${KIND_LABEL[dto.vehicleKind]} ${regNo}`;
    const row = await this.save(() => this.prisma.location.create({
      data: { name, type: 'VEHICLE', regNo, vehicleKind: dto.vehicleKind, driverId: dto.driverId || null, note: dto.note?.trim() || null },
    }));
    await this.audit.log(u.id, 'CREATE', 'Location', row.id, undefined, row);
    return row;
  }

  @Patch(':id') @RequirePermissions('MASTER_DATA_EDIT')
  async update(@Param('id') id: string, @Body() dto: UpdateVehicleDto, @CurrentUser() u: AuthUser) {
    const before = await this.prisma.location.findUnique({ where: { id } });
    if (!before || before.type !== 'VEHICLE') throw new NotFoundException('Unknown vehicle');
    const data: Prisma.LocationUncheckedUpdateInput = {};
    if (dto.regNo !== undefined) {
      const regNo = plate(dto.regNo);
      if (!regNo) throw new BadRequestException('Enter the number plate');
      await this.checkFree(regNo, id);
      data.regNo = regNo;
    }
    if (dto.vehicleKind) data.vehicleKind = dto.vehicleKind;
    if (dto.name?.trim()) data.name = dto.name.trim();
    if (dto.driverId !== undefined) {
      await this.checkDriver(dto.driverId || undefined);
      data.driverId = dto.driverId || null;
    }
    if (dto.note !== undefined) data.note = dto.note.trim() || null;
    if (dto.isActive !== undefined) {
      if (!dto.isActive) {
        const open = await this.prisma.vehicleTrip.findFirst({ where: { vehicleId: id, status: 'OPEN' } });
        if (open) throw new ConflictException(`${open.tripNo} is still open for this vehicle; settle it first`);
      }
      data.isActive = dto.isActive;
    }
    const row = await this.save(() => this.prisma.location.update({ where: { id }, data }));
    await this.audit.log(u.id, 'UPDATE', 'Location', id, before, row);
    return row;
  }

  private async checkFree(regNo: string, exceptId?: string) {
    const same = await this.prisma.location.findMany({ where: { type: 'VEHICLE', regNo: { not: null }, id: exceptId ? { not: exceptId } : undefined }, select: { regNo: true, name: true } });
    const clash = same.find((v) => plateKey(v.regNo!) === plateKey(regNo));
    if (clash) throw new ConflictException(`${regNo} is already added as ${clash.name}`);
  }

  private async checkDriver(driverId?: string) {
    if (!driverId) return;
    const e = await this.prisma.employee.findUnique({ where: { id: driverId } });
    if (!e?.isActive) throw new BadRequestException('Unknown or inactive driver');
  }

  /** The name is unique across all locations; say so in plain words. */
  private async save<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A location with this name already exists; give the vehicle a different name');
      throw e;
    }
  }
}

@Module({ controllers: [VehiclesController] })
export class VehiclesModule {}
