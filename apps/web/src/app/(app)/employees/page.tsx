'use client';

import CrudPage from '@/components/CrudPage';
import { money } from '@dist/shared';

interface Employee { id: string; isActive: boolean; name: string; phone: string | null; type: string; monthlySalary: string | null; dailyWage: string | null; commissionPercent: string | null }

export default function EmployeesPage() {
  return (
    <CrudPage<Employee>
      title="Employees"
      path="/employees"
      editPermission="USER_MANAGE"
      icon="employees"
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'phone', label: 'Phone' },
        { name: 'type', label: 'Pay type', type: 'select', required: true, options: [
          { value: 'MONTHLY', label: 'Monthly salary' },
          { value: 'DAILY', label: 'Daily wage' },
        ] },
        { name: 'monthlySalary', label: 'Monthly salary', type: 'number', required: true, showWhen: (v) => v.type === 'MONTHLY' },
        { name: 'dailyWage', label: 'Daily wage', type: 'number', required: true, showWhen: (v) => v.type === 'DAILY' },
        { name: 'commissionPercent', label: 'Commission % of own sales', type: 'number' },
        { name: 'joinDate', label: 'Join date', type: 'date' },
      ]}
      columns={[
        { header: 'Name', render: (r) => <b>{r.name}</b>, value: (r) => r.name },
        { header: 'Phone', render: (r) => r.phone ?? '' },
        { header: 'Type', value: (r) => r.type, render: (r) => <span className="badge blue">{r.type === 'DAILY' ? 'Daily' : 'Monthly'}</span> },
        { header: 'Pay', num: true, value: (r) => r.monthlySalary ?? r.dailyWage, render: (r) => money(r.monthlySalary ?? r.dailyWage ?? 0) },
        { header: 'Commission', num: true, render: (r) => (r.commissionPercent ? `${Number(r.commissionPercent)}%` : '—') },
      ]}
    />
  );
}
