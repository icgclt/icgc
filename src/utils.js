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

// ---- Event times -------------------------------------------------------------------------------
// Events keep their time as free text ("8:00-10:30am", "6:00pm - 7:30pm", "9am", "18:00-19:30").
// eventTimeRange() turns that into minutes since midnight so the app knows when an event ends.
// Returns { startMin, endMin } or null when no time can be read. A single time is treated as a
// start time and the event is assumed to last 3 hours.
export function eventTimeRange(text) {
  const str = String(text || '');
  const re = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:([ap])\.?\s?m\.?)?/gi;
  const toks = [];
  let m;
  while ((m = re.exec(str))) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const mer = m[3] ? m[3].toLowerCase() : '';
    if (min > 59 || h > 24 || (mer && (h < 1 || h > 12))) continue;
    toks.push({ h, min, mer, explicit: !!(m[2] || mer) });
  }
  // bare numbers ("Hall 3") only count when the text also has a real clock time in it
  if (!toks.some((t) => t.explicit)) return null;
  const to24 = (t, mer) => (t.h % 12) * 60 + t.min + (mer === 'p' ? 720 : 0);
  // no am/pm anywhere: 24-hour if any hour is 13+, otherwise guess (7-11 morning, 12 and 1-6 afternoon)
  const guess = (t) => (t.h === 12 ? 12 * 60 + t.min : t.h >= 7 ? t.h * 60 + t.min : (t.h + 12) * 60 + t.min);
  const first = toks[0];
  if (toks.length === 1) {
    const startMin = first.mer ? to24(first, first.mer) : first.h >= 13 ? first.h * 60 + first.min : guess(first);
    return { startMin, endMin: startMin + 180 };
  }
  const last = toks[toks.length - 1];
  let startMin, endMin;
  if (last.mer) {
    endMin = to24(last, last.mer);
    startMin = to24(first, first.mer || last.mer);
    if (!first.mer && startMin > endMin) startMin -= 720;       // "11:00-1:00pm" starts at 11am
    else if (first.mer && startMin > endMin) endMin += 1440;    // "11:00pm-1:00am" ends after midnight
  } else if (first.mer) {
    startMin = to24(first, first.mer);
    endMin = to24(last, first.mer);
    if (endMin <= startMin) endMin += 720;                      // "10:30am - 12:00" ends at noon
  } else if (toks.some((t) => t.h >= 13)) {
    startMin = first.h * 60 + first.min;
    endMin = last.h * 60 + last.min;
  } else {
    startMin = guess(first);
    endMin = guess(last);
    if (endMin <= startMin) endMin += 720;
  }
  return { startMin, endMin };
}

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const minutesNow = (d) => d.getHours() * 60 + d.getMinutes();

// True once an event is over: its date has passed, or it is today and its end time has passed.
// Events with no readable time stay "upcoming" until the end of their day.
export function eventHasEnded(e, now = new Date()) {
  const day = String(e.date || '').slice(0, 10);
  const todayStr = localDate(now);
  if (day < todayStr) return true;
  if (day > todayStr) return false;
  const range = eventTimeRange(e.event_time);
  return !!range && minutesNow(now) >= range.endMin;
}

export function eventInProgress(e, now = new Date()) {
  if (String(e.date || '').slice(0, 10) !== localDate(now)) return false;
  const range = eventTimeRange(e.event_time);
  const n = minutesNow(now);
  return !!range && n >= range.startMin && n < range.endMin;
}

// Events that have not finished yet, soonest first (same day: by start time).
export function upcomingEvents(events, now = new Date()) {
  const start = (e) => { const r = eventTimeRange(e.event_time); return r ? r.startMin : 9999; };
  return [...(events || [])]
    .filter((e) => !eventHasEnded(e, now))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || start(a) - start(b));
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

// Parses CSV text (handles quoted fields, commas/newlines inside quotes, CRLF or LF) into
// an array of objects keyed by the header row. Tolerant of a leading BOM (Excel exports).
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip, \n handles the break */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}
