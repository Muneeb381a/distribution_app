'use client';

import CrudPage from '@/components/CrudPage';

interface Location { id: string; name: string; type: string }

export default function LocationsPage() {
  return (
    <CrudPage<Location>
      title="Locations"
      path="/locations"
      editPermission="MASTER_DATA_EDIT"
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: [
          { value: 'GODOWN', label: 'Godown' },
          { value: 'SHOP', label: 'Shop' },
          { value: 'VEHICLE', label: 'Vehicle' },
        ] },
      ]}
      columns={[
        { header: 'Name', render: (r) => r.name },
        { header: 'Type', render: (r) => r.type },
      ]}
    />
  );
}
