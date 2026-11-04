import {
  BadRequestException,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as XLSX from 'xlsx';
import { BusinessLineCode, CustomerType, Prisma, UnitName } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { StockService } from '../stock/stock.service.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';

interface UploadedFileData {
  buffer: Buffer;
  originalname: string;
}
type Raw = Record<string, string>;
interface Parsed<T> {
  row: number;
  errors: string[];
  data?: T;
}

const TEMPLATES = {
  customers: ['name', 'shop_name', 'phone', 'address', 'area', 'type', 'credit_limit', 'opening_balance'],
  products: ['business_line', 'category_path', 'name', 'brand', 'size', 'pack_size', 'bag_kg', 'returnable_empty'],
  suppliers: ['name', 'phone', 'type', 'opening_balance'],
  stock: ['location', 'product', 'size', 'qty', 'unit', 'unit_cost'],
} as const;
type Kind = keyof typeof TEMPLATES;

function readSheet(buf: Buffer): Raw[] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new BadRequestException('File has no sheets');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  return rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, '_'), String(v).trim()])),
  );
}

function num(v: string, label: string, errors: string[], opts: { min?: number } = {}): number | undefined {
  if (v === '') return undefined;
  const n = Number(v.replace(/,/g, ''));
  if (!Number.isFinite(n)) errors.push(`${label} must be a number`);
  else if (opts.min != null && n < opts.min) errors.push(`${label} must be at least ${opts.min}`);
  else return n;
  return undefined;
}

const yes = (v: string) => ['yes', 'y', 'true', '1'].includes(v.toLowerCase());

@Controller('import')
class ImportController {
  constructor(private prisma: PrismaService, private audit: AuditService, private stock: StockService) {}

  @Get('templates/:kind') @RequirePermissions('IMPORT_DATA')
  template(@Param('kind') kind: string, @Res() res: Response) {
    if (!(kind in TEMPLATES)) throw new BadRequestException('Unknown template');
    const ws = XLSX.utils.aoa_to_sheet([[...TEMPLATES[kind as Kind]]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, kind);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-template.xlsx"`);
    res.send(buf);
  }

  /** Preview by default; pass commit=true to save. Nothing is saved if any row has an error. */
  @Post(':kind') @RequirePermissions('IMPORT_DATA') @UseInterceptors(FileInterceptor('file'))
  async run(
    @Param('kind') kind: string,
    @Query('commit') commit: string | undefined,
    @UploadedFile() file: UploadedFileData | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Upload a file in the "file" field');
    if (!(kind in TEMPLATES)) throw new BadRequestException('Unknown import kind');
    const raw = readSheet(file.buffer);
    const missing = TEMPLATES[kind as Kind].filter((c) => raw.length && !(c in raw[0]));
    if (missing.length) throw new BadRequestException(`Missing columns: ${missing.join(', ')}`);

    const parsers = {
      customers: () => this.parseCustomers(raw),
      suppliers: () => this.parseSuppliers(raw),
      products: () => this.parseProducts(raw),
      stock: () => this.parseStock(raw),
    };
    const parsed: Parsed<unknown>[] = await parsers[kind as Kind]();

    const bad = parsed.filter((p) => p.errors.length);
    const summary = { total: parsed.length, valid: parsed.length - bad.length, invalid: bad.length, errors: bad.map((p) => ({ row: p.row, errors: p.errors })) };
    if (commit !== 'true') return { committed: false, ...summary };
    if (bad.length) throw new BadRequestException({ message: 'Fix the errors and upload again', ...summary });
    if (!parsed.length) throw new BadRequestException('File has no data rows');

    await this.prisma.$transaction(async (tx) => {
      if (kind === 'customers') await tx.customer.createMany({ data: parsed.map((p) => p.data as Prisma.CustomerCreateManyInput) });
      else if (kind === 'suppliers') await tx.supplier.createMany({ data: parsed.map((p) => p.data as Prisma.SupplierCreateManyInput) });
      else if (kind === 'stock') await this.saveStock(tx, parsed as Parsed<StockRow>[], user.id);
      else await this.saveProducts(tx, parsed as Parsed<ProductRow>[]);
    });
    await this.audit.log(user.id, 'IMPORT', kind, undefined, undefined, { rows: parsed.length, file: file.originalname });
    return { committed: true, ...summary };
  }

  private async parseCustomers(raw: Raw[]): Promise<Parsed<Prisma.CustomerCreateManyInput>[]> {
    const existing = await this.prisma.customer.findMany({ select: { name: true, phone: true } });
    const seen = new Set(existing.map((c) => `${c.name.toLowerCase()}|${c.phone ?? ''}`));
    return raw.map((r, i) => {
      const errors: string[] = [];
      if (!r.name) errors.push('name is required');
      const typeText = (r.type || 'CASH').toUpperCase();
      if (!(typeText in CustomerType)) errors.push('type must be CASH or CREDIT');
      const creditLimit = num(r.credit_limit, 'credit_limit', errors, { min: 0 });
      const openingBalance = num(r.opening_balance, 'opening_balance', errors);
      if (typeText === 'CASH' && creditLimit) errors.push('cash customers cannot have a credit limit');
      const key = `${r.name.toLowerCase()}|${r.phone}`;
      if (r.name && seen.has(key)) errors.push('customer already exists (same name and phone)');
      seen.add(key);
      return {
        row: i + 2,
        errors,
        data: {
          name: r.name,
          shopName: r.shop_name || null,
          phone: r.phone || null,
          address: r.address || null,
          area: r.area || null,
          type: typeText as CustomerType,
          creditLimit,
          openingBalance: openingBalance ?? 0,
        },
      };
    });
  }

  private async parseSuppliers(raw: Raw[]): Promise<Parsed<Prisma.SupplierCreateManyInput>[]> {
    const existing = new Set((await this.prisma.supplier.findMany({ select: { name: true } })).map((s) => s.name.toLowerCase()));
    return raw.map((r, i) => {
      const errors: string[] = [];
      if (!r.name) errors.push('name is required');
      const type = (r.type || 'OTHER').toUpperCase();
      if (!['BEVERAGE', 'RICE_MILL', 'OTHER'].includes(type)) errors.push('type must be BEVERAGE, RICE_MILL or OTHER');
      const openingBalance = num(r.opening_balance, 'opening_balance', errors);
      if (existing.has(r.name.toLowerCase())) errors.push('supplier already exists');
      existing.add(r.name.toLowerCase());
      return {
        row: i + 2,
        errors,
        data: { name: r.name, phone: r.phone || null, type: type as 'BEVERAGE' | 'RICE_MILL' | 'OTHER', openingBalance: openingBalance ?? 0 },
      };
    });
  }

  /** Opening stock: one row per product and location, quantity in any unit the product has. */
  private async parseStock(raw: Raw[]): Promise<Parsed<StockRow>[]> {
    const [locations, products, opened] = await Promise.all([
      this.prisma.location.findMany({ where: { isActive: true } }),
      this.prisma.product.findMany({ where: { isActive: true }, include: { units: true } }),
      this.prisma.stockMovement.findMany({ where: { type: 'OPENING' }, select: { productId: true, locationId: true } }),
    ]);
    const done = new Set(opened.map((o) => `${o.productId}|${o.locationId}`));
    return raw.map((r, i) => {
      const errors: string[] = [];
      const location = locations.find((l) => l.name.toLowerCase() === r.location.toLowerCase());
      if (!location) errors.push(`unknown location "${r.location}"`);
      const matches = products.filter((p) => p.name.toLowerCase() === r.product.toLowerCase() && (p.size ?? '').toLowerCase() === r.size.toLowerCase());
      const product = matches[0];
      if (!product) errors.push(`unknown product "${r.product}" with size "${r.size}"`);
      const qty = num(r.qty, 'qty', errors, { min: 0.001 });
      if (qty == null && !errors.some((e) => e.startsWith('qty'))) errors.push('qty is required');
      const unitText = (r.unit || product?.baseUnit || '').toUpperCase();
      const unit = product?.units.find((u) => u.unitName === unitText);
      if (product && !unit) errors.push(`${product.name} has no unit ${unitText} (has ${product.units.map((u) => u.unitName).join(', ')})`);
      const unitCost = num(r.unit_cost, 'unit_cost', errors, { min: 0 });
      if (product && location) {
        const key = `${product.id}|${location.id}`;
        if (done.has(key)) errors.push('opening stock already recorded for this product and location');
        done.add(key);
      }
      return {
        row: i + 2,
        errors,
        data: errors.length ? undefined : { productId: product!.id, locationId: location!.id, unitName: unit!.unitName, qty: qty!, unitCost: unitCost ?? null },
      };
    });
  }

  private async saveStock(tx: Prisma.TransactionClient, rows: Parsed<StockRow>[], userId: string) {
    for (const { data: d } of rows) {
      const { qtyBase, factor } = await this.stock.toBase(tx, d!.productId, d!.unitName, d!.qty);
      await this.stock.move(tx, { productId: d!.productId, locationId: d!.locationId, qtyBase, type: 'OPENING', refType: 'IMPORT', userId });
      if (d!.unitCost != null) {
        // unit_cost is per the row's unit; store per base unit. Never overwrite a cost set by a real purchase.
        const existing = await tx.productCost.findUnique({ where: { productId: d!.productId } });
        if (!existing) {
          await tx.productCost.create({ data: { productId: d!.productId, latestUnitCostBase: new Prisma.Decimal(d!.unitCost).div(factor).toDecimalPlaces(4) } });
        }
      }
    }
  }

  private async parseProducts(raw: Raw[]): Promise<Parsed<ProductRow>[]> {
    const existing = new Set(
      (await this.prisma.product.findMany({ select: { name: true, size: true } })).map((p) => `${p.name.toLowerCase()}|${(p.size ?? '').toLowerCase()}`),
    );
    return raw.map((r, i) => {
      const errors: string[] = [];
      const line = r.business_line.toUpperCase();
      if (!(line in BusinessLineCode)) errors.push('business_line must be BOTTLES or RICE');
      if (!r.name) errors.push('name is required');
      const path = r.category_path.split('>').map((s) => s.trim()).filter(Boolean);
      if (!path.length) errors.push('category_path is required (e.g. "Coca-Cola" or "Basmati > Super Kernel > Sella")');
      const packSize = num(r.pack_size, 'pack_size', errors, { min: 1 });
      const bagKg = num(r.bag_kg, 'bag_kg', errors, { min: 0.001 });
      if (line === 'RICE' && r.pack_size) errors.push('pack_size applies to bottles only');
      if (line === 'BOTTLES' && r.bag_kg) errors.push('bag_kg applies to rice only');
      const key = `${r.name.toLowerCase()}|${r.size.toLowerCase()}`;
      if (r.name && existing.has(key)) errors.push('product already exists (same name and size)');
      existing.add(key);
      return {
        row: i + 2,
        errors,
        data: {
          line: line as BusinessLineCode,
          path,
          name: r.name,
          brand: r.brand || null,
          size: r.size || null,
          packSize: packSize ?? 6,
          bagKg: bagKg ?? null,
          returnableEmpty: r.returnable_empty ? yes(r.returnable_empty) : line === 'BOTTLES',
        },
      };
    });
  }

  private async saveProducts(tx: Prisma.TransactionClient, rows: Parsed<ProductRow>[]) {
    const lines = new Map((await tx.businessLine.findMany()).map((l) => [l.code, l.id]));
    const cache = new Map<string, string>();
    const categoryId = async (code: BusinessLineCode, path: string[]) => {
      let parentId: string | null = null;
      let key = code as string;
      for (const name of path) {
        key += `/${name}`;
        let id: string | undefined = cache.get(key);
        if (!id) {
          const where: { businessLineId: string; parentId: string | null; name: string } = { businessLineId: lines.get(code)!, parentId, name };
          const found: { id: string } | null = await tx.category.findFirst({ where });
          id = found?.id ?? (await tx.category.create({ data: where })).id;
          cache.set(key, id);
        }
        parentId = id;
      }
      return parentId!;
    };
    for (const { data: d } of rows) {
      const bottles = d!.line === 'BOTTLES';
      await tx.product.create({
        data: {
          categoryId: await categoryId(d!.line, d!.path),
          name: d!.name,
          brand: d!.brand,
          size: d!.size,
          baseUnit: bottles ? 'BOTTLE' : 'KG',
          isPacked: !bottles && d!.bagKg != null,
          returnableEmpty: d!.returnableEmpty,
          units: {
            create: bottles
              ? [{ unitName: 'BOTTLE', factorToBase: 1 }, { unitName: 'CARTON', factorToBase: d!.packSize }]
              : [
                  { unitName: 'KG', factorToBase: 1 },
                  { unitName: 'MAUND', factorToBase: 40 },
                  ...(d!.bagKg != null ? [{ unitName: 'BAG' as const, factorToBase: d!.bagKg }] : []),
                ],
          },
        },
      });
    }
  }
}

interface StockRow {
  productId: string;
  locationId: string;
  unitName: UnitName;
  qty: number;
  unitCost: number | null;
}

interface ProductRow {
  line: BusinessLineCode;
  path: string[];
  name: string;
  brand: string | null;
  size: string | null;
  packSize: number;
  bagKg: number | null;
  returnableEmpty: boolean;
}

@Module({ controllers: [ImportController] })
export class ImportModule {}
