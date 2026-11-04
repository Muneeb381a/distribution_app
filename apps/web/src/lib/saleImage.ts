// Draws bills and receipts as images for 80 mm thermal printers. Thermal printers cannot shape Urdu
// (Nastaliq) text themselves, so everything is printed as a picture.

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
}

const WIDTH = 576; // 80 mm at 203 dpi
const PAD = 16;
const money = (n: string | number) => Number(n).toLocaleString('en-PK');
const label = (p: { name: string; size: string | null }) => (p.size ? `${p.name} ${p.size}` : p.name);

type Pen = ReturnType<typeof makePen>;

function makePen(urduFamily: string) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = 3000;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WIDTH, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  let y = 16;
  return {
    get y() { return y; },
    gap(n: number) { y += n; },
    urdu(text: string, size: number, x: number, align: CanvasTextAlign, dy = 0) {
      ctx.font = `${size}px ${urduFamily}, sans-serif`;
      ctx.direction = 'rtl';
      ctx.textAlign = align;
      ctx.fillText(text, x, y + dy);
    },
    latin(text: string, size: number, x: number, align: CanvasTextAlign, bold = false) {
      ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
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
      out.width = WIDTH;
      out.height = y + 24;
      out.getContext('2d')!.drawImage(canvas, 0, 0);
      return out.toDataURL('image/png');
    },
  };
}

/** A label row: English left, Urdu centre, amount right. */
function row(p: Pen, en: string, ur: string, value: string, bold = false) {
  p.latin(en, 22, PAD, 'left', bold);
  p.urdu(ur, 24, WIDTH / 2 + 50, 'center', -4);
  p.latin(value, 22, WIDTH - PAD, 'right', bold);
  p.gap(36);
}

function header(p: Pen, no: string, when: string, status: string) {
  p.urdu('ڈسٹری بیوشن', 40, WIDTH / 2, 'center');
  p.gap(70);
  if (status === 'CANCELLED') {
    p.latin('*** CANCELLED ***', 26, WIDTH / 2, 'center', true);
    p.gap(36);
  }
  p.latin(no, 22, PAD, 'left', true);
  p.latin(new Date(when).toLocaleString('en-GB'), 20, WIDTH - PAD, 'right');
  p.gap(32);
}

export async function renderBillImage(b: BillData, urduFamily: string): Promise<string> {
  await document.fonts.load(`24px ${urduFamily}`, 'ڈسٹری بیوشن').catch(() => []); // a missing local fallback font must not stop the print
  const p = makePen(urduFamily);
  header(p, b.billNo, b.createdAt, b.status);

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
    p.latin(label(l.product), 22, PAD, 'left');
    p.latin(money(l.lineTotal), 22, WIDTH - PAD, 'right', true);
    p.gap(28);
    p.latin(`${Number(l.qty)} ${l.unitName.toLowerCase()} x ${money(l.rate)}`, 20, PAD, 'left');
    p.gap(34);
  }
  if (b.returns.length) {
    p.latin('Returns', 20, PAD, 'left', true);
    p.urdu('واپسی', 22, WIDTH - PAD, 'right', -4);
    p.gap(32);
    for (const r of b.returns) {
      p.latin(`${label(r.product)} (${r.reason.toLowerCase()})`, 20, PAD, 'left');
      p.latin(`-${money(r.creditAmount)}`, 22, WIDTH - PAD, 'right');
      p.gap(28);
      p.latin(`${Number(r.qty)} ${r.unitName.toLowerCase()}`, 20, PAD, 'left');
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
  p.gap(10);
  p.urdu('شکریہ', 26, WIDTH / 2, 'center');
  p.gap(50);
  return p.finish();
}

export async function renderReceiptImage(r: ReceiptData, urduFamily: string): Promise<string> {
  await document.fonts.load(`24px ${urduFamily}`, 'ڈسٹری بیوشن').catch(() => []); // a missing local fallback font must not stop the print
  const p = makePen(urduFamily);
  header(p, `Receipt ${r.receiptNo}`, r.createdAt, r.status);
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
  p.rule();
  row(p, 'New balance', 'کل بقایا', money(r.newBalance), true);
  if (r.recordedBy) {
    p.latin(`Received by: ${r.recordedBy}`, 19, PAD, 'left');
    p.gap(28);
  }
  p.gap(10);
  p.urdu('شکریہ', 26, WIDTH / 2, 'center');
  p.gap(50);
  return p.finish();
}
