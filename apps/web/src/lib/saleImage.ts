// Draws bills and receipts as images for 80 mm thermal printers. Thermal printers cannot shape Urdu
// (Nastaliq) text themselves, so everything is printed as a picture.

import { contactLine, money, unitLabel, type BusinessSettings } from '@dist/shared';

export interface BillData {
  billNo: string;
  date: string;
  createdAt: string;
  status: string;
  saleType: string;
  customer: { name: string; shopName: string | null; creditLimit: string | null } | null;
  salesman: { name: string } | null;
  items: { product: { name: string; size: string | null }; unitName: string; qty: string; rate: string; lineTotal: string }[];
  returns: { product: { name: string; size: string | null }; unitName: string; qty: string; creditAmount: string; reason: string }[];
  gross: string;
  returnsCredit: string;
  net: string;
  paidNow: string;
  previousBalance: string;
  newBalance: string;
  availableCredit: string | null;
  empties: { productName: string; given: number; collected: number; heldAfter: number }[] | null;
}

export interface ReceiptData {
  receiptNo: string;
  createdAt: string;
  status: string;
  customer: { name: string; shopName: string | null };
  amount: string;
  method: string;
  previousBalance: string;
  newBalance: string;
  recordedBy: string | null;
  chequeNo?: string | null;
  chequeBank?: string | null;
  chequeDate?: string | null;
}

/** "Cheque 000123 · HBL · 15/12/2026" for receipts paid by cheque. */
export const chequeText = (r: Pick<ReceiptData, 'chequeNo' | 'chequeBank' | 'chequeDate'>) =>
  [`Cheque ${r.chequeNo}`, r.chequeBank, r.chequeDate && new Date(r.chequeDate).toLocaleDateString('en-GB', { timeZone: 'UTC' })].filter(Boolean).join(' · ');

/**
 * Printer dots across the roll at 203 dpi: 80 mm rolls print 72 mm (576 dots), 58 mm rolls 48 mm (384).
 * Layout is done on a wider logical page for 58 mm so the text stays readable, then scaled down.
 */
const ROLL = { 80: { dots: 576, layout: 576 }, 58: { dots: 384, layout: 460 } } as const;
const PAD = 16;
// Logical width of the bill being drawn. Set by makePen; all drawing after it is synchronous.
let WIDTH = 576;
const label = (p: { name: string; size: string | null }) => (p.size ? `${p.name} ${p.size}` : p.name);

type Pen = ReturnType<typeof makePen>;

function makePen(urduFamily: string, roll: 80 | 58) {
  const { dots, layout } = ROLL[roll];
  WIDTH = layout;
  const scale = dots / layout;
  const canvas = document.createElement('canvas');
  canvas.width = dots;
  canvas.height = 3600;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  let y = 16;
  /** Shrinks the font until the text fits in maxWidth (long product names, addresses). */
  const fit = (text: string, font: (size: number) => string, size: number, maxWidth: number) => {
    let s = size;
    ctx.font = font(s);
    while (s > 12 && ctx.measureText(text).width > maxWidth) ctx.font = font(--s);
  };
  return {
    get y() { return y; },
    gap(n: number) { y += n; },
    urdu(text: string, size: number, x: number, align: CanvasTextAlign, dy = 0, maxWidth = WIDTH - PAD * 2) {
      fit(text, (n) => `${n}px ${urduFamily}, sans-serif`, size, maxWidth);
      ctx.direction = 'rtl';
      ctx.textAlign = align;
      ctx.fillText(text, x, y + dy);
    },
    latin(text: string, size: number, x: number, align: CanvasTextAlign, bold = false, maxWidth = WIDTH - PAD * 2) {
      fit(text, (n) => `${bold ? 'bold ' : ''}${n}px sans-serif`, size, maxWidth);
      ctx.direction = 'ltr';
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
    },
    rule() {
      ctx.fillRect(PAD, y, WIDTH - PAD * 2, 2);
      y += 14;
    },
    finish() {
      const out = document.createElement('canvas');
      out.width = dots;
      out.height = Math.ceil((y + 24) * scale);
      out.getContext('2d')!.drawImage(canvas, 0, 0);
      return out.toDataURL('image/png');
    },
  };
}

/** A label row: English left, Urdu centre, amount right. */
function row(p: Pen, en: string, ur: string, value: string, bold = false) {
  const third = (WIDTH - PAD * 2) / 3;
  p.latin(en, 22, PAD, 'left', bold, third + 20);
  p.urdu(ur, 24, WIDTH / 2 + 50, 'center', -4, third - 30);
  p.latin(value, 22, WIDTH - PAD, 'right', bold, third);
  p.gap(36);
}

/** Business name (Urdu, big), English name, address and phone, then the document number and time. */
function header(p: Pen, s: BusinessSettings, no: string, when: string, status: string) {
  if (s.urduName) {
    p.urdu(s.urduName, 40, WIDTH / 2, 'center');
    p.gap(66);
  }
  p.latin(s.businessName, s.urduName ? 22 : 30, WIDTH / 2, 'center', true);
  p.gap(s.urduName ? 30 : 40);
  const contact = contactLine(s);
  if (contact) {
    p.latin(contact, 18, WIDTH / 2, 'center');
    p.gap(26);
  }
  if (s.ntn) {
    p.latin(`NTN ${s.ntn}`, 18, WIDTH / 2, 'center');
    p.gap(26);
  }
  p.gap(6);
  p.rule();
  if (status === 'CANCELLED') {
    p.latin('*** CANCELLED ***', 26, WIDTH / 2, 'center', true);
    p.gap(36);
  }
  p.latin(no, 22, PAD, 'left', true, WIDTH / 2 - PAD);
  p.latin(new Date(when).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }), 20, WIDTH - PAD, 'right', false, WIDTH / 2 - PAD);
  p.gap(32);
}

function footer(p: Pen, s: BusinessSettings) {
  p.gap(10);
  if (s.footer) {
    p.urdu(s.footer, 26, WIDTH / 2, 'center');
    p.gap(46);
  }
  if (s.note) {
    p.latin(s.note, 17, WIDTH / 2, 'center');
    p.gap(28);
  }
  p.gap(10);
}

export async function renderBillImage(b: BillData, urduFamily: string, s: BusinessSettings): Promise<string> {
  await document.fonts.load(`24px ${urduFamily}`, `${s.urduName}${s.footer}گاہک`).catch(() => []); // a missing local fallback font must not stop the print
  const p = makePen(urduFamily, s.thermalWidth);
  header(p, s, b.billNo, b.createdAt, b.status);

  p.latin(b.customer ? b.customer.name : 'Cash sale', 24, PAD, 'left', true);
  p.urdu('گاہک', 24, WIDTH - PAD, 'right', -4);
  p.gap(34);
  if (b.customer?.shopName) {
    p.latin(b.customer.shopName, 20, PAD, 'left');
    p.gap(28);
  }
  if (b.salesman) {
    p.latin(`Salesman: ${b.salesman.name}`, 20, PAD, 'left');
    p.gap(28);
  }
  p.rule();

  for (const l of b.items) {
    p.latin(label(l.product), 22, PAD, 'left', false, WIDTH * 0.66 - PAD);
    p.latin(money(l.lineTotal), 22, WIDTH - PAD, 'right', true, WIDTH * 0.3);
    p.gap(28);
    p.latin(`${Number(l.qty)} ${unitLabel(l.unitName)} x ${money(l.rate)}`, 20, PAD, 'left');
    p.gap(34);
  }
  if (b.returns.length) {
    p.latin('Returns', 20, PAD, 'left', true);
    p.urdu('واپسی', 22, WIDTH - PAD, 'right', -4);
    p.gap(32);
    for (const r of b.returns) {
      p.latin(`${label(r.product)} (${r.reason.toLowerCase()})`, 20, PAD, 'left', false, WIDTH * 0.66 - PAD);
      p.latin(`-${money(r.creditAmount)}`, 22, WIDTH - PAD, 'right', false, WIDTH * 0.3);
      p.gap(28);
      p.latin(`${Number(r.qty)} ${unitLabel(r.unitName)}`, 20, PAD, 'left');
      p.gap(32);
    }
  }
  p.rule();

  if (b.customer) row(p, 'Previous balance', 'پچھلا بقایا', money(b.previousBalance));
  row(p, 'This bill', 'یہ بل', money(b.net));
  if (Number(b.returnsCredit) > 0) row(p, '(incl. returns credit)', 'واپسی', `-${money(b.returnsCredit)}`);
  if (Number(b.paidNow) > 0) row(p, 'Paid now', 'ادا شدہ', `-${money(b.paidNow)}`);
  if (b.customer) {
    p.rule();
    row(p, 'New balance', 'کل بقایا', money(b.newBalance), true);
    if (b.customer.creditLimit) {
      p.latin(`Credit limit ${money(b.customer.creditLimit)}  |  available ${money(b.availableCredit ?? 0)}`, 19, PAD, 'left');
      p.gap(30);
    }
  }
  for (const e of b.empties ?? []) {
    p.latin(`Empties ${e.productName}: given ${e.given}, collected ${e.collected}, held ${e.heldAfter}`, 19, PAD, 'left');
    p.gap(28);
  }
  footer(p, s);
  return p.finish();
}

export async function renderReceiptImage(r: ReceiptData, urduFamily: string, s: BusinessSettings): Promise<string> {
  await document.fonts.load(`24px ${urduFamily}`, `${s.urduName}${s.footer}رسید`).catch(() => []); // a missing local fallback font must not stop the print
  const p = makePen(urduFamily, s.thermalWidth);
  header(p, s, `Receipt ${r.receiptNo}`, r.createdAt, r.status);
  p.latin(r.customer.name, 24, PAD, 'left', true);
  p.urdu('رسید', 28, WIDTH - PAD, 'right', -6);
  p.gap(36);
  if (r.customer.shopName) {
    p.latin(r.customer.shopName, 20, PAD, 'left');
    p.gap(28);
  }
  p.rule();
  row(p, 'Previous balance', 'پچھلا بقایا', money(r.previousBalance));
  row(p, `Received (${r.method.toLowerCase()})`, 'وصول', `-${money(r.amount)}`, true);
  if (r.chequeNo) {
    p.latin(chequeText(r), 19, PAD, 'left');
    p.gap(26);
    p.latin('Subject to the cheque clearing', 17, PAD, 'left');
    p.gap(26);
  }
  p.rule();
  row(p, 'New balance', 'کل بقایا', money(r.newBalance), true);
  if (r.recordedBy) {
    p.latin(`Received by: ${r.recordedBy}`, 19, PAD, 'left');
    p.gap(28);
  }
  footer(p, s);
  return p.finish();
}
