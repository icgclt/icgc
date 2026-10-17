// Pure helpers for the Deposit Slip feature (no React, so they can be unit-tested).
export const NOTES = [200, 100, 50, 20, 10, 5, 2, 1];
export const COIN_VALUES = [0.5, 0.2, 0.1];

export const num = (v) => Number(v) || 0;
export const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const gh = (v) => 'GHS ' + num(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
export const fmtDT = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};
export const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
export const addDays = (iso, n) => {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below1000(n) {
  let s = '';
  if (n >= 100) { s += ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) s += ' and '; }
  if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += '-' + ONES[n % 10]; }
  else if (n > 0) s += ONES[n];
  return s;
}
function intWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']].forEach(([v, label]) => {
    if (n >= v) { parts.push(below1000(Math.floor(n / v)) + ' ' + label); n %= v; }
  });
  if (n > 0) parts.push(parts.length && n < 100 ? 'and ' + below1000(n) : below1000(n));
  return parts.join(' ');
}
export function amountWords(amount) {
  const a = r2(amount);
  const cedis = Math.floor(a + 1e-9);
  const pesewas = Math.round((a - cedis) * 100);
  if (a <= 0) return 'Zero Ghana Cedis Only';
  let s = '';
  if (cedis > 0) s += intWords(cedis) + ' Ghana Cedi' + (cedis === 1 ? '' : 's');
  if (pesewas > 0) s += (s ? ' and ' : '') + intWords(pesewas) + ' Pesewa' + (pesewas === 1 ? '' : 's');
  return s + ' Only';
}

// Break a withdrawn amount into notes (largest first). Anything under GHS 1 is returned as coins.
export function suggestNotes(amount) {
  let rem = Math.round(num(amount) * 100);
  const extra = {};
  NOTES.forEach((d) => {
    const q = Math.floor(rem / (d * 100));
    if (q > 0) extra[d] = q;
    rem -= q * d * 100;
  });
  return { extra, coins: rem > 0 ? rem / 100 : 0 };
}

// Add up the counted cash for one weekly report (weekly counts + weekday collections).
export function countedFor(reportId, data) {
  const notes = {};
  NOTES.forEach((d) => { notes[d] = 0; });
  let coinAmt = 0, coinPieces = 0, momo = 0;
  const add = (den, qty) => {
    const d = Number(den), q = num(qty);
    if (NOTES.includes(d)) notes[d] += q; else { coinAmt += d * q; coinPieces += q; }
  };
  (data.finance_weekly_cash_counts || []).filter((x) => x.report_id === reportId).forEach((x) => add(x.denomination, x.quantity));
  const cols = (data.finance_weekday_collections || []).filter((x) => x.report_id === reportId);
  const ids = new Set(cols.map((x) => x.id));
  (data.finance_weekday_cash_counts || []).filter((x) => ids.has(x.collection_id)).forEach((x) => add(x.denomination, x.quantity));
  (data.finance_weekly_momo || []).filter((x) => x.report_id === reportId).forEach((x) => { momo += num(x.amount); });
  (data.finance_weekday_momo || []).filter((x) => ids.has(x.collection_id)).forEach((x) => { momo += num(x.amount); });
  return { notes, coinAmt: r2(coinAmt), coinPieces, momo: r2(momo) };
}

export function cashValue(counted) {
  return r2(NOTES.reduce((s, d) => s + d * num(counted.notes[d]), 0) + num(counted.coinAmt));
}

// Work out every figure on the slip.
export function computeSlip({ counted, momoTotal, onlineTotal, form }) {
  const withdraw = form.withdrawOverride !== '' && form.withdrawOverride != null
    ? r2(form.withdrawOverride)
    : r2(num(momoTotal) + (form.includeOnline ? num(onlineTotal) : 0));
  const rows = NOTES.map((d) => {
    const c = num(counted.notes[d]);
    const x = num(form.extra?.[d]);
    return { d, counted: c, extra: x, total: c + x, amount: d * (c + x) };
  });
  const extraCoins = r2(form.extraCoins);
  const extraAlloc = r2(NOTES.reduce((s, d) => s + d * num(form.extra?.[d]), 0) + extraCoins);
  const coinsAmount = r2(num(counted.coinAmt) + extraCoins);
  const totalCash = r2(rows.reduce((s, r) => s + r.amount, 0) + coinsAmount);
  const chequeTotal = r2((form.cheques || []).reduce((s, c) => s + num(c.amount), 0));
  const totalDeposit = r2(totalCash + chequeTotal);
  const unallocated = r2(withdraw - extraAlloc);
  return { withdraw, rows, extraCoins, extraAlloc, coinsAmount, totalCash, chequeTotal, totalDeposit, unallocated, balanced: Math.abs(unallocated) < 0.005 };
}

// The next working day after a date (skips Saturdays, Sundays and the listed holidays). Mirrors the database function.
export const nextWorkingDay = (iso, holidays = new Set()) => {
  let x = addDays(iso, 1);
  for (let i = 0; i < 40; i++) {
    const dow = new Date(x + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6 || holidays.has(x)) x = addDays(x, 1); else break;
  }
  return x;
};
export const fmtLongDate = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '');
