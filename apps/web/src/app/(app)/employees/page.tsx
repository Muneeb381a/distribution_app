'use client';

import Link from 'next/link';
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
      columns={[
        { header: 'Name', render: (r) => (canPayroll ? <Link href={`/employees/${r.id}`}><b>{r.name}</b></Link> : <b>{r.name}</b>), value: (r) => r.name },
        { header: 'Phone', render: (r) => r.phone ?? '' },
        { header: 'Type', value: (r) => r.type, render: (r) => <span className="badge blue">{r.type === 'DAILY' ? 'Daily' : 'Monthly'}</span> },
        { header: 'Pay', num: true, value: (r) => r.monthlySalary ?? r.dailyWage, render: (r) => money(r.monthlySalary ?? r.dailyWage ?? 0) },
        { header: 'Commission', num: true, render: (r) => (r.commissionPercent ? `${Number(r.commissionPercent)}%` : '—') },
      ]}
    />
  );
}
