'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';

/* ------------------------------------------------------------------ toasts */

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string }
interface ToastApi { success: (text: string) => void; error: (text: string) => void; info: (text: string) => void }

/* ----------------------------------------------------------------- dialogs */

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions (cancel bill, write off…). */
  danger?: boolean;
}
interface PromptOptions extends ConfirmOptions {
  label: string;
  type?: 'text' | 'password' | 'number';
  minLength?: number;
  initial?: string;
}
type Dialog =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

const ToastCtx = createContext<ToastApi | null>(null);
const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);
const PromptCtx = createContext<((o: PromptOptions) => Promise<string | null>) | null>(null);

export function useToast(): ToastApi {
  const t = useContext(ToastCtx);
  if (!t) throw new Error('useToast outside FeedbackProvider');
  return t;
}
/** `await confirm({ title })` → true when the user confirms. Replaces window.confirm(). */
export function useConfirm() {
  const c = useContext(ConfirmCtx);
  if (!c) throw new Error('useConfirm outside FeedbackProvider');
  return c;
}
/** `await prompt({ title, label })` → the text, or null if cancelled. Replaces window.prompt(). */
export function usePrompt() {
  const p = useContext(PromptCtx);
  if (!p) throw new Error('usePrompt outside FeedbackProvider');
  return p;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const seq = useRef(0);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const [toastApi] = useState<ToastApi>(() => ({
    success: (t) => push('success', t),
    error: (t) => push('error', t),
    info: (t) => push('info', t),
  }));

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ kind: 'confirm', opts, resolve })), []);
  const prompt = useCallback((opts: PromptOptions) => new Promise<string | null>((resolve) => setDialog({ kind: 'prompt', opts, resolve })), []);

  const close = (value: boolean | string | null) => {
    if (!dialog) return;
    if (dialog.kind === 'confirm') dialog.resolve(value === true);
    else dialog.resolve(typeof value === 'string' ? value : null);
    setDialog(null);
  };

  return (
    <ToastCtx.Provider value={toastApi}>
      <ConfirmCtx.Provider value={confirm}>
        <PromptCtx.Provider value={prompt}>
          {children}
          {dialog && <Modal dialog={dialog} onClose={close} />}
          <div className="toasts" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={`toast ${t.kind}`}>
                <span className="toast-icon"><Icon name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'info'} /></span>
                <span className="toast-text">{t.text}</span>
                <button className="toast-x" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}><Icon name="x" /></button>
              </div>
            ))}
          </div>
        </PromptCtx.Provider>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

function Modal({ dialog, onClose }: { dialog: Dialog; onClose: (v: boolean | string | null) => void }) {
  const { opts } = dialog;
  const [text, setText] = useState(dialog.kind === 'prompt' ? (dialog.opts.initial ?? '') : '');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('input, button.modal-ok');
    first?.focus();
    return () => prev?.focus();
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(null); }
    if (e.key === 'Tab') {
      // keep focus inside the dialog
      const els = box.current?.querySelectorAll<HTMLElement>('input, button');
      if (!els?.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  const ok = () => onClose(dialog.kind === 'prompt' ? text : true);
  const tooShort = dialog.kind === 'prompt' && text.length < (dialog.opts.minLength ?? 1);

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(null); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={box} onKeyDown={onKey}>
        <form onSubmit={(e) => { e.preventDefault(); if (!tooShort) ok(); }}>
          <div className="modal-head">
            {opts.danger && <span className="modal-icon"><Icon name="alert" /></span>}
            <h2 id="modal-title">{opts.title}</h2>
          </div>
          {opts.body && <div className="modal-body">{opts.body}</div>}
          {dialog.kind === 'prompt' && (
            <label className="field modal-field">{dialog.opts.label}
              <input
                type={dialog.opts.type ?? 'text'} value={text} minLength={dialog.opts.minLength}
                onChange={(e) => setText(e.target.value)} autoComplete={dialog.opts.type === 'password' ? 'new-password' : 'off'}
              />
              {dialog.opts.minLength && <span className="hint">At least {dialog.opts.minLength} characters</span>}
            </label>
          )}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => onClose(null)}>{opts.cancelLabel ?? 'Cancel'}</button>
            <button className={`modal-ok${opts.danger ? ' danger' : ''}`} disabled={tooShort}>{opts.confirmLabel ?? 'OK'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- loading */

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** Button that shows a spinner and is disabled while `busy`. */
export function BusyButton({ busy, children, className, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...rest} className={`${className ?? ''}${busy ? ' is-busy' : ''}`.trim() || undefined} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

/** Grey shimmering table rows while data loads. */
export function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="sk-row" aria-hidden="true">
          {Array.from({ length: cols }, (_, j) => <td key={j}><span className="skeleton sk-line" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} /></td>)}
        </tr>
      ))}
    </>
  );
}

/** Empty state with an optional call to action. */
export function Empty({ icon = 'file', title, text, action }: { icon?: Parameters<typeof Icon>[0]['name']; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} /></span>
      <b>{title}</b>
      {text && <span>{text}</span>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
