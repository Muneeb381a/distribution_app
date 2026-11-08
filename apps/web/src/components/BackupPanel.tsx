'use client';

import { useCallback, useEffect, useState } from 'react';
import { BusyButton, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { API_URL, api } from '@/lib/api';

export interface BackupStatus {
  last: { name: string; bytes: number; at: string; tables: number | null } | null;
  ageHours: number | null; count: number; everyHours: number; auto: boolean; supported: boolean;
  copyDir: string | null; copyReachable: boolean | null; running: boolean;
}
interface BackupFile { name: string; bytes: number; at: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const kb = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ago = (h: number) => (h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'} ago`);

/** Settings → Backup: how safe the data is right now, a button to back up now, and the saved copies. */
export default function BackupPanel() {
  const toast = useToast();
  const [data, setData] = useState<{ status: BackupStatus; files: BackupFile[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState('');

  const load = useCallback(() => api<{ status: BackupStatus; files: BackupFile[] }>('/backups').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function backupNow() {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; warning?: boolean; message: string; status: BackupStatus; files: BackupFile[] }>('/backups', { method: 'POST', json: {} });
      setData({ status: r.status, files: r.files });
      if (r.warning) toast.error(r.message); else toast.success('Backup saved and checked');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download(f: BackupFile) {
    setSaving(f.name);
    try {
      const res = await fetch(`${API_URL}/backups/${encodeURIComponent(f.name)}/download`, { headers: { Authorization: `Bearer ${localStorage.getItem('dist.token') ?? ''}` } });
      if (!res.ok) throw new Error('The file could not be downloaded');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = f.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <span className="skeleton" style={{ display: 'block', height: 220, maxWidth: 880 }} />;
  const { status: s, files } = data;
  if (!s.supported) {
    return (
      <section className="card bk-status amber">
        <span className="bk-icon"><Icon name="cloud" /></span>
        <div className="bk-main">
          <h2>Backups are kept by the database host</h2>
          <p>This copy of the app runs on a serverless host that cannot take file backups itself. Your data is stored on Neon, which keeps a history of changes you can restore from its dashboard. For an extra copy you control, run <code>pnpm backup</code> from a computer with the database address.</p>
        </div>
      </section>
    );
  }
  const stale = s.ageHours === null || s.ageHours > 72;
  const warn = !stale && s.ageHours !== null && s.ageHours > 36;
  const tone = stale ? 'red' : warn ? 'amber' : 'green';

  return (
    <div className="bk">
      <section className={`card bk-status ${tone}`}>
        <span className="bk-icon"><Icon name={stale ? 'alert' : 'check'} /></span>
        <div className="bk-main">
          {s.last && s.ageHours !== null ? (
            <>
              <h2>{stale ? `No backup for ${Math.round(s.ageHours / 24)} days` : warn ? 'Backup is getting old' : 'Your data is backed up'}</h2>
              <p>Last backup {ago(s.ageHours)} · {when(s.last.at)} · {kb(s.last.bytes)}{s.last.tables ? ` · ${s.last.tables} tables checked` : ''}</p>
            </>
          ) : (
            <><h2>No backup has been taken yet</h2><p>Press the button to take the first one now.</p></>
          )}
        </div>
        <BusyButton type="button" busy={busy} onClick={backupNow}><Icon name="cloud" />Back up now</BusyButton>
      </section>

      <div className="bk-facts">
        <div className="card">
          <span className="bk-fact-icon"><Icon name="refresh" /></span>
          <b>Automatic</b>
          <p>{s.auto ? `A backup is taken by itself whenever the last one is older than ${s.everyHours} hours, while the app is running. If the PC was off, it catches up when you start it.` : 'Automatic backups are switched off on this computer.'}</p>
        </div>
        <div className="card">
          <span className="bk-fact-icon"><Icon name="download" /></span>
          <b>Second copy</b>
          {s.copyDir
            ? <p>Also copied to <code>{s.copyDir}</code>. {s.copyReachable ? <span className="ok">That folder is reachable.</span> : <span className="error">That folder cannot be reached right now (USB unplugged?).</span>}</p>
            : <p>Not set. A backup that only lives on this PC is lost with the PC. Set <code>BACKUP_COPY_DIR</code> in <code>apps/api/.env</code> to a USB drive or a Google Drive / OneDrive folder, or download copies below.</p>}
        </div>
        <div className="card">
          <span className="bk-fact-icon"><Icon name="history" /></span>
          <b>How long they are kept</b>
          <p>The last 14 days, plus one for each of the last 12 months, so older mistakes can still be undone. You have {s.count} saved now.</p>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h2>Saved backups</h2><span className="count-pill">{files.length}</span></div>
        {files.length ? (
          <ul className="list bk-list">
            {files.map((f, i) => (
              <li key={f.name}>
                <span className="who-line"><b>{when(f.at)}{i === 0 && <span className="badge green" style={{ marginLeft: 8 }}>Newest</span>}</b><span>{f.name} · {kb(f.bytes)}</span></span>
                <BusyButton type="button" className="secondary" busy={saving === f.name} onClick={() => download(f)}><Icon name="download" />Download</BusyButton>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>Nothing saved yet.</p>}
        <details className="bk-restore">
          <summary>How to restore a backup</summary>
          <p>Restoring replaces the data, so it is done from the command line, not from this screen, to stop it happening by accident.</p>
          <ol>
            <li>Close the app (stop the API).</li>
            <li>To check a backup first, run <code>pnpm restore backups/&lt;file&gt;</code>. It loads into a separate database and touches nothing live.</li>
            <li>To go back to a backup for real, run <code>pnpm restore backups/&lt;file&gt; --replace-live-data</code>. Everything entered after that backup is lost.</li>
          </ol>
        </details>
      </section>
    </div>
  );
}
