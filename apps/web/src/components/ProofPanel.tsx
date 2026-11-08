'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { BusyButton, useConfirm, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { API_URL, api } from '@/lib/api';
import { photoFromFile } from '@/lib/image';
import { formatDate } from '@dist/shared';

interface Proof { id: string; mime: string; bytes: number; at: string; by: string | null }

const MAX = 4;

/**
 * Photos kept with a delivery bill, mainly the slip signed by the receiver. The picture is shrunk on this device
 * first, so it is small to send even on a weak connection. Pictures are fetched with the sign-in token and shown here.
 */
export function ProofPanel({ saleId, canAdd, canRemove }: { saleId: string; canAdd: boolean; canRemove: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<Proof[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState<string | null>(null);

  const load = useCallback(() => api<Proof[]>(`/delivery-proofs?saleId=${saleId}`).then(setList).catch(() => setList([])), [saleId]);
  useEffect(() => {
    load();
  }, [load]);

  // Fetch each picture once; free the browser memory when they are replaced or the panel closes.
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    (async () => {
      for (const p of list ?? []) {
        if (urls[p.id]) continue;
        try {
          const res = await fetch(`${API_URL}/delivery-proofs/${p.id}/image`, { headers: { Authorization: `Bearer ${localStorage.getItem('dist.token') ?? ''}` } });
          if (!res.ok) continue;
          const u = URL.createObjectURL(await res.blob());
          made.push(u);
          if (alive) setUrls((cur) => ({ ...cur, [p.id]: u }));
        } catch { /* leave this one blank */ }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  useEffect(() => () => { Object.values(urls).forEach((u) => URL.revokeObjectURL(u)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await api('/delivery-proofs', { method: 'POST', json: { saleId, image: await photoFromFile(file) } });
      toast.success('Photo saved with this bill');
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Proof) {
    if (!(await confirm({ title: 'Remove this photo?', body: <p>It is deleted from this bill. The removal is recorded in the audit log.</p>, confirmLabel: 'Remove', danger: true }))) return;
    try { await api(`/delivery-proofs/${p.id}`, { method: 'DELETE' }); setBig(null); await load(); } catch (e) { toast.error((e as Error).message); }
  }

  const count = list?.length ?? 0;
  return (
    <section className="card proof no-print">
      <div className="card-head"><h3 style={{ margin: 0 }}>Proof of delivery</h3>{count > 0 && <span className="count-pill">{count}</span>}</div>
      {list === null && <span className="skeleton" style={{ display: 'block', height: 90 }} />}
      {list && count === 0 && (
        <p className="proof-empty"><Icon name="camera" /><span>No photo yet. After the receiver signs the slip, take a picture of it.</span></p>
      )}
      {count > 0 && (
        <ul className="proof-grid">
          {list!.map((p) => (
            <li key={p.id}>
              <button type="button" className="proof-thumb" onClick={() => urls[p.id] && setBig(p.id)} aria-label="Open the photo">
                {urls[p.id]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={urls[p.id]} alt="Signed delivery slip" />
                  : <span className="skeleton" style={{ position: 'absolute', inset: 0 }} />}
              </button>
              <span className="proof-meta">{formatDate(p.at, 'short')}{p.by ? ` · ${p.by}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {canAdd && count < MAX && (
        <>
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
          <BusyButton type="button" busy={busy} className="secondary proof-add" onClick={() => input.current?.click()}><Icon name="camera" />{count ? 'Add another photo' : 'Take or choose a photo'}</BusyButton>
        </>
      )}

      {big && urls[big] && (
        <div className="proof-light" role="dialog" aria-modal="true" aria-label="Signed delivery slip" onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(null); }} onKeyDown={(e) => { if (e.key === 'Escape') setBig(null); }} tabIndex={-1} ref={(el) => el?.focus()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[big]} alt="Signed delivery slip" />
          <div className="proof-light-bar">
            <a className="btn secondary" href={urls[big]} download={`delivery-proof-${big.slice(0, 8)}.jpg`}><Icon name="download" />Save</a>
            {canRemove && <button type="button" className="secondary danger-hover" onClick={() => { const p = list?.find((x) => x.id === big); if (p) void remove(p); }}>Remove</button>}
            <button type="button" className="secondary" onClick={() => setBig(null)}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
