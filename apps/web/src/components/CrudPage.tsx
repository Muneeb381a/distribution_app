'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BusyButton, Empty, SkeletonRows, useConfirm, useToast } from '@/components/Feedback';
import { Icon, type IconName } from '@/components/Icon';
import { LoadMore, SortTh, usePaged, useSort } from '@/components/Table';
import { api, can, useUser } from '@/lib/api';

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'date';
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
  /** Makes the column sortable. */
  value?: (row: T) => string | number | null | undefined;
}

interface Props<T extends { id: string }> {
  title: string;
  path: string;
  fields: Field[];
  columns: Column<T>[];
  /** Permission needed to add, edit and deactivate. */
  editPermission: string;
  /** Called to turn the form text values into the JSON body. */
  toBody?: (values: Record<string, string>) => Record<string, unknown>;
  extraRowActions?: (row: T) => ReactNode;
  /** Singular name for the add button, e.g. "customer". */
  noun?: string;
  /** Icon for the empty state. */
  icon?: IconName;
  /** Rows can be edited (PATCH path/:id). Default true. */
  editable?: boolean;
}

type Row = { id: string; isActive?: boolean } & Record<string, unknown>;

/** Form text for a row's current value. */
function textOf(v: unknown, f: Field): string {
  if (v == null) return '';
  if (f.type === 'number') return String(Number(v));
  if (f.type === 'date' || f.name.toLowerCase().endsWith('date')) return String(v).slice(0, 10);
  return String(v);
}

export default function CrudPage<T extends { id: string }>({ title, path, fields, columns, editPermission, toBody, extraRowActions, noun, icon = 'file', editable = true }: Props<T>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | 'add' | { edit: T }>(null);
  const [filter, setFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const canEdit = can(useUser(), editPermission);
  const toast = useToast();
  const confirm = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  const singular = noun ?? title.replace(/s$/i, '').toLowerCase();

  const load = useCallback(
    () => api<T[]>(path).then((r) => { setRows(r); setError(''); }).catch((e) => setError(e.message)),
    [path],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (mode) formRef.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, [mode]);

  const hasActive = !!rows?.some((r) => 'isActive' in r);
  const inactiveCount = rows?.filter((r) => (r as unknown as Row).isActive === false).length ?? 0;

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (rows ?? []).filter((r) => (showInactive || (r as unknown as Row).isActive !== false) && (!f || JSON.stringify(r).toLowerCase().includes(f)));
  }, [rows, filter, showInactive]);

  const { sorted, sort, toggle } = useSort<T, string>(shown, (r, k) => columns.find((c) => c.header === k)?.value?.(r));
  const { page, loadMore, reset } = usePaged(sorted, 30);

  const body = () => {
    if (toBody) return toBody(values);
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (f.showWhen && !f.showWhen(values)) continue;
      // On edit an emptied optional field is left as it was (the API ignores missing fields).
      if (!v) continue;
      out[f.name] = f.type === 'number' ? Number(v) : v;
    }
    return out;
  };

  function startAdd() {
    setValues({});
    setMode('add');
  }
  function startEdit(r: T) {
    const row = r as unknown as Row;
    setValues(Object.fromEntries(fields.map((f) => [f.name, textOf(row[f.name], f)])));
    setMode({ edit: r });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function close() {
    setMode(null);
    setValues({});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const editing = mode && mode !== 'add' ? mode.edit : null;
    try {
      if (editing) await api(`${path}/${editing.id}`, { method: 'PATCH', json: body() });
      else await api(path, { method: 'POST', json: body() });
      toast.success(editing ? `${values.name || singular} updated` : `${values.name || singular} added`);
      close();
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setActive(r: T, isActive: boolean) {
    const name = String((r as unknown as Row).name ?? singular);
    if (!isActive && !(await confirm({
      title: `Deactivate ${name}?`,
      body: <p>It is hidden from pickers and new entries. History stays as it is, and you can activate it again.</p>,
      confirmLabel: 'Deactivate',
      danger: true,
    }))) return;
    try {
      await api(`${path}/${r.id}`, { method: 'PATCH', json: { isActive } });
      toast.success(`${name} ${isActive ? 'activated' : 'deactivated'}`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const editing = mode && mode !== 'add' ? mode.edit : null;
  const showActions = !!extraRowActions || (canEdit && editable);
  const showStatus = hasActive && inactiveCount > 0;
  const colCount = columns.length + (showStatus ? 1 : 0) + (showActions ? 1 : 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{rows ? `${rows.length - inactiveCount} active${inactiveCount ? ` · ${inactiveCount} inactive` : ''}` : 'Loading…'}</p>
        </div>
        {canEdit && !mode && (
          <button onClick={startAdd} className="btn-icon"><Icon name="plus" />Add {singular}</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {canEdit && mode && (
        <form className="card form" onSubmit={submit} ref={formRef} aria-label={editing ? `Edit ${singular}` : `New ${singular}`}>
          <p className="form-title">{editing ? `Edit ${String((editing as unknown as Row).name ?? singular)}` : `New ${singular}`}</p>
          {fields.filter((f) => !f.showWhen || f.showWhen(values)).map((f) => (
            <label key={f.name}>
              <span>{f.label}{f.required && <span className="error" aria-hidden="true"> *</span>}</span>
              {f.type === 'select' ? (
                <select value={values[f.name] ?? ''} required={f.required} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                  <option value="">Select…</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  step="any"
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  value={values[f.name] ?? ''}
                  required={f.required}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                />
              )}
            </label>
          ))}
          <div className="form-actions">
            <BusyButton busy={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : `Save ${singular}`}</BusyButton>
            <button type="button" className="secondary" onClick={close}>Cancel</button>
          </div>
        </form>
      )}
      <div className="list-head">
        <div className="filter">
          <Icon name="search" />
          <input aria-label={`Filter ${title.toLowerCase()}`} placeholder={`Filter ${title.toLowerCase()}…`} value={filter} onChange={(e) => { setFilter(e.target.value); reset(); }} />
        </div>
        {inactiveCount > 0 && (
          <button type="button" className={`chip${showInactive ? ' on' : ''}`} aria-pressed={showInactive} onClick={() => setShowInactive(!showInactive)}>Show inactive ({inactiveCount})</button>
        )}
        {filter && <span className="count">{shown.length} of {rows?.length ?? 0}</span>}
      </div>
      <table className="sticky-head">
        <thead>
          <tr>
            {columns.map((c) => (c.value
              ? <SortTh key={c.header} k={c.header} sort={sort} toggle={toggle} num={c.num}>{c.header}</SortTh>
              : <th key={c.header} className={c.num ? 'num' : ''}>{c.header}</th>))}
            {showStatus && <th>Status</th>}
            {showActions && <th><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {!rows && !error && <SkeletonRows cols={colCount} />}
          {page.map((r) => {
            const inactive = (r as unknown as Row).isActive === false;
            return (
              <tr key={r.id} className={inactive ? 'inactive' : ''}>
                {columns.map((c) => <td key={c.header} className={c.num ? 'num' : ''}>{c.render(r)}</td>)}
                {showStatus && <td>{inactive ? <span className="badge">Inactive</span> : <span className="badge green">Active</span>}</td>}
                {showActions && (
                  <td>
                    <div className="row-actions">
                      {extraRowActions?.(r)}
                      {canEdit && editable && (
                        <>
                          <button type="button" className="secondary icon-only" onClick={() => startEdit(r)} aria-label={`Edit ${String((r as unknown as Row).name ?? '')}`} title="Edit"><Icon name="edit" /></button>
                          {hasActive && (inactive
                            ? <button type="button" className="secondary" onClick={() => setActive(r, true)}>Activate</button>
                            : <button type="button" className="secondary icon-only danger-hover" onClick={() => setActive(r, false)} aria-label={`Deactivate ${String((r as unknown as Row).name ?? '')}`} title="Deactivate"><Icon name="ban" /></button>)}
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {rows && !shown.length && (
            <tr><td colSpan={colCount}>
              {filter ? <Empty icon="search" title={`No ${title.toLowerCase()} match “${filter}”`} />
                : <Empty icon={icon} title={`No ${title.toLowerCase()} yet`} action={canEdit && <button type="button" onClick={startAdd}><Icon name="plus" />Add first {singular}</button>} />}
            </td></tr>
          )}
        </tbody>
      </table>
      <LoadMore shown={page.length} total={sorted.length} onMore={loadMore} />
    </>
  );
}
