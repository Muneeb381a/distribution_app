import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { newPassword, seedTenant } from '../src/platform/seed-tenant.js';

const prisma = new PrismaClient();

async function main() {
  // The original business, living in the main schema.
  const { ownerPassword } = await seedTenant(prisma, { ownerPassword: process.env.SEED_OWNER_PASSWORD });
  if (ownerPassword) console.log(`Created user "owner" with password: ${ownerPassword}  (change it after first login)`);

  await prisma.tenant.upsert({
    where: { code: 'main' },
    update: {},
    create: { code: 'main', name: 'Main business', schemaName: 'public', isMain: true, status: 'ACTIVE' },
  });

  // The person who runs the platform: signs in at /admin and sees every business.
  if ((await prisma.platformAdmin.count()) === 0) {
    const username = process.env.PLATFORM_ADMIN_USERNAME ?? 'platform';
    const password = process.env.PLATFORM_ADMIN_PASSWORD ?? newPassword();
    await prisma.platformAdmin.create({ data: { username, passwordHash: await bcrypt.hash(password, 10), displayName: 'Platform admin' } });
    console.log(`Created platform admin "${username}" with password: ${password}  (change it after first login)`);
  }
}

main().finally(() => prisma.$disconnect());
