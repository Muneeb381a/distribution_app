'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BusyButton, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { rupees } from '@dist/shared';

export interface Category { id: string; name: string; color: string | null; isSystem: boolean; isActive: boolean; entries: number; total: string }

export const PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#14b8a6', '#0ea5e9', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b'];

/** The category's own colour, or a steady one worked out from its name. */
export const colorOf = (cats: Category[], name: string) =>
  cats.find((c) => c.name === name)?.color ?? `hsl(${[...name.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11)} 62% 48%)`;

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {PALETTE.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} className={`swatch${value === c ? ' on' : ''}`} style={{ background: c }} onClick={() => onChange(c)}>
          {value === c && <Icon name="check" />}
        </button>
      ))}
    </div>
  );
}

/** Pick a category from the owner's own list, or make a new one on the spot. */
export function CategoryPicker({ categories, value, onChange, onChanged, onManage }: {
  categories: Category[]; value: string; onChange: (name: string) => void; onChanged: () => Promise<void> | void; onManage: () => void;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[6]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) input.current?.focus(); }, [adding]);
  const active = categories.filter((c) => c.isActive);

  async function create(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      const c = await api<Category>('/expense-categories', { method: 'POST', json: { name, color } });
      toast.success(`${c.name} added`);
      await onChanged();
      onChange(c.name);
      setAdding(false);
      setName('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="catpick">
      {/* Keeps the form from submitting without a category. */}
      <input className="sr-only" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} />
      <div className="catpick-chips" role="radiogroup" aria-label="Category">
        {active.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={value === c.name} className={`catchip${value === c.name ? ' on' : ''}`} onClick={() => onChange(c.name)}>
            <i style={{ background: colorOf(categories, c.name) }} />{c.name}
          </button>
        ))}
        {!adding && <button type="button" className="catchip add" onClick={() => setAdding(true)}><Icon name="plus" />New category</button>}
      </div>
      {adding && (
        <div className="catnew" role="group" aria-label="New category">
          <div className="catnew-row">
            <input ref={input} maxLength={40} value={name} placeholder="e.g. Tea and snacks" onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void create(e); if (e.key === 'Escape') setAdding(false); }} />
          </div>
          <Swatches value={color} onChange={setColor} />
          <div className="catnew-actions">
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
            <BusyButton type="button" busy={busy} disabled={!name.trim()} onClick={(e) => void create(e as unknown as FormEvent)}><Icon name="check" />Add category</BusyButton>
          </div>
        </div>
      )}
      <button type="button" className="catpick-manage" onClick={onManage}><Icon name="settings" />Manage categories</button>
    </div>
  );
}

/** Rename, recolour, hide and show categories. */
export function CategoryManager({ categories, onClose, onChanged }: { categories: Category[]; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', color: PALETTE[6] });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function patch(c: Category, body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await api(`/expense-categories/${c.id}`, { method: 'PATCH', json: body });
      toast.success(done);
      setEditing(null);
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const row = (c: Category) => (
    <li key={c.id} className={`catrow${c.isActive ? '' : ' off'}`}>
      {editing === c.id ? (
        <form className="catedit" onSubmit={(e) => { e.preventDefault(); void patch(c, { name: draft.name, color: draft.color }, `${draft.name} saved`); }}>
          {c.isSystem ? <b>{c.name}</b> : <input autoFocus maxLength={40} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Category name" />}
          <Swatches value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
          {!c.isSystem && c.entries > 0 && draft.name.trim() !== c.name && <p className="fld-hint">The {c.entries} entr{c.entries === 1 ? 'y' : 'ies'} under “{c.name}” will be renamed too.</p>}
          <div className="catnew-actions">
            <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
            <BusyButton busy={busy} disabled={!draft.name.trim()}><Icon name="check" />Save</BusyButton>
          </div>
        </form>
      ) : (
        <>
          <i className="catdot" style={{ background: colorOf(categories, c.name) }} />
          <span className="catrow-text">
            <b>{c.name}</b>
            <span className="muted">{c.entries ? `${c.entries} entr${c.entries === 1 ? 'y' : 'ies'} · Rs ${rupees(c.total)}` : 'Not used yet'}{c.isSystem ? ' · used by payroll' : ''}</span>
          </span>
          <button type="button" className="secondary icon-only" aria-label={`Edit ${c.name}`} title="Edit" onClick={() => { setEditing(c.id); setDraft({ name: c.name, color: c.color ?? PALETTE[6] }); }}><Icon name="edit" /></button>
          {!c.isSystem && (c.isActive
            ? <button type="button" className="secondary icon-only danger-hover" aria-label={`Hide ${c.name}`} title="Hide from the list" disabled={busy} onClick={() => void patch(c, { isActive: false }, `${c.name} hidden`)}><Icon name="ban" /></button>
            : <button type="button" className="secondary" disabled={busy} onClick={() => void patch(c, { isActive: true }, `${c.name} is back`)}>Show</button>)}
        </>
      )}
    </li>
  );

  const on = categories.filter((c) => c.isActive);
  const off = categories.filter((c) => !c.isActive);
  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="cat-title" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <header className="drawer-head">
          <span className="drawer-icon"><Icon name="expenses" /></span>
          <div><h2 id="cat-title">Expense categories</h2><p>Your own list. Hiding one keeps its old entries; renaming one renames them too.</p></div>
          <button type="button" className="drawer-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="drawer-body">
          <ul className="catlist">{on.map(row)}</ul>
          {off.length > 0 && (<><h3 className="catlist-title">Hidden</h3><ul className="catlist">{off.map(row)}</ul></>)}
        </div>
        <footer className="drawer-foot"><span className="drawer-note">Add a new one from the expense form</span><button type="button" onClick={onClose}>Done</button></footer>
      </aside>
    </div>
  );
}
