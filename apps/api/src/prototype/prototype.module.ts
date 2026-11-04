import { Body, Controller, Module, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray } from 'class-validator';

class SyncDto {
  @IsArray() @ArrayMaxSize(500) bills: { id: string; billNo: string; [k: string]: unknown }[];
}

/**
 * THROWAWAY: proves idempotent offline sync before the real sales tables exist (Phase 3).
 * Keeps accepted bills in memory only. Delete this module when /sync/sales is built.
 */
@Controller('prototype')
class PrototypeController {
  private accepted = new Map<string, string>(); // id -> billNo

  @Post('sync')
  sync(@Body() dto: SyncDto) {
    const results = dto.bills.map((b) => {
      if (!/^[0-9a-f-]{36}$/.test(String(b.id))) return { id: b.id, status: 'rejected' as const };
      if (this.accepted.has(b.id)) return { id: b.id, status: 'duplicate' as const };
      if ([...this.accepted.values()].includes(b.billNo)) return { id: b.id, status: 'rejected' as const, reason: 'bill number clash' };
      this.accepted.set(b.id, b.billNo);
      return { id: b.id, status: 'accepted' as const };
    });
    return { results, serverTotal: this.accepted.size };
  }
}

@Module({ controllers: [PrototypeController] })
export class PrototypeModule {}
