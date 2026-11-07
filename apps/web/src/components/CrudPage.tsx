'use client';

import { StatTiles, type Tile } from '@/components/StatTiles';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BusyButton, Empty, SkeletonRows, useConfirm, useToast } from '@/components/Feedback';
import { Affix, Choice, Field as FormField, FormSection, type Span } from '@/components/Form';
import { Icon, type IconName } from '@/components/Icon';
import { LoadMore, SortTh, usePaged, useSort } from '@/components/Table';
import type { Permission } from '@dist/shared';
import { api, can, useUser } from '@/lib/api';

export interface Field {
  name: string;
  label: string;
  /** `choice` shows the options as cards (for 2–4 options); `select` as a dropdown. */
  type?: 'text' | 'number' | 'select' | 'date' | 'tel' | 'choice' | 'textarea';
  options?: { value: string; label: string; description?: string; icon?: IconName }[];
  required?: boolean;
  /** Only send/show for these values of another field, e.g. salary for monthly staff. */
  showWhen?: (values: Record<string, string>) => boolean;
  /** Width out of 12 columns. Default 6. */
  span?: Span;
  hint?: string;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  /** Which `sections` entry the field sits in. */
  section?: string;
  /** Value for a new record, e.g. type CASH. */
  initial?: string;
}

export interface FormSectionDef { key: string; title: string; description?: string }

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
  editPermission: Permission;
  /** Called to turn the form text values into the JSON body. */
  toBody?: (values: Record<string, string>) => Record<string, unknown>;
  extraRowActions?: (row: T) => ReactNode;
  /** Singular name for the add button, e.g. "customer". */
  noun?: string;
  /** Icon for the empty state. */
  icon?: IconName;
  /** Rows can be edited (PATCH path/:id). Default true. */
  editable?: boolean;
  /** Groups for the form; fields name theirs with `section`. Without it the form is one group. */
  sections?: FormSectionDef[];
  /** One line under the form title, e.g. what the record is used for. */
  formDescription?: string;
  /** A live preview drawn above the form fields from what is typed so far. */
  preview?: (values: Record<string, string>, editing: boolean) => ReactNode;
  /** Summary tiles above the list, worked out from the active rows. */
  summary?: (rows: T[]) => Tile[];
}

type Row = { id: string; isActive?: boolean } & Record<string, unknown>;

/** Form text for a row's current value. */
function textOf(v: unknown, f: Field): string {
  if (v == null) return '';
  if (f.type === 'number') return String(Number(v));
  if (f.type === 'date' || f.name.toLowerCase().endsWith('date')) return String(v).slice(0, 10);
  return String(v);
}

export default function CrudPage<T extends { id: string }>({ title, path, fields, columns, editPermission, toBody, extraRowActions, noun, icon = 'file', editable = true, sections, formDescription, preview, summary }: Props<T>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | 'add' | { edit: T }>(null);
  const [initial, setInitial] = useState('');
  const [filter, setFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const canEdit = can(useUser(), editPermission);
  const toast = useToast();
  const confirm = useConfirm();
  const formRef = useRef<HTMLDivElement>(null);
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
    const v = Object.fromEntries(fields.filter((f) => f.initial !== undefined).map((f) => [f.name, f.initial!]));
    setValues(v);
    setInitial(JSON.stringify(v));
    setMode('add');
  }
  function startEdit(r: T) {
    const row = r as unknown as Row;
    const v = Object.fromEntries(fields.map((f) => [f.name, textOf(row[f.name], f)]));
    setValues(v);
    setInitial(JSON.stringify(v));
    setMode({ edit: r });
  }
  function close() {
    setMode(null);
    setValues({});
  }
  const dirty = !!mode && JSON.stringify(values) !== initial;
  /** Closing with typed-in changes asks first, so a stray click or Esc cannot throw them away. */
  async function requestClose() {
    if (dirty && !(await confirm({ title: 'Discard your changes?', body: <p>What you typed has not been saved.</p>, confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true }))) return;
    close();
  }
  // The page behind the drawer does not scroll while it is open.
  useEffect(() => {
    if (!mode) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mode]);

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
      {summary && rows && rows.length > 0 && <StatTiles items={summary(rows.filter((r) => (r as unknown as Row).isActive !== false))} />}
      {canEdit && mode && (
        <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) void requestClose(); }}>
          <aside ref={formRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); void requestClose(); } }}>
            <form onSubmit={submit}>
              <header className="drawer-head">
                <span className="drawer-icon"><Icon name={icon} /></span>
                <div>
                  <h2 id="drawer-title">{editing ? `Edit ${String((editing as unknown as Row).name ?? singular)}` : `New ${singular}`}</h2>
                  {formDescription && <p>{formDescription}</p>}
                </div>
                <button type="button" className="drawer-x" onClick={() => void requestClose()} aria-label="Close"><Icon name="x" /></button>
              </header>
              <div className="drawer-body">
                {preview && <div className="drawer-preview" aria-live="polite">{preview(values, !!editing)}</div>}
                {(sections ?? [{ key: '', title: '' }]).map((sec) => {
                  const inSection = fields.filter((f) => (sections ? f.section === sec.key : true) && (!f.showWhen || f.showWhen(values)));
                  if (!inSection.length) return null;
                  return (
                    <FormSection key={sec.key} title={sec.title || undefined} description={sec.description}>
                      {inSection.map((f) => <FieldInput key={f.name} f={f} value={values[f.name] ?? ''} onChange={(v) => setValues({ ...values, [f.name]: v })} />)}
                    </FormSection>
                  );
                })}
              </div>
              <footer className="drawer-foot">
                <span className="drawer-note">{dirty ? 'Unsaved changes' : <><span className="req">*</span> required</>}</span>
                <button type="button" className="secondary" onClick={() => void requestClose()}>Cancel</button>
                <BusyButton busy={busy}><Icon name="check" />{busy ? 'Saving…' : editing ? 'Save changes' : `Save ${singular}`}</BusyButton>
              </footer>
            </form>
          </aside>
        </div>
      )}
      <div className="list-head">
        <div className="filter">
          <Icon name="search" />
          <input aria-label={`Filter ${title.toLowerCase()}`} placeholder={`Filter ${title.toLowerCase()}…`} value={filter} onChange={(e) => { setFilter(e.target.value); reset(); }} />
        </div>
        {inactiveCount > 0 && (
          <button type="button" className={`chip${showInactive ? ' on' : ''}`} aria-pressed={showInactive} onClick={() => setShowInactive(!showInactive)}>Show inactive ({inactiveCount})</button>
        )}
        {filter ? <span className="count">{shown.length} of {rows?.length ?? 0}</span> : rows ? <span className="count-pill">{shown.length}</span> : null}
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

/** One configured field, drawn with the form kit. */
function FieldInput({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  let control: ReactNode;
  if (f.type === 'choice') {
    control = <Choice name={f.name} value={value} onChange={onChange} options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label, description: o.description, icon: o.icon }))} />;
  } else if (f.type === 'select') {
    control = (
      <select value={value} required={f.required} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.placeholder ?? 'Select…'}</option>
        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (f.type === 'textarea') {
    control = <textarea value={value} required={f.required} placeholder={f.placeholder} rows={2} onChange={(e) => onChange(e.target.value)} />;
  } else {
    const input = (
      <input
        type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'tel' ? 'tel' : 'text'}
        step={f.type === 'number' ? 'any' : undefined}
        min={f.type === 'number' ? 0 : undefined}
        inputMode={f.type === 'number' ? 'decimal' : f.type === 'tel' ? 'tel' : undefined}
        placeholder={f.placeholder}
        value={value}
        required={f.required}
        onChange={(e) => onChange(e.target.value)}
      />
    );
    control = f.prefix || f.suffix ? <Affix prefix={f.prefix} suffix={f.suffix}>{input}</Affix> : input;
  }
  return (
    <FormField label={f.label} required={f.required} optional={!f.required && f.type !== 'choice'} hint={f.hint} span={f.type === 'choice' ? (f.span ?? 12) : (f.span ?? 6)}>
      {control}
    </FormField>
  );
}
