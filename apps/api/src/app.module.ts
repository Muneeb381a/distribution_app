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
import { SyncModule } from './sync/sync.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TripsModule } from './trips/trips.module.js';
import { ExpenseCategoriesModule } from './expenses/expense-categories.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { BackupModule } from './backup/backup.module.js';
import { DayEndModule } from './dayend/dayend.module.js';
import { ProofModule } from './sales/proof.module.js';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, CatalogModule, MasterDataModule, UsersModule, ImportModule, StockCoreModule, StockModule, PurchasingModule, SalesModule, HrModule, ReportsModule, DashboardModule, SearchModule, SupplierEmptiesModule, SyncModule, SettingsModule, TripsModule, VehiclesModule, ExpenseCategoriesModule, BackupModule, DayEndModule, ProofModule],
})
export class AppModule {}
