'use client';

import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import CrudPage from '@/components/CrudPage';
import { Icon } from '@/components/Icon';
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
      summary={(rows) => {
        const owed = rows.reduce((s, r) => s + Math.max(0, Number(r.openingBalance)), 0);
        return [
          { label: 'Suppliers', value: rows.length, icon: 'suppliers' },
          ...SUPPLIER_TYPES.map((t) => ({ label: t.label, value: rows.filter((r) => r.type === t.value).length, icon: (t.value === 'RICE_MILL' ? 'products' : t.value === 'BEVERAGE' ? 'stock' : 'file') as 'products' | 'stock' | 'file' })).filter((t) => t.value > 0),
          { label: 'Opening balances', value: <><small>Rs</small>{money(owed)}</>, sub: 'owed to suppliers from the old register', icon: 'wallet' as const, tone: owed ? ('amber' as const) : ('green' as const) },
        ];
      }}
      columns={[
        {
          header: 'Supplier', value: (r) => r.name,
          render: (r) => (
            <span className="person">
              <Avatar user={{ username: r.name }} size={36} />
              <span className="person-text"><b>{r.name}</b><span>{r.phone || 'No phone saved'}</span></span>
            </span>
          ),
        },
        { header: 'Type', value: (r) => r.type, render: (r) => <Badge tone="blue">{SUPPLIER_TYPES.find((t) => t.value === r.type)?.label ?? r.type}</Badge> },
        { header: 'Opening balance', num: true, value: (r) => r.openingBalance, render: (r) => (Number(r.openingBalance) > 0 ? <strong className="left-amt">Rs {money(r.openingBalance)}</strong> : <span className="muted">—</span>) },
      ]}
      extraRowActions={(r) => <Link className="pill-link" href={`/suppliers/${r.id}`}><Icon name="suppliers" />Ledger</Link>}
    />
  );
}
