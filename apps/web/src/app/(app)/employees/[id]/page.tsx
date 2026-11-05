'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, SkeletonRows } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import { formatDate, money, rupees } from '@dist/shared';

type Kind = 'ADVANCE' | 'CUT' | 'REPAID' | 'SALARY';
interface Entry { date: string; kind: Kind; ref: string; text: string; owed: string; paid: string; cancelled: boolean; balance: string }
interface Ledger {
  employee: { id: string; name: string; phone: string | null; type: string; monthlySalary: string | null; dailyWage: string | null; isActive: boolean };
  owed: string; openAdvances: number; monthlyCut: string;
  totals: { advanced: string; salaryPaid: string; earned: string };
  entries: Entry[];
}

const KIND: Record<Kind, { label: string; tone: string }> = {
  ADVANCE: { label: 'Advance', tone: 'amber' },
  CUT: { label: 'Salary cut', tone: 'blue' },
  REPAID: { label: 'Cash back', tone: 'green' },
  SALARY: { label: 'Salary', tone: '' },
};

/** One employee's money with the business: advances, how they are coming back, and salaries paid. */
export default function EmployeeLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const [l, setL] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  usePageTitle(l ? l.employee.name : null);

  useEffect(() => {
    api<Ledger>(`/employees/${id}/ledger`).then(setL).catch((e) => setError(e.message));
  }, [id]);

  const href = (e: Entry) => (e.kind === 'SALARY' || e.kind === 'CUT' ? `/payroll/${e.ref}` : `/payroll/advances/${e.ref}`);
  const owed = Number(l?.owed ?? 0);
  const months = l && Number(l.monthlyCut) > 0 ? Math.ceil(owed / Number(l.monthlyCut)) : 0;

  return (
    <>
      <Link className="back" href="/employees"><Icon name="chevronLeft" />Employees</Link>
      <div className="page-head">
        <div>
          <h1>{l?.employee.name ?? 'Employee'}</h1>
          <p>
            {l ? <>{l.employee.type === 'DAILY' ? `Daily wage Rs ${rupees(l.employee.dailyWage ?? 0)}` : `Monthly salary Rs ${rupees(l.employee.monthlySalary ?? 0)}`}{l.employee.phone ? ` · ${l.employee.phone}` : ''}{!l.employee.isActive && ' · Inactive'}</> : 'Loading…'}
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/payroll"><Icon name="wallet" />Give advance</Link>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="stats">
        <div className="stat">
          <span className="label"><span className={`icon ${owed > 0 ? 'amber' : 'green'}`}><Icon name="wallet" /></span>Owes the business</span>
          <span className={`value${owed > 0 ? ' neg' : ''}`}><small>Rs</small>{rupees(owed)}</span>
          <span className="sub">{l ? (l.openAdvances ? `${l.openAdvances} advance${l.openAdvances === 1 ? '' : 's'} open` : 'Nothing owed') : '…'}</span>
        </div>
        <div className="stat">
          <span className="label"><span className="icon"><Icon name="history" /></span>Next salary cut</span>
          <span className="value"><small>Rs</small>{rupees(l?.monthlyCut ?? 0)}</span>
          <span className="sub">{months ? `About ${months} month${months === 1 ? '' : 's'} to clear` : 'No cut planned'}</span>
        </div>
        <div className="stat">
          <span className="label"><span className="icon green"><Icon name="payroll" /></span>Salary paid</span>
          <span className="value"><small>Rs</small>{rupees(l?.totals.salaryPaid ?? 0)}</span>
          <span className="sub">Earned Rs {rupees(l?.totals.earned ?? 0)} in all</span>
        </div>
        <div className="stat">
          <span className="label"><span className="icon amber"><Icon name="trend" /></span>Advances given</span>
          <span className="value"><small>Rs</small>{rupees(l?.totals.advanced ?? 0)}</span>
          <span className="sub">All time</span>
        </div>
      </div>

      <div className="list-head">
        <h2 style={{ margin: 0 }}>Ledger</h2>
        <span className="count">{l?.entries.length ?? 0} entries</span>
      </div>
      <div className="table-wrap">
        <table className="ledger">
          <thead><tr><th>Date</th><th>Entry</th><th>Detail</th><th className="num">Owed +/−</th><th className="num">Cash paid</th><th className="num">Owes after</th></tr></thead>
          <tbody>
            {!l && !error && <SkeletonRows cols={6} />}
            {l?.entries.map((e, i) => {
              const d = Number(e.owed);
              return (
                <tr key={`${e.kind}-${e.ref}-${i}`} className={e.cancelled ? 'cancel struck' : ''}>
                  <td>{formatDate(e.date)}</td>
                  <td><span className={`badge ${KIND[e.kind].tone}`}>{KIND[e.kind].label}</span></td>
                  <td><Link href={href(e)}>{e.text}</Link>{e.cancelled && <span className="muted"> · cancelled</span>}</td>
                  <td className={`num ${d > 0 ? 'amt-debit' : d < 0 ? 'amt-credit' : ''}`}>{d ? `${d > 0 ? '+' : '−'}${money(Math.abs(d))}` : ''}</td>
                  <td className="num">{Number(e.paid) ? money(e.paid) : ''}</td>
                  <td className="num bal">{money(e.balance)}</td>
                </tr>
              );
            })}
            {l && !l.entries.length && <tr><td colSpan={6}><Empty icon="payroll" title="Nothing yet" text="Advances and salaries for this employee show here." /></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Owed goes up with an advance and down with each salary cut or cash paid back. Cancelled entries are struck through and do not count.</p>
    </>
  );
}
