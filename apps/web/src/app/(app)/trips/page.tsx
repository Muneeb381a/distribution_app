'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/Avatar';
import { BusyButton, Empty, SkeletonRows, useToast } from '@/components/Feedback';
import { Field, FormActions, FormCard, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import MoveLines, { EMPTY_MOVE, moveItems, type MoveLine } from '@/components/MoveLines';
import { StatTiles } from '@/components/StatTiles';
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
  // Clock for "out for 3 h"; ticks once a minute.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

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

  const outFor = (iso: string) => {
    if (!now) return '';
    const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
    return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  };
  const loadedLines = moveItems(lines).length;
  const chosenVehicle = vehicles.find((v) => v.id === f.vehicleId);
  const fromName = sources.find((l) => l.id === from)?.name ?? 'the godown';
  const shortTotal = settled.reduce((s, t) => s + Math.max(0, Number(t.cashExpected ?? 0) - Number(t.cashReceived ?? 0)), 0);

  return (
    <>
      <div className="page-head">
        <div><h1>Vehicle trips</h1><p>Load a vehicle in the morning, settle stock and cash when it comes back.</p></div>
      </div>
      {error && <p className="error">{error}</p>}

      <StatTiles items={[
        { label: 'On the road', value: open.length, sub: open.length ? 'waiting to be settled' : 'all vehicles are back', icon: 'suppliers', tone: open.length ? 'amber' : 'green' },
        { label: 'Vehicles free', value: Math.max(0, vehicles.length - onRoad.size), sub: `of ${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`, icon: 'locations' },
        { label: 'Trips settled', value: settled.length, icon: 'check', tone: 'green' },
        { label: 'Cash short', value: shortTotal ? <><small>Rs</small>{rupees(shortTotal)}</> : '0', sub: 'across settled trips', icon: 'wallet', tone: shortTotal ? 'red' : 'green' },
      ]} />

      <div className="section-head"><h2>On the road</h2>{trips && <span className="count-pill">{open.length}</span>}</div>
      {!trips && !error && <div className="trip-cards"><span className="skeleton" style={{ height: 150 }} /></div>}
      {trips && !open.length && (
        <div className="trip-empty"><Icon name="suppliers" /><div><b>No vehicle is out right now</b><span>Start a trip below to load a vehicle and send it out.</span></div></div>
      )}
      <div className="trip-cards">
        {open.map((t) => (
          <Link key={t.id} href={`/trips/${t.id}`} className="card trip-card">
            <div className="trip-card-head"><span className="badge amber"><i className="live-dot" />On the road</span><span className="muted">{t.tripNo}</span></div>
            <span className="trip-vehicle-row">
              <span className="trip-truck"><Icon name="suppliers" /></span>
              <span className="trip-vehicle-text"><b className="trip-vehicle">{t.vehicle.name}</b><span className="muted">out for {outFor(t.openedAt) || '…'} · since {formatDate(t.openedAt, 'time')}</span></span>
            </span>
            <span className="trip-who">
              {t.salesman ? <><Avatar user={{ username: t.salesman.name }} size={24} />{t.salesman.name}</> : <span className="muted">No salesman</span>}
            </span>
            <span className="trip-go">Settle when back <Icon name="chevronRight" /></span>
          </Link>
        ))}
      </div>

      {can(user, 'STOCK_TRANSFER') && (
        <>
          <div className="section-head"><h2>Start a trip</h2></div>
          <FormCard description="The vehicle is loaded from the godown in one transfer. Load more later from the trip page." onSubmit={start}
            actions={(
              <FormActions note={chosenVehicle ? `${chosenVehicle.name} · ${loadedLines ? `${loadedLines} product${loadedLines === 1 ? '' : 's'} from ${fromName}` : 'starts with what is already on it'}` : 'Choose a vehicle to start'}>
                <BusyButton type="submit" busy={busy} disabled={!f.vehicleId}><Icon name="plus" />Start trip{loadedLines ? ' and load' : ''}</BusyButton>
              </FormActions>
            )}>
            <FormSection title="1 · Vehicle" description="Which vehicle is going out, and who is driving or selling.">
              <div className="fld span-12">
                <span className="fld-label"><span>Vehicle</span><span className="req" aria-hidden="true">*</span></span>
                {vehicles.length ? (
                  <div className="pick-grid" role="radiogroup" aria-label="Vehicle">
                    {vehicles.map((v) => {
                      const busyV = onRoad.has(v.id);
                      return (
                        <button key={v.id} type="button" role="radio" aria-checked={f.vehicleId === v.id} disabled={busyV} className={`pick${f.vehicleId === v.id ? ' on' : ''}`} onClick={() => setF({ ...f, vehicleId: v.id })}>
                          <span className="pick-icon"><Icon name="suppliers" /></span>
                          <b>{v.name}</b>
                          <span className={`badge ${busyV ? 'amber' : 'green'}`}>{busyV ? 'On the road' : 'Free'}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : <p className="fld-hint">No vehicle yet. <Link href="/vehicles">Add your first vehicle</Link>, then come back to start a trip.</p>}
                {vehicles.length > 0 && <p className="fld-hint">Vehicle not here? <Link href="/vehicles">Add a vehicle</Link>.</p>}
              </div>
              <div className="fld span-12">
                <span className="fld-label"><span>Salesman</span><span className="opt">Optional</span></span>
                <div className="pick-chips" role="radiogroup" aria-label="Salesman">
                  <button type="button" role="radio" aria-checked={!f.salesmanId} className={`pick-chip${!f.salesmanId ? ' on' : ''}`} onClick={() => setF({ ...f, salesmanId: '' })}>No salesman</button>
                  {salesmen.map((s) => (
                    <button key={s.id} type="button" role="radio" aria-checked={f.salesmanId === s.id} className={`pick-chip${f.salesmanId === s.id ? ' on' : ''}`} onClick={() => setF({ ...f, salesmanId: s.id })}>
                      <Avatar user={{ username: s.name }} size={22} />{s.name}
                    </button>
                  ))}
                </div>
              </div>
            </FormSection>
            <FormSection title="2 · Load" description="What goes on the vehicle now. You can leave this empty and load later.">
              <div className="fld span-12">
                <span className="fld-label"><span>Load from</span></span>
                <div className="pick-chips" role="radiogroup" aria-label="Load from">
                  {sources.map((l) => (
                    <button key={l.id} type="button" role="radio" aria-checked={from === l.id} className={`pick-chip${from === l.id ? ' on' : ''}`} onClick={() => setF({ ...f, fromLocationId: l.id })}>
                      <Icon name={l.type === 'GODOWN' ? 'stock' : 'locations'} />{l.name}
                    </button>
                  ))}
                </div>
              </div>
              <MoveLines id="trip" optional products={products} lines={lines} onChange={setLines} available={available} note="Leave empty to start with what is already on the vehicle." />
            </FormSection>
            <FormSection title="3 · Route" description="A reminder of where it is heading.">
              <Field label="Route / note" optional span={12}><input maxLength={200} value={f.note} placeholder="e.g. Johar Town, Model Town" onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            </FormSection>
          </FormCard>
        </>
      )}

      <div className="section-head"><h2>Settled trips</h2>{trips && <span className="count-pill">{settled.length}</span>}</div>
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
                  <td className="nowrap">{formatDate(t.date)}</td>
                  <td><Link className="bill-no" href={`/trips/${t.id}`}>{t.tripNo}</Link></td>
                  <td><span className="badge blue">{t.vehicle.name}</span></td>
                  <td>{t.salesman ? <span className="person"><Avatar user={{ username: t.salesman.name }} size={26} /><b>{t.salesman.name}</b></span> : <span className="muted">—</span>}</td>
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
