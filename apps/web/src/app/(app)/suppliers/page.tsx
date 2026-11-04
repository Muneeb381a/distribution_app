'use client';

import Link from 'next/link';
import CrudPage from '@/components/CrudPage';

interface Supplier { id: string; name: string; phone: string | null; type: string; openingBalance: string }

export default function SuppliersPage() {
  return (
    <CrudPage<Supplier>
      title="Suppliers"
      path="/suppliers"
      editPermission="MASTER_DATA_EDIT"
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'phone', label: 'Phone' },
        { name: 'type', label: 'Type', type: 'select', options: [
          { value: 'BEVERAGE', label: 'Beverage distributor' },
          { value: 'RICE_MILL', label: 'Rice mill' },
          { value: 'OTHER', label: 'Other' },
        ] },
        { name: 'openingBalance', label: 'Opening balance (we owe)', type: 'number' },
      ]}
      columns={[
        { header: 'Name', render: (r) => r.name },
        { header: 'Phone', render: (r) => r.phone ?? '' },
        { header: 'Type', render: (r) => <span className="badge blue">{r.type.charAt(0) + r.type.slice(1).toLowerCase()}</span> },
        { header: 'Opening balance', num: true, render: (r) => Number(r.openingBalance).toLocaleString() },
      ]}
      extraRowActions={(r) => <Link href={`/suppliers/${r.id}`}>Ledger</Link>}
    />
  );
}
