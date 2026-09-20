export function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* insecure context */ }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const money = (n) =>
  new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(Number(n) || 0);

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const HIDDEN = ['id', 'created_by', 'updated_at'];

export function toCSV(rows) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !HIDDEN.includes(k));
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // stop Excel treating text as a formula
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\r\n');
}

export function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadCSV(name, rows) {
  download(`${name}-${today()}.csv`, '\ufeff' + toCSV(rows), 'text/csv;charset=utf-8');
}
