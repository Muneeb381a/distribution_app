'use client';

import Link from 'next/link';
import CrudPage from '@/components/CrudPage';

interface Customer {
  id: string; name: string; shopName: string | null; phone: string | null; area: string | null;
  type: 'CASH' | 'CREDIT'; creditLimit: string | null; openingBalance: string;
}

export default function CustomersPage() {
  return (
    <CrudPage<Customer>
      title="Customers"
      path="/customers"
      editPermission="MASTER_DATA_EDIT"
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'shopName', label: 'Shop name' },
        { name: 'phone', label: 'Phone' },
        { name: 'area', label: 'Area / route' },
        { name: 'address', label: 'Address' },
        { name: 'type', label: 'Type', type: 'select', required: true, options: [
          { value: 'CASH', label: 'Cash' },
          { value: 'CREDIT', label: 'Udhaar (credit)' },
        ] },
        { name: 'creditLimit', label: 'Credit limit', type: 'number', showWhen: (v) => v.type === 'CREDIT' },
        { name: 'openingBalance', label: 'Opening balance (they owe)', type: 'number' },
      ]}
      columns={[
        { header: 'Name', render: (r) => r.name },
        { header: 'Shop', render: (r) => r.shopName ?? '' },
        { header: 'Area', render: (r) => r.area ?? '' },
        { header: 'Type', render: (r) => <span className={`badge ${r.type === 'CREDIT' ? 'amber' : 'green'}`}>{r.type === 'CREDIT' ? 'Udhaar' : 'Cash'}</span> },
        { header: 'Credit limit', num: true, render: (r) => (r.creditLimit ? Number(r.creditLimit).toLocaleString() : '—') },
        { header: 'Opening balance', num: true, render: (r) => Number(r.openingBalance).toLocaleString() },
      ]}
      extraRowActions={(r) => <Link href={`/customers/${r.id}`}>Rates →</Link>}
    />
  );
}
