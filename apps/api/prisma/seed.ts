import { randomBytes } from 'node:crypto';
import { PrismaClient, type BusinessLineCode } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLES, RICE_TREE } from '@dist/shared';

const prisma = new PrismaClient();

// The starting rice tree (Type > Variety > Form) lives in @dist/shared so the catalog screen uses the same one.
const BOTTLE_BRANDS = ['Coca-Cola', 'Pepsi', 'Sprite', 'Fanta', '7Up'];

async function category(businessLineId: string, name: string, parentId: string | null) {
  const found = await prisma.category.findFirst({ where: { businessLineId, name, parentId } });
  return found ?? prisma.category.create({ data: { businessLineId, name, parentId } });
}

async function main() {
  const lines = {} as Record<BusinessLineCode, string>;
  for (const [code, name] of [['BOTTLES', 'Bottles'], ['RICE', 'Rice']] as const) {
    lines[code] = (await prisma.businessLine.upsert({ where: { code }, update: {}, create: { code, name } })).id;
  }

  for (const [name, perms] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    // Owner always tracks the full permission list; other roles are left alone once created.
    if (name === 'Owner' || (await prisma.rolePermission.count({ where: { roleId: role.id } })) === 0) {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({ data: perms.map((permissionCode) => ({ roleId: role.id, permissionCode })) });
    }
  }

  const owner = await prisma.role.findUniqueOrThrow({ where: { name: 'Owner' } });
  if (!(await prisma.appUser.findUnique({ where: { username: 'owner' } }))) {
    const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(9).toString('base64url');
    await prisma.appUser.create({ data: { username: 'owner', passwordHash: await bcrypt.hash(password, 10), roleId: owner.id } });
    console.log(`Created user "owner" with password: ${password}  (change it after first login)`);
  }

  for (const [name, type] of [['Main Godown', 'GODOWN'], ['Shop', 'SHOP']] as const) {
    await prisma.location.upsert({ where: { name }, update: {}, create: { name, type } });
  }

  for (const brand of BOTTLE_BRANDS) await category(lines.BOTTLES, brand, null);
  for (const [type, varieties] of Object.entries(RICE_TREE)) {
    const t = await category(lines.RICE, type, null);
    for (const [variety, forms] of Object.entries(varieties)) {
      const v = await category(lines.RICE, variety, t.id);
      for (const form of forms) await category(lines.RICE, form, v.id);
    }
  }
}

main().finally(() => prisma.$disconnect());
