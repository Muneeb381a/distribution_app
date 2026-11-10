'use client';

import { Empty, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { ago, deviceLine, place, type LoginEvent } from '@/lib/platform';

/** The page where a business's staff sign in, with the business code already filled. */
export const loginLink = (code: string) => `${window.location.origin}/login?business=${code}`;

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button type="button" className="secondary btn-icon copy-btn" onClick={() => { navigator.clipboard.writeText(text).then(() => toast.success('Copied'), () => toast.error('Could not copy')); }}>
      <Icon name="copy" />{label}
    </button>
  );
}

/** Bars for a short series, one column per entry. */
export function Spark({ data, label }: { data: { key: string; value: number; note: string; tick?: string }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="spark" role="img" aria-label={label}>
      {data.map((d) => (
        <span key={d.key} className="spark-col" title={d.note}>
          <i style={{ height: `${Math.max(3, (d.value / max) * 100)}%` }} className={d.value === max && max > 1 ? 'hot' : ''} />
          <small>{d.tick ?? ''}</small>
        </span>
      ))}
    </div>
  );
}

export function LoginTable({ rows, showBusiness }: { rows: LoginEvent[]; showBusiness?: boolean }) {
  return (
    <table>
      <thead><tr><th>When</th><th>Person</th>{showBusiness && <th>Business</th>}<th>Result</th><th>Place</th><th>Device</th><th>Address</th></tr></thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id}>
            <td className="nowrap" title={new Date(e.createdAt).toLocaleString()}>{ago(e.createdAt)}</td>
            <td><b>{e.username || '—'}</b></td>
            {showBusiness && <td>{e.scope === 'PLATFORM' ? <span className="badge teal">Console</span> : (e.tenantName ?? e.tenantCode ?? '—')}</td>}
            <td>{e.success ? <span className="badge green">Signed in</span> : <span className="badge red" title={e.reason ?? ''}>{e.reason ?? 'Failed'}</span>}</td>
            <td>{place(e)}</td>
            <td>{deviceLine(e)}</td>
            <td className="mono">{e.ip ?? '—'}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={showBusiness ? 7 : 6}><Empty icon="lock" title="No sign-ins" /></td></tr>}
      </tbody>
    </table>
  );
}
