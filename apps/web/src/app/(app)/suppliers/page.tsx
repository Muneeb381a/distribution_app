'use client';

import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import CrudPage from '@/components/CrudPage';
import { Icon } from '@/components/Icon';
import { money, SUPPLIER_TYPES } from '@dist/shared';

interface Supplier { id: string; name: string; phone: string | null; type: string; openingBalance: string; isActive: boolean; balance: string }

export default function SuppliersPage() {
  return (
    <CrudPage<Supplier>
      title="Suppliers"
      path="/suppliers"
      listPath="/suppliers?includeInactive=true"
      deactivateNote={(r) => (Number(r.balance) !== 0
        ? <p className="alert-bar"><b>{r.name} {Number(r.balance) > 0 ? `still has Rs ${money(r.balance)} to be paid.` : `still owes you Rs ${money(Math.abs(Number(r.balance)))}.`}</b> Hiding does not clear it; hidden suppliers are just left out of the lists and the dashboard. To remove the amount, change the opening balance or cancel the purchases first.</p>
        : null)}
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
      summary={(rows, all) => {
        const owed = rows.reduce((s, r) => s + Math.max(0, Number(r.balance)), 0);
        const hidden = all.filter((r) => !r.isActive && Number(r.balance) > 0);
        const hiddenOwed = hidden.reduce((s, r) => s + Number(r.balance), 0);
        return [
          { label: 'Suppliers', value: rows.length, icon: 'suppliers' },
          ...SUPPLIER_TYPES.map((t) => ({ label: t.label, value: rows.filter((r) => r.type === t.value).length, icon: (t.value === 'RICE_MILL' ? 'products' : t.value === 'BEVERAGE' ? 'stock' : 'file') as 'products' | 'stock' | 'file' })).filter((t) => t.value > 0),
          { label: 'We owe', value: <><small>Rs</small>{money(owed)}</>, sub: 'to the suppliers shown here', icon: 'wallet' as const, tone: owed ? ('amber' as const) : ('green' as const) },
          ...(hidden.length ? [{ label: 'Hidden, still owed', value: <><small>Rs</small>{money(hiddenOwed)}</>, sub: `${hidden.length} hidden supplier${hidden.length === 1 ? '' : 's'}: tick Show inactive to fix`, icon: 'alert' as const, tone: 'red' as const }] : []),
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
        { header: 'Balance', num: true, value: (r) => Number(r.balance), render: (r) => (Number(r.balance) > 0 ? <strong className="left-amt">Rs {money(r.balance)}</strong> : Number(r.balance) < 0 ? <span className="muted">They owe Rs {money(Math.abs(Number(r.balance)))}</span> : <span className="muted">—</span>) },
      ]}
      extraRowActions={(r) => <Link className="pill-link" href={`/suppliers/${r.id}`}><Icon name="suppliers" />Ledger</Link>}
    />
  );
}
