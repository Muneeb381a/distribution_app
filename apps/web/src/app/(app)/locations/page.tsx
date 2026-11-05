'use client';

import { Badge } from '@/components/Badge';
import CrudPage from '@/components/CrudPage';
import { LOCATION_TYPES } from '@dist/shared';

interface Location { id: string; name: string; type: string; isActive: boolean }

const TYPE = Object.fromEntries(LOCATION_TYPES.map((t) => [t.value, t]));

export default function LocationsPage() {
  return (
    <CrudPage<Location>
      title="Locations"
      path="/locations"
      editPermission="MASTER_DATA_EDIT"
      icon="locations"
      formDescription="Places that hold stock. Every purchase, transfer and sale says which location it uses."
      fields={[
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Godown 2, Truck LHR-1' },
        { name: 'type', label: 'Type', type: 'choice', required: true, initial: 'GODOWN', options: LOCATION_TYPES.map(({ value, label }) => ({
          value, label, icon: value === 'VEHICLE' ? 'suppliers' : value === 'SHOP' ? 'sales' : 'stock',
          description: value === 'GODOWN' ? 'Stores stock; no selling' : value === 'SHOP' ? 'Counter sales are made from here' : 'Delivery van; load it each morning',
        })) },
      ]}
      columns={[
        { header: 'Name', render: (r) => <b>{r.name}</b>, value: (r) => r.name },
        { header: 'Type', render: (r) => <Badge tone={TYPE[r.type]?.tone}>{TYPE[r.type]?.label ?? r.type}</Badge>, value: (r) => r.type },
      ]}
    />
  );
}
