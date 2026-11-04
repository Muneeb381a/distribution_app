import { Body, Controller, Get, Injectable, Module, Put } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { SETTINGS_LIMITS as L, withDefaults, type BusinessSettings } from '@dist/shared';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, Public, RequirePermissions, type AuthUser } from '../common/decorators.js';

const KEY = 'business';

class SettingsDto {
  @IsOptional() @IsString() @MaxLength(L.businessName) businessName?: string;
  @IsOptional() @IsString() @MaxLength(L.urduName) urduName?: string;
  @IsOptional() @IsString() @MaxLength(L.tagline) tagline?: string;
  @IsOptional() @IsString() @MaxLength(L.address) address?: string;
  @IsOptional() @IsString() @MaxLength(L.phone) phone?: string;
  @IsOptional() @IsString() @MaxLength(L.ntn) ntn?: string;
  @IsOptional() @IsString() @MaxLength(L.footer) footer?: string;
  @IsOptional() @IsString() @MaxLength(L.note) note?: string;
  @IsOptional() @IsIn([80, 58]) thermalWidth?: 80 | 58;
}

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(): Promise<BusinessSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    return withDefaults(row?.value as Partial<BusinessSettings> | undefined);
  }
}

@Controller('settings')
class SettingsController {
  constructor(private prisma: PrismaService, private settings: SettingsService, private audit: AuditService) {}

  /** Everything prints need; any signed-in user (bills are printed by cashiers and salesmen). */
  @Get()
  get() {
    return this.settings.get();
  }

  /** Name and tagline for the sign-in page, before anyone is signed in. */
  @Public() @Get('public')
  async publicInfo() {
    const s = await this.settings.get();
    return { businessName: s.businessName, tagline: s.tagline };
  }

  @Put() @RequirePermissions('SETTINGS_EDIT')
  async save(@Body() dto: SettingsDto, @CurrentUser() u: AuthUser) {
    const before = await this.settings.get();
    // Only the fields sent change; the DTO also carries keys that were left out, as undefined.
    const trimmed = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    const next = withDefaults({ ...before, ...trimmed });
    // An emptied name falls back to the default rather than printing a blank header.
    if (!next.businessName) next.businessName = withDefaults(null).businessName;
    await this.prisma.setting.upsert({
      where: { key: KEY },
      update: { value: next as unknown as Prisma.InputJsonValue, updatedById: u.id },
      create: { key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: u.id },
    });
    await this.audit.log(u.id, 'UPDATE', 'Setting', KEY, before, next);
    return next;
  }
}

@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
