'use client';

import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import CrudPage from '@/components/CrudPage';
import { can, useUser } from '@/lib/api';
import { money } from '@dist/shared';

interface Employee { id: string; isActive: boolean; name: string; phone: string | null; type: string; monthlySalary: string | null; dailyWage: string | null; commissionPercent: string | null }

export default function EmployeesPage() {
  const canPayroll = can(useUser(), 'PAYROLL_MANAGE');
  return (
    <CrudPage<Employee>
      title="Employees"
      path="/employees"
      editPermission="USER_MANAGE"
      icon="employees"
      formDescription="Staff who get a salary or daily wage. Advances, attendance and payroll use this list."
      sections={[
        { key: 'person', title: 'Person', description: 'Name and contact.' },
        { key: 'pay', title: 'Pay', description: 'Monthly staff lose a day\'s pay per absent day. Daily staff are paid for days worked.' },
      ]}
      fields={[
        { name: 'name', label: 'Full name', required: true, section: 'person' },
        { name: 'phone', label: 'Phone', type: 'tel', section: 'person', span: 3, placeholder: '03xx-xxxxxxx' },
        { name: 'joinDate', label: 'Join date', type: 'date', section: 'person', span: 3 },
        { name: 'type', label: 'Pay type', type: 'choice', required: true, section: 'pay', initial: 'MONTHLY', options: [
          { value: 'MONTHLY', label: 'Monthly salary', description: 'Fixed amount each month', icon: 'payroll' },
          { value: 'DAILY', label: 'Daily wage', description: 'Paid per day worked', icon: 'history' },
        ] },
        { name: 'monthlySalary', label: 'Monthly salary', type: 'number', prefix: 'Rs', required: true, section: 'pay', span: 4, showWhen: (v) => v.type === 'MONTHLY' },
        { name: 'dailyWage', label: 'Daily wage', type: 'number', prefix: 'Rs', required: true, section: 'pay', span: 4, showWhen: (v) => v.type === 'DAILY' },
        { name: 'commissionPercent', label: 'Commission', type: 'number', suffix: '%', section: 'pay', span: 4, hint: 'Of their own sales, paid on top (salesmen)' },
      ]}
      summary={(rows) => {
        const monthly = rows.filter((r) => r.type !== 'DAILY');
        const payroll = monthly.reduce((s, r) => s + Number(r.monthlySalary ?? 0), 0);
        return [
          { label: 'Staff', value: rows.length, sub: 'active employees', icon: 'employees' },
          { label: 'Monthly salary', value: monthly.length, sub: 'paid a fixed amount', icon: 'payroll' },
          { label: 'Daily wage', value: rows.length - monthly.length, sub: 'paid per day worked', icon: 'history', tone: 'amber' },
          { label: 'Monthly payroll', value: <><small>Rs</small>{money(payroll)}</>, sub: 'salaries only, before commission', icon: 'wallet', tone: 'green' },
        ];
      }}
      columns={[
        {
          header: 'Name', value: (r) => r.name,
          render: (r) => {
            const who = (
              <span className="person">
                <Avatar user={{ username: r.name }} size={36} />
                <span className="person-text"><b>{r.name}</b><span>{r.phone || 'No phone saved'}</span></span>
              </span>
            );
            return canPayroll ? <Link className="plain" href={`/employees/${r.id}`}>{who}</Link> : who;
          },
        },
        { header: 'Pay type', value: (r) => r.type, render: (r) => <span className={`badge ${r.type === 'DAILY' ? 'amber' : 'blue'}`}>{r.type === 'DAILY' ? 'Daily wage' : 'Monthly salary'}</span> },
        { header: 'Pay', num: true, value: (r) => r.monthlySalary ?? r.dailyWage, render: (r) => <span className="pay"><b>Rs {money(r.monthlySalary ?? r.dailyWage ?? 0)}</b><span>{r.type === 'DAILY' ? 'per day' : 'per month'}</span></span> },
        { header: 'Commission', num: true, render: (r) => (r.commissionPercent ? <span className="badge teal">{Number(r.commissionPercent)}% of sales</span> : <span className="muted">—</span>) },
      ]}
    />
  );
}
