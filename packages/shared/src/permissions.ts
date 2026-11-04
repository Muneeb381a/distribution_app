/**
 * Every permission the app knows, with the label the Users & roles screen shows.
 * Add a permission here once: the API guard, the role editor and the web checks all use this list.
 */
export const PERMISSION_GROUPS = [
  {
    title: 'Selling',
    items: [
      ['SALE_CREATE', 'Create bills'],
      ['SALE_CANCEL', 'Cancel bills'],
      ['PAYMENT_RECORD', 'Record customer payments'],
      ['RATE_EDIT', 'Change rates on a bill'],
      ['CREDIT_OVERRIDE', 'Override credit limit'],
    ],
  },
  {
    title: 'Stock & purchasing',
    items: [
      ['PURCHASE_MANAGE', 'Purchases and returns'],
      ['SUPPLIER_PAYMENT', 'Pay suppliers'],
      ['STOCK_TRANSFER', 'Transfer stock'],
      ['STOCK_ADJUST', 'Adjust / mark damaged'],
      ['DAMAGED_APPROVE', 'Approve damaged → saleable'],
    ],
  },
  {
    title: 'Money & reports',
    items: [
      ['EXPENSE_MANAGE', 'Expenses'],
      ['PAYROLL_MANAGE', 'Payroll, attendance, advances'],
      ['REPORT_VIEW', 'Dashboard and reports'],
      ['AUDIT_VIEW', 'View audit log'],
    ],
  },
  {
    title: 'Admin',
    items: [
      ['MASTER_DATA_EDIT', 'Edit products, customers, suppliers'],
      ['IMPORT_DATA', 'Import from Excel'],
      ['USER_MANAGE', 'Users and roles'],
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]['items'][number][0];

export const PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map(([code]) => code));

export const PERMISSION_LABEL: Record<Permission, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.items.map(([code, label]) => [code, label])),
) as Record<Permission, string>;

/** Roles created by the seed. The owner always has everything. */
export const DEFAULT_ROLES: Record<string, Permission[]> = {
  Owner: [...PERMISSIONS],
  Cashier: ['SALE_CREATE', 'RATE_EDIT', 'PAYMENT_RECORD', 'REPORT_VIEW', 'EXPENSE_MANAGE'],
  Salesman: ['SALE_CREATE', 'PAYMENT_RECORD'],
  'Godown keeper': ['MASTER_DATA_EDIT', 'STOCK_TRANSFER', 'STOCK_ADJUST'],
};

export const hasPermission = (user: { permissions: readonly string[] } | null | undefined, p: Permission) => !!user?.permissions.includes(p);
