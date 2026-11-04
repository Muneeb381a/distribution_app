'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select';
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Only send/show for these values of another field, e.g. salary for monthly staff. */
  showWhen?: (values: Record<string, string>) => boolean;
}

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  /** Right-align numbers. */
  num?: boolean;
}

interface Props<T extends { id: string }> {
  title: string;
  path: string;
  fields: Field[];
  columns: Column<T>[];
  /** Permission needed to see the "add" form. */
  editPermission: string;
  /** Called to turn the form text values into the JSON body. */
  toBody?: (values: Record<string, string>) => Record<string, unknown>;
  extraRowActions?: (row: T) => ReactNode;
  /** Singular name for the add button, e.g. "customer". */
  noun?: string;
}

export default function CrudPage<T extends { id: string }>({ title, path, fields, columns, editPermission, toBody, extraRowActions, noun }: Props<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const [loaded, setLoaded] = useState(false);
  const canEdit = can(useUser(), editPermission);
  const singular = noun ?? title.replace(/s$/i, '').toLowerCase();

  const load = useCallback(
    () => api<T[]>(path).then((r) => { setRows(r); setLoaded(true); }).catch((e) => setError(e.message)),
    [path],
  );

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(f)) : rows;
  }, [rows, filter]);

  const defaultBody = () => {
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (!v || (f.showWhen && !f.showWhen(values))) continue;
      body[f.name] = f.type === 'number' ? Number(v) : v;
    }
    return body;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api(path, { method: 'POST', json: toBody ? toBody(values) : defaultBody() });
      setValues({});
      setAdding(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{loaded ? `${rows.length} total` : 'Loading…'}</p>
        </div>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <Icon name="plus" />Add {singular}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {canEdit && adding && (
        <form className="card form" onSubmit={submit}>
          <p className="form-title">New {singular}</p>
          {fields.filter((f) => !f.showWhen || f.showWhen(values)).map((f) => (
            <label key={f.name}>
              <span>{f.label}{f.required && <span className="error"> *</span>}</span>
              {f.type === 'select' ? (
                <select value={values[f.name] ?? ''} required={f.required} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                  <option value="">Select…</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  step="any"
                  value={values[f.name] ?? ''}
                  required={f.required}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                />
              )}
            </label>
          ))}
          <div className="form-actions">
            <button disabled={busy}>{busy ? 'Saving…' : `Save ${singular}`}</button>
            <button type="button" className="secondary" onClick={() => { setAdding(false); setValues({}); }}>Cancel</button>
          </div>
        </form>
      )}
      <div className="list-head">
        <div className="filter">
          <Icon name="search" />
          <input placeholder={`Filter ${title.toLowerCase()}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {filter && <span className="count">{shown.length} of {rows.length}</span>}
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.header} className={c.num ? 'num' : ''}>{c.header}</th>)}
            {extraRowActions && <th />}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => <td key={c.header} className={c.num ? 'num' : ''}>{c.render(r)}</td>)}
              {extraRowActions && <td>{extraRowActions(r)}</td>}
            </tr>
          ))}
          {!shown.length && (
            <tr><td colSpan={columns.length + 1} className="empty">{!loaded ? 'Loading…' : filter ? 'No match for your filter.' : `No ${title.toLowerCase()} yet.`}</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
