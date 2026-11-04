'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Slip {
  month: string; base: string; commission: string; absenceDeduction: string; gross: string; advances: string; carryIn: string;
  netPaid: string; carryOut: string; paidOn: string; employee: { name: string; type: string };
  advanceItems: { id: string; date: string; amount: string; note: string | null }[];
  details: { attendance?: Record<string, number>; salesNet?: string; commissionPercent?: string | null } | null;
}

const n = (v: string) => Number(v).toLocaleString();

export default function SalarySlipPage() {
  const { id } = useParams<{ id: string }>();
  const [slip, setSlip] = useState<Slip | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Slip>(`/payroll/${id}`).then(setSlip).catch((e) => setError(e.message));
  }, [id]);

  const row = (label: string, value: string, bold = false) => (
    <tr style={bold ? { fontWeight: 700 } : undefined}><td>{label}</td><td style={{ textAlign: 'right' }}>{value}</td></tr>
  );

  return (
    <>
      <p className="no-print"><Link href="/payroll">← Payroll</Link></p>
      {error && <p className="error">{error}</p>}
      {slip && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h1>Salary slip · {slip.month}</h1>
          <p><strong>{slip.employee.name}</strong> <span className="muted">({slip.employee.type === 'DAILY' ? 'daily wage' : 'monthly salary'})</span></p>
          <table>
            <tbody>
              {row(slip.employee.type === 'DAILY' ? 'Wages for days worked' : 'Salary', n(slip.base))}
              {Number(slip.commission) > 0 && row(`Commission (${Number(slip.details?.commissionPercent ?? 0)}% of ${n(slip.details?.salesNet ?? '0')})`, n(slip.commission))}
              {Number(slip.absenceDeduction) > 0 && row('Absence deduction', `-${n(slip.absenceDeduction)}`)}
              {row('Earned', n(slip.gross), true)}
              {slip.advanceItems.map((a) => row(`Advance ${a.date.slice(0, 10)}${a.note ? ` (${a.note})` : ''}`, `-${n(a.amount)}`))}
              {Number(slip.carryIn) > 0 && row('Advances carried from last month', `-${n(slip.carryIn)}`)}
              {row('Net paid', n(slip.netPaid), true)}
              {Number(slip.carryOut) > 0 && row('Carried to next month', n(slip.carryOut))}
            </tbody>
          </table>
          <p className="muted">Paid on {slip.paidOn.slice(0, 10)}</p>
          <p className="no-print"><button onClick={() => window.print()}>Print</button></p>
        </div>
      )}
    </>
  );
}
