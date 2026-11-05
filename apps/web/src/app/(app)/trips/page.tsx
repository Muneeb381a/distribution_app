'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BusyButton, Empty, SkeletonRows, useToast } from '@/components/Feedback';
import { Field, FormActions, FormCard, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import MoveLines, { EMPTY_MOVE, moveItems, type MoveLine } from '@/components/MoveLines';
import { api, can, useUser } from '@/lib/api';
import { formatQty, useLookups } from '@/lib/lookups';
import { usePageTitle } from '@/lib/pageTitle';
import type { TripRow } from '@/lib/trips';
import { formatDate, money, rupees } from '@dist/shared';

interface Employee { id: string; name: string }
interface StockRow { productId: string; locationId: string; ok: string; units: { unitName: string; factorToBase: string }[]; baseUnit: string }

/**
 * Vehicles on the road. Start a trip in the morning by loading the vehicle from the godown;
 * open it in the evening to count what came back and take the cash.
 */
export default function TripsPage() {
  usePageTitle('Vehicle trips');
  const user = useUser();
  const router = useRouter();
  const toast = useToast();
  const { products, locations } = useLookups();
  const [trips, setTrips] = useState<TripRow[] | null>(null);
  const [salesmen, setSalesmen] = useState<Employee[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [error, setError] = useState('');
  const vehicles = locations.filter((l) => l.type === 'VEHICLE');
  const sources = locations.filter((l) => l.type !== 'VEHICLE');
  const [f, setF] = useState({ vehicleId: '', salesmanId: '', fromLocationId: '', note: '' });
  const [lines, setLines] = useState<MoveLine[]>([{ ...EMPTY_MOVE }]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<TripRow[]>('/trips').then((t) => { setTrips(t); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    api<Employee[]>('/employees/options').then(setSalesmen).catch(() => {});
    api<StockRow[]>('/stock').then(setStock).catch(() => {});
  }, [load]);

  const open = (trips ?? []).filter((t) => t.status === 'OPEN');
  const settled = (trips ?? []).filter((t) => t.status === 'SETTLED');
  const onRoad = new Set(open.map((t) => t.vehicle.id));
  const from = f.fromLocationId || sources.find((l) => l.type === 'GODOWN')?.id || '';
  const available = (pid: string) => {
    if (!pid || !from) return '—';
    const r = stock.find((x) => x.productId === pid && x.locationId === from);
    return r ? formatQty(r.ok, r.units, r.baseUnit) : '0';
  };

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const t = await api<{ id: string; tripNo: string }>('/trips', {
        method: 'POST',
        json: { vehicleId: f.vehicleId, salesmanId: f.salesmanId || undefined, fromLocationId: from || undefined, items: moveItems(lines), note: f.note || undefined },
      });
      toast.success(`${t.tripNo} started${moveItems(lines).length ? ' and loaded' : ''}`);
      router.push(`/trips/${t.id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Vehicle trips</h1><p>Load a vehicle in the morning, settle stock and cash when it comes back.</p></div>
      </div>
      {error && <p className="error">{error}</p>}

      <h2>On the road</h2>
      {!trips && !error && <div className="trip-cards"><span className="skeleton" style={{ height: 150 }} /></div>}
      {trips && !open.length && <p className="muted">No vehicle is out right now.</p>}
      <div className="trip-cards">
        {open.map((t) => (
          <Link key={t.id} href={`/trips/${t.id}`} className="card trip-card">
            <div className="trip-card-head"><span className="badge amber">On the road</span><span className="muted">{t.tripNo}</span></div>
            <b className="trip-vehicle">{t.vehicle.name}</b>
            <span className="muted">{t.salesman?.name ?? 'No salesman'} · since {formatDate(t.openedAt, 'time')}</span>
            <span className="trip-go">Settle when back <Icon name="chevronRight" /></span>
          </Link>
        ))}
      </div>

      {can(user, 'STOCK_TRANSFER') && (
        <FormCard title="Start a trip" description="The vehicle is loaded from the godown in one transfer. Load more later from the trip page." onSubmit={start}
          actions={<FormActions><BusyButton type="submit" busy={busy}><Icon name="plus" />Start trip and load</BusyButton></FormActions>}>
          <FormSection>
            <Field label="Vehicle" required span={4} hint={!vehicles.length ? <>Add a vehicle under <Link href="/locations">Locations</Link> first</> : undefined}>
              <select required value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
                <option value="">Select vehicle…</option>
                {vehicles.map((v) => <option key={v.id} value={v.id} disabled={onRoad.has(v.id)}>{v.name}{onRoad.has(v.id) ? ' (on the road)' : ''}</option>)}
              </select>
            </Field>
            <Field label="Salesman" optional span={4}>
              <select value={f.salesmanId} onChange={(e) => setF({ ...f, salesmanId: e.target.value })}>
                <option value="">None</option>
                {salesmen.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Load from" span={4}>
              <select value={from} onChange={(e) => setF({ ...f, fromLocationId: e.target.value })}>
                {sources.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <MoveLines id="trip" optional products={products} lines={lines} onChange={setLines} available={available} note="Leave empty to start with what is already on the vehicle." />
            <Field label="Route / note" optional span={12}><input maxLength={200} value={f.note} placeholder="e.g. Johar Town, Model Town" onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          </FormSection>
        </FormCard>
      )}

      <h2 style={{ marginTop: 28 }}>Settled trips</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Trip</th><th>Vehicle</th><th>Salesman</th><th className="num">Cash due</th><th className="num">Handed over</th><th className="num">Short</th><th>Stock</th></tr></thead>
          <tbody>
            {!trips && !error && <SkeletonRows cols={8} />}
            {settled.map((t) => {
              const short = Number(t.cashExpected ?? 0) - Number(t.cashReceived ?? 0);
              const off = t.lines.filter((l) => Number(l.diff) !== 0).length;
              return (
                <tr key={t.id}>
                  <td>{formatDate(t.date)}</td>
                  <td><Link href={`/trips/${t.id}`}><b>{t.tripNo}</b></Link></td>
                  <td>{t.vehicle.name}</td>
                  <td>{t.salesman?.name ?? <span className="muted">—</span>}</td>
                  <td className="num">{money(t.cashExpected ?? 0)}</td>
                  <td className="num">{money(t.cashReceived ?? 0)}</td>
                  <td className="num">{short > 0 ? <span className="amt-debit">{rupees(short)}</span> : short < 0 ? <span className="amt-credit">+{rupees(-short)}</span> : <span className="muted">—</span>}</td>
                  <td>{off ? <span className="badge red">{off} item{off === 1 ? '' : 's'} off</span> : <span className="badge green">Matched</span>}</td>
                </tr>
              );
            })}
            {trips && !settled.length && <tr><td colSpan={8}><Empty icon="stock" title="No settled trips yet" text="Trips show here after the evening count." /></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
