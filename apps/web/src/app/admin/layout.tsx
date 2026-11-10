'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/Avatar';
import { FeedbackProvider } from '@/components/Feedback';
import { Icon, type IconName } from '@/components/Icon';
import { clearPlatformSession, usePlatformAdmin } from '@/lib/platform';

const NAV: { href: string; label: string; icon: IconName; exact?: boolean }[] = [
  { href: '/admin', label: 'Overview', icon: 'dashboard', exact: true },
  { href: '/admin/tenants', label: 'Businesses', icon: 'customers' },
  { href: '/admin/activity', label: 'Activity', icon: 'history' },
  { href: '/admin/team', label: 'Team & security', icon: 'users' },
];

const TITLES: [RegExp, string][] = [
  [/^\/admin\/tenants\/[^/]+$/, 'Business'],
  [/^\/admin\/tenants$/, 'Businesses'],
  [/^\/admin\/activity$/, 'Activity'],
  [/^\/admin\/team$/, 'Team & security'],
  [/^\/admin$/, 'Overview'],
];

/** The platform console: where the person who sells the software sees every business that uses it. */
function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const admin = usePlatformAdmin();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const isLogin = pathname === '/admin/login';

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready && !admin && !isLogin) router.replace('/admin/login');
  }, [ready, admin, isLogin, router]);
  useEffect(() => {
    const title = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = `${title ?? 'Console'} · Platform console`;
  }, [pathname]);

  if (isLogin) return <FeedbackProvider>{children}</FeedbackProvider>;
  if (!admin) return null;

  const active = (n: (typeof NAV)[number]) => (n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`));

  return (
    <FeedbackProvider>
      <div className="shell admin-shell">
        <div className={`scrim${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
        <nav className={`sidebar${open ? ' open' : ''}`} aria-label="Console menu">
          <div className="brand">
            <span className="logo"><Icon name="panel" /></span>
            <span className="brand-text">Platform console<small>All businesses</small></span>
          </div>
          <div className="nav-group">
            <div className="nav-items"><div>
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={`nav-link${active(n) ? ' active' : ''}`} aria-current={active(n) ? 'page' : undefined}>
                  <Icon name={n.icon} /><span className="nav-label">{n.label}</span>
                </Link>
              ))}
            </div></div>
          </div>
        </nav>
        <div className="main">
          <header className="topbar">
            <button className="menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" /></button>
            <nav className="crumbs" aria-label="Breadcrumb"><ol><li>Platform</li><li aria-current="page">{TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Console'}</li></ol></nav>
            <span className="topbar-fill" />
            <div className="top-right">
              <span className="admin-who"><Avatar user={{ username: admin.displayName || admin.username }} size={30} /><span><b>{admin.displayName || admin.username}</b><small>Platform admin</small></span></span>
              <button type="button" className="secondary btn-icon" onClick={() => { clearPlatformSession(); router.replace('/admin/login'); }}><Icon name="logout" />Sign out</button>
            </div>
          </header>
          <main className="content" id="main" tabIndex={-1}>{children}</main>
        </div>
      </div>
    </FeedbackProvider>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}><AdminShell>{children}</AdminShell></Suspense>;
}
