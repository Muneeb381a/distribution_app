import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma.service.js';
import { AuthModule } from './auth/auth.module.js';
import { AuditModule } from './audit/audit.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { MasterDataModule } from './masterdata/masterdata.module.js';
import { UsersModule } from './users/users.module.js';
import { ImportModule } from './import/import.module.js';
import { StockCoreModule } from './stock/stock.service.js';
import { StockModule } from './stock/stock.module.js';
import { PurchasingModule } from './purchasing/purchasing.module.js';
import { SalesModule } from './sales/sales.module.js';
import { HrModule } from './hr/hr.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { SupplierEmptiesModule } from './purchasing/supplier-empties.module.js';
import { SearchModule } from './search/search.module.js';
import { PrototypeModule } from './prototype/prototype.module.js';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, CatalogModule, MasterDataModule, UsersModule, ImportModule, StockCoreModule, StockModule, PurchasingModule, SalesModule, HrModule, ReportsModule, DashboardModule, SearchModule, SupplierEmptiesModule, PrototypeModule],
})
export class AppModule {}
