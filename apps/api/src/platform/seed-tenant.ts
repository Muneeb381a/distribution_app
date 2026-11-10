import { randomBytes } from 'node:crypto';
import type { BusinessLineCode, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLES, RICE_TREE } from '@dist/shared';

// The starting rice tree (Type > Variety > Form) lives in @dist/shared so the catalog screen uses the same one.
const BOTTLE_BRANDS = ['Coca-Cola', 'Pepsi', 'Sprite', 'Fanta', '7Up'];

/** A readable one-time password for a new account. */
export const newPassword = () => randomBytes(9).toString('base64url');

/**
 * The starting data of a business: business lines, roles, the "owner" account, the first locations and the category tree.
 * Safe to run again; it only adds what is missing. Returns the owner's password when it had to create the account.
 */
export async function seedTenant(prisma: PrismaClient, opts: { ownerPassword?: string } = {}): Promise<{ ownerPassword: string | null }> {
  const category = async (businessLineId: string, name: string, parentId: string | null) => {
    const found = await prisma.category.findFirst({ where: { businessLineId, name, parentId } });
    return found ?? prisma.category.create({ data: { businessLineId, name, parentId } });
  };

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

  let ownerPassword: string | null = null;
  const owner = await prisma.role.findUniqueOrThrow({ where: { name: 'Owner' } });
  if (!(await prisma.appUser.findUnique({ where: { username: 'owner' } }))) {
    ownerPassword = opts.ownerPassword ?? newPassword();
    await prisma.appUser.create({ data: { username: 'owner', passwordHash: await bcrypt.hash(ownerPassword, 10), roleId: owner.id } });
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
  return { ownerPassword };
}
