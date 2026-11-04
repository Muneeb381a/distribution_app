'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FeedbackProvider } from '@/components/Feedback';
import { Icon, type IconName } from '@/components/Icon';
import TopBar from '@/components/TopBar';
import type { Permission } from '@dist/shared';
import { api, can, updateUser, useUser, type SessionUser } from '@/lib/api';
import { startSync, useSyncState } from '@/lib/offline';
import { PageTitleCtx } from '@/lib/pageTitle';
import { getSettings, loadSettings, useSettings } from '@/lib/settings';

interface NavItem { href: string; label: string; icon: IconName; permission: Permission | null }

const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: null }] },
  {
    title: 'Selling',
    items: [
      { href: '/sales', label: 'Sales', icon: 'sales', permission: 'SALE_CREATE' },
      { href: '/khata', label: 'Khata', icon: 'khata', permission: 'PAYMENT_RECORD' },
      { href: '/cheques', label: 'Cheques', icon: 'wallet', permission: 'PAYMENT_RECORD' },
      { href: '/outbox', label: 'Offline outbox', icon: 'cloud', permission: 'SALE_CREATE' },
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
      { href: '/audit', label: 'Audit log', icon: 'history', permission: 'AUDIT_VIEW' },
      { href: '/settings', label: 'Settings', icon: 'settings', permission: 'SETTINGS_EDIT' },
    ],
  },
];

/** Detail pages that are not in the menu: [pattern, title, parent href]. */
const DETAIL: [RegExp, string][] = [
  [/^\/sales\/new$/, 'New bill'],
  [/^\/sales\/[^/]+$/, 'Bill'],
  [/^\/khata\/[^/]+\/statement$/, 'Statement'],
  [/^\/khata\/[^/]+$/, 'Customer khata'],
  [/^\/customers\/[^/]+$/, 'Customer rates'],
  [/^\/suppliers\/[^/]+$/, 'Supplier ledger'],
  [/^\/receipts\/[^/]+$/, 'Receipt'],
  [/^\/payroll\/advances\/[^/]+$/, 'Advance slip'],
  [/^\/payroll\/[^/]+$/, 'Salary slip'],
  [/^\/employees\/[^/]+$/, 'Employee ledger'],
  [/^\/products\/catalog$/, 'Add from catalog'],
];
const RECEIPT_PARENT = NAV[1].items[1];
// /outbox is listed in the menu, so it needs no detail entry.

export interface Crumb { label: string; href?: string }

/** Breadcrumb for a path: section › page › detail. */
function crumbsFor(pathname: string, detail?: string): Crumb[] {
  const all = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
  const item = pathname.startsWith('/receipts') ? { ...RECEIPT_PARENT, group: 'Selling' } : all.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  if (!item) return [{ label: detail ?? getSettings().businessName }];
  const sub = DETAIL.find(([re]) => re.test(pathname))?.[1];
  const out: Crumb[] = [{ label: item.group }, { label: item.label, href: sub ? item.href : undefined }];
  if (sub) out.push({ label: detail ?? sub });
  return out;
}

function NavLinks({ user, onNavigate, collapsed }: { user: SessionUser; onNavigate: () => void; collapsed: boolean }) {
  const pathname = usePathname();
  const sync = useSyncState();
  const waiting = sync.pending + sync.failed;
  return (
    <>
      {NAV.map((g) => {
        const items = g.items.filter((n) => !n.permission || can(user, n.permission));
        if (!items.length) return null;
        return (
          <div className="nav-group" key={g.title}>
            <div className="nav-title">{g.title}</div>
            {items.map((n) => (
              <Link
                key={n.href} href={n.href} onClick={onNavigate}
                className={`nav-link${active(pathname, n.href) ? ' active' : ''}`}
                aria-current={active(pathname, n.href) ? 'page' : undefined}
                title={collapsed ? n.label : undefined}
              >
                <Icon name={n.icon} />
                <span className="nav-label">{n.label}</span>
                {n.href === '/outbox' && waiting > 0 && <span className="nav-count" aria-label={`${waiting} waiting`}>{waiting}</span>}
              </Link>
            ))}
          </div>
        );
      })}
    </>
  );
}

const active = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`) || (href === '/khata' && pathname.startsWith('/receipts'));

const SIDEBAR_KEY = 'dist.sidebar';

/** Top bar with the breadcrumb; also names the browser tab. */
function TitledTopBar({ user, onMenu, detail }: { user: SessionUser; onMenu: () => void; detail: { path: string; title: string } | null }) {
  const pathname = usePathname();
  const crumbs = useMemo(() => crumbsFor(pathname, detail?.path === pathname ? detail.title : undefined), [pathname, detail]);
  const { businessName } = useSettings();
  useEffect(() => {
    document.title = `${crumbs[crumbs.length - 1].label} · ${businessName}`;
  }, [crumbs, businessName]);
  return <TopBar user={user} onMenu={onMenu} crumbs={crumbs} status={<SyncPill />} />;
}

/** Connection and outbox state, always visible; opens the outbox. */
function SyncPill() {
  const s = useSyncState();
  const cls = !s.reachable ? 'offline' : s.failed ? 'failed' : s.pending || s.syncing ? 'pending' : '';
  const text = !s.reachable ? (s.pending ? `Offline · ${s.pending} waiting` : 'Offline')
    : s.failed ? `${s.failed} need attention`
    : s.syncing ? 'Syncing…'
    : s.pending ? `${s.pending} to sync`
    : 'Online';
  return (
    <Link href="/outbox" className={`net-pill ${cls}`} title={s.lastSync ? `Last sync ${new Date(s.lastSync).toLocaleTimeString()}` : 'Offline outbox'} aria-live="polite">
      <i aria-hidden="true" /><span className="net-label">{text}</span>
    </Link>
  );
}

function OfflineBanner() {
  const s = useSyncState();
  if (s.reachable) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="wifiOff" />
      <span>No connection to the server. New bills and receipts are saved on this PC and sync automatically.{s.pending ? ` ${s.pending} waiting.` : ''}</span>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [detail, setDetail] = useState<{ path: string; title: string } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    try { setCollapsed(localStorage.getItem(SIDEBAR_KEY) === 'collapsed'); } catch { /* ignore */ }
  }, []);

  // Offline support: background sync, and the service worker that keeps the app shell for offline use.
  useEffect(() => {
    if (!user) return;
    startSync();
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Warm the pages that must open with no connection.
        const warm = () => reg.active?.postMessage({ type: 'warm', urls: ['/sales/new', '/outbox', '/dashboard'] });
        if (reg.active) warm(); else navigator.serviceWorker.ready.then(warm);
      }).catch(() => {});
    }
  }, [user]);

  const toggleSidebar = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(SIDEBAR_KEY, c ? 'open' : 'collapsed'); } catch { /* ignore */ }
      return !c;
    });
  };

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  // Business name, address and print settings for headers and bills (cached for offline).
  useEffect(() => {
    if (user) loadSettings();
  }, [user]);
  const biz = useSettings();

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
    <FeedbackProvider>
      <PageTitleCtx.Provider value={setDetail}>
        <div className={`shell${collapsed ? ' collapsed' : ''}`}>
          <a href="#main" className="skip-link">Skip to content</a>
          <div className={`scrim${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
          <nav className={`sidebar${open ? ' open' : ''}`} aria-label="Main menu">
            <div className="brand">
              <span className="logo"><Icon name="products" /></span>
              <span className="brand-text">{biz.businessName}{biz.tagline && <small>{biz.tagline}</small>}</span>
              <button className="collapse-btn" onClick={toggleSidebar} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
                <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
              </button>
            </div>
            <Suspense fallback={null}>
              <NavLinks user={user} onNavigate={() => setOpen(false)} collapsed={collapsed} />
            </Suspense>
          </nav>
          <div className="main">
            <Suspense fallback={<header className="topbar" />}>
              <TitledTopBar user={user} onMenu={() => setOpen(true)} detail={detail} />
            </Suspense>
            <OfflineBanner />
            <main className="content" id="main" tabIndex={-1}>{children}</main>
          </div>
        </div>
      </PageTitleCtx.Provider>
    </FeedbackProvider>
  );
}
