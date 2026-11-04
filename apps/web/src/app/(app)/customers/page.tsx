'use client';

import Link from 'next/link';
import CrudPage from '@/components/CrudPage';
import { CUSTOMER_TYPES, money } from '@dist/shared';

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
      icon="customers"
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'shopName', label: 'Shop name' },
        { name: 'phone', label: 'Phone' },
        { name: 'area', label: 'Area / route' },
        { name: 'address', label: 'Address' },
        { name: 'type', label: 'Type', type: 'select', required: true, options: CUSTOMER_TYPES.map((t) => ({ value: t.value, label: t.value === 'CREDIT' ? 'Udhaar (credit)' : t.label })) },
        { name: 'creditLimit', label: 'Credit limit', type: 'number', showWhen: (v) => v.type === 'CREDIT' },
        { name: 'openingBalance', label: 'Opening balance (they owe)', type: 'number' },
      ]}
      columns={[
        { header: 'Name', render: (r) => <b>{r.name}</b>, value: (r) => r.name },
        { header: 'Shop', render: (r) => r.shopName ?? '', value: (r) => r.shopName },
        { header: 'Area', render: (r) => r.area ?? '', value: (r) => r.area },
        { header: 'Type', render: (r) => <span className={`badge ${r.type === 'CREDIT' ? 'amber' : 'green'}`}>{r.type === 'CREDIT' ? 'Udhaar' : 'Cash'}</span> },
        { header: 'Credit limit', num: true, value: (r) => r.creditLimit, render: (r) => (r.creditLimit ? money(r.creditLimit) : '—') },
        { header: 'Opening balance', num: true, value: (r) => r.openingBalance, render: (r) => money(r.openingBalance) },
      ]}
      extraRowActions={(r) => <><Link href={`/khata/${r.id}`}>Khata</Link><Link href={`/customers/${r.id}`}>Rates</Link></>}
    />
  );
}
