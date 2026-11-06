'use client';

import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import CrudPage from '@/components/CrudPage';
import { Icon } from '@/components/Icon';
import { CUSTOMER_TYPES, money, PRICE_TIERS } from '@dist/shared';

interface Customer {
  id: string; name: string; shopName: string | null; phone: string | null; area: string | null;
  type: 'CASH' | 'CREDIT'; creditLimit: string | null; openingBalance: string; priceTier: string;
}

export default function CustomersPage() {
  return (
    <CrudPage<Customer>
      title="Customers"
      path="/customers"
      editPermission="MASTER_DATA_EDIT"
      icon="customers"
      formDescription="Shopkeepers you sell to. Their fixed rates are set on the customer's Rates page."
      sections={[
        { key: 'shop', title: 'Shop', description: 'Who the customer is and where to find them. Search finds them by name, shop, area or phone.' },
        { key: 'account', title: 'Account', description: 'Cash customers pay every bill in full. Udhaar customers run a khata up to their credit limit.' },
      ]}
      fields={[
        { name: 'name', label: 'Owner name', required: true, section: 'shop', placeholder: 'e.g. Ahmed Sahib' },
        { name: 'shopName', label: 'Shop name', section: 'shop', placeholder: 'e.g. Ahmed Kiryana' },
        { name: 'phone', label: 'Phone', type: 'tel', section: 'shop', span: 4, placeholder: '03xx-xxxxxxx', hint: 'Used for WhatsApp bills' },
        { name: 'area', label: 'Area / route', section: 'shop', span: 4, placeholder: 'e.g. Gulberg', hint: 'Groups customers by route' },
        { name: 'address', label: 'Address', section: 'shop', span: 4 },
        { name: 'type', label: 'Customer type', type: 'choice', required: true, section: 'account', initial: 'CASH', options: CUSTOMER_TYPES.map((t) => ({
          value: t.value, label: t.long, icon: t.value === 'CREDIT' ? 'khata' : 'wallet',
          description: t.value === 'CREDIT' ? 'Takes goods on khata and pays later' : 'Pays in full on every bill',
        })) },
        { name: 'priceTier', label: 'Price list', type: 'choice', section: 'account', initial: 'RETAIL', options: PRICE_TIERS.map((t) => ({
          value: t.value, label: t.label, description: t.description, icon: t.value === 'WHOLESALE' ? 'stock' : 'sales',
        })), hint: 'Which list rates their bills use. Fixed rates on the Rates page still come first.' },
        { name: 'creditLimit', label: 'Credit limit', type: 'number', prefix: 'Rs', section: 'account', showWhen: (v) => v.type === 'CREDIT', hint: 'Bills that would cross it need the override permission. Leave empty for no limit.' },
        { name: 'openingBalance', label: 'Opening balance', type: 'number', prefix: 'Rs', section: 'account', hint: 'What they owe you today, from the old register' },
      ]}
      summary={(rows) => {
        const udhaar = rows.filter((r) => r.type === 'CREDIT');
        const owed = rows.reduce((s, r) => s + Math.max(0, Number(r.openingBalance)), 0);
        return [
          { label: 'Customers', value: rows.length, sub: `${rows.length - udhaar.length} cash`, icon: 'customers' },
          { label: 'On udhaar', value: udhaar.length, sub: 'run a khata', icon: 'khata', tone: 'amber' },
          { label: 'Opening balances', value: <><small>Rs</small>{money(owed)}</>, sub: 'brought from the old register', icon: 'wallet', tone: owed ? 'red' : 'green' },
          { label: 'Wholesale list', value: rows.filter((r) => r.priceTier === 'WHOLESALE').length, sub: 'use wholesale rates', icon: 'stock' },
        ];
      }}
      columns={[
        {
          header: 'Customer', value: (r) => r.name,
          render: (r) => (
            <span className="person">
              <Avatar user={{ username: r.name }} size={36} />
              <span className="person-text">
                <b>{r.name}</b>
                <span>{[r.shopName, r.area].filter(Boolean).join(' · ') || 'No shop or area saved'}</span>
              </span>
            </span>
          ),
        },
        { header: 'Phone', render: (r) => (r.phone ? <span className="nowrap">{r.phone}</span> : <span className="muted">—</span>) },
        { header: 'Type', value: (r) => r.type, render: (r) => <span className={`badge ${r.type === 'CREDIT' ? 'amber' : 'green'}`}>{r.type === 'CREDIT' ? 'Udhaar' : 'Cash'}</span> },
        { header: 'Price list', value: (r) => r.priceTier, render: (r) => (r.priceTier === 'WHOLESALE' ? <span className="badge blue">Wholesale</span> : <span className="muted">Retail</span>) },
        { header: 'Credit limit', num: true, value: (r) => r.creditLimit, render: (r) => (r.creditLimit ? `Rs ${money(r.creditLimit)}` : <span className="muted">—</span>) },
        { header: 'Opening balance', num: true, value: (r) => r.openingBalance, render: (r) => (Number(r.openingBalance) > 0 ? <strong className="left-amt">Rs {money(r.openingBalance)}</strong> : <span className="muted">—</span>) },
      ]}
      extraRowActions={(r) => <><Link className="pill-link" href={`/khata/${r.id}`}><Icon name="khata" />Khata</Link><Link className="pill-link" href={`/customers/${r.id}`}><Icon name="sales" />Rates</Link></>}
    />
  );
}
