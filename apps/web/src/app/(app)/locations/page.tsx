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
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: LOCATION_TYPES.map(({ value, label }) => ({ value, label })) },
      ]}
      columns={[
        { header: 'Name', render: (r) => <b>{r.name}</b>, value: (r) => r.name },
        { header: 'Type', render: (r) => <Badge tone={TYPE[r.type]?.tone}>{TYPE[r.type]?.label ?? r.type}</Badge>, value: (r) => r.type },
      ]}
    />
  );
}
