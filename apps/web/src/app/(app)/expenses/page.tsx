'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useConfirm, useToast } from '@/components/Feedback';
import { api } from '@/lib/api';

interface Expense { id: string; date: string; category: string; businessLine: string | null; amount: string; note: string | null; source: string | null; status: string }

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';

export default function ExpensesPage() {
  const [rows, setRows] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [form, setForm] = useState({ date: today(), category: '', businessLine: '', amount: '', note: '' });
  const [error, setError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(
    () => api<Expense[]>(`/expenses?from=${range.from}&to=${range.to}`).then(setRows).catch((e) => setError(e.message)),
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
    setError('');
    try {
      await api('/expenses', {
        method: 'POST',
        json: { date: form.date, category: form.category, businessLine: form.businessLine || undefined, amount: Number(form.amount), note: form.note || undefined },
      });
      setForm({ ...form, amount: '', note: '' });
      toast.success(`Expense of Rs ${Number(form.amount).toLocaleString()} added`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function cancel(id: string) {
    if (!(await confirm({ title: 'Cancel this expense?', body: <p>It stays in the list as cancelled and no longer counts in reports.</p>, confirmLabel: 'Cancel expense', cancelLabel: 'Keep', danger: true }))) return;
    try {
      await api(`/expenses/${id}/cancel`, { method: 'POST', json: {} });
      toast.success('Expense cancelled');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const total = rows.filter((r) => r.status === 'ACTIVE').reduce((s, r) => s + Number(r.amount), 0);

  return (
    <>
      <div className="page-head"><div><h1>Expenses</h1><p>Shop and business costs</p></div></div>
      {error && <p className="error">{error}</p>}
      <form className="card form" onSubmit={add}>
        <p className="form-title">Add expense</p>
        <label>Date<input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label>Category
          <input required list="expense-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label>Belongs to
          <select value={form.businessLine} onChange={(e) => setForm({ ...form, businessLine: e.target.value })}>
            <option value="">Shared (rent, bills…)</option>
            <option value="BOTTLES">Bottles</option>
            <option value="RICE">Rice</option>
          </select>
        </label>
        <label>Amount<input type="number" step="any" min="0" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
        <label>Note<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <button>Add expense</button>
      </form>
      <div className="toolbar">
        <label>From <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label>To <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        <span className="badge blue" style={{ fontSize: 14 }}>Total Rs {total.toLocaleString()}</span>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Category</th><th>For</th><th className="num">Amount</th><th>Note</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={r.status === 'CANCELLED' ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
              <td>{r.date.slice(0, 10)}</td>
              <td>{r.category}</td>
              <td><span className={`badge ${r.businessLine === 'RICE' ? 'amber' : r.businessLine === 'BOTTLES' ? 'blue' : ''}`}>{r.businessLine ? (r.businessLine === 'RICE' ? 'Rice' : 'Bottles') : 'Shared'}</span></td>
              <td className="num"><strong>{Number(r.amount).toLocaleString()}</strong></td>
              <td className="muted">{r.note}</td>
              <td>{r.status === 'ACTIVE' && !r.source && <button className="secondary" onClick={() => cancel(r.id)}>Cancel</button>}{r.source && <span className="muted">payroll</span>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="empty">No expenses in this range.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
