'use client';

import CrudPage from '@/components/CrudPage';

interface Location { id: string; name: string; type: string; isActive: boolean }

const TYPE: Record<string, [string, string]> = { GODOWN: ['Godown', 'blue'], SHOP: ['Shop', 'green'], VEHICLE: ['Vehicle', 'amber'] };

export default function LocationsPage() {
  return (
    <CrudPage<Location>
      title="Locations"
      path="/locations"
      editPermission="MASTER_DATA_EDIT"
      icon="locations"
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: [
          { value: 'GODOWN', label: 'Godown' },
          { value: 'SHOP', label: 'Shop' },
          { value: 'VEHICLE', label: 'Vehicle' },
        ] },
      ]}
      columns={[
        { header: 'Name', render: (r) => <b>{r.name}</b>, value: (r) => r.name },
        { header: 'Type', render: (r) => <span className={`badge ${TYPE[r.type]?.[1] ?? ''}`}>{TYPE[r.type]?.[0] ?? r.type}</span>, value: (r) => r.type },
      ]}
    />
  );
}
