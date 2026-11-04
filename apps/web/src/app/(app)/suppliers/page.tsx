'use client';

import Link from 'next/link';
import { Badge } from '@/components/Badge';
import CrudPage from '@/components/CrudPage';
import { money, SUPPLIER_TYPES } from '@dist/shared';

interface Supplier { id: string; name: string; phone: string | null; type: string; openingBalance: string }

export default function SuppliersPage() {
  return (
    <CrudPage<Supplier>
      title="Suppliers"
      path="/suppliers"
      editPermission="MASTER_DATA_EDIT"
      icon="suppliers"
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'phone', label: 'Phone' },
        { name: 'type', label: 'Type', type: 'select', options: SUPPLIER_TYPES.map(({ value, label }) => ({ value, label })) },
        { name: 'openingBalance', label: 'Opening balance (we owe)', type: 'number' },
      ]}
      columns={[
        { header: 'Name', render: (r) => <b>{r.name}</b>, value: (r) => r.name },
        { header: 'Phone', render: (r) => r.phone ?? '' },
        { header: 'Type', value: (r) => r.type, render: (r) => <Badge tone="blue">{SUPPLIER_TYPES.find((t) => t.value === r.type)?.label ?? r.type}</Badge> },
        { header: 'Opening balance', num: true, value: (r) => r.openingBalance, render: (r) => money(r.openingBalance) },
      ]}
      extraRowActions={(r) => <Link href={`/suppliers/${r.id}`}>Ledger</Link>}
    />
  );
}
