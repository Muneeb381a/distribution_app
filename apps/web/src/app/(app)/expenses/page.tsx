'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BusyButton, Empty, SkeletonRows, useConfirm, useToast } from '@/components/Feedback';
import { Affix, Choice, Field, FormActions, FormCard, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { downloadCsv, LoadMore, SortTh, usePaged, useSort } from '@/components/Table';
import { api } from '@/lib/api';
import { formatDate, localDay, monthStart, rupees } from '@dist/shared';

/** A steady colour per category name, so the same category looks the same everywhere. */
const catColor = (name: string) => `hsl(${[...name.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11)} 62% 48%)`;

interface Place { id: string; name: string; type: 'GODOWN' | 'SHOP' | 'VEHICLE'; isActive: boolean }
interface Expense {
  id: string; date: string; category: string; amount: string; note: string | null; source: string | null; status: string;
  location: { id: string; name: string; type: string } | null;
}
const placeOf = (r: Expense) => r.location?.name ?? 'General';


export default function ExpensesPage() {
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [range, setRange] = useState({ from: localDay(monthStart()), to: localDay() });
  const [places, setPlaces] = useState<Place[]>([]);
  // 'ALL', 'none' (general) or a location id
  const [placeFilter, setPlaceFilter] = useState('ALL');
  const [form, setForm] = useState({ date: localDay(), category: '', locationId: '', amount: '', note: '' });
  const [fresh, setFresh] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(
    () => api<Expense[]>(`/expenses?from=${range.from}&to=${range.to}`).then((r) => { setRows(r); setError(''); }).catch((e) => setError(e.message)),
    [range],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api<string[]>('/expenses/categories').then(setCategories).catch(() => {});
    api<Place[]>('/locations').then((l) => setPlaces(l.filter((x) => x.isActive && x.type !== 'VEHICLE'))).catch(() => {});
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/expenses', {
        method: 'POST',
        json: { date: form.date, category: form.category.trim(), locationId: form.locationId || undefined, amount: Number(form.amount), note: form.note || undefined },
      });
      toast.success(`Rs ${rupees(form.amount)} for ${form.category} added`);
      if (!categories.includes(form.category.trim())) setCategories([...categories, form.category.trim()].sort());
      // keep date, category and place: the next entry is often the same kind
      setForm({ ...form, amount: '', note: '' });
      setFresh((n) => n + 1);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(r: Expense) {
    if (!(await confirm({ title: 'Cancel this expense?', body: <p>Rs {rupees(r.amount)} for {r.category} on {formatDate(r.date)}. It stays in the list as cancelled and no longer counts in reports.</p>, confirmLabel: 'Cancel expense', cancelLabel: 'Keep', danger: true }))) return;
    try {
      await api(`/expenses/${r.id}/cancel`, { method: 'POST', json: {} });
      toast.success('Expense cancelled');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const shown = useMemo(() => (rows ?? []).filter((r) => placeFilter === 'ALL' || (r.location?.id ?? 'none') === placeFilter), [rows, placeFilter]);
  // Totals per place for the chips, from every active entry in the date range.
  const placeTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (r.status === 'ACTIVE') m.set(r.location?.id ?? 'none', (m.get(r.location?.id ?? 'none') ?? 0) + Number(r.amount));
    return m;
  }, [rows]);
  const active = useMemo(() => shown.filter((r) => r.status === 'ACTIVE'), [shown]);
  const total = active.reduce((s, r) => s + Number(r.amount), 0);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of active) m.set(r.category, (m.get(r.category) ?? 0) + Number(r.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);
  type Key = 'date' | 'category' | 'amount';
  const { sorted, sort, toggle } = useSort<Expense, Key>(shown, (r, k) => (k === 'date' ? r.date : k === 'category' ? r.category : r.amount));
  const { page, loadMore } = usePaged(sorted, 30);

  return (
    <>
      <div className="page-head">
        <div><h1>Expenses</h1><p>Shop and business costs. Payroll adds salaries here automatically.</p></div>
        <button className="secondary btn-icon" disabled={!shown.length} onClick={() => downloadCsv(`expenses-${range.from}_${range.to}.csv`, ['Date', 'Category', 'Place', 'Amount', 'Note', 'Status'], shown.map((r) => [r.date.slice(0, 10), r.category, placeOf(r), r.amount, r.note, r.status.toLowerCase()]))}>
          <Icon name="download" />Export CSV
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="doc-grid">
        <div>
          <div className="filters">
            <div className="date-range">
              <input type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              <span className="muted">to</span>
              <input type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </div>
            <div className="chips" role="group" aria-label="Place">
              {[['ALL', 'All places'], ...places.map((p) => [p.id, p.name]), ['none', 'General']].map(([v, l]) => (
                <button key={v} type="button" className={`chip${placeFilter === v ? ' on' : ''}`} aria-pressed={placeFilter === v} onClick={() => setPlaceFilter(v)}>
                  {l}{v !== 'ALL' && placeTotals.get(v) ? <span className="chip-count">{rupees(placeTotals.get(v)!)}</span> : null}
                </button>
              ))}
            </div>
          </div>

          <StatTiles items={[
            { label: 'Total spent', value: <><small>Rs</small>{rupees(total)}</>, sub: `${formatDate(range.from, 'short')} to ${formatDate(range.to, 'short')}`, icon: 'expenses', tone: 'red' },
            { label: 'Entries', value: active.length, icon: 'file' },
            { label: 'Biggest', value: byCategory[0] ? byCategory[0][0] : '—', sub: byCategory[0] ? `Rs ${rupees(byCategory[0][1])}` : undefined, icon: 'trend', tone: 'amber' },
          ]} />

          <table className="sticky-head">
            <thead>
              <tr>
                <SortTh k="date" sort={sort} toggle={toggle}>Date</SortTh>
                <SortTh k="category" sort={sort} toggle={toggle}>Category</SortTh>
                <th>Place</th>
                <SortTh k="amount" sort={sort} toggle={toggle} num>Amount</SortTh>
                <th>Note</th><th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {!rows && !error && <SkeletonRows cols={6} />}
              {page.map((r) => (
                <tr key={r.id} className={r.status === 'CANCELLED' ? 'inactive' : ''}>
                  <td>{formatDate(r.date, 'short')}</td>
                  <td><span className="cat"><i className="cat-dot" style={{ background: catColor(r.category) }} /><b>{r.category}</b></span></td>
                  <td>{r.location ? <span className={`badge ${r.location.type === 'GODOWN' ? 'amber' : 'blue'}`}>{r.location.name}</span> : <span className="badge">General</span>}</td>
                  <td className="num">{r.status === 'CANCELLED' ? <s>{rupees(r.amount)}</s> : <b>{rupees(r.amount)}</b>}</td>
                  <td className="muted">{r.note}</td>
                  <td>
                    {r.status === 'CANCELLED' ? <span className="badge">Cancelled</span>
                      : r.source ? <span className="badge teal">Payroll</span>
                      : <button type="button" className="secondary icon-only danger-hover" title="Cancel expense" aria-label={`Cancel ${r.category} expense`} onClick={() => cancel(r)}><Icon name="ban" /></button>}
                  </td>
                </tr>
              ))}
              {rows && !shown.length && <tr><td colSpan={6}><Empty icon="expenses" title="No expenses in this range" text="Add one with the form, or widen the dates." /></td></tr>}
            </tbody>
          </table>
          <LoadMore shown={page.length} total={sorted.length} onMore={loadMore} />
        </div>

        <aside className="doc-side first-on-small">
          <FormCard key={fresh} title="Add expense" onSubmit={add}
            actions={<FormActions><BusyButton type="submit" busy={busy}><Icon name="plus" />Add expense</BusyButton></FormActions>}>
            <FormSection>
              <Field label="Amount" required span={12}>
                <Affix prefix="Rs"><input className="big" type="number" step="any" min="1" required inputMode="decimal" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Affix>
              </Field>
              <Field label="Category" required span={12}>
                <input required list="expense-categories" placeholder="Fuel, rent, electricity…" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </Field>
              <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              {categories.length > 0 && (
                <div className="chips span-12" role="group" aria-label="Common categories">
                  {categories.slice(0, 6).map((c) => <button key={c} type="button" className={`chip${form.category === c ? ' on' : ''}`} onClick={() => setForm({ ...form, category: c })}>{c}</button>)}
                </div>
              )}
              <Field label="Where" span={12} hint="Godown and shop costs are shown separately in reports; both come off total profit.">
                <Choice name="exp-place" value={form.locationId || 'none'} onChange={(v) => setForm({ ...form, locationId: v === 'none' ? '' : v })} columns={1}
                  options={[
                    ...places.map((p) => ({ value: p.id, label: p.name, description: (p.type === 'GODOWN' ? 'Godown' : 'Shop').toLowerCase() === p.name.toLowerCase() ? undefined : p.type === 'GODOWN' ? 'Godown' : 'Shop', icon: (p.type === 'GODOWN' ? 'stock' : 'locations') as 'stock' | 'locations' })),
                    { value: 'none', label: 'General', description: 'Salaries, office, phone', icon: 'wallet' as const },
                  ]} />
              </Field>
              <Field label="Date" required span={6}><input type="date" required max={localDay()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Note" optional span={6}><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            </FormSection>
          </FormCard>
          {byCategory.length > 0 && (
            <section className="card">
              <h3>By category</h3>
              <ul className="list">
                {byCategory.slice(0, 8).map(([c, v]) => (
                  <li key={c} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>{c}</span><span className="amt">{rupees(v)}</span></span>
                    <span className="meter" aria-hidden="true"><span style={{ width: `${(v / byCategory[0][1]) * 100}%`, background: 'var(--accent)' }} /></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
