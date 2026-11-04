'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BusyButton, Empty, SkeletonRows, useConfirm, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { downloadCsv, LoadMore, SortTh, usePaged, useSort } from '@/components/Table';
import { api } from '@/lib/api';
import { lineLabel, lineTone, localDay, monthStart, rupees } from '@dist/shared';

interface Expense { id: string; date: string; category: string; businessLine: string | null; amount: string; note: string | null; source: string | null; status: string }


export default function ExpensesPage() {
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [range, setRange] = useState({ from: localDay(monthStart()), to: localDay() });
  const [lineFilter, setLineFilter] = useState<'ALL' | 'BOTTLES' | 'RICE' | ''>('ALL');
  const [form, setForm] = useState({ date: localDay(), category: '', businessLine: '', amount: '', note: '' });
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
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/expenses', {
        method: 'POST',
        json: { date: form.date, category: form.category.trim(), businessLine: form.businessLine || undefined, amount: Number(form.amount), note: form.note || undefined },
      });
      toast.success(`Rs ${rupees(form.amount)} for ${form.category} added`);
      if (!categories.includes(form.category.trim())) setCategories([...categories, form.category.trim()].sort());
      setForm({ ...form, amount: '', note: '' });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(r: Expense) {
    if (!(await confirm({ title: 'Cancel this expense?', body: <p>Rs {rupees(r.amount)} for {r.category} on {r.date.slice(0, 10)}. It stays in the list as cancelled and no longer counts in reports.</p>, confirmLabel: 'Cancel expense', cancelLabel: 'Keep', danger: true }))) return;
    try {
      await api(`/expenses/${r.id}/cancel`, { method: 'POST', json: {} });
      toast.success('Expense cancelled');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const shown = useMemo(() => (rows ?? []).filter((r) => lineFilter === 'ALL' || (r.businessLine ?? '') === lineFilter), [rows, lineFilter]);
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
        <button className="secondary btn-icon" disabled={!shown.length} onClick={() => downloadCsv(`expenses-${range.from}_${range.to}.csv`, ['Date', 'Category', 'For', 'Amount', 'Note', 'Status'], shown.map((r) => [r.date.slice(0, 10), r.category, lineLabel(r.businessLine), r.amount, r.note, r.status.toLowerCase()]))}>
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
            <div className="chips">
              {([['ALL', 'All'], ['BOTTLES', 'Bottles'], ['RICE', 'Rice'], ['', 'Shared']] as const).map(([v, l]) => (
                <button key={v} type="button" className={`chip${lineFilter === v ? ' on' : ''}`} aria-pressed={lineFilter === v} onClick={() => setLineFilter(v)}>{l}</button>
              ))}
            </div>
          </div>

          <div className="sum-bar">
            <div><span>Total</span><b>Rs {rupees(total)}</b></div>
            <div><span>Entries</span><b>{active.length}</b></div>
            <div><span>Biggest</span><b style={{ fontSize: 15 }}>{byCategory[0] ? `${byCategory[0][0]} · ${rupees(byCategory[0][1])}` : '—'}</b></div>
          </div>

          <table className="sticky-head">
            <thead>
              <tr>
                <SortTh k="date" sort={sort} toggle={toggle}>Date</SortTh>
                <SortTh k="category" sort={sort} toggle={toggle}>Category</SortTh>
                <th>For</th>
                <SortTh k="amount" sort={sort} toggle={toggle} num>Amount</SortTh>
                <th>Note</th><th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {!rows && !error && <SkeletonRows cols={6} />}
              {page.map((r) => (
                <tr key={r.id} className={r.status === 'CANCELLED' ? 'inactive' : ''}>
                  <td>{new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                  <td><b>{r.category}</b></td>
                  <td><span className={`badge ${lineTone(r.businessLine)}`}>{lineLabel(r.businessLine)}</span></td>
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
          <form className="card side-form receipt" onSubmit={add}>
            <h2 style={{ margin: 0 }}>Add expense</h2>
            <label>Amount (Rs)<input className="big" type="number" step="any" min="1" required inputMode="decimal" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label>Category
              <input required list="expense-categories" placeholder="Fuel, rent, electricity…" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            {categories.length > 0 && (
              <div className="chips">
                {categories.slice(0, 6).map((c) => <button key={c} type="button" className={`chip${form.category === c ? ' on' : ''}`} onClick={() => setForm({ ...form, category: c })}>{c}</button>)}
              </div>
            )}
            <div>
              <span className="field-label" id="exp-line">Belongs to</span>
              <div className="seg" role="radiogroup" aria-labelledby="exp-line" style={{ margin: '6px 0 0', display: 'flex' }}>
                {[['', 'Shared'], ['BOTTLES', 'Bottles'], ['RICE', 'Rice']].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={form.businessLine === v} className={form.businessLine === v ? 'on' : ''} style={{ flex: 1 }} onClick={() => setForm({ ...form, businessLine: v })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="two">
              <label>Date<input type="date" required max={localDay()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              <label>Note<input value={form.note} placeholder="Optional" onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            </div>
            <BusyButton type="submit" busy={busy}>Add expense</BusyButton>
          </form>
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
