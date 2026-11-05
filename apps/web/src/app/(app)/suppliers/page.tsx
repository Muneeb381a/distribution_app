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
      formDescription="Companies and mills you buy from. Purchases, payments and returns go on their ledger."
      fields={[
        { name: 'name', label: 'Supplier name', required: true, placeholder: 'e.g. Coca-Cola Icecek' },
        { name: 'phone', label: 'Phone', type: 'tel', placeholder: '042-xxxxxxx' },
        { name: 'type', label: 'What they supply', type: 'choice', initial: 'BEVERAGE', options: SUPPLIER_TYPES.map(({ value, label }) => ({
          value, label, icon: value === 'RICE_MILL' ? 'products' : value === 'BEVERAGE' ? 'suppliers' : 'file',
          description: value === 'BEVERAGE' ? 'Soft drinks, juices, water' : value === 'RICE_MILL' ? 'Rice mills and traders' : 'Anything else',
        })) },
        { name: 'openingBalance', label: 'Opening balance', type: 'number', prefix: 'Rs', hint: 'What you owe them today. Use a minus amount if they owe you.' },
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
