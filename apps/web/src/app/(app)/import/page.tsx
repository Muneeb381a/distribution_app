'use client';

import Link from 'next/link';
import { useRef, useState, type DragEvent } from 'react';
import { BusyButton, Empty, useConfirm, useToast } from '@/components/Feedback';
import { Icon, type IconName } from '@/components/Icon';
import { downloadCsv } from '@/components/Table';
import { api, ApiError, download } from '@/lib/api';

type Kind = 'customers' | 'products' | 'suppliers' | 'stock';
interface Result { committed: boolean; total: number; valid: number; invalid: number; errors: { row: number; errors: string[] }[] }

const KINDS: { value: Kind; label: string; icon: IconName; href: string; hint: string }[] = [
  { value: 'customers', label: 'Customers', icon: 'customers', href: '/customers', hint: 'type is CASH or CREDIT. opening_balance is what the shop owes you today.' },
  { value: 'products', label: 'Products', icon: 'products', href: '/products', hint: 'business_line BOTTLES or RICE. category_path like "Basmati > Super Kernel > Sella". pack_size = bottles per carton; bag_kg = packed rice bag size.' },
  { value: 'stock', label: 'Opening stock', icon: 'stock', href: '/stock', hint: 'One row per product and location. location and product/size must match exactly; unit is optional (defaults to bottle or kg), e.g. CARTON or MAUND. unit_cost is optional and only used if the product has no cost yet. Each product and location can be imported once.' },
  { value: 'suppliers', label: 'Suppliers', icon: 'suppliers', href: '/suppliers', hint: 'type is BEVERAGE, RICE_MILL or OTHER. opening_balance is what you owe them.' },
];
const STEPS = ['Choose file', 'Preview', 'Confirm'];
const ACCEPT = ['.xlsx', '.xls', '.csv'];

export default function ImportPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [kind, setKind] = useState<Kind>('customers');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const current = KINDS.find((k) => k.value === kind)!;
  const step = result?.committed ? 3 : result ? 2 : 1;

  function reset(next?: Partial<{ kind: Kind; file: File | null }>) {
    if (next?.kind) setKind(next.kind);
    setFile(next?.file ?? null);
    setResult(null);
    setError('');
  }

  async function run(commit: boolean, f = file) {
    if (!f) return;
    setError('');
    setBusy(true);
    const body = new FormData();
    body.append('file', f);
    try {
      const r = await api<Result>(`/import/${kind}${commit ? '?commit=true' : ''}`, { method: 'POST', body });
      setResult(r);
      if (commit) toast.success(`Imported ${r.total} ${current.label.toLowerCase()} rows`);
    } catch (e) {
      if (e instanceof ApiError && (e.body as Result | undefined)?.errors) setResult({ ...(e.body as Result), committed: false });
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function choose(f: File | undefined | null) {
    if (!f) return;
    if (!ACCEPT.some((ext) => f.name.toLowerCase().endsWith(ext))) {
      toast.error('Choose an Excel (.xlsx, .xls) or CSV file');
      return;
    }
    reset({ file: f });
    run(false, f); // preview straight away
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    choose(e.dataTransfer.files?.[0]);
  }

  async function commit() {
    if (!result) return;
    const ok = await confirm({
      title: `Import ${result.total} ${current.label.toLowerCase()} rows?`,
      body: <p>All rows are saved together. Imports cannot be undone from the app.</p>,
      confirmLabel: 'Import now',
    });
    if (ok) run(true);
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Import from Excel / CSV</h1><p>Bring in opening data in three steps. Nothing is saved until you confirm.</p></div>
      </div>

      <ol className="stepper" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s} className={step > i + 1 ? 'done' : step === i + 1 ? 'current' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
            <span className="step-no">{step > i + 1 ? <Icon name="check" /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>1. What are you importing?</h2>
        <div className="kind-grid" role="radiogroup" aria-label="What to import">
          {KINDS.map((k) => (
            <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} className={`kind${kind === k.value ? ' on' : ''}`} onClick={() => reset({ kind: k.value })}>
              <span className="kind-icon"><Icon name={k.icon} /></span>{k.label}
            </button>
          ))}
        </div>
        <p className="muted" style={{ margin: '14px 0' }}><Icon name="info" /> {current.hint}</p>
        <button className="secondary btn-icon" onClick={() => download(`/import/templates/${kind}`, `${kind}-template.xlsx`).catch((e) => toast.error(e.message))}>
          <Icon name="download" />Download {current.label.toLowerCase()} template
        </button>

        <div
          className={`dropzone${drag ? ' over' : ''}${file ? ' has-file' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => picker.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Choose a file to import, or drop it here"
        >
          <input ref={picker} type="file" hidden accept={ACCEPT.join(',')} onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="drop-icon"><Icon name={file ? 'file' : 'import'} /></span>
          {file ? (
            <>
              <b>{file.name}</b>
              <span>{(file.size / 1024).toFixed(1)} KB · click or drop to choose another file</span>
            </>
          ) : (
            <>
              <b>Drop your file here, or click to choose</b>
              <span>Excel (.xlsx, .xls) or CSV, using the template&apos;s columns</span>
            </>
          )}
        </div>
      </section>

      {(busy || result || error) && (
        <section className="card" aria-live="polite">
          <h2 style={{ marginTop: 0 }}>{result?.committed ? '3. Done' : '2. Preview'}</h2>
          {busy && <p className="muted"><span className="spinner" /> Checking {file?.name}…</p>}
          {error && !result && <p className="error">{error}</p>}
          {result && !busy && (
            result.committed ? (
              <div className="import-done">
                <span className="modal-icon ok"><Icon name="check" /></span>
                <div>
                  <b>Imported {result.total} rows.</b>
                  <p className="muted" style={{ margin: 0 }}>They are live now.</p>
                </div>
                <div className="actions" style={{ marginLeft: 'auto' }}>
                  <Link className="btn" href={current.href}>Open {current.label.toLowerCase()}</Link>
                  <button className="secondary" onClick={() => reset()}>Import another file</button>
                </div>
              </div>
            ) : (
              <>
                <div className="mini-stats">
                  <div className="stat"><span className="label">Rows</span><span className="value">{result.total}</span></div>
                  <div className="stat"><span className="label"><span className="icon green"><Icon name="check" /></span>Valid</span><span className="value">{result.valid}</span></div>
                  <div className="stat"><span className="label"><span className={`icon ${result.invalid ? 'red' : ''}`}><Icon name="alert" /></span>With errors</span><span className={`value${result.invalid ? ' neg' : ''}`}>{result.invalid}</span></div>
                </div>
                {result.errors.length > 0 ? (
                  <>
                    <div className="list-head">
                      <p className="error" style={{ margin: 0, flex: 1 }}>Fix these rows in your file and drop it again. Nothing has been saved.</p>
                      <button className="secondary btn-icon" onClick={() => downloadCsv(`${kind}-errors.csv`, ['Row', 'Problem'], result.errors.map((e) => [e.row, e.errors.join('; ')]))}><Icon name="download" />Download errors</button>
                    </div>
                    <div className="table-wrap scroll">
                      <table className="errors-table">
                        <thead><tr><th className="num">Row</th><th>Problem</th></tr></thead>
                        <tbody>
                          {result.errors.map((e) => (
                            <tr key={e.row}>
                              <td className="num"><b>{e.row}</b></td>
                              <td><ul>{e.errors.map((m) => <li key={m}>{m}</li>)}</ul></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : result.total === 0 ? (
                  <Empty icon="file" title="The file has no data rows" text="Fill in the template under its header row." />
                ) : (
                  <div className="import-ok">
                    <p className="ok" style={{ margin: 0, flex: 1 }}>All {result.total} rows look good.</p>
                    <BusyButton busy={busy} onClick={commit}><Icon name="check" />Import {result.total} rows</BusyButton>
                  </div>
                )}
              </>
            )
          )}
        </section>
      )}
    </>
  );
}
