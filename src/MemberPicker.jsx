import { useEffect, useMemo, useRef, useState } from 'react';

// Type-ahead member picker: search by name, member ID or phone, then click (or use arrow keys + Enter).
export default function MemberPicker({ roster, value, onChange, placeholder = 'Type a name, member ID or phone…' }) {
  const selected = roster.find((m) => m.id === value) || null;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef(null);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? roster.filter((m) => [m.name, m.member_code, m.phone].some((v) => String(v || '').toLowerCase().includes(t))) : roster;
    return list.slice(0, 50);
  }, [roster, q]);

  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const pick = (m) => { onChange(m.id); setQ(''); setOpen(false); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { if (open && matches[hi]) { e.preventDefault(); pick(matches[hi]); } }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
    else if (e.key === 'Tab') { setOpen(false); setQ(''); }
  };
  const shown = open ? q : (selected ? `${selected.name}${selected.member_code ? ' · ' + selected.member_code : ''}` : '');

  return (
    <div className="mpicker" ref={box}>
      <input
        value={shown}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQ(''); }}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
      />
      {selected && !open && <button type="button" className="mpclear" aria-label="Clear selected member" onClick={() => { onChange(''); setQ(''); }}>×</button>}
      {open && (
        <div className="mplist" role="listbox">
          {matches.map((m, i) => (
            <div key={m.id} role="option" aria-selected={i === hi} className={i === hi ? 'mpitem hi' : 'mpitem'}
              ref={(el) => { if (el && i === hi) el.scrollIntoView({ block: 'nearest' }); }}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setHi(i)}>
              <b>{m.name}</b>
              <small>{[m.member_code, m.phone].filter(Boolean).join(' · ') || 'No member ID'}</small>
            </div>
          ))}
          {!matches.length && <div className="mpempty">No member matches “{q}”.</div>}
        </div>
      )}
    </div>
  );
}
