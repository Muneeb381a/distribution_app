'use client';

import CrudPage from '@/components/CrudPage';

interface Employee { id: string; name: string; phone: string | null; type: string; monthlySalary: string | null; dailyWage: string | null; commissionPercent: string | null }

export default function EmployeesPage() {
  return (
    <CrudPage<Employee>
      title="Employees"
      path="/employees"
      editPermission="USER_MANAGE"
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
        { name: 'joinDate', label: 'Join date (YYYY-MM-DD)' },
      ]}
      columns={[
        { header: 'Name', render: (r) => r.name },
        { header: 'Phone', render: (r) => r.phone ?? '' },
        { header: 'Type', render: (r) => <span className="badge blue">{r.type === 'DAILY' ? 'Daily' : 'Monthly'}</span> },
        { header: 'Pay', num: true, render: (r) => Number(r.monthlySalary ?? r.dailyWage ?? 0).toLocaleString() },
        { header: 'Commission', num: true, render: (r) => (r.commissionPercent ? `${Number(r.commissionPercent)}%` : '—') },
      ]}
    />
  );
}
