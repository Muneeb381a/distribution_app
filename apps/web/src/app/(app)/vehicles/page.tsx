'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import CrudPage, { type Field } from '@/components/CrudPage';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';

interface Vehicle {
  id: string; name: string; isActive: boolean;
  regNo: string | null; vehicleKind: string | null; note: string | null;
  driver: { id: string; name: string } | null;
  onTrip: { id: string; tripNo: string; openedAt: string; salesman: { name: string } | null } | null;
  tripCount: number;
}

const KINDS = [
  { value: 'PICKUP', label: 'Pickup', description: 'Suzuki, Shehzore' },
  { value: 'LOADER', label: 'Loader', description: 'Rickshaw / Qingqi' },
  { value: 'TRUCK', label: 'Truck', description: 'Big loads' },
  { value: 'VAN', label: 'Van', description: 'Bolan, Hiace' },
  { value: 'BIKE', label: 'Bike', description: 'Small orders' },
  { value: 'OTHER', label: 'Other', description: 'Anything else' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));

/** The number plate as shown on the vehicle. */
function Plate({ value, size = 'md' }: { value: string; size?: 'md' | 'lg' }) {
  return <span className={`plate${size === 'lg' ? ' plate-lg' : ''}${value ? '' : ' empty'}`}>{value || 'LEB-0000'}</span>;
}

/** Vehicles: the trucks, pickups and rickshaws that carry stock out. A vehicle holds stock like a godown, so it is kept as a location of its own kind. */
export default function VehiclesPage() {
  usePageTitle('Vehicles');
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api<{ id: string; name: string }[]>('/employees/options').then(setDrivers).catch(() => {}); }, []);

  const fields: Field[] = [
    { name: 'regNo', label: 'Number plate', required: true, placeholder: 'e.g. LEB-1234', hint: 'As written on the vehicle. The same plate cannot be added twice.', span: 6, section: 'id' },
    { name: 'name', label: 'Nickname', placeholder: 'e.g. Ali’s pickup', hint: 'Optional. Shown in pickers instead of the kind and plate.', span: 6, section: 'id' },
    { name: 'vehicleKind', label: 'Kind', type: 'choice', required: true, initial: 'PICKUP', options: KINDS, section: 'id' },
    { name: 'driverId', label: 'Usual driver', type: 'select', placeholder: 'No fixed driver', options: drivers.map((d) => ({ value: d.id, label: d.name })), span: 12, hint: 'Only a reminder; each trip can still choose its own salesman.', section: 'more' },
    { name: 'note', label: 'Note', type: 'textarea', placeholder: 'e.g. Carries 120 bags; insurance due in March', span: 12, section: 'more' },
  ];

  return (
    <CrudPage<Vehicle>
      title="Vehicles"
      noun="vehicle"
      path="/vehicles"
      editPermission="MASTER_DATA_EDIT"
      icon="suppliers"
      formDescription="Add the vehicle once. Then load it each morning from Vehicle trips."
      fields={fields}
      sections={[
        { key: 'id', title: 'Vehicle', description: 'How you will find it in lists and on trips.' },
        { key: 'more', title: 'Driver and notes' },
      ]}
      toBody={(v) => ({
        regNo: v.regNo ?? '', vehicleKind: v.vehicleKind || 'PICKUP', name: v.name ?? '',
        driverId: v.driverId ?? '', note: v.note ?? '',
      })}
      preview={(v) => {
        const kind = KIND[v.vehicleKind || 'PICKUP'] ?? 'Vehicle';
        const driver = drivers.find((d) => d.id === v.driverId);
        const plate = (v.regNo ?? '').trim().toUpperCase();
        return (
          <div className="veh-preview">
            <span className="trip-truck"><Icon name="suppliers" /></span>
            <div className="veh-preview-main">
              <b>{v.name?.trim() || `${kind} ${plate}`.trim()}</b>
              <span>{driver ? `Driver: ${driver.name}` : 'No fixed driver'}</span>
            </div>
            <Plate value={plate} size="lg" />
          </div>
        );
      }}
      summary={(rows) => [
        { label: 'Vehicles', value: rows.length, icon: 'suppliers' },
        { label: 'On the road', value: rows.filter((r) => r.onTrip).length, sub: 'out on a trip now', icon: 'trend', tone: rows.some((r) => r.onTrip) ? 'amber' : 'green' },
        { label: 'Free', value: rows.filter((r) => !r.onTrip).length, sub: 'ready to load', icon: 'check', tone: 'green' },
        { label: 'No driver', value: rows.filter((r) => !r.driver).length, sub: 'no usual driver set', icon: 'user', tone: rows.some((r) => !r.driver) ? 'amber' : 'green' },
      ]}
      columns={[
        {
          header: 'Vehicle', value: (r) => r.name,
          render: (r) => (
            <span className="veh-cell">
              <span className="trip-truck sm"><Icon name="suppliers" /></span>
              <span className="veh-text"><b>{r.name}</b>{r.note && <span className="muted">{r.note}</span>}</span>
            </span>
          ),
        },
        { header: 'Plate', value: (r) => r.regNo, render: (r) => (r.regNo ? <Plate value={r.regNo} /> : <span className="muted">—</span>) },
        { header: 'Kind', value: (r) => r.vehicleKind, render: (r) => (r.vehicleKind ? <span className="badge blue">{KIND[r.vehicleKind] ?? r.vehicleKind}</span> : <span className="muted">—</span>) },
        {
          header: 'Driver', value: (r) => r.driver?.name,
          render: (r) => (r.driver ? <span className="person"><Avatar user={{ username: r.driver.name }} size={26} /><b>{r.driver.name}</b></span> : <span className="muted">Not set</span>),
        },
        {
          header: 'Status', value: (r) => (r.onTrip ? 'On the road' : 'Free'),
          render: (r) => (r.onTrip
            ? <Link href={`/trips/${r.onTrip.id}`} className="badge amber"><i className="live-dot" />On the road · {r.onTrip.tripNo}</Link>
            : <span className="badge green">Free</span>),
        },
        { header: 'Trips', num: true, value: (r) => r.tripCount, render: (r) => (r.tripCount ? r.tripCount : <span className="muted">0</span>) },
      ]}
    />
  );
}
