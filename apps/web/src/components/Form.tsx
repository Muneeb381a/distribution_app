'use client';

import { useId, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';

/**
 * The form kit. Every form in the app is built from these, so spacing, labels, hints, errors,
 * required/optional marks and the action bar look and behave the same everywhere.
 *
 * <FormCard title="New customer" onSubmit={…} actions={<FormActions …/>}>
 *   <FormSection title="Shop" description="…">
 *     <Field label="Name" required span={6}><input … /></Field>
 *   </FormSection>
 * </FormCard>
 */

export function FormCard({ title, description, onSubmit, actions, children, aside, className, id }: {
  title?: ReactNode; description?: ReactNode; onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  actions?: ReactNode; children: ReactNode; aside?: ReactNode; className?: string; id?: string;
}) {
  return (
    <form className={`fcard${className ? ` ${className}` : ''}`} onSubmit={onSubmit} id={id} noValidate={false}>
      {(title || description || aside) && (
        <header className="fcard-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {aside}
        </header>
      )}
      <div className="fcard-body">{children}</div>
      {actions && <footer className="fcard-foot">{actions}</footer>}
    </form>
  );
}

/** A titled group of fields: title and help on the left, fields on the right (stacked on phones). */
export function FormSection({ title, description, children }: { title?: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="fsec">
      {(title || description) && (
        <div className="fsec-info">
          {title && <h3>{title}</h3>}
          {description && <p>{description}</p>}
        </div>
      )}
      <div className="fgrid">{children}</div>
    </section>
  );
}

export type Span = 2 | 3 | 4 | 5 | 6 | 8 | 12;

/**
 * One field: label (with required * or "Optional"), the control, then a hint or an error.
 * Pass a single input/select/textarea as the child; it is linked to the label by id.
 */
export function Field({ label, hint, error, required, optional, span = 6, htmlFor, children, className }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; optional?: boolean;
  span?: Span; htmlFor?: string; children: ReactNode; className?: string;
}) {
  const auto = useId();
  const id = htmlFor ?? auto;
  return (
    <div className={`fld span-${span}${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`}>
      <label className="fld-label" htmlFor={id}>
        <span>{label}</span>
        {required && <span className="req" aria-hidden="true">*</span>}
        {optional && <span className="opt">Optional</span>}
      </label>
      <FieldId id={id}>{children}</FieldId>
      {error ? <p className="fld-error" role="alert"><Icon name="alert" />{error}</p> : hint ? <p className="fld-hint">{hint}</p> : null}
    </div>
  );
}

/** Gives the first input/select/textarea inside the field the label's id. */
function FieldId({ id, children }: { id: string; children: ReactNode }) {
  return <div className="fld-control" data-for={id} ref={(el) => {
    const c = el?.querySelector<HTMLElement>('input:not([type=hidden]):not(.combo-req), select, textarea');
    if (c && !c.id) c.id = id;
  }}>{children}</div>;
}

/** Input with a prefix ("Rs") and/or suffix ("kg", "%"). */
export function Affix({ prefix, suffix, children }: { prefix?: ReactNode; suffix?: ReactNode; children: ReactNode }) {
  return (
    <div className={`affix${prefix ? ' has-prefix' : ''}${suffix ? ' has-suffix' : ''}`}>
      {prefix && <span className="affix-pre">{prefix}</span>}
      {children}
      {suffix && <span className="affix-suf">{suffix}</span>}
    </div>
  );
}

export interface ChoiceOption<V extends string> { value: V; label: ReactNode; description?: ReactNode; icon?: Parameters<typeof Icon>[0]['name'] }

/** A small set of options as cards (Cash / Udhaar, Monthly / Daily). Keyboard: arrows move, like radios. */
export function Choice<V extends string>({ value, onChange, options, name, columns }: {
  value: V | ''; onChange: (v: V) => void; options: ChoiceOption<V>[]; name: string; columns?: number;
}) {
  return (
    <div className="choice" role="radiogroup" style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {options.map((o) => (
        <label key={o.value} className={`choice-opt${value === o.value ? ' on' : ''}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.icon && <span className="choice-icon"><Icon name={o.icon} /></span>}
          <span className="choice-text"><b>{o.label}</b>{o.description && <span>{o.description}</span>}</span>
          <span className="choice-dot" aria-hidden="true" />
        </label>
      ))}
    </div>
  );
}

/** A switch for yes/no settings. */
export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
      <span className="toggle-text"><b>{label}</b>{description && <span>{description}</span>}</span>
    </label>
  );
}

/** Right-aligned action bar: secondary actions, then the main button. */
export function FormActions({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="factions">
      {note && <span className="factions-note">{note}</span>}
      <div className="factions-btns">{children}</div>
    </div>
  );
}
