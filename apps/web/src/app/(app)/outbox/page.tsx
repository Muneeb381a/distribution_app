'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Combobox from '@/components/Combobox';
import DocPrintDialog from '@/components/DocPrintDialog';
import { BusyButton, Empty, useConfirm, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { can, useUser } from '@/lib/api';
import { customerOptions } from '@/lib/lookups';
import {
  allOps, discardOp, getSnapshot, retryOp, savePaymentOffline, syncNow, useOutboxVersion, useSyncState,
  type OutboxOp, type Snapshot,
} from '@/lib/offline';
import { usePageTitle } from '@/lib/pageTitle';
import { formatDate, money, BILL_PAYMENT_METHODS, timeAgo } from '@dist/shared';

// Cheques are taken on the khata page, where they can later be cleared or bounced.
const METHODS = BILL_PAYMENT_METHODS.map((m) => [m.value, m.label] as const);

export default function OutboxPage() {
  usePageTitle('Offline outbox');
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const sync = useSyncState();
  const version = useOutboxVersion();
  const [ops, setOps] = useState<OutboxOp[] | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [printing, setPrinting] = useState<OutboxOp | null>(null);
  const [pay, setPay] = useState({ customerId: '', amount: '', method: 'CASH', note: '' });
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    allOps().then((o) => setOps(o.reverse()));
  }, [version]);
  useEffect(() => {
    getSnapshot().then(setSnap);
  }, [sync.snapshotAt]);

  const waiting = ops?.filter((o) => o.status === 'pending') ?? [];
  const failed = ops?.filter((o) => o.status === 'failed') ?? [];
  const flagged = ops?.filter((o) => o.status === 'done' && o.flags?.length) ?? [];
  const customerOpts = useMemo(() => customerOptions(snap?.customers ?? []), [snap]);
  const balanceOf = (id: string) => {
    const base = Number(snap?.customers.find((c) => c.id === id)?.balance ?? 0);
    return base + (ops ?? []).filter((o) => o.customerId === id && o.status === 'pending').reduce((s, o) => s + o.balanceDelta, 0);
  };

  async function discard(o: OutboxOp) {
    const ok = await confirm({
      title: `Discard ${o.kind === 'SALE' ? 'bill' : 'receipt'} ${o.number}?`,
      body: <><p>It is removed from this PC and never reaches the server. If a slip was printed and handed over, take it back.</p><p>Only do this for a {o.kind === 'SALE' ? 'bill' : 'receipt'} that should not count.</p></>,
      confirmLabel: 'Discard', cancelLabel: 'Keep', danger: true,
    });
    if (!ok) return;
    await discardOp(o.clientId);
    toast.info(`${o.number} discarded`);
  }

  async function receive(e: FormEvent) {
    e.preventDefault();
    if (!snap) return;
    setBusy(true);
    try {
      const op = await savePaymentOffline(snap, { customerId: pay.customerId, amount: Number(pay.amount), method: pay.method, note: pay.note || undefined }, clientId);
      setClientId(crypto.randomUUID());
      setPay({ customerId: '', amount: '', method: 'CASH', note: '' });
      toast.success(`Receipt ${op.number} saved on this PC`);
      setPrinting(op);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tone = (o: OutboxOp) =>
    o.status === 'failed' ? <span className="badge red">Needs attention</span>
      : o.status === 'pending' ? <span className="badge amber">Waiting to sync</span>
      : o.flags?.length ? <span className="badge amber">Synced · check</span>
      : <span className="badge green">Synced</span>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Offline outbox</h1>
          <p>Bills and receipts made on this PC without a connection. They sync on their own; nothing here is lost if the browser closes.</p>
        </div>
        <div className="actions">
          <Link className="btn" href="/sales/new"><Icon name="plus" />New bill</Link>
          <BusyButton busy={sync.syncing} disabled={!waiting.length} onClick={() => syncNow()}>{!sync.syncing && <Icon name="refresh" />}Sync now</BusyButton>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="label"><span className={`icon ${sync.reachable ? 'green' : 'amber'}`}><Icon name={sync.reachable ? 'cloud' : 'wifiOff'} /></span>Connection</span>
          <span className="value" style={{ fontSize: 22 }}>{sync.reachable ? 'Online' : 'Offline'}</span>
          <span className="sub">Last sync {timeAgo(sync.lastSync)}</span>
        </div>
        <div className="stat">
          <span className="label"><span className="icon amber"><Icon name="history" /></span>Waiting</span>
          <span className="value">{waiting.length}</span>
          <span className="sub">Rs {money(waiting.reduce((s, o) => s + Number(o.bill?.net ?? o.payment?.amount ?? 0), 0))}</span>
        </div>
        <div className="stat">
          <span className="label"><span className={`icon ${failed.length ? 'red' : 'green'}`}><Icon name="alert" /></span>Need attention</span>
          <span className={`value${failed.length ? ' neg' : ''}`}>{failed.length + flagged.length}</span>
          <span className="sub">{failed.length ? 'Fix and retry, or discard' : flagged.length ? 'Synced with a warning' : 'All good'}</span>
        </div>
        <div className="stat">
          <span className="label"><span className="icon"><Icon name="monitor" /></span>This PC</span>
          <span className="value" style={{ fontSize: 22 }}>{sync.prefix ?? '—'}</span>
          <span className="sub">{snap ? `Data saved ${timeAgo(snap.at)}` : 'No offline data yet'}</span>
        </div>
      </div>

      {!sync.prefix && (
        <p className="error"><Icon name="alert" /> This PC has no device number yet, so it cannot bill offline. Open the app once while connected to set it up.</p>
      )}

      <div className="doc-grid">
        <div>
          {failed.length > 0 && (
            <section className="card alert-card">
              <h2><Icon name="alert" /> Needs attention</h2>
              <p className="card-sub" style={{ margin: '0 0 12px' }}>The server could not accept these. Fix the cause (for example record a stock transfer) and retry, or discard.</p>
              <ul className="list">
                {failed.map((o) => (
                  <li key={o.clientId} style={{ flexWrap: 'wrap' }}>
                    <span className="who-line">
                      <b>{o.number}</b>
                      <span>{o.bill?.customer?.name ?? o.receipt?.customer.name ?? 'Walk-in'} · Rs {money(o.bill?.net ?? o.payment?.amount ?? 0)} · {formatDate(o.savedAt, 'datetime')}</span>
                      <span className="error" style={{ display: 'block' }}>{o.error}</span>
                    </span>
                    <span className="row-actions">
                      <button type="button" className="secondary" onClick={() => setPrinting(o)}><Icon name="print" /></button>
                      <button type="button" className="secondary" onClick={() => retryOp(o.clientId)}>Retry</button>
                      <button type="button" className="danger-ghost" onClick={() => discard(o)}>Discard</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <table className="outbox-list">
            <thead><tr><th>Number</th><th>Customer</th><th className="num">Amount</th><th>Saved</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {(ops ?? []).map((o) => (
                <tr key={o.clientId}>
                  <td><b>{o.number}</b><div className="muted" style={{ fontSize: 12.5 }}>{o.kind === 'SALE' ? 'Bill' : 'Receipt'}</div></td>
                  <td>{o.bill?.customer?.name ?? o.receipt?.customer.name ?? <span className="muted">Walk-in</span>}</td>
                  <td className="num"><b>{money(o.bill?.net ?? o.payment?.amount ?? 0)}</b></td>
                  <td className="muted">{formatDate(o.savedAt, 'datetime')}</td>
                  <td>
                    {tone(o)}
                    {o.flags?.map((f) => <div key={f} className="muted" style={{ fontSize: 12.5, whiteSpace: 'normal', maxWidth: 280 }}>{f.replace(/^[A-Z_]+: /, '')}</div>)}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="secondary icon-only" title="Reprint" aria-label={`Reprint ${o.number}`} onClick={() => setPrinting(o)}><Icon name="print" /></button>
                      {o.serverId && <Link href={o.kind === 'SALE' ? `/sales/${o.serverId}` : `/receipts/${o.serverId}`}>Open</Link>}
                    </div>
                  </td>
                </tr>
              ))}
              {ops && !ops.length && (
                <tr><td colSpan={6}><Empty icon="cloud" title="Nothing in the outbox" text="When the connection drops, new bills are kept here until they sync." /></td></tr>
              )}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 13 }}>Synced documents stay here for a week for reprinting. Offline bills use this PC&apos;s numbers ({sync.prefix ?? 'D?'}) so they never clash with the server or another PC.</p>
        </div>

        <aside className="doc-side">
          {can(user, 'PAYMENT_RECORD') && (
            <form className="card side-form receipt" onSubmit={receive}>
              <h2 style={{ margin: 0 }}>Receive payment offline</h2>
              <p className="card-sub" style={{ margin: 0 }}>For when the khata page can&apos;t load. The receipt prints now and syncs later.</p>
              <div className="field">
                <span className="field-label">Customer</span>
                <Combobox ariaLabel="Customer" required options={customerOpts} value={pay.customerId} recentKey="customer" placeholder={snap ? 'Search name, shop, phone…' : 'No offline data'} disabled={!snap} onChange={(v) => setPay({ ...pay, customerId: v })} />
              </div>
              {pay.customerId && <p className="muted" style={{ margin: 0 }}>Balance on this PC: <b>Rs {money(balanceOf(pay.customerId))}</b></p>}
              <label>Amount (Rs)<input className="big" type="number" step="any" min="1" required inputMode="decimal" placeholder="0" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
              <div className="chips" role="radiogroup" aria-label="Method">
                {METHODS.map(([v, l]) => <button type="button" role="radio" aria-checked={pay.method === v} key={v} className={`chip${pay.method === v ? ' on' : ''}`} onClick={() => setPay({ ...pay, method: v })}>{l}</button>)}
              </div>
              <label>Note<input value={pay.note} placeholder="Optional" onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
              <BusyButton type="submit" busy={busy} disabled={!snap || !sync.prefix}><Icon name="print" />Save &amp; print receipt</BusyButton>
            </form>
          )}
        </aside>
      </div>

      {printing && <DocPrintDialog bill={printing.bill} receipt={printing.receipt} onClose={() => setPrinting(null)} />}
    </>
  );
}
