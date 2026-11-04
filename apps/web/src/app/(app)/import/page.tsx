'use client';

import { useState } from 'react';
import { api, ApiError, download } from '@/lib/api';

type Kind = 'customers' | 'products' | 'suppliers' | 'stock';
interface Result { committed: boolean; total: number; valid: number; invalid: number; errors: { row: number; errors: string[] }[] }

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'customers', label: 'Customers (with opening khata balance)', hint: 'type is CASH or CREDIT. opening_balance is what the shop owes you today.' },
  { value: 'products', label: 'Products', hint: 'business_line BOTTLES or RICE. category_path like "Basmati > Super Kernel > Sella". pack_size = bottles per carton; bag_kg = packed rice bag size.' },
  { value: 'stock', label: 'Opening stock', hint: 'One row per product and location. location and product/size must match exactly; unit is optional (defaults to bottle or kg), e.g. CARTON or MAUND. unit_cost is optional and only used if the product has no cost yet. Each product and location can be imported once.' },
  { value: 'suppliers', label: 'Suppliers', hint: 'type is BEVERAGE, RICE_MILL or OTHER. opening_balance is what you owe them.' },
];

export default function ImportPage() {
  const [kind, setKind] = useState<Kind>('customers');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(commit: boolean) {
    if (!file) return;
    setError('');
    setBusy(true);
    const body = new FormData();
    body.append('file', file);
    try {
      setResult(await api<Result>(`/import/${kind}${commit ? '?commit=true' : ''}`, { method: 'POST', body }));
    } catch (e) {
      if (e instanceof ApiError && (e.body as Result | undefined)?.errors) setResult({ ...(e.body as Result), committed: false });
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = KINDS.find((k) => k.value === kind)!;

  return (
    <>
      <h1>Import from Excel / CSV</h1>
      <div className="card form">
        <label>What to import
          <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setResult(null); setError(''); }}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <button className="secondary" onClick={() => download(`/import/templates/${kind}`, `${kind}-template.xlsx`)}>Download template</button>
      </div>
      <p className="muted">{current.hint}</p>
      <div className="toolbar">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        <button disabled={!file || busy} className="secondary" onClick={() => run(false)}>Preview</button>
        <button disabled={!file || busy || !result || result.committed || result.invalid > 0} onClick={() => run(true)}>Import</button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="card">
          {result.committed ? <p className="ok">Imported {result.total} rows.</p> : (
            <p>{result.total} rows: <span className="ok">{result.valid} valid</span>, <span className={result.invalid ? 'error' : ''}>{result.invalid} with errors</span>. {result.invalid === 0 && 'Nothing is saved until you click Import.'}</p>
          )}
          {result.errors.length > 0 && (
            <table>
              <thead><tr><th>Row</th><th>Problem</th></tr></thead>
              <tbody>{result.errors.map((e) => <tr key={e.row}><td>{e.row}</td><td>{e.errors.join('; ')}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
