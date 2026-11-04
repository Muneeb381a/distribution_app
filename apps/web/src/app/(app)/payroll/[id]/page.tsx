'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';

interface Slip {
  month: string; base: string; commission: string; absenceDeduction: string; gross: string; advances: string; carryIn: string;
  netPaid: string; carryOut: string; paidOn: string; status?: string; employee: { name: string; type: string; phone?: string | null };
  advanceItems: { id: string; date: string; amount: string; note: string | null }[];
  details: { attendance?: Record<string, number>; salesNet?: string; commissionPercent?: string | null } | null;
}

const n = (v: string | number) => Number(v).toLocaleString('en-PK');
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export default function SalarySlipPage() {
  const { id } = useParams<{ id: string }>();
  const [slip, setSlip] = useState<Slip | null>(null);
  const [error, setError] = useState('');

  usePageTitle(slip ? `Salary slip · ${slip.employee.name}` : null);

  useEffect(() => {
    api<Slip>(`/payroll/${id}`).then(setSlip).catch((e) => setError(e.message));
  }, [id]);

  const row = (label: string, value: string, cls = '') => (
    <tr className={cls}><td>{label}</td><td className="num">{value}</td></tr>
  );

  return (
    <>
      <div className="no-print">
        <Link className="back" href="/payroll"><Icon name="chevronLeft" />Payroll</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {!slip && !error && <span className="skeleton" style={{ display: 'block', maxWidth: 560, height: 420, margin: '0 auto' }} />}
      {slip && (
        <article className="slip card">
          <header className="slip-head">
            <div>
              <span className="slip-kicker">Salary slip</span>
              <h1>{monthName(slip.month)}</h1>
            </div>
            <div className="actions no-print">
              <button onClick={() => window.print()}><Icon name="print" />Print</button>
            </div>
          </header>
          <dl className="meta slip-meta">
            <div><dt>Employee</dt><dd>{slip.employee.name}</dd></div>
            <div><dt>Pay type</dt><dd>{slip.employee.type === 'DAILY' ? 'Daily wage' : 'Monthly salary'}</dd></div>
            <div><dt>Paid on</dt><dd>{new Date(slip.paidOn).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</dd></div>
            {slip.details?.attendance && (
              <div><dt>Attendance</dt><dd>{Object.entries(slip.details.attendance).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ')}</dd></div>
            )}
          </dl>
          <table className="slip-table">
            <thead><tr><th>Earnings &amp; deductions</th><th className="num">Rs</th></tr></thead>
            <tbody>
              {row(slip.employee.type === 'DAILY' ? 'Wages for days worked' : 'Salary', n(slip.base))}
              {Number(slip.commission) > 0 && row(`Commission (${Number(slip.details?.commissionPercent ?? 0)}% of ${n(slip.details?.salesNet ?? '0')})`, n(slip.commission))}
              {Number(slip.absenceDeduction) > 0 && row('Absence deduction', `-${n(slip.absenceDeduction)}`, 'minus')}
              {row('Earned', n(slip.gross), 'subtotal')}
              {slip.advanceItems.map((a) => row(`Advance ${a.date.slice(0, 10)}${a.note ? ` (${a.note})` : ''}`, `-${n(a.amount)}`, 'minus'))}
              {Number(slip.carryIn) > 0 && row('Advances carried from last month', `-${n(slip.carryIn)}`, 'minus')}
            </tbody>
          </table>
          <div className="slip-net">
            <span>Net paid</span>
            <b>Rs {n(slip.netPaid)}</b>
          </div>
          {Number(slip.carryOut) > 0 && <p className="muted" style={{ margin: '10px 0 0' }}>Rs {n(slip.carryOut)} of advances is carried to next month.</p>}
          <footer className="slip-sign">
            <span>Employee signature</span>
            <span>Authorised by</span>
          </footer>
        </article>
      )}
    </>
  );
}
