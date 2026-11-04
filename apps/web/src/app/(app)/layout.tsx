'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import TopBar from '@/components/TopBar';
import { api, can, updateUser, useUser, type SessionUser } from '@/lib/api';

interface NavItem { href: string; label: string; icon: IconName; permission: string | null }

const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: null }] },
  {
    title: 'Selling',
    items: [
      { href: '/sales', label: 'Sales', icon: 'sales', permission: 'SALE_CREATE' },
      { href: '/khata', label: 'Khata', icon: 'khata', permission: 'PAYMENT_RECORD' },
      { href: '/customers', label: 'Customers', icon: 'customers', permission: null },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { href: '/products', label: 'Products', icon: 'products', permission: null },
      { href: '/stock', label: 'Stock', icon: 'stock', permission: null },
      { href: '/purchases', label: 'Purchases', icon: 'purchases', permission: 'PURCHASE_MANAGE' },
      { href: '/suppliers', label: 'Suppliers', icon: 'suppliers', permission: null },
      { href: '/locations', label: 'Locations', icon: 'locations', permission: null },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/expenses', label: 'Expenses', icon: 'expenses', permission: 'EXPENSE_MANAGE' },
      { href: '/payroll', label: 'Payroll', icon: 'payroll', permission: 'PAYROLL_MANAGE' },
      { href: '/reports', label: 'Reports', icon: 'reports', permission: 'REPORT_VIEW' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/employees', label: 'Employees', icon: 'employees', permission: 'USER_MANAGE' },
      { href: '/users', label: 'Users & roles', icon: 'users', permission: 'USER_MANAGE' },
      { href: '/import', label: 'Import', icon: 'import', permission: 'IMPORT_DATA' },
    ],
  },
];

function NavLinks({ user, onNavigate }: { user: SessionUser; onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {NAV.map((g) => {
        const items = g.items.filter((n) => !n.permission || can(user, n.permission));
        if (!items.length) return null;
        return (
          <div className="nav-group" key={g.title}>
            <div className="nav-title">{g.title}</div>
            {items.map((n) => (
              <Link key={n.href} href={n.href} onClick={onNavigate} className={`nav-link${pathname.startsWith(n.href) ? ' active' : ''}`}>
                <Icon name={n.icon} />
                {n.label}
              </Link>
            ))}
          </div>
        );
      })}
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  // Pick up role / permission changes made since sign-in.
  const stored = user ? JSON.stringify([user.roleName, [...user.permissions].sort()]) : null;
  useEffect(() => {
    if (!stored) return;
    api<SessionUser>('/auth/me')
      .then((fresh) => {
        if (JSON.stringify([fresh.roleName, [...fresh.permissions].sort()]) !== stored) {
          updateUser(fresh);
          window.location.reload();
        }
      })
      .catch(() => {});
  }, [stored]);

  if (!user) return null;

  return (
    <div className="shell">
      <div className={`scrim${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
      <nav className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <span className="logo"><Icon name="products" /></span>
          <span>Distribution<small>Rice &amp; Beverages</small></span>
        </div>
        <Suspense fallback={null}>
          <NavLinks user={user} onNavigate={() => setOpen(false)} />
        </Suspense>
      </nav>
      <div className="main">
        <TopBar user={user} onMenu={() => setOpen(true)} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
