'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BusyButton, Empty, useConfirm, useToast } from '@/components/Feedback';
import { Affix, Field, FormActions, FormCard, FormSection, Toggle } from '@/components/Form';
import { Icon } from '@/components/Icon';
import MoveLines, { EMPTY_MOVE, moveItems, type MoveLine } from '@/components/MoveLines';
import { api, can, useUser } from '@/lib/api';
import { formatQty, useLookups } from '@/lib/lookups';
import { usePageTitle } from '@/lib/pageTitle';
import type { TripDetail, TripLine } from '@/lib/trips';
import { formatDate, methodLabel, money, productLabel, round2, rupees } from '@dist/shared';

interface StockRow { productId: string; locationId: string; ok: string; units: { unitName: string; factorToBase: string }[]; baseUnit: string }

/** Bottles per peti for a product, or 0 when it is not sold by the peti. */
const petiOf = (l: Pick<TripLine, 'units'>) => Number(l.units.find((u) => u.unitName === 'CARTON')?.factorToBase ?? 0);
const q = (v: string | number, l: Pick<TripLine, 'units' | 'baseUnit'>) => formatQty(Number(v), l.units, l.baseUnit);

/** Counting in peti + loose bottles (or kg), returned as base units. */
function CountInput({ line, value, onChange }: { line: TripLine; value: { peti: string; loose: string }; onChange: (v: { peti: string; loose: string }) => void }) {
  const f = petiOf(line);
  if (f > 1) {
    return (
      <div className="count-input">
        <Affix suffix="peti"><input aria-label={`${line.name} peti counted`} type="number" min="0" step="1" inputMode="numeric" value={value.peti} placeholder="0" onChange={(e) => onChange({ ...value, peti: e.target.value })} /></Affix>
        <Affix suffix="btl"><input aria-label={`${line.name} loose bottles counted`} type="number" min="0" step="1" inputMode="numeric" value={value.loose} placeholder="0" onChange={(e) => onChange({ ...value, loose: e.target.value })} /></Affix>
      </div>
    );
  }
  return (
    <div className="count-input one">
      <Affix suffix={line.baseUnit === 'KG' ? 'kg' : 'btl'}><input aria-label={`${line.name} counted`} type="number" min="0" step="any" inputMode="decimal" value={value.loose} placeholder="0" onChange={(e) => onChange({ ...value, loose: e.target.value })} /></Affix>
    </div>
  );
}
const counted = (l: TripLine, v?: { peti: string; loose: string }) => (v ? (Number(v.peti) || 0) * (petiOf(l) || 0) + (Number(v.loose) || 0) : null);
/** Prefill: what the books expect, split into peti and loose. */
const split = (l: TripLine) => {
  const e = Number(l.expected), f = petiOf(l);
  return f > 1 ? { peti: String(Math.trunc(e / f)), loose: String(e - Math.trunc(e / f) * f) } : { peti: '', loose: String(e) };
};

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const { products, locations } = useLookups();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<Record<string, { peti: string; loose: string }>>({});
  const [cash, setCash] = useState('');
  const [unloadTo, setUnloadTo] = useState('');
  const [asAdvance, setAsAdvance] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState<{ from: string; lines: MoveLine[] } | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  usePageTitle(trip ? `${trip.tripNo} · ${trip.vehicle.name}` : null);

  const load = useCallback(() => api<TripDetail>(`/trips/${id}`).then((t) => { setTrip(t); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<StockRow[]>('/stock').then(setStock).catch(() => {}); }, [trip?.lines.length]);

  const godowns = locations.filter((l) => l.type !== 'VEHICLE');
  const unloadChoice = unloadTo || godowns.find((l) => l.type === 'GODOWN')?.id || '';
  const unload = unloadChoice === 'keep' ? '' : unloadChoice;
  const open = trip?.status === 'OPEN';
  const canSettle = can(user, 'STOCK_ADJUST');
  const rows = useMemo(() => (trip?.lines ?? []).map((l) => {
    const c = counted(l, counts[l.productId]);
    return { l, c, diff: c === null ? null : round2(c - Number(l.expected)) };
  }), [trip, counts]);
  const allCounted = rows.every((r) => r.c !== null || Number(r.l.expected) === 0);
  const short = trip ? round2(Number(trip.cash.expected) - (Number(cash) || 0)) : 0;

  async function settle(e: FormEvent) {
    e.preventDefault();
    if (!trip) return;
    const off = rows.filter((r) => r.diff);
    const ok = await confirm({
      title: `Settle ${trip.tripNo}?`,
      body: (
        <>
          {off.length ? <p>{off.length} product{off.length === 1 ? ' is' : 's are'} off: the difference is posted as a stock adjustment.</p> : <p>Stock matches the books.</p>}
          <p>Cash: due Rs {money(trip.cash.expected)}, handed over Rs {money(Number(cash) || 0)}{short > 0 ? <> — <b>short Rs {money(short)}</b>{asAdvance ? `, recorded as an advance to ${trip.salesman?.name}` : ''}</> : short < 0 ? ` — Rs ${money(-short)} extra` : ''}.</p>
          {unload && <p>What was counted goes back to {locations.find((l) => l.id === unload)?.name}.</p>}
        </>
      ),
      confirmLabel: 'Settle trip',
    });
    if (!ok) return;
    setBusy('settle');
    try {
      const t = await api<TripDetail>(`/trips/${id}/settle`, {
        method: 'POST',
        json: {
          lines: rows.filter((r) => r.c !== null).map((r) => ({ productId: r.l.productId, counted: r.c })),
          cashReceived: Number(cash) || 0, unloadToLocationId: unload || undefined, shortageAsAdvance: asAdvance && short > 0 || undefined, note: note || undefined,
        },
      });
      setTrip(t);
      toast.success(`${t.tripNo} settled`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function loadMore(e: FormEvent) {
    e.preventDefault();
    if (!loading) return;
    setBusy('load');
    try {
      const t = await api<TripDetail>(`/trips/${id}/load`, { method: 'POST', json: { fromLocationId: loading.from, items: moveItems(loading.lines) } });
      setTrip(t);
      setLoading(null);
      toast.success('Loaded');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (error && !trip) return <><Link className="back" href="/trips"><Icon name="chevronLeft" />Vehicle trips</Link><p className="error">{error}</p></>;
  if (!trip) return <span className="skeleton" style={{ display: 'block', height: 420 }} />;

  const loadedTotal = trip.lines.reduce((s, l) => s + Number(l.loaded), 0);
  const soldTotal = trip.lines.reduce((s, l) => s + Number(l.sold), 0);

  return (
    <>
      <Link className="back" href="/trips"><Icon name="chevronLeft" />Vehicle trips</Link>
      <div className="page-head">
        <div>
          <h1>{trip.vehicle.name} <span className={`badge ${open ? 'amber' : 'green'}`}>{open ? 'On the road' : 'Settled'}</span></h1>
          <p>{trip.tripNo} · {formatDate(trip.date)}{trip.salesman ? ` · ${trip.salesman.name}` : ''}{trip.note ? ` · ${trip.note}` : ''}</p>
        </div>
        {open && can(user, 'STOCK_TRANSFER') && (
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setLoading({ from: godowns.find((l) => l.type === 'GODOWN')?.id ?? '', lines: [{ ...EMPTY_MOVE }] })}><Icon name="plus" />Load more</button>
            <Link className="btn secondary" href={`/sales/new?location=${trip.vehicle.id}${trip.salesman ? `&salesman=${trip.salesman.id}` : ''}`}><Icon name="sales" />New bill from this vehicle</Link>
          </div>
        )}
      </div>

      <div className="stats">
        <div className="stat"><span className="label"><span className="icon"><Icon name="stock" /></span>Loaded</span><span className="value">{rupees(loadedTotal)}</span><span className="sub">bottles / kg in {trip.lines.length} products</span></div>
        <div className="stat"><span className="label"><span className="icon blue"><Icon name="sales" /></span>Sold</span><span className="value">{rupees(soldTotal)}</span><span className="sub">{trip.totals.bills} bill{trip.totals.bills === 1 ? '' : 's'} · Rs {rupees(trip.totals.net)}</span></div>
        <div className="stat"><span className="label"><span className="icon green"><Icon name="wallet" /></span>Cash to collect</span><span className="value"><small>Rs</small>{rupees(trip.cash.expected)}</span><span className="sub">{Object.entries(trip.cash.byMethod).filter(([m]) => m !== 'CASH').map(([m, v]) => `${methodLabel(m)} ${rupees(v)}`).join(' · ') || 'cash taken with bills'}</span></div>
        <div className="stat"><span className="label"><span className="icon amber"><Icon name="khata" /></span>Udhaar given</span><span className="value"><small>Rs</small>{rupees(trip.totals.udhaar)}</span><span className="sub">on this trip&apos;s bills</span></div>
      </div>

      {loading && (
        <FormCard title="Load more" onSubmit={loadMore} actions={<FormActions><button type="button" className="secondary" onClick={() => setLoading(null)}>Cancel</button><BusyButton type="submit" busy={busy === 'load'}>Load onto {trip.vehicle.name}</BusyButton></FormActions>}>
          <FormSection>
            <Field label="From" span={4}>
              <select value={loading.from} onChange={(e) => setLoading({ ...loading, from: e.target.value })}>{godowns.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </Field>
            <MoveLines id="more" products={products} lines={loading.lines} onChange={(lines) => setLoading({ ...loading, lines })}
              available={(pid) => { const r = stock.find((x) => x.productId === pid && x.locationId === loading.from); return pid ? (r ? formatQty(r.ok, r.units, r.baseUnit) : '0') : '—'; }} />
          </FormSection>
        </FormCard>
      )}

      {open ? (
        <form className="card trip-settle" onSubmit={settle}>
          <div className="card-head"><h2>Evening count</h2><span className="muted" style={{ fontSize: 13 }}>Count what is on the vehicle. It starts at what the books expect.</span></div>
          <div className="table-wrap">
            <table className="trip-table">
              <thead><tr><th>Product</th><th className="num">At start</th><th className="num">Loaded</th><th className="num">Sold</th><th className="num">Should be</th><th>Counted</th><th className="num">Difference</th></tr></thead>
              <tbody>
                {rows.map(({ l, diff }) => (
                  <tr key={l.productId} className={diff ? (diff < 0 ? 'row-short' : 'row-extra') : ''}>
                    <td><b>{productLabel(l)}</b>{Number(l.other) !== 0 && <div className="muted" style={{ fontSize: 12 }}>other moves {q(l.other, l)}</div>}{Number(l.damaged) !== 0 && <div className="muted" style={{ fontSize: 12 }}>{q(l.damaged, l)} damaged on board</div>}</td>
                    <td className="num muted">{Number(l.atStart) ? q(l.atStart, l) : '—'}</td>
                    <td className="num">{q(l.loaded, l)}</td>
                    <td className="num">{q(l.sold, l)}</td>
                    <td className="num"><b>{q(l.expected, l)}</b></td>
                    <td><CountInput line={l} value={counts[l.productId] ?? split(l)} onChange={(v) => setCounts({ ...counts, [l.productId]: v })} /></td>
                    <td className="num">{diff ? <b className={diff < 0 ? 'amt-debit' : 'amt-credit'}>{diff > 0 ? '+' : '−'}{q(Math.abs(diff), l)}</b> : <span className="muted">✓</span>}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={7}><Empty icon="stock" title="Nothing on this vehicle" text="Load stock onto it, or settle to close the trip." /></td></tr>}
              </tbody>
            </table>
          </div>

          <div className="fgrid trip-cash">
            <Field label="Cash handed over" required span={4} hint={`Due Rs ${money(trip.cash.expected)} from cash taken with this trip's bills`}
              error={short > 0 && cash !== '' ? `Short Rs ${money(short)}` : undefined}>
              <Affix prefix="Rs"><input className="big" type="number" min="0" step="any" required inputMode="decimal" value={cash} placeholder={String(Number(trip.cash.expected))} onChange={(e) => setCash(e.target.value)} /></Affix>
            </Field>
            <Field label="Unload counted stock to" span={4} hint="Leave stock on the vehicle by choosing “Keep on vehicle”">
              <select value={unloadChoice} onChange={(e) => setUnloadTo(e.target.value)}>
                {godowns.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                <option value="keep">Keep on vehicle</option>
              </select>
            </Field>
            <Field label="Note" optional span={4}><input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {short > 0 && cash !== '' && trip.salesman && can(user, 'PAYROLL_MANAGE') && (
              <div className="fld span-12">
                <Toggle checked={asAdvance} onChange={setAsAdvance} label={`Recover Rs ${money(short)} from ${trip.salesman.name}'s salary`} description="Recorded as a salary advance; it is cut in the next payroll." />
              </div>
            )}
          </div>
          {canSettle && (
            <FormActions note={allCounted ? undefined : 'Count every product before settling'}>
              <BusyButton type="submit" busy={busy === 'settle'} disabled={!allCounted || cash === ''}><Icon name="check" />Settle trip</BusyButton>
            </FormActions>
          )}
        </form>
      ) : (
        <section className="card">
          <div className="card-head"><h2>Settlement</h2><span className="muted" style={{ fontSize: 13 }}>{trip.settledAt && formatDate(trip.settledAt, 'datetime')}</span></div>
          <div className="table-wrap">
            <table className="trip-table">
              <thead><tr><th>Product</th><th className="num">Loaded</th><th className="num">Sold</th><th className="num">Should be</th><th className="num">Counted</th><th className="num">Difference</th><th className="num">Unloaded</th></tr></thead>
              <tbody>
                {trip.settledLines.map((s) => {
                  const l = trip.lines.find((x) => x.productId === s.productId) ?? { units: [], baseUnit: 'BOTTLE' };
                  const d = Number(s.diff);
                  return (
                    <tr key={s.productId} className={d ? (d < 0 ? 'row-short' : 'row-extra') : ''}>
                      <td><b>{productLabel(s.product)}</b></td>
                      <td className="num">{q(s.loaded, l)}</td><td className="num">{q(s.sold, l)}</td><td className="num">{q(s.expected, l)}</td><td className="num">{q(s.counted, l)}</td>
                      <td className="num">{d ? <b className={d < 0 ? 'amt-debit' : 'amt-credit'}>{d > 0 ? '+' : '−'}{q(Math.abs(d), l)}</b> : <span className="muted">✓</span>}</td>
                      <td className="num">{Number(s.unloaded) ? q(s.unloaded, l) : <span className="muted">kept</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="totals trip-cash-sum">
            <dt>Cash due</dt><dd>Rs {money(trip.cash.expected)}</dd>
            <dt>Handed over</dt><dd>Rs {money(trip.cash.received ?? 0)}</dd>
            <dt><b>{Number(trip.cash.short) > 0 ? 'Short' : Number(trip.cash.short) < 0 ? 'Extra' : 'Difference'}</b></dt><dd><b className={Number(trip.cash.short) > 0 ? 'amt-debit' : ''}>Rs {money(Math.abs(Number(trip.cash.short ?? 0)))}</b></dd>
          </dl>
          {trip.advance && <p className="muted">Rs {money(trip.advance.amount)} recorded as an advance to {trip.salesman?.name} — <Link href={`/payroll/advances/${trip.advance.id}`}>advance slip</Link>.</p>}
        </section>
      )}

      <h2 style={{ marginTop: 24 }}>Bills on this trip</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Bill</th><th>Customer</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Udhaar</th></tr></thead>
          <tbody>
            {trip.sales.map((s) => (
              <tr key={s.id}>
                <td>{formatDate(s.createdAt, 'time')}</td>
                <td><Link href={`/sales/${s.id}`}>{s.billNo}</Link></td>
                <td>{s.customer?.name ?? <span className="muted">Walk-in</span>}</td>
                <td className="num"><b>{money(s.net)}</b></td>
                <td className="num">{money(s.paidNow)}</td>
                <td className="num">{Number(s.net) - Number(s.paidNow) > 0 ? <span className="amt-debit">{money(Number(s.net) - Number(s.paidNow))}</span> : <span className="muted">—</span>}</td>
              </tr>
            ))}
            {!trip.sales.length && <tr><td colSpan={6}><Empty icon="sales" title="No bills yet" text="Delivery bills made from this vehicle while it is out show here." /></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
