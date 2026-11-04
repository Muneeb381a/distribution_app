import type { OutboxBill } from './offlineDb';

const WIDTH = 576; // 80 mm at 203 dpi, the usual thermal print width in dots
const PAD = 16;

/**
 * Draws a bilingual bill onto a canvas and returns a PNG data URL. Thermal printers cannot shape
 * Urdu (Nastaliq) text themselves, so the bill is printed as an image.
 */
export async function renderBill(bill: OutboxBill, urduFamily: string): Promise<string> {
  await document.fonts.load(`24px ${urduFamily}`, 'ڈسٹری بیوشن').catch(() => []); // a missing local fallback font must not stop the print
  const rows = bill.lines.length;
  const height = 380 + rows * 72;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.fillStyle = '#000';

  let y = 20;
  const urdu = (text: string, size: number, x: number, align: CanvasTextAlign, yy: number) => {
    ctx.font = `${size}px ${urduFamily}, sans-serif`;
    ctx.direction = 'rtl';
    ctx.textAlign = align;
    ctx.fillText(text, x, yy);
  };
  const latin = (text: string, size: number, x: number, align: CanvasTextAlign, yy: number, bold = false) => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
    ctx.direction = 'ltr';
    ctx.textAlign = align;
    ctx.fillText(text, x, yy);
  };
  const rule = () => {
    ctx.fillRect(PAD, y, WIDTH - PAD * 2, 2);
    y += 14;
  };
  const money = (n: number) => n.toLocaleString('en-PK');

  ctx.textBaseline = 'top';
  urdu('ڈسٹری بیوشن', 40, WIDTH / 2, 'center', y);
  y += 70;
  latin(`Bill ${bill.billNo}`, 22, PAD, 'left', y, true);
  latin(new Date(bill.createdAt).toLocaleString('en-GB'), 20, WIDTH - PAD, 'right', y);
  y += 32;
  latin(bill.customer, 24, PAD, 'left', y, true);
  urdu('گاہک', 24, WIDTH - PAD, 'right', y - 4);
  y += 38;
  rule();

  for (const l of bill.lines) {
    latin(l.name, 22, PAD, 'left', y);
    latin(money(l.qty * l.rate), 22, WIDTH - PAD, 'right', y, true);
    y += 30;
    latin(`${l.qty} ${l.unit} x ${money(l.rate)}`, 20, PAD, 'left', y);
    y += 36;
  }
  rule();

  const total = (en: string, ur: string, value: number, bold = false) => {
    latin(en, 22, PAD, 'left', y, bold);
    urdu(ur, 24, WIDTH / 2 + 40, 'center', y - 4);
    latin(money(value), 22, WIDTH - PAD, 'right', y, bold);
    y += 36;
  };
  total('Previous balance', 'پچھلا بقایا', bill.previousBalance);
  total('This bill', 'یہ بل', bill.total);
  total('Paid now', 'ادا شدہ', bill.paidNow);
  rule();
  total('New balance', 'کل بقایا', bill.newBalance, true);

  return canvas.toDataURL('image/png');
}
