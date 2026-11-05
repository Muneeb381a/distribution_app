'use client';

import { useState, type FormEvent } from 'react';
import { BusyButton, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { formatDate } from '@dist/shared';

export interface DeliveryState {
  id: string;
  status: string;
  deliveryStatus: string | null;
  deliveredAt: string | null;
  receivedBy: string | null;
  deliveredBy: string | null;
}

/** Pending / delivered state of a dispatch, and the one step that closes it: who signed for the goods. */
export function DeliveryPanel({ sale, canMark, onDone }: { sale: DeliveryState; canMark: boolean; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!sale.deliveryStatus || sale.status === 'CANCELLED') return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/sales/${sale.id}/deliver`, { method: 'POST', json: { receivedBy: name } });
      toast.success('Marked as delivered');
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sale.deliveryStatus === 'DELIVERED') {
    return (
      <section className="card no-print">
        <h3>Delivery</h3>
        <p style={{ margin: 0 }}>
          <span className="badge green">Delivered</span>{' '}
          {sale.deliveredAt ? formatDate(sale.deliveredAt) : ''}
        </p>
        <p className="muted" style={{ margin: '6px 0 0' }}>Received by <b>{sale.receivedBy}</b>{sale.deliveredBy ? ` · marked by ${sale.deliveredBy}` : ''}</p>
      </section>
    );
  }
  return (
    <section className="card no-print">
      <h3>Delivery</h3>
      <p style={{ margin: '0 0 10px' }}><span className="badge amber">Not delivered yet</span></p>
      {canMark ? (
        <form className="side-form" onSubmit={submit}>
          <label>Received by
            <input required value={name} maxLength={80} placeholder="Name of the person who signed" onChange={(e) => setName(e.target.value)} />
          </label>
          <BusyButton type="submit" busy={busy}><Icon name="check" />Mark delivered</BusyButton>
        </form>
      ) : <p className="muted" style={{ margin: 0 }}>Waiting for the signed slip.</p>}
    </section>
  );
}
