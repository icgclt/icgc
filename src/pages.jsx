import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, can, ROLES, isAdmin, isSuperAdmin } from './auth';
import { useData } from './data';
import BackupPanel from './BackupPanel';
import { supabase } from './supabase';
import Crud, { StoragePhoto } from './Crud';
import { money, today, downloadCSV, download, parseCSV, uuid, upcomingEvents as pickUpcomingEvents, eventInProgress, escapeHtml as esc, formatLoginId } from './utils';

const STATUS = ['Active', 'Inactive', 'Visitor', 'Left'];
const SERVICES = ['Sunday Service', 'Bible Study', 'Prayer Meeting', 'Special Program', 'Other'];
const OFFERING_CATEGORIES = ['Main Offering', 'Project Offering', "Children's Offering", 'First Fruit', 'Weekday Offering', 'Donation', 'Thanksgiving', 'Pledges'];
const HEADCOUNT_CATEGORIES = ['Children Boys', 'Children Girls', 'Youth Boys', 'Youth Girls', 'Adult Men', 'Adult Women'];
const headcountLabel = (cat) => cat.replace('Youth Boys', 'Omega Boys').replace('Youth Girls', 'Omega Girls');
const badge = (v) => <span className="badge">{v}</span>;
const displayMemberLogin = (value) => formatLoginId(value);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayName = (iso) => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' }) : '';
// Member IDs start with the church's letters: adults <P>A, Omega <P>O, children <P>C (e.g. TTA1 for ICGC Testimony Temple).
// Set VITE_MEMBER_CODE_PREFIX in .env to override. Default is TT for Testimony Temple.
const MEMBER_PREFIX = (import.meta.env.VITE_MEMBER_CODE_PREFIX || 'TT').toUpperCase();
const [PFX_ADULT, PFX_OMEGA, PFX_CHILD] = [`${MEMBER_PREFIX}A`, `${MEMBER_PREFIX}O`, `${MEMBER_PREFIX}C`];
const PFX_RE = new RegExp(`^(${PFX_ADULT}|${PFX_OMEGA}|${PFX_CHILD})`);
const PFX_NUM_RE = new RegExp(`^(${PFX_ADULT}|${PFX_OMEGA}|${PFX_CHILD})(\\d+)$`);
const memberIdCompare = (a, b) => {
  const rank = (code) => { const p = String(code || '').toUpperCase().match(PFX_RE)?.[1]; return p === PFX_ADULT ? 0 : p === PFX_OMEGA ? 1 : p === PFX_CHILD ? 2 : 9; };
  const ca = String(a.member_code || '').toUpperCase(), cb = String(b.member_code || '').toUpperCase();
  const ra = rank(ca), rb = rank(cb);
  if (ra !== rb) return ra - rb;
  const ma = ca.match(PFX_NUM_RE), mb = cb.match(PFX_NUM_RE);
  if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
  return ca.localeCompare(cb, undefined, { numeric: true, sensitivity: 'base' });
};

// Forgiving name key used to match attendance names to member records: ignores capitals, extra spaces,
// punctuation, titles (Mr, Mrs, Rev ...) and word order, so "MRS ADINKRAH JOEL" matches "Joel Adinkrah".
const NAME_TITLES = new Set(['mr', 'mrs', 'miss', 'ms', 'mad', 'madam', 'rev', 'dr', 'pastor', 'elder', 'deacon', 'deaconess', 'prophet', 'apostle', 'bro', 'sis', 'brother', 'sister', 'evangelist', 'evang', 'prof', 'hon']);
const looseNameKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !NAME_TITLES.has(t)).sort().join(' ');

/* ---------------- Dashboard ---------------- */
// Small Male / Female / Total table shared by the Active members and Last attendance cards.
function GroupBreakdown({ rows }) {
  const showNone = rows.some((r) => r.none > 0);
  return (
    <div className="tablewrap" style={{ marginTop: 8 }}>
      <table>
        <thead><tr><th>Group</th><th>Male</th><th>Female</th>{showNone && <th>Not set</th>}<th>Total</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.male}</td><td>{r.female}</td>{showNone && <td>{r.none}</td>}<td><b>{r.total}</b></td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

// "Title (n): name, name, ..." line used under the dashboard tables so people can be found and fixed.
function NameList({ title, names, hint }) {
  if (!names.length) return null;
  return (
    <div className="muted sm" style={{ marginTop: 10 }}>
      <b>{title} ({names.length}):</b> {names.slice(0, 40).join(', ')}{names.length > 40 ? ` and ${names.length - 40} more` : ''}.
      {hint && <><br />{hint}</>}
    </div>
  );
}

export function Dashboard() {
  const { data } = useData();
  const { profile } = useAuth();
  const [basis, setBasis] = useState('Active'); // which members the breakdown counts: 'Active' or 'All'
  const active = data.members.filter((m) => m.status === 'Active').length;
  const pool = basis === 'Active' ? data.members.filter((m) => m.status === 'Active') : data.members;
  const GROUPS = [['Adult', 'Adults'], ['Omega', 'Omega'], ['Child', 'Children']];
  const countOf = (type, gender) => pool.filter((m) => (m.member_type || 'Adult') === type
    && (gender ? m.gender === gender : m.gender !== 'Male' && m.gender !== 'Female')).length;
  const breakdown = GROUPS.map(([type, label]) => {
    const male = countOf(type, 'Male'), female = countOf(type, 'Female'), none = countOf(type, null);
    return { label, male, female, none, total: male + female + none };
  });
  const noGender = (m) => m.gender !== 'Male' && m.gender !== 'Female';
  const labelOf = (m) => `${m.name}${m.member_code ? ` (${m.member_code})` : ''}`;
  const noGenderMembers = pool.filter(noGender).sort(memberIdCompare).map(labelOf);
  const lastDate = data.attendance.map((a) => a.date).sort().pop();
  const presentRows = data.attendance.filter((a) => a.date === lastDate && a.status === 'Present');
  const lastPresent = presentRows.length;
  // Work out each present person's group and gender from their member record (directly, via the child
  // record, or by matching the name). Anyone who cannot be matched is counted under "Not linked".
  const nameKey = (v) => String(v || '').trim().toLowerCase();
  const byId = new Map(data.members.map((m) => [m.id, m]));
  const byName = new Map();
  data.members.forEach((m) => { const k = nameKey(m.name); if (k && !byName.has(k)) byName.set(k, m); });
  const looseCount = new Map(), byLoose = new Map();
  data.members.forEach((m) => { const k = looseNameKey(m.name); if (!k) return; looseCount.set(k, (looseCount.get(k) || 0) + 1); byLoose.set(k, m); });
  const matchLoose = (name) => { const k = looseNameKey(name); return k && looseCount.get(k) === 1 ? byLoose.get(k) : undefined; };
  const childMember = new Map((data.children || []).filter((c) => c.member_id).map((c) => [c.id, c.member_id]));
  const presentBreakdown = GROUPS.map(([type, label]) => ({ label, type, male: 0, female: 0, none: 0, total: 0 }));
  const notLinked = { label: 'Not linked to a member', male: 0, female: 0, none: 0, total: 0 };
  const notLinkedNames = [];
  const noGenderPresent = new Map();
  presentRows.forEach((a) => {
    const m = byId.get(a.member_id) || byId.get(childMember.get(a.child_id)) || byName.get(nameKey(a.person_name)) || matchLoose(a.person_name);
    const row = m ? presentBreakdown.find((r) => r.type === (m.member_type || 'Adult')) || notLinked : notLinked;
    const key = m && m.gender === 'Male' ? 'male' : m && m.gender === 'Female' ? 'female' : 'none';
    row[key] += 1; row.total += 1;
    if (!m) notLinkedNames.push(String(a.person_name || '(no name)').trim());
    else if (key === 'none') noGenderPresent.set(m.id, m);
  });
  const presentTable = notLinked.total ? [...presentBreakdown, notLinked] : presentBreakdown;
  const noGenderPresentNames = [...noGenderPresent.values()].sort(memberIdCompare).map(labelOf);
  const genderHint = 'Open Members, find the person, edit and choose Male or Female.';
  // Events that have already finished (including earlier today) drop off; re-check every minute.
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(id); }, []);
  const upcoming = pickUpcomingEvents(data.events).slice(0, 5);
  const recent = [...data.members].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5);
  const birthdaySoon = (data.members || []).filter(m => m.dob && (() => { const now = new Date(); const birth = new Date(`${now.getFullYear()}-${String(m.dob).slice(5,7)}-${String(m.dob).slice(8,10)}T00:00:00`); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); let diff = Math.round((birth-start)/86400000); if (diff < 0) { birth.setFullYear(now.getFullYear()+1); diff = Math.round((birth-start)/86400000); } return diff >= 0 && diff <= 7; })()).map(m => { const now=new Date(); const mm=String(m.dob).slice(5,7), dd=String(m.dob).slice(8,10); let dt=new Date(`${now.getFullYear()}-${mm}-${dd}T00:00:00`); if(dt < new Date(now.getFullYear(),now.getMonth(),now.getDate())) dt.setFullYear(now.getFullYear()+1); return {...m, daysUntil:Math.round((dt-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000)}; }).sort((a,b)=>a.daysUntil-b.daysUntil);

  return (
    <>
      <div className="top">
        <div>
          <h1>Dashboard</h1>
          <div className="muted">Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}</div>
        </div>
      </div>
      <div className="cards">
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div className="label">{basis === 'Active' ? 'Active members' : 'All members'}</div>
            <div className="tabs" style={{ margin: 0 }}>
              <button type="button" className={`tab${basis === 'Active' ? ' active' : ''}`} style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setBasis('Active')}>Active</button>
              <button type="button" className={`tab${basis === 'All' ? ' active' : ''}`} style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setBasis('All')}>All</button>
            </div>
          </div>
          <div className="num">{pool.length}</div>
          <div className="muted sm">{active} active · {data.members.length} on the register (all statuses)</div>
          <GroupBreakdown rows={breakdown} />
          <NameList title="Gender not set" names={noGenderMembers} hint={genderHint} />
        </div>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div className="label">Last attendance{lastDate ? ` (${lastDate})` : ''}</div>
          <div className="num">{lastPresent}</div>
          <div className="muted sm">present</div>
          <GroupBreakdown rows={presentTable} />
          <NameList title="Gender not set" names={noGenderPresentNames} hint={genderHint} />
          <NameList title="Not linked" names={notLinkedNames} hint="No member has this name. Correct the spelling in Attendance Records, or add the person under Members." />
        </div>
        <div className="card"><div className="label">New visitors</div><div className="num">{data.visitors.filter(v => v.visit_date === today()).length}</div><div className="muted sm">today</div></div>
        <div className="card"><div className="label">Open follow-ups</div><div className="num">{data.follow_ups.filter(f => f.status === 'Open' || f.status === 'In Progress').length}</div></div>
      </div>
      <div className="panel"><h2>Birthday reminders · next 7 days</h2>{birthdaySoon.length ? birthdaySoon.map(m=><div className="listrow" key={m.id}><b style={{marginRight:8}}>{m.name}</b><span>{m.daysUntil===0 ? 'Birthday today' : `In ${m.daysUntil} day${m.daysUntil===1?'':'s'}`} · {String(m.dob).slice(5)}</span></div>) : <p className="muted">No birthdays in the next 7 days.</p>}</div>
      <div className="grid2">
        <div className="panel">
          <h2>Recent members</h2>
          {recent.length ? recent.map((m) => (
            <p key={m.id}><b>{m.name}</b><br /><span className="muted">{m.phone || 'No phone'} · {m.status}</span></p>
          )) : <div className="empty">No members yet.</div>}
        </div>
        <div className="panel">
          <h2>Upcoming events</h2>
          {upcoming.length ? upcoming.map((e) => (
            <p key={e.id}><b>{e.title}</b>{eventInProgress(e) && <span className="badge" style={{ marginLeft: 8 }}>Happening now</span>}<br /><span className="muted">{e.date} · {dayName(e.date)}{e.event_time ? ` · ${e.event_time}` : ''}{e.location ? ` · ${e.location}` : ''}</span></p>
          )) : <div className="empty">No upcoming events.</div>}
        </div>
      </div>
    </>
  );
}

/* ---------------- Modules (all use the generic Crud component) ---------------- */
const MEMBER_CSV_FIELDS = ['member_code', 'name', 'phone', 'email', 'dob', 'gender', 'member_type', 'grp', 'status', 'address', 'parent1_name', 'parent1_phone', 'parent1_relationship', 'parent2_name', 'parent2_phone', 'parent2_relationship', 'notes'];

// ---- Member CSV import helpers ------------------------------------------------------------------
// Excel often damages phone numbers: it drops the leading 0 (0244123456 becomes 244123456) and turns long
// numbers into scientific notation (2.43E+08), which loses the digits for good.
function cleanPhone(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { phone: '', status: 'blank' };
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(s)) return { phone: '', status: 'damaged' };
  const compact = s.replace(/[\s\-().]/g, '');
  if (/^\+?233\d{9}$/.test(compact)) return { phone: '0' + compact.replace(/^\+?233/, ''), status: 'fixed' };
  if (/^0\d{9}$/.test(compact)) return { phone: compact, status: 'ok' };
  if (/^[1-9]\d{8}$/.test(compact)) return { phone: '0' + compact, status: 'fixed' };
  return { phone: s, status: 'odd' };
}

// Dates arrive as 2026-10-11 or, from Excel in Ghana, 11/10/2026 (day first).
function cleanDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { date: null, ok: true };
  let y, mo, d;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) [, y, mo, d] = m;
  else if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/))) [, d, mo, y] = m;
  else return { date: null, ok: false };
  const t = new Date(Date.UTC(+y, +mo - 1, +d));
  if (t.getUTCFullYear() !== +y || t.getUTCMonth() !== +mo - 1 || t.getUTCDate() !== +d) return { date: null, ok: false };
  return { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, ok: true };
}

const importNorm = (v) => String(v || '').trim().toLowerCase();
const samePhone = (a, b) => !!a && !!b && String(a).replace(/\D/g, '').slice(-9) === String(b).replace(/\D/g, '').slice(-9);
const nameList = (arr) => (arr.length > 6 ? `${arr.slice(0, 6).join(', ')} and ${arr.length - 6} more` : arr.join(', '));

// Same name is not enough to be the same person: use the phone number when the file and the record both have one.
function findExistingMember(pool, name, phone) {
  const sameName = pool.filter((m) => importNorm(m.name) === importNorm(name));
  if (phone) {
    const withPhone = sameName.find((m) => samePhone(m.phone, phone));
    if (withPhone) return withPhone;
  }
  const candidates = sameName.filter((m) => !phone || !m.phone || samePhone(m.phone, phone));
  return candidates.length === 1 ? candidates[0] : null;
}

function MemberImport() {
  const { data, save } = useData();
  const { role } = useAuth();
  const fileRef = useRef(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!can(role, 'members', 'write')) return null;

  const downloadTemplate = () =>
    download('members-template.csv', '\ufeff' + MEMBER_CSV_FIELDS.join(',') + '\r\n' + ',Jane Doe,0244000000,,,Female,Adult,,Active,,,,,,,,\r\n', 'text/csv;charset=utf-8');

  const importCSV = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const rows = parseCSV(await file.text());
      if (!rows.length) { setMsg({ ok: false, text: 'No rows found in that file — check it has a header row plus at least one member.' }); return; }

      // A working copy that grows as members are added. Every new row looks at it, so each new member gets the
      // next free ID instead of every row being given the same "next" ID from the unchanged member list.
      const working = [...data.members];
      const childByMember = new Map((data.children || []).map((c) => [c.member_id, c]));
      const history = data.member_group_history || [];
      let added = 0, updated = 0, skipped = 0, phonesFixed = 0;
      const damagedPhones = [], oddPhones = [], badDates = [], idTaken = [];

      for (const r of rows) {
        const name = (r.name || '').trim();
        if (!name) { skipped++; continue; }

        const ph = cleanPhone(r.phone);
        if (ph.status === 'fixed') phonesFixed++;
        if (ph.status === 'damaged') damagedPhones.push(name);
        if (ph.status === 'odd') oddPhones.push(name);
        const dob = cleanDate(r.dob);
        if (!dob.ok) badDates.push(name);

        const typeIn = ['Adult', 'Omega', 'Child'].find((t) => t.toLowerCase() === importNorm(r.member_type));
        const providedCode = String(r.member_code || '').trim().toUpperCase();
        const codeOwner = providedCode ? working.find((m) => importNorm(m.member_code) === providedCode.toLowerCase()) : null;

        let match = null;
        if (codeOwner && importNorm(codeOwner.name) === importNorm(name)) match = codeOwner;
        else if (codeOwner) idTaken.push(`${providedCode} (${codeOwner.name})`);
        if (!match) match = findExistingMember(working, name, ph.phone);

        const memberType = typeIn || match?.member_type || 'Adult';
        const statusIn = STATUS.find((s) => s.toLowerCase() === importNorm(r.status));
        const status = statusIn || match?.status || 'Active';

        let memberCode;
        if (match) memberCode = (match.member_code || nextMemberCode(working, memberType, history)).trim();
        else if (providedCode && !codeOwner) memberCode = providedCode;
        else memberCode = nextMemberCode(working, memberType, history);

        const importId = match ? match.id : uuid();
        const importedMember = {
          id: importId,
          member_code: memberCode,
          name,
          phone: ph.phone || match?.phone || '',
          email: r.email || match?.email || '',
          dob: dob.date || match?.dob || null,
          gender: r.gender || match?.gender || null,
          member_type: memberType,
          grp: r.grp || r.group || match?.grp || '',
          status,
          address: r.address || match?.address || '',
          parent1_name: r.parent1_name || match?.parent1_name || '',
          parent1_phone: cleanPhone(r.parent1_phone).phone || match?.parent1_phone || '',
          parent1_relationship: r.parent1_relationship || match?.parent1_relationship || '',
          parent2_name: r.parent2_name || match?.parent2_name || '',
          parent2_phone: cleanPhone(r.parent2_phone).phone || match?.parent2_phone || '',
          parent2_relationship: r.parent2_relationship || match?.parent2_relationship || '',
          notes: r.notes || match?.notes || '',
        };
        save('members', importedMember);

        // Reserve the ID straight away so the next row cannot be given it.
        if (match) working[working.findIndex((m) => m.id === importId)] = { ...match, ...importedMember };
        else working.push(importedMember);

        if (memberType === 'Child') {
          const existingChild = childByMember.get(importId);
          const childRecord = {
            ...(existingChild || {}),
            id: existingChild?.id || uuid(),
            member_id: importId,
            name,
            dob: importedMember.dob || null,
            gender: importedMember.gender || null,
            guardian_name: [importedMember.parent1_name, importedMember.parent2_name].filter(Boolean).join(' / '),
            guardian_phone: [importedMember.parent1_phone, importedMember.parent2_phone].filter(Boolean).join(' / '),
            status: ['Inactive', 'Left'].includes(importedMember.status) ? 'Inactive' : 'Active',
          };
          save('children', childRecord);
          childByMember.set(importId, childRecord);
        }
        match ? updated++ : added++;
      }

      const lines = [`Done — ${added} added, ${updated} updated${skipped ? `, ${skipped} skipped (no name)` : ''}.`];
      if (phonesFixed) lines.push(`${phonesFixed} phone number${phonesFixed === 1 ? ' had its' : 's had their'} leading 0 put back.`);
      if (damagedPhones.length) lines.push(`${damagedPhones.length} phone number${damagedPhones.length === 1 ? ' was' : 's were'} damaged by Excel (shown like 2.43E+08) and left blank, so please enter them again: ${nameList(damagedPhones)}.`);
      if (oddPhones.length) lines.push(`Check the phone number for: ${nameList(oddPhones)}.`);
      if (badDates.length) lines.push(`Date of birth not understood (use DD/MM/YYYY or YYYY-MM-DD) for: ${nameList(badDates)}.`);
      if (idTaken.length) lines.push(`These Member IDs already belong to someone else, so new IDs were given: ${nameList(idTaken)}.`);
      setMsg({ ok: true, text: lines.join('\n') });
    } catch (err) {
      setMsg({ ok: false, text: 'Could not read that file. Make sure it is a plain CSV export.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="top" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Bulk upload / download</h2>
        <div className="btnrow">
          <button className="secondary" onClick={downloadTemplate}>Download CSV template</button>
          <button className="secondary" onClick={() => data.members.length ? downloadCSV('members', data.members) : alert('No members to export yet.')}>Download all members (CSV)</button>
          <button className="primary" disabled={busy} onClick={() => fileRef.current.click()}>{busy ? 'Importing…' : 'Upload CSV'}</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={importCSV} />
        </div>
      </div>
      <p className="muted sm">
        CSV columns: <code>{MEMBER_CSV_FIELDS.join(', ')}</code>. Leave <code>member_code</code> empty and each new
        member is given the next free ID. A row updates an existing member when the Member ID matches, or when the
        name matches and the phone number does not point to a different person. In Excel, format the phone column as
        Text first so leading zeros are kept.
      </p>
      {msg && <div className={msg.ok ? 'muted' : 'err'} style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{msg.text}</div>}
    </div>
  );
}

function nextMemberCode(members, memberType, history = []) {
  const prefix = memberType === 'Child' ? PFX_CHILD : memberType === 'Omega' ? PFX_OMEGA : PFX_ADULT;
  let max = 0;
  const codes = [
    ...(members || []).map(m => m.member_code),
    ...(history || []).flatMap(h => [h.from_member_code, h.to_member_code]),
  ];
  codes.forEach((rawCode) => {
    const code = String(rawCode || '').trim().toUpperCase();
    const match = code.match(new RegExp('^' + prefix + '(\\d+)$'));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  });
  return prefix + (max + 1);
}


function PortalAccountLauncher({ members, onCreate }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState('');
  const activeMembers = (members || []).filter(m => !['Inactive', 'Left'].includes(m.status));
  const term = q.trim().toLowerCase();
  const matches = activeMembers
    .filter(m => !term || `${m.name || ''} ${m.member_code || ''} ${m.phone || ''}`.toLowerCase().includes(term))
    .sort((a, b) => String(a.member_code || '').localeCompare(String(b.member_code || ''), undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, 12);
  const member = activeMembers.find(m => m.id === selected);

  function chooseMember(m) {
    setSelected(m.id);
    setQ(`${m.member_code || ''} · ${m.name}`.trim());
  }

  function changeSearch(value) {
    setQ(value);
    if (selected) {
      const selectedMember = activeMembers.find(m => m.id === selected);
      const selectedText = selectedMember ? `${selectedMember.member_code || ''} ${selectedMember.name || ''} ${selectedMember.phone || ''}`.toLowerCase() : '';
      if (!selectedMember || !selectedText.includes(value.trim().toLowerCase())) setSelected('');
    }
  }

  return <div className="portal-account-launcher">
    <div style={{position:'relative'}}>
      <input
        placeholder="Search member by name, ID or phone…"
        value={q}
        onChange={e=>changeSearch(e.target.value)}
        autoComplete="off"
      />
      {q.trim() && !member && <div className="panel" style={{position:'absolute',zIndex:20,left:0,right:0,top:'calc(100% + 4px)',margin:0,padding:4,maxHeight:260,overflowY:'auto',boxShadow:'0 8px 24px rgba(0,0,0,.15)'}}>
        {matches.length ? matches.map(m => (
          <button key={m.id} type="button" onClick={()=>chooseMember(m)} style={{display:'block',width:'100%',textAlign:'left',border:0,background:'transparent',padding:'8px 10px',cursor:'pointer',borderRadius:6}}>
            <b>{m.member_code || 'No ID'}</b> · {m.name}{m.phone ? <span className="muted"> · {m.phone}</span> : ''}
          </button>
        )) : <div className="muted sm" style={{padding:8}}>No matching active member.</div>}
      </div>}
    </div>
    <div className="panel" style={{margin:0,minHeight:42,padding:'9px 12px'}}>
      {member ? <><b>{member.member_code || 'No ID'} · {member.name}</b><div className="muted sm">{member.phone || 'No phone number'}</div></> : <span className="muted">Select a member from the search results.</span>}
    </div>
    <button className="primary" disabled={!member || !member.phone} onClick={()=>onCreate(member)}>Create / Reset Portal Password</button>
  </div>;
}

export function Members() {
  const { data, save } = useData();

  async function createPortalAccount(member) {
    if (!member?.id) return;
    if (!member.phone) return alert('Add a phone number to this member first.');
    const { data: result, error } = await supabase.functions.invoke('create-member-portal-user', { body: { member_id: member.id } });
    if (error) return alert(error.message || 'Could not create the member portal account.');
    if (result?.error) return alert(result.error);
    const msg = `Portal account created for ${member.name}\n\nPhone: ${result.phone}\nTemporary password: ${result.temporary_password}\n\nGive these details to the member. They should sign in and change the password immediately.`;
    window.prompt('Member portal credentials — copy these now', msg);
  }

  function syncChildFromMember(record, original) {
    const existingChild = (data.children || []).find(c => c.member_id === record.id);
    if (record.member_type === 'Child') {
      const child = {
        ...(existingChild || {}),
        id: existingChild?.id || uuid(),
        member_id: record.id,
        name: record.name,
        dob: record.dob || null,
        gender: record.gender || null,
        guardian_name: [record.parent1_name, record.parent2_name].filter(Boolean).join(' / '),
        guardian_phone: [record.parent1_phone, record.parent2_phone].filter(Boolean).join(' / '),
        pickup_notes: existingChild?.pickup_notes || '',
        medical_notes: existingChild?.medical_notes || '',
        status: ['Inactive', 'Left'].includes(record.status) ? 'Inactive' : 'Active',
      };
      save('children', child);
    } else if (original?.member_type === 'Child' && existingChild) {
      save('children', { ...existingChild, status: 'Inactive' });
    }
  }

  return (
    <>
      <MemberImport />
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>Member Portal Account</h2>
        <p className="muted">Select a member below in the Members table and use <b>Create Portal Account</b> to generate a phone-based login and temporary password.</p>
        <PortalAccountLauncher members={data.members} onCreate={createPortalAccount} />
      </div>
      <Crud
        table="members" title="Members" noun="member"
        sortKey="member_code" sortCompare={memberIdCompare} searchKeys={['name', 'member_code', 'phone', 'grp', 'email']}
        prepareRecord={(record, original) => {
          const oldType = original?.member_type || 'Adult';
          const newType = record.member_type || 'Adult';
          const progressed = !!original && oldType !== newType;
          const member_code = progressed ? nextMemberCode(data.members, newType, data.member_group_history) : (original?.member_code || record.member_code || nextMemberCode(data.members, newType, data.member_group_history));
          return { ...record, member_code };
        }}
        filters={[
          { key: 'status', label: 'All statuses', options: STATUS },
          { key: 'member_type', label: 'All church groups', options: ['Adult', 'Omega', 'Child'] },
        ]}
        defaults={{ status: 'Active', member_type: 'Adult' }}
        onSaved={async (record, original) => {
          if (original?.member_type && original.member_type !== record.member_type) {
            await supabase.from('member_group_history').insert({
              id: uuid(), member_id: record.id, from_group: original.member_type, to_group: record.member_type,
              from_member_code: original.member_code || null, to_member_code: record.member_code || null,
              changed_at: new Date().toISOString(),
            });
          }
          syncChildFromMember(record, original);
        }}
        fields={[
          { key: 'member_code', label: 'Unique Member ID (automatic)', readOnly: true, unique: true, placeholder: 'Assigned automatically' },
          { key: 'name', label: 'Name', required: true },
          { key: 'photo_url', label: 'Passport Photo', type: 'photo', bucket: 'member-photos', maxWidth: 300, maxHeight: 400, quality: 0.78 },
          { key: 'phone', label: 'Phone', type: 'tel' },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'dob', label: 'Date of birth', type: 'date' },
          { key: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female'] },
          { key: 'member_type', label: 'Church Group', type: 'select', options: ['Adult', 'Omega', 'Child'], required: true },
          { key: 'grp', label: 'Group / Cell' },
          { key: 'status', label: 'Status', type: 'select', options: STATUS, required: true },
          { key: 'address', label: 'Address' },
          { key: 'parent1_name', label: 'Parent / Guardian 1 Name', showIf: v => v.member_type === 'Child' },
          { key: 'parent1_phone', label: 'Parent / Guardian 1 Phone', type: 'tel', showIf: v => v.member_type === 'Child' },
          { key: 'parent1_relationship', label: 'Parent / Guardian 1 Relationship', placeholder: 'Father, Mother, Guardian…', showIf: v => v.member_type === 'Child' },
          { key: 'parent2_name', label: 'Parent / Guardian 2 Name', showIf: v => v.member_type === 'Child' },
          { key: 'parent2_phone', label: 'Parent / Guardian 2 Phone', type: 'tel', showIf: v => v.member_type === 'Child' },
          { key: 'parent2_relationship', label: 'Parent / Guardian 2 Relationship', placeholder: 'Mother, Father, Guardian…', showIf: v => v.member_type === 'Child' },
          { key: 'notes', label: 'Notes', type: 'textarea', full: true },
        ]}
        columns={[
          { label: 'Member ID', render: (m) => <b>{m.member_code || 'Not assigned'}</b> },
          { label: 'Name', render: (m) => <><b>{m.name}</b><br /><small>{m.email}</small></> },
          { label: 'Church Group', render: (m) => <span className="badge">{m.member_type || 'Adult'}</span> },
          { label: 'Phone', key: 'phone' },
          { label: 'Group', key: 'grp' },
          { label: 'Status', render: (m) => badge(m.status) },
        ]}
      />
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>Children in the Members database</h2>
        <p className="muted">Children are entered from the Members screen. Select <b>Child</b> as the Church Group and the parent/guardian particulars will appear automatically.</p>
        <p className="muted sm">Each child is also linked to the internal Children attendance record so the Children's attendance and secure pickup functions continue to work.</p>
      </div>
    </>
  );
}

export function MemberLookup() {
  const { data } = useData();
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const members = data.members || [];
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return members.slice(0, 30);
    return members.filter(m => `${m.member_code || ''} ${m.name || ''} ${m.phone || ''}`.toLowerCase().includes(term)).slice(0, 30);
  }, [members, q]);
  const member = members.find(m => m.id === selectedId) || (matches.length === 1 ? matches[0] : null);
  useEffect(() => { if (!selectedId && matches.length === 1) setSelectedId(matches[0].id); }, [matches, selectedId]);
  const rowsFor = (table, field='member_id') => (data[table] || []).filter(r => member && (r[field] === member.id || (!r[field] && r.person_name === member.name) || (!r[field] && r.member_name === member.name)));
  const attendance = member ? rowsFor('attendance').sort((a,b)=>String(b.date).localeCompare(String(a.date))) : [];
  const firstFruit = member ? (data.member_contributions || []).filter(r => r.fund === 'First Fruit' && (r.member_id === member.id || (!r.member_id && r.person_name === member.name))).sort((a,b)=>`${b.year}-${b.month}`.localeCompare(`${a.year}-${a.month}`)) : [];
  const welfare = member ? (data.member_contributions || []).filter(r => r.fund === 'Welfare Dues' && (r.member_id === member.id || (!r.member_id && r.person_name === member.name))).sort((a,b)=>`${b.year}-${b.month}`.localeCompare(`${a.year}-${a.month}`)) : [];
  const receipts = member ? (data.payment_receipts || []).filter(r => r.member_id === member.id || (!r.member_id && r.member_name === member.name)).sort((a,b)=>String(b.paid_at||b.created_at).localeCompare(String(a.paid_at||a.created_at))) : [];
  const requests = member ? (data.payment_requests || []).filter(r => r.member_id === member.id).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))) : [];
  const prayers = member ? (data.prayer_requests || []).filter(r => r.member_id === member.id || (!r.member_id && r.person_name === member.name)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))) : [];
  const followups = member ? (data.follow_ups || []).filter(r => r.member_id === member.id || (!r.member_id && (r.person_name === member.name || r.member_name === member.name))).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))) : [];
  const children = member ? (data.children || []).filter(r => r.member_id === member.id) : [];
  const totalFirstFruit = firstFruit.reduce((s,r)=>s+Number(r.amount||0),0);
  const totalWelfare = welfare.reduce((s,r)=>s+Number(r.amount||0),0);
  const totalReceipts = receipts.filter(r=>r.status==='Paid').reduce((s,r)=>s+Number(r.amount||0),0);
  return <>
    <div className="top"><div><h1>Member Record</h1><div className="muted">Search a member by the unique Member ID, name or phone and view the member's connected records.</div></div></div>
    <div className="panel">
      <div className="toolbar"><input autoFocus placeholder="Enter Member ID e.g. M-ABC12345, name or phone…" value={q} onChange={e=>{setQ(e.target.value);setSelectedId('')}} />{q && matches.length > 1 && <select value={selectedId} onChange={e=>setSelectedId(e.target.value)}><option value="">Select member</option>{matches.map(m=><option key={m.id} value={m.id}>{m.member_code || 'No ID'} · {m.name}</option>)}</select>}</div>
      {!member && <div className="empty">Search for a member to open the complete member record.</div>}
    </div>
    {member && <>
      <div className="panel"><div className="top" style={{marginBottom:8}}><div><h2 style={{margin:0}}>{member.name}</h2><div className="muted">Member ID: <b>{member.member_code || 'Not assigned'}</b> · {member.phone || 'No phone'} · {member.status || ''}</div></div></div><div className="cards"><div className="card"><span className="label">Attendance</span><strong>{attendance.filter(a=>a.status==='Present').length}</strong></div><div className="card"><span className="label">First Fruit</span><strong>{money(totalFirstFruit)}</strong></div><div className="card"><span className="label">Welfare Dues</span><strong>{money(totalWelfare)}</strong></div><div className="card"><span className="label">Paid Receipts</span><strong>{money(totalReceipts)}</strong></div><div className="card"><span className="label">Prayer Requests</span><strong>{prayers.length}</strong></div><div className="card"><span className="label">Follow-ups</span><strong>{followups.length}</strong></div></div></div>
      <div className="grid2">
        <div className="panel"><h2>Personal information</h2><p><b>Member ID:</b> {member.member_code || ''}</p><p><b>Church Group:</b> {member.member_type || 'Adult'}</p><p><b>Gender:</b> {member.gender || 'Not recorded'}</p><p><b>Date of birth:</b> {member.dob || 'Not recorded'}</p><p><b>Group:</b> {member.grp || 'Not assigned'}</p><p><b>Phone:</b> {member.phone || ''}</p><p><b>Email:</b> {member.email || ''}</p><p><b>Address:</b> {member.address || ''}</p><p><b>Occupation:</b> {member.occupation || ''}</p>{member.member_type === 'Child' && <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--border)'}}><h3 style={{marginTop:0}}>Parent / Guardian Particulars</h3><p><b>{member.parent1_relationship || 'Parent / Guardian 1'}:</b> {member.parent1_name || 'Not recorded'} · {member.parent1_phone || 'No phone'}</p><p><b>{member.parent2_relationship || 'Parent / Guardian 2'}:</b> {member.parent2_name || 'Not recorded'} · {member.parent2_phone || 'No phone'}</p></div>}</div>
        <div className="panel"><h2>Children / dependants</h2>{children.length ? children.map(c=><div className="listrow" key={c.id}><b>{c.name}</b><span className="muted">{c.gender || ''} · {c.dob || ''}</span></div>) : <div className="empty">No linked children.</div>}</div>
      </div>
      <div className="panel"><h2>Attendance history</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Service</th><th>Status</th><th>Note</th></tr></thead><tbody>{attendance.slice(0,50).map(r=><tr key={r.id}><td>{r.date}</td><td>{r.service}</td><td>{badge(r.status)}</td><td>{r.note || ''}</td></tr>)}{!attendance.length&&<tr><td colSpan="4" className="empty">No attendance records linked to this member.</td></tr>}</tbody></table></div></div>
      <div className="grid2">
        <div className="panel"><h2>First Fruit</h2><div className="tablewrap"><table><thead><tr><th>Month</th><th>Amount</th></tr></thead><tbody>{firstFruit.slice(0,30).map(r=><tr key={r.id}><td>{MONTHS[Number(r.month)-1]} {r.year}</td><td>{money(r.amount)}</td></tr>)}{!firstFruit.length&&<tr><td colSpan="2" className="empty">No First Fruit records.</td></tr>}</tbody></table></div></div>
        <div className="panel"><h2>Welfare Dues</h2><div className="tablewrap"><table><thead><tr><th>Month</th><th>Amount</th></tr></thead><tbody>{welfare.slice(0,30).map(r=><tr key={r.id}><td>{MONTHS[Number(r.month)-1]} {r.year}</td><td>{money(r.amount)}</td></tr>)}{!welfare.length&&<tr><td colSpan="2" className="empty">No Welfare Dues records.</td></tr>}</tbody></table></div></div>
      </div>
      <div className="panel"><h2>Payments and receipts</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Fund</th><th>Amount</th><th>Method</th><th>Status</th><th>Reference</th></tr></thead><tbody>{receipts.slice(0,50).map(r=><tr key={r.id}><td>{String(r.paid_at||r.created_at||'').slice(0,10)}</td><td>{r.fund}</td><td>{money(r.amount)}</td><td>{r.method || ''}</td><td>{badge(r.status)}</td><td>{r.reference || r.receipt_number || ''}</td></tr>)}{!receipts.length&&<tr><td colSpan="6" className="empty">No digital receipts linked to this member.</td></tr>}</tbody></table></div>{requests.length>0&&<p className="muted sm">There are also {requests.length} Mobile Money payment request(s) for this member.</p>}</div>
      <div className="grid2"><div className="panel"><h2>Prayer requests</h2>{prayers.slice(0,20).map(r=><div className="listrow" key={r.id}><span>{r.request}</span>{badge(r.status)}</div>)}{!prayers.length&&<div className="empty">No prayer requests.</div>}</div><div className="panel"><h2>Follow-up</h2>{followups.slice(0,20).map(r=><div className="listrow" key={r.id}><span>{r.reason || r.type || r.notes || 'Follow-up'}</span>{badge(r.status)}</div>)}{!followups.length&&<div className="empty">No follow-up records.</div>}</div></div>
    </>}
  </>;
}

export function Attendance() {
  const { data } = useData();
  return (
    <Crud
      table="attendance" title="Attendance" noun="attendance"
      sortKey="date" sortDir="desc" searchKeys={['person_name', 'note']}
      filters={[
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'service', label: 'All services', options: SERVICES },
      ]}
      defaults={{ date: today(), service: 'Sunday Service', status: 'Present' }}
      suggest={{ person_name: data.members.map((m) => m.name) }}
      fields={[
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'service', label: 'Service', type: 'select', options: SERVICES, required: true },
        { key: 'person_name', label: 'Person / member name', required: true, full: true },
        { key: 'status', label: 'Status', type: 'select', options: ['Present', 'Absent', 'Visitor'], required: true },
        { key: 'note', label: 'Note' },
      ]}
      columns={[
        { label: 'Date', key: 'date' },
        { label: 'Service', key: 'service' },
        { label: 'Person', key: 'person_name' },
        { label: 'Status', render: (r) => badge(r.status) },
        { label: 'Note', key: 'note' },
      ]}
    />
  );
}

// Absentee list: active members who were not marked Present on the chosen date (and service),
// with phone numbers for follow-up. Children without their own number show a parent's number.
export function AbsenteeList() {
  const { data } = useData();
  const norm = (v) => String(v || '').trim().toLowerCase();
  const nm = looseNameKey; // forgiving name key (titles, spelling case, word order)
  const GROUP_LABEL = { Adult: 'Adults', Omega: 'Omega', Child: 'Children' };
  const latestPresent = useMemo(() => data.attendance.filter((a) => a.status === 'Present').map((a) => a.date).sort().pop() || today(), [data.attendance]);
  const [date, setDate] = useState(latestPresent);
  const [service, setService] = useState('');
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');

  const servicesThatDay = useMemo(() => [...new Set(data.attendance.filter((a) => a.date === date).map((a) => a.service))].filter(Boolean), [data.attendance, date]);
  const dayRows = useMemo(() => data.attendance.filter((a) => a.date === date && (!service || a.service === service)), [data.attendance, date, service]);

  // Children's quick attendance records the child's own id; map it back to the member record.
  const childToMember = useMemo(() => new Map((data.children || []).filter((c) => c.member_id).map((c) => [c.id, c.member_id])), [data.children]);
  const presentFor = (rows, status) => {
    const ids = new Set(), names = new Set();
    rows.filter((a) => a.status === status).forEach((a) => {
      if (a.member_id) ids.add(a.member_id);
      if (a.child_id && childToMember.get(a.child_id)) ids.add(childToMember.get(a.child_id));
      const k = nm(a.person_name); if (k) names.add(k);
    });
    return { ids, names };
  };

  // Most recent date each person was present (on or before the chosen date).
  const lastSeen = useMemo(() => {
    const byId = new Map(), byName = new Map();
    data.attendance.forEach((a) => {
      if (a.status !== 'Present' || a.date > date) return;
      if (a.member_id && (!byId.has(a.member_id) || a.date > byId.get(a.member_id))) byId.set(a.member_id, a.date);
      if (a.child_id && childToMember.get(a.child_id)) {
        const mid = childToMember.get(a.child_id);
        if (!byId.has(mid) || a.date > byId.get(mid)) byId.set(mid, a.date);
      }
      const n = nm(a.person_name);
      if (n && (!byName.has(n) || a.date > byName.get(n))) byName.set(n, a.date);
    });
    return { byId, byName };
  }, [data.attendance, childToMember, date]);

  const activeMembers = useMemo(() => data.members.filter((m) => m.status === 'Active'), [data.members]);
  const result = useMemo(() => {
    if (!dayRows.length) return { absent: [], presentCount: 0 };
    const present = presentFor(dayRows, 'Present');
    const markedAbsent = presentFor(dayRows, 'Absent');
    const needle = norm(q);
    const absent = activeMembers
      .filter((m) => !present.ids.has(m.id) && !present.names.has(nm(m.name)))
      .filter((m) => !group || (m.member_type || 'Adult') === group)
      .filter((m) => !needle || norm(m.name).includes(needle) || norm(m.member_code).includes(needle) || norm(m.phone).includes(needle))
      .map((m) => {
        const own = m.phone || '';
        const parent = m.parent1_phone || m.parent2_phone || '';
        const seen = [lastSeen.byId.get(m.id), lastSeen.byName.get(nm(m.name))].filter(Boolean).sort().pop() || '';
        return {
          member: m, code: m.member_code || '', name: m.name, group: GROUP_LABEL[m.member_type || 'Adult'] || m.member_type,
          phone: own || parent, phoneNote: !own && parent ? ' (parent)' : '',
          status: (markedAbsent.ids.has(m.id) || markedAbsent.names.has(nm(m.name))) ? 'Marked absent' : 'Not marked',
          lastSeen: seen,
        };
      })
      .sort((a, b) => memberIdCompare(a.member, b.member) || a.name.localeCompare(b.name));
    return { absent, presentCount: activeMembers.filter((m) => present.ids.has(m.id) || present.names.has(nm(m.name))).length };
  }, [dayRows, activeMembers, group, q, lastSeen]);

  const exportCsv = () => downloadCSV('absentees', result.absent.map((r) => ({
    'Member ID': r.code, Name: r.name, Group: r.group, Phone: r.phone ? r.phone + r.phoneNote : '', Status: r.status, 'Last present': r.lastSeen, Date: date, Service: service || 'All services',
  })));

  return (
    <>
      <div className="top"><div><h1>Absentee List</h1><div className="muted">Active members not marked present on the chosen day, with phone numbers for follow-up.</div></div>
        <button className="secondary" disabled={!result.absent.length} onClick={exportCsv}>Download CSV</button></div>
      <div className="panel">
        <div className="toolbar">
          <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Service<select value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">All services</option>
            {servicesThatDay.map((x) => <option key={x} value={x}>{x}</option>)}
          </select></label>
          <label>Group<select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All groups</option><option value="Adult">Adults</option><option value="Omega">Omega</option><option value="Child">Children</option>
          </select></label>
          <input placeholder="Search name, member ID or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!dayRows.length ? (
          <div className="empty">No attendance was recorded on {date}{service ? ` for ${service}` : ''}, so there is nothing to compare. Pick a day when attendance was taken.</div>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}><b>{result.absent.length}</b> absent · {result.presentCount} present · {activeMembers.length} active members{(group || q) ? ' (list is filtered)' : ''}</p>
            <div className="tablewrap"><table>
              <thead><tr><th>#</th><th>Member ID</th><th>Name</th><th>Group</th><th>Phone</th><th>Status</th><th>Last present</th></tr></thead>
              <tbody>
                {result.absent.map((r, i) => (
                  <tr key={r.member.id}>
                    <td>{i + 1}</td><td>{r.code}</td><td><b>{r.name}</b></td><td>{r.group}</td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : <span className="muted">No phone</span>}{r.phoneNote && <span className="muted sm">{r.phoneNote}</span>}</td>
                    <td>{r.status}</td><td>{r.lastSeen || <span className="muted">Never</span>}</td>
                  </tr>
                ))}
                {!result.absent.length && <tr><td colSpan="7" className="empty">Everyone matching these filters was present.</td></tr>}
              </tbody>
            </table></div>
          </>
        )}
      </div>
    </>
  );
}

// Tap-to-cycle attendance sheet: one screen, one tap per member, no per-person forms.
// Cycle per tap: unmarked -> Present -> Absent -> unmarked. Loads existing marks for the
// chosen date+service so re-opening a sheet lets you correct it rather than duplicate it.
export function QuickAttendance() {
  const { data, save } = useData();
  const [date, setDate] = useState(today());
  const [service, setService] = useState('Sunday Service');
  const [q, setQ] = useState('');
  const [marks, setMarks] = useState({});

  const members = useMemo(
    () => [...data.members].filter((m) => !['Inactive', 'Left'].includes(m.status)).sort((a, b) => a.name.localeCompare(b.name)),
    [data.members],
  );

  const existing = useMemo(() => {
    const map = new Map();
    data.attendance.forEach((a) => { if (a.date === date && a.service === service) map.set(a.person_name, a); });
    return map;
  }, [data.attendance, date, service]);

  useEffect(() => {
    const next = {};
    members.forEach((m) => { const ex = existing.get(m.name); if (ex) next[m.id] = ex.status; });
    setMarks(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, service]);

  const shown = members.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));

  const toggle = (id) => setMarks((prev) => {
    const cur = prev[id];
    const next = { ...prev };
    if (cur === 'Present') next[id] = 'Absent';
    else if (cur === 'Absent') delete next[id];
    else next[id] = 'Present';
    return next;
  });

  const markAllShown = (status) => setMarks((prev) => {
    const next = { ...prev };
    shown.forEach((m) => { next[m.id] = status; });
    return next;
  });

  const saveAll = () => {
    let n = 0;
    members.forEach((m) => {
      const status = marks[m.id];
      if (!status) return;
      const ex = existing.get(m.name);
      save('attendance', { id: ex ? ex.id : uuid(), date, service, person_name: m.name, status, note: ex?.note || '' });
      n++;
    });
    alert(n ? `Saved attendance for ${n} member(s).` : 'Nothing marked yet — tap names to mark them first.');
  };

  const presentCount = members.filter((m) => marks[m.id] === 'Present').length;
  const absentCount = members.filter((m) => marks[m.id] === 'Absent').length;

  return (
    <>
      <div className="top">
        <h1>Quick Attendance</h1>
        <button className="primary" onClick={saveAll}>Save attendance</button>
      </div>
      <div className="panel">
        <div className="toolbar">
          <div className="fld"><small>Date</small><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="fld"><small>Service</small>
            <select value={service} onChange={(e) => setService(e.target.value)}>
              {SERVICES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <input placeholder="Search member…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="btnrow" style={{ marginBottom: 12 }}>
          <button className="secondary sm" onClick={() => markAllShown('Present')}>Mark all shown Present</button>
          <button className="secondary sm" onClick={() => markAllShown('Absent')}>Mark all shown Absent</button>
        </div>
        <p className="muted sm">{presentCount} present · {absentCount} absent · {members.length - presentCount - absentCount} unmarked. Tap a name to cycle: unmarked → Present → Absent → unmarked.</p>
        <div className="quicklist">
          {shown.map((m) => {
            const status = marks[m.id];
            return (
              <button key={m.id} type="button" className={'quickrow' + (status ? ' ' + status.toLowerCase() : '')} onClick={() => toggle(m.id)}>
                <span>{m.name}</span>
                <span className="badge">{status || 'Unmarked'}</span>
              </button>
            );
          })}
          {!shown.length && <div className="empty">No members match.</div>}
        </div>
      </div>
    </>
  );
}

export function Giving() {
  return (
    <Crud
      table="giving" title="Giving" noun="transaction"
      sortKey="date" sortDir="desc" searchKeys={['giver', 'reference']}
      filters={[
        { key: 'type', label: 'All types', options: ['Tithe', 'Offering', 'Donation', 'Pledge', 'Other'] },
        { key: 'method', label: 'All methods', options: ['Cash', 'Mobile Money', 'Bank', 'Card'] },
      ]}
      defaults={{ date: today(), type: 'Tithe', method: 'Cash' }}
      fields={[
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'giver', label: 'Giver', fallback: 'Anonymous' },
        { key: 'type', label: 'Type', type: 'select', options: ['Tithe', 'Offering', 'Donation', 'Pledge', 'Other'], required: true },
        { key: 'amount', label: 'Amount (GHS)', type: 'number', step: '0.01', gt: 0, required: true },
        { key: 'method', label: 'Payment method', type: 'select', options: ['Cash', 'Mobile Money', 'Bank', 'Card'], required: true },
        { key: 'reference', label: 'Reference' },
      ]}
      columns={[
        { label: 'Date', key: 'date' },
        { label: 'Giver', key: 'giver' },
        { label: 'Type', key: 'type' },
        { label: 'Amount', render: (r) => <b>{money(r.amount)}</b> },
        { label: 'Method', key: 'method' },
        { label: 'Reference', key: 'reference' },
      ]}
    />
  );
}

export function Departments() {
  return (
    <Crud
      table="departments" title="Departments" noun="department"
      sortKey="name" searchKeys={['name', 'leader']}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'leader', label: 'Leader' },
        { key: 'notes', label: 'Members / notes', type: 'textarea', full: true },
      ]}
      columns={[
        { label: 'Department', render: (d) => <b>{d.name}</b> },
        { label: 'Leader', key: 'leader' },
        { label: 'Notes', key: 'notes' },
      ]}
    />
  );
}

export function Events() {
  const { data, save, remove } = useData();
  const { role } = useAuth();
  const canWrite = can(role, 'events', 'write');
  const canDel = can(role, 'events', 'del');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...(data.events || [])]
      .filter(e => !s || [e.title, e.location, e.description].some(v => String(v || '').toLowerCase().includes(s)))
      .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  }, [data.events, q]);

  const open = (row=null) => setForm({
    original: row,
    values: {
      title: row?.title || '', date: row?.date || today(), event_time: row?.event_time || '',
      location: row?.location || '', description: row?.description || '',
      recurrence: row?.recurrence || 'none', recurrence_end_date: row?.recurrence_end_date || '', duration_days: row?.duration_days || 1
    }, errors: {}
  });

  const set = (k,v) => setForm(f => ({...f, values:{...f.values,[k]:v}}));

  const submit = async (e) => {
    e.preventDefault();
    const v = form.values;
    if (!v.title.trim() || !v.date) return setForm({...form, errors:{title: !v.title.trim() ? 'Required' : undefined, date: !v.date ? 'Required' : undefined}});
    if (v.recurrence === 'multi_day' && (!Number.isInteger(Number(v.duration_days)) || Number(v.duration_days) < 2 || Number(v.duration_days) > 60)) return setForm({...form, errors:{duration_days:'Choose between 2 and 60 days.'}});
    if (v.recurrence === 'weekly' && !v.recurrence_end_date) return setForm({...form, errors:{recurrence_end_date:'Select the last date for this weekly series.'}});
    if (v.recurrence === 'weekly' && v.recurrence_end_date < v.date) return setForm({...form, errors:{recurrence_end_date:'End date must be on or after the first event date.'}});

    if (form.original) {
      save('events', {...form.original, title:v.title.trim(), date:v.date, event_time:v.event_time.trim(), location:v.location.trim(), description:v.description.trim(), recurrence:v.recurrence, recurrence_end_date:v.recurrence_end_date || null, duration_days:Number(v.duration_days)||1});
    } else {
      const seriesId = ['weekly','multi_day'].includes(v.recurrence) ? uuid() : null;
      const dates = [];
      let d = new Date(v.date + 'T00:00:00');
      const end = v.recurrence === 'weekly' ? new Date(v.recurrence_end_date + 'T00:00:00') : v.recurrence === 'multi_day' ? new Date(d.getTime() + (Number(v.duration_days)-1)*86400000) : d;
      for (let guard=0; d <= end && guard < 520; guard++) {
        dates.push(new Date(d));
        if (v.recurrence === 'none') break;
        d.setDate(d.getDate()+(v.recurrence === 'weekly' ? 7 : 1));
      }
      dates.forEach(dt => {
        const iso = dt.toISOString().slice(0,10);
        save('events', {
          id: uuid(), title:v.title.trim(), date:iso, event_time:v.event_time.trim(), location:v.location.trim(), description:v.description.trim(),
          recurrence:v.recurrence, recurrence_end_date:v.recurrence === 'weekly' ? v.recurrence_end_date : null, duration_days:Number(v.duration_days)||1,
          series_id:seriesId
        });
      });
    }
    setForm(null);
  };

  return <>
    <div className="top"><div><h1>Events</h1><div className="muted">Create one-time events, multi-day programmes, or recurring weekly events.</div></div>{canWrite && <button className="primary" onClick={()=>open()}>+ Add event</button>}</div>
    <div className="panel"><div className="toolbar"><input placeholder="Search events" value={q} onChange={e=>setQ(e.target.value)} /></div></div>
    <div className="panel"><div className="tablewrap"><table><thead><tr><th>Date</th><th>Event</th><th>Time</th><th>Location</th><th>Repeat</th><th></th></tr></thead><tbody>
      {rows.map(e=><tr key={e.id}><td><b>{e.date}</b><br/><small>{dayName(e.date)}</small></td><td><b>{e.title}</b><br/><small>{e.description}</small></td><td>{e.event_time||''}</td><td>{e.location||''}</td><td>{e.recurrence==='weekly' ? `Weekly until ${e.recurrence_end_date}` : e.recurrence==='multi_day' ? `Multi-day programme (${e.duration_days||1} days)` : 'One-time'}</td><td>{canWrite&&<button onClick={()=>open(e)}>Edit</button>} {canDel&&<button className="danger" onClick={()=>remove('events',e.id)}>Delete</button>}</td></tr>)}
      {!rows.length&&<tr><td colSpan="6" className="empty">No events.</td></tr>}
    </tbody></table></div></div>
    {form && <div className="modal"><form className="modalcard" onSubmit={submit}><h2>{form.original?'Edit event':'Add event'}</h2>
      <div className="formgrid">
        <div><label>Event title *</label><input value={form.values.title} onChange={e=>set('title',e.target.value)} /></div>
        <div><label>First date *</label><input type="date" value={form.values.date} onChange={e=>set('date',e.target.value)} /></div>
        <div><label>Time</label><input value={form.values.event_time} onChange={e=>set('event_time',e.target.value)} placeholder="6:00 PM" /></div>
        <div><label>Location</label><input value={form.values.location} onChange={e=>set('location',e.target.value)} /></div>
        <div><label>Repeat</label><select value={form.values.recurrence} onChange={e=>set('recurrence',e.target.value)}><option value="none">One-time</option><option value="multi_day">Multi-day programme</option><option value="weekly">Every week</option></select></div>
        {form.values.recurrence==='multi_day' && <div><label>Number of days *</label><input type="number" min="2" max="60" value={form.values.duration_days} onChange={e=>set('duration_days',e.target.value)} /><small className="muted">Creates one event entry for each consecutive day.</small></div>}
        {form.values.recurrence==='weekly' && <div><label>Repeat until *</label><input type="date" value={form.values.recurrence_end_date} onChange={e=>set('recurrence_end_date',e.target.value)} /><small className="muted">An event is created automatically for each 7-day interval.</small></div>}
        <div className="full"><label>Description</label><textarea value={form.values.description} onChange={e=>set('description',e.target.value)} /></div>
      </div>
      {Object.values(form.errors||{}).filter(Boolean).map((x,i)=><div className="err" key={i}>{x}</div>)}
      <div className="toolbar"><button type="button" onClick={()=>setForm(null)}>Cancel</button><button className="primary">Save event</button></div>
    </form></div>}
  </>;
}


/* ---------------- Event Attendance ---------------- */
export function EventAttendance() {
  const { data, save } = useData();
  const { role } = useAuth();
  const canWrite = can(role, 'attendance', 'write');
  const events = useMemo(() => [...(data.events || [])]
    .filter(e => String(e.date) <= today())
    .sort((a,b) => String(b.date).localeCompare(String(a.date))), [data.events]);
  const [eventId, setEventId] = useState('');
  const [statusMap, setStatusMap] = useState({});

  const event = events.find(e => e.id === eventId);
  const registrations = useMemo(() => (data.event_registrations || []).filter(r => r.event_id === eventId), [data.event_registrations, eventId]);
  const registeredIds = useMemo(() => new Set(registrations.map(r => r.member_id)), [registrations]);
  const members = useMemo(() => {
    const base = [...(data.members || [])].filter(m => !['Inactive', 'Left'].includes(m.status));
    return registrations.length ? base.filter(m => registeredIds.has(m.id)) : base;
  }, [data.members, registrations.length, registeredIds]);

  useEffect(() => {
    if (!eventId) { setStatusMap({}); return; }
    const rows = (data.attendance || []).filter(a => a.event_id === eventId);
    const next = {};
    rows.forEach(a => { if (a.member_id) next[a.member_id] = a.status; });
    setStatusMap(next);
  }, [eventId, data.attendance]);

  const dailyAttendanceMap = useMemo(() => {
    const map = new Map();
    if (!event) return map;
    (data.attendance || []).filter(a => String(a.date || '').slice(0,10) === String(event.date || '').slice(0,10)).forEach(a => {
      if (a.member_id && !map.has(a.member_id)) map.set(a.member_id, a);
    });
    return map;
  }, [data.attendance, event]);
  const toggle = (id) => {
    const existingToday = dailyAttendanceMap.get(id);
    const existingHere = (data.attendance || []).find(a => a.event_id === event?.id && a.member_id === id);
    if (existingToday && !existingHere) return;
    setStatusMap(m => ({...m, [id]: m[id] === 'Present' ? 'Absent' : 'Present'}));
  };
  const markAll = (status) => {
    const next = {};
    members.forEach(m => {
      const existingToday = dailyAttendanceMap.get(m.id);
      const existingHere = (data.attendance || []).find(a => a.event_id === event?.id && a.member_id === m.id);
      if (!existingToday || existingHere) next[m.id] = status;
    });
    setStatusMap(next);
  };

  const saveAll = () => {
    if (!event) return;
    const conflicts = members.filter(m => statusMap[m.id] && dailyAttendanceMap.has(m.id) && !(data.attendance || []).some(a => a.event_id === event.id && a.member_id === m.id));
    if (conflicts.length) {
      alert(`${conflicts.length} member${conflicts.length === 1 ? '' : 's'} already marked on ${event.date}. Attendance can only be marked once per person per day.

${conflicts.slice(0, 8).map(m => m.name).join(', ')}${conflicts.length > 8 ? '…' : ''}`);
      return;
    }
    let count = 0;
    members.forEach(m => {
      const status = statusMap[m.id];
      if (!status) return;
      const existing = (data.attendance || []).find(a => a.event_id === event.id && a.member_id === m.id);
      const result = save('attendance', {
        id: existing?.id || uuid(), event_id: event.id, date: event.date,
        service: `Event: ${event.title}`, person_name: m.name, member_id: m.id,
        status, note: existing?.note || `Event occurrence attendance: ${event.title}`
      });
      if (result?.duplicate) { alert(result.error.message); return; }
      count++;
    });
    alert(`Saved ${count} attendance record${count === 1 ? '' : 's'} for ${event.title}.`);
  };

  const present = members.filter(m => statusMap[m.id] === 'Present').length;
  const absent = members.filter(m => statusMap[m.id] === 'Absent').length;
  const seriesId = event?.series_id || event?.id;
  const seriesEvents = useMemo(() => {
    if (!event) return [];
    return [...(data.events || [])].filter(e => (e.series_id || e.id) === seriesId && String(e.date) <= today()).sort((a,b) => String(a.date).localeCompare(String(b.date)));
  }, [data.events, event, seriesId]);
  const seriesReport = seriesEvents.map(e => {
    const rows = (data.attendance || []).filter(a => a.event_id === e.id);
    return {...e, presentCount: rows.filter(a=>a.status==='Present').length, absentCount: rows.filter(a=>a.status==='Absent').length, visitorCount: rows.filter(a=>a.status==='Visitor').length};
  });
  const seriesTotalPresent = seriesReport.reduce((n,r)=>n+r.presentCount,0);
  const seriesAvg = seriesReport.length ? Math.round(seriesTotalPresent / seriesReport.length) : 0;

  return <>
    <div className="top"><div><h1>Event Attendance</h1><div className="muted">Record attendance separately for each event occurrence. Weekly events have separate attendance records.</div></div></div>
    <div className="panel">
      <div className="toolbar">
        <select value={eventId} onChange={e => setEventId(e.target.value)} style={{minWidth:320}}><option value="">Select event occurrence</option>{events.map(e => <option key={e.id} value={e.id}>{e.date} · {e.title}{e.event_time ? ` · ${e.event_time}` : ''}</option>)}</select>
        {event && canWrite && <><button onClick={() => markAll('Present')}>Mark all present</button><button onClick={() => markAll('Absent')}>Mark all absent</button><button className="primary" onClick={saveAll}>Save attendance</button></>}
      </div>
    </div>
    {event && <div className="cards"><div className="card"><span className="label">Event</span><strong>{event.title}</strong></div><div className="card"><span className="label">Date</span><strong>{event.date}</strong></div><div className="card"><span className="label">Present</span><strong>{present}</strong></div><div className="card"><span className="label">Absent</span><strong>{absent}</strong></div></div>}
    {event && <div className="panel"><h2>{event.title} attendance</h2><div className="muted" style={{marginBottom:12}}>{event.date} {event.event_time || ''} {event.location ? `· ${event.location}` : ''}{registrations.length ? ` · ${registrations.length} registered` : ''}</div><div className="tablewrap"><table><thead><tr><th>Member</th><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>
      {members.map(m => {
        const existingToday = dailyAttendanceMap.get(m.id);
        const existingHere = (data.attendance || []).find(a => a.event_id === event.id && a.member_id === m.id);
        const blocked = !!existingToday && !existingHere;
        return <tr key={m.id}><td><b>{m.name}</b><br/><small>{m.member_code || ''}</small></td><td>{m.phone || ''}</td><td>{statusMap[m.id] ? badge(statusMap[m.id]) : blocked ? <span className="muted">Already marked today</span> : <span className="muted">Not marked</span>}</td><td>{canWrite && <button disabled={blocked} title={blocked ? `Already marked today (${existingToday.service || 'attendance'})` : ''} onClick={() => toggle(m.id)}>{blocked ? 'Already marked today' : statusMap[m.id] === 'Present' ? 'Mark absent' : 'Mark present'}</button>}</td></tr>;
      })}
      {!members.length && <tr><td colSpan="4" className="empty">No members found for this occurrence.</td></tr>}
    </tbody></table></div></div>}
    {event && <div className="panel"><div className="top"><div><h2 style={{margin:0}}>Attendance report for this event series</h2><div className="muted">Each occurrence is shown separately.</div></div></div><div className="cards"><div className="card"><span className="label">Occurrences</span><strong>{seriesReport.length}</strong></div><div className="card"><span className="label">Total present</span><strong>{seriesTotalPresent}</strong></div><div className="card"><span className="label">Average present</span><strong>{seriesAvg}</strong></div></div><div className="tablewrap"><table><thead><tr><th>Date</th><th>Time</th><th>Present</th><th>Absent</th><th>Visitors</th><th></th></tr></thead><tbody>
      {seriesReport.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.event_time || ''}</td><td><b>{r.presentCount}</b></td><td>{r.absentCount}</td><td>{r.visitorCount}</td><td><button onClick={()=>setEventId(r.id)}>Open</button></td></tr>)}
      {!seriesReport.length && <tr><td colSpan="6" className="empty">No occurrences found.</td></tr>}
    </tbody></table></div></div>}
  </>;
}

/* ---------------- Service Timer ---------------- */
export function ServiceTimer() {
  const KEY = 'cm:service-timer:v1';
  const defaults = [{id:uuid(),person:'Worship Leader',role:'Worship',minutes:15},{id:uuid(),person:'Announcements',role:'Announcements',minutes:5},{id:uuid(),person:'Offering',role:'Offering',minutes:10},{id:uuid(),person:'Preacher',role:'Sermon',minutes:45}];
  const [items,setItems]=useState(()=>{try{const x=JSON.parse(localStorage.getItem(KEY));return Array.isArray(x)&&x.length?x:defaults;}catch{return defaults;}});
  useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(items));}catch{}},[items]);
  const add=()=>setItems(x=>[...x,{id:uuid(),person:'New person',role:'Programme item',minutes:5}]);
  const update=(id,k,v)=>setItems(x=>x.map(r=>r.id===id?{...r,[k]:k==='minutes'?Math.max(1,Number(v)||1):v}:r));
  const remove=id=>setItems(x=>x.filter(r=>r.id!==id));
  return <>
    <div className="top"><div><h1>Service Countdown · Timer Setup</h1><div className="muted">Set the people or programme items and their durations. Use Live Countdown when the service starts.</div></div></div>
    <div className="panel"><div className="toolbar"><button onClick={add}>+ Add programme item</button><button onClick={()=>setItems(defaults.map(x=>({...x,id:uuid()})))}>Restore sample</button></div></div>
    <div className="panel"><div className="tablewrap"><table><thead><tr><th>#</th><th>Person / item</th><th>Role</th><th>Minutes</th><th></th></tr></thead><tbody>{items.map((r,i)=><tr key={r.id}><td>{i+1}</td><td><input value={r.person} onChange={e=>update(r.id,'person',e.target.value)}/></td><td><input value={r.role} onChange={e=>update(r.id,'role',e.target.value)}/></td><td><input type="number" min="1" value={r.minutes} onChange={e=>update(r.id,'minutes',e.target.value)} style={{width:90}}/></td><td className="actions"><button className="danger" onClick={()=>remove(r.id)}>Remove</button></td></tr>)}</tbody></table></div></div>
    <div className="panel"><h2>Ready for service</h2><p className="muted">Go to <b>Service Countdown → Live Countdown</b> to select the current item and display its countdown.</p></div>
  </>;
}

export function ServiceTimerLive() {
  const KEY='cm:service-timer:v1';
  const [items,setItems]=useState(()=>{try{return JSON.parse(localStorage.getItem(KEY))||[];}catch{return[];}});
  const [active,setActive]=useState(0),[remaining,setRemaining]=useState(0),[running,setRunning]=useState(false),[overtime,setOvertime]=useState(false);
  useEffect(()=>{const load=()=>{try{const x=JSON.parse(localStorage.getItem(KEY));if(Array.isArray(x))setItems(x);}catch{}};load();window.addEventListener('storage',load);return()=>window.removeEventListener('storage',load);},[]);
  useEffect(()=>{if(active>=items.length)setActive(Math.max(0,items.length-1));},[items.length,active]);
  useEffect(()=>{if(!running)return;const t=setInterval(()=>setRemaining(v=>{if(v<=1){setRunning(false);setOvertime(true);return 0;}return v-1;}),1000);return()=>clearInterval(t);},[running]);
  const start=i=>{setActive(i);setRemaining(Math.max(1,Number(items[i]?.minutes)||1)*60);setOvertime(false);setRunning(true);};
  const reset=()=>{if(!items[active])return;setRemaining(Math.max(1,Number(items[active].minutes)||1)*60);setOvertime(false);setRunning(false);};
  const next=()=>{if(active<items.length-1)start(active+1);};
  const fmt=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  if(!items.length)return <div className="panel"><h1>Live Countdown</h1><p className="muted">No timer items yet. Add them under Service Countdown → Timer Setup.</p></div>;
  const current=items[active];
  return <div className="timer-live-page">
    <div className="timer-live-head"><div><div className="timer-live-church">{import.meta.env.VITE_CHURCH_NAME || 'Church'}</div><h1>{current?.person||'Service Countdown'}</h1><div className="timer-live-role">{current?.role||''}</div></div><select value={active} onChange={e=>{setRunning(false);setOvertime(false);setActive(Number(e.target.value));setRemaining(0);}}>{items.map((x,i)=><option key={x.id} value={i}>{i+1}. {x.person}</option>)}</select></div>
    <div className="timer-live-main"><div className={'timer-live-clock '+(overtime?'overtime':'')}>{overtime?'TIME UP':fmt(remaining)}</div><div className="timer-live-meta">{current?.minutes||0} minutes</div><div className="timer-live-actions"><button className="primary" onClick={()=>remaining?setRunning(x=>!x):start(active)}>{running?'Pause':remaining?'Resume':'Start'}</button><button className="secondary" onClick={reset}>Reset</button><button className="secondary" onClick={next} disabled={active>=items.length-1}>Next</button></div><p className="muted sm">This view fills the available screen for projection.</p></div>
  </div>;
}

/* ---------------- SMS ---------------- */
export function SendSMS() {
  const { data } = useData();
  const { hasPermission } = useAuth();
  const allowed = hasPermission('sms.send');
  const groups = [...new Set(data.members.map((m) => m.grp).filter(Boolean))].sort();

  const [audience, setAudience] = useState('active');
  const [group, setGroup] = useState(groups[0] || '');
  const [picked, setPicked] = useState({});
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  if (!allowed) return (
    <>
      <div className="top"><h1>Send SMS</h1></div>
      <div className="panel"><p className="muted">You do not have permission to send SMS. Ask a Super Admin to tick Send SMS for your role under Role Permissions.</p></div>
    </>
  );

  const withPhone = data.members.filter((m) => m.phone && String(m.phone).trim());
  let recipients = [];
  if (audience === 'active') recipients = withPhone.filter((m) => m.status === 'Active');
  else if (audience === 'all') recipients = withPhone;
  else if (audience === 'group') recipients = withPhone.filter((m) => m.grp === group);
  else recipients = withPhone.filter((m) => picked[m.id]);

  const shownForPick = withPhone.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));
  const segments = Math.ceil((message.length || 0) / 160) || 0;

  const send = async () => {
    if (!recipients.length) { setResult({ ok: false, text: 'No recipients selected.' }); return; }
    if (!message.trim()) { setResult({ ok: false, text: 'Write a message first.' }); return; }
    if (!confirm(`Send this message to ${recipients.length} member(s)?`)) return;
    setSending(true);
    setResult(null);
    try {
      const { data: res, error } = await supabase.functions.invoke('send-sms', {
        body: { recipients: recipients.map((m) => m.phone), message },
      });
      if (error) throw error;
      if (res?.error) setResult({ ok: false, text: res.error });
      else setResult({ ok: true, text: `Sent to ${res.sent} member(s).` });
    } catch (err) {
      setResult({ ok: false, text: err?.message || 'Could not reach the SMS service.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="top"><h1>Send SMS</h1></div>
      <div className="panel">
        <h2>Recipients</h2>
        <div className="toolbar">
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="active">All active members</option>
            <option value="all">All members with a phone number</option>
            <option value="group">By group</option>
            <option value="custom">Choose individually</option>
          </select>
          {audience === 'group' && (
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              {groups.length ? groups.map((g) => <option key={g}>{g}</option>) : <option value="">No groups yet</option>}
            </select>
          )}
        </div>
        {audience === 'custom' && (
          <>
            <input placeholder="Search member…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
            <div className="quicklist">
              {shownForPick.map((m) => (
                <button key={m.id} type="button" className={'quickrow' + (picked[m.id] ? ' present' : '')}
                  onClick={() => setPicked((p) => ({ ...p, [m.id]: !p[m.id] }))}>
                  <span>{m.name}</span><span className="badge">{picked[m.id] ? 'Selected' : m.phone}</span>
                </button>
              ))}
              {!shownForPick.length && <div className="empty">No members with a phone number match.</div>}
            </div>
          </>
        )}
        <p className="muted sm" style={{ marginTop: 12 }}>{recipients.length} recipient(s) with a phone number on file.</p>
      </div>
      <div className="panel">
        <h2>Message</h2>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type your message…" style={{ minHeight: 120 }} />
        <p className="muted sm">{message.length} characters · {segments || 0} SMS segment(s) per recipient (160 chars each).</p>
        {result && <div className={result.ok ? 'muted' : 'err'} style={{ marginBottom: 10 }}>{result.text}</div>}
        <button className="primary" disabled={sending} onClick={send}>{sending ? 'Sending...' : `Send to ${recipients.length}`}</button>
      </div>
    </>
  );
}

/* ---------------- Offerings (detailed categories) ---------------- */
export function Offerings() {
  return (
    <Crud
      table="offering_entries" title="Offerings" noun="offering entry"
      sortKey="date" sortDir="desc" searchKeys={['note']}
      filters={[{ key: 'category', label: 'All categories', options: OFFERING_CATEGORIES }]}
      defaults={{ date: today(), category: 'Main Offering' }}
      fields={[
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'category', label: 'Category', type: 'select', options: OFFERING_CATEGORIES, required: true },
        { key: 'amount', label: 'Amount (GHS)', type: 'number', step: '0.01', gt: -1, required: true },
        { key: 'note', label: 'Note' },
      ]}
      columns={[
        { label: 'Date', key: 'date' },
        { label: 'Category', key: 'category' },
        { label: 'Amount', render: (r) => <b>{money(r.amount)}</b> },
        { label: 'Note', key: 'note' },
      ]}
    />
  );
}

/* ---------------- First Fruit / Welfare Dues: shared monthly grid ---------------- */
// Both funds follow the identical "member x 12 months" pattern from the old workbooks
// one editable grid, keyed by which roster and which fund it writes to.
function ContributionsGrid({ fund, roster, title }) {
  const { data, save } = useData();
  const [year, setYear] = useState(new Date().getFullYear());
  const [q, setQ] = useState('');
  const [edits, setEdits] = useState({});
  const [memberId, setMemberId] = useState(roster[0]?.id || '');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [amount, setAmount] = useState('');

  const existing = useMemo(() => {
    const map = new Map();
    data.member_contributions.forEach((c) => {
      if (c.fund === fund && Number(c.year) === Number(year)) map.set(c.person_name + '|' + c.month, c);
    });
    return map;
  }, [data.member_contributions, fund, year]);

  useEffect(() => { setEdits({}); }, [year, fund]);
  useEffect(() => { if (!roster.some(m => m.id === memberId)) setMemberId(roster[0]?.id || ''); }, [roster, memberId]);

  const shown = roster.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()) || String(m.member_code || '').toLowerCase().includes(q.trim().toLowerCase()));
  const valueFor = (name, mth) => {
    const k = name + '|' + mth;
    if (k in edits) return edits[k];
    const rec = existing.get(k);
    return rec ? String(rec.amount) : '';
  };
  const setValue = (name, mth, v) => setEdits((e) => ({ ...e, [name + '|' + mth]: v }));
  const rowTotal = (name) => MONTHS.reduce((s, _, i) => s + (Number(valueFor(name, i + 1)) || 0), 0);
  const monthTotal = (mth) => shown.reduce((s, m) => s + (Number(valueFor(m.name, mth)) || 0), 0);
  const grandTotal = shown.reduce((s, m) => s + rowTotal(m.name), 0);

  const saveEntry = () => {
    const member = roster.find(m => m.id === memberId);
    const n = Number(amount);
    if (!member) return alert('Select a member.');
    if (!n || n <= 0) return alert('Enter a valid amount.');
    const key = member.name + '|' + month;
    const rec = existing.get(key);
    save('member_contributions', {
      id: rec?.id || uuid(), fund, member_id: member.id, person_name: member.name,
      year: Number(year), month: Number(month), amount: n,
    });
    setAmount('');
    alert(`${fund} payment recorded for ${member.name} for ${MONTHS[month - 1]} ${year}.`);
  };

  const saveAll = () => {
    let n = 0;
    Object.entries(edits).forEach(([k, v]) => {
      const [name, monthStr] = k.split('|');
      const mth = Number(monthStr);
      const amountNum = Number(v) || 0;
      const rec = existing.get(k);
      const member = roster.find(m => m.name === name);
      if (!rec && amountNum === 0) return;
      save('member_contributions', {
        id: rec ? rec.id : uuid(), fund, member_id: member?.id || rec?.member_id || null,
        person_name: name, year: Number(year), month: mth, amount: amountNum,
      });
      n++;
    });
    setEdits({});
    alert(n ? `Saved ${n} ${fund.toLowerCase()} entr${n === 1 ? 'y' : 'ies'}.` : 'No changes to save.');
  };

  return (
    <>
      <div className="top">
        <h1>{title}</h1>
        <button className="primary" onClick={saveAll}>Save grid changes</button>
      </div>
      <div className="panel">
        <h2>Add payment</h2>
        <div className="formgrid">
          <div><label>Member</label><select value={memberId} onChange={e => setMemberId(e.target.value)}><option value="">Select member</option>{roster.map(m => <option key={m.id} value={m.id}>{m.name}{m.member_code ? ` · ${m.member_code}` : ''}</option>)}</select></div>
          <div><label>Year</label><input type="number" value={year} onChange={e => setYear(Number(e.target.value) || year)} /></div>
          <div><label>Month paid</label><select value={month} onChange={e => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
          <div><label>Amount (GHS)</label><input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        </div>
        <button className="primary" style={{ marginTop: 12 }} onClick={saveEntry}>Record {fund} payment</button>
        <p className="muted sm">The payment is recorded against the month selected above. For example, a payment made for March is recorded under March.</p>
      </div>
      <div className="panel">
        <div className="toolbar">
          <input placeholder="Search member or member ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="fld"><small>Year</small><input type="number" value={year} style={{ width: 90 }} onChange={(e) => setYear(Number(e.target.value) || year)} /></div>
        </div>
        <div className="tablewrap">
          <table className="gridtable">
            <thead><tr><th>Name</th>{MONTHS.map((m) => <th key={m}>{m}</th>)}<th>Total</th></tr></thead>
            <tbody>{shown.map((m) => <tr key={m.id}><td><b>{m.name}</b><br /><small>{m.member_code || ''}</small></td>{MONTHS.map((_, i) => <td key={i}><input type="number" min="0" step="0.01" className="cellinput" value={valueFor(m.name, i + 1)} onChange={(e) => setValue(m.name, i + 1, e.target.value)} /></td>)}<td><b>{money(rowTotal(m.name))}</b></td></tr>)}{!shown.length && <tr><td colSpan={14} className="empty">No members match.</td></tr>}</tbody>
            {shown.length > 0 && <tfoot><tr><td><b>Monthly total</b></td>{MONTHS.map((_, i) => <td key={i}><b>{money(monthTotal(i + 1))}</b></td>)}<td><b>{money(grandTotal)}</b></td></tr></tfoot>}
          </table>
        </div>
      </div>
    </>
  );
}

export function FirstFruit() {
  const { data } = useData();
  const roster = [...data.members].filter((m) => !['Inactive', 'Left'].includes(m.status)).sort((a, b) => a.name.localeCompare(b.name));
  return <ContributionsGrid fund="First Fruit" roster={roster} title="First Fruit Register" />;
}

export function WelfareDues() {
  const { data } = useData();
  const roster = [...data.members].filter((m) => !['Inactive', 'Left'].includes(m.status)).sort((a, b) => a.name.localeCompare(b.name));
  return <ContributionsGrid fund="Welfare Dues" roster={roster} title="Welfare Dues" />;
}

/* ---------------- Welfare Fund ---------------- */
export function WelfareMembers() {
  return (
    <Crud
      table="welfare_members" title="Welfare Members" noun="welfare member"
      sortKey="name" searchKeys={['name', 'ac_no', 'phone', 'next_of_kin']}
      filters={[{ key: 'status', label: 'All statuses', options: ['Active', 'Inactive'] }]}
      defaults={{ status: 'Active' }}
      fields={[
        { key: 'ac_no', label: 'AC/NO' },
        { key: 'name', label: 'Full name', required: true },
        { key: 'sex', label: 'Sex', type: 'select', options: ['M', 'F'] },
        { key: 'date_registered', label: 'Date registered', type: 'date' },
        { key: 'phone', label: 'Phone' },
        { key: 'department', label: 'Department' },
        { key: 'next_of_kin', label: 'Next of kin' },
        { key: 'registration_dues', label: 'Registration dues (GHS)', type: 'number', step: '0.01', gt: -1 },
        { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], required: true },
      ]}
      columns={[
        { label: 'AC/NO', key: 'ac_no' },
        { label: 'Name', render: (m) => <b>{m.name}</b> },
        { label: 'Sex', key: 'sex' },
        { label: 'Phone', key: 'phone' },
        { label: 'Next of kin', key: 'next_of_kin' },
        { label: 'Status', render: (m) => badge(m.status) },
      ]}
    />
  );
}

export function WelfareFund() {
  const { data } = useData();
  const income = data.welfare_transactions.filter((t) => t.kind === 'Income').reduce((s, t) => s + Number(t.amount), 0);
  const expenditure = data.welfare_transactions.filter((t) => t.kind === 'Expenditure').reduce((s, t) => s + Number(t.amount), 0);
  return (
    <>
      <div className="top"><h1>Welfare Fund</h1></div>
      <div className="cards">
        <div className="card"><div className="label">Total income</div><div className="num" style={{ fontSize: 22 }}>{money(income)}</div></div>
        <div className="card"><div className="label">Total expenditure</div><div className="num" style={{ fontSize: 22 }}>{money(expenditure)}</div></div>
        <div className="card"><div className="label">Balance</div><div className="num" style={{ fontSize: 22 }}>{money(income - expenditure)}</div></div>
      </div>
      <Crud
        table="welfare_transactions" title="Transactions" noun="transaction"
        sortKey="date" sortDir="desc" searchKeys={['item', 'note']}
        filters={[{ key: 'kind', label: 'All', options: ['Income', 'Expenditure'] }]}
        defaults={{ date: today(), kind: 'Income' }}
        fields={[
          { key: 'date', label: 'Date', type: 'date', required: true },
          { key: 'kind', label: 'Type', type: 'select', options: ['Income', 'Expenditure'], required: true },
          { key: 'item', label: 'Item (e.g. Contribution, Offering, Donation, T&T)', required: true },
          { key: 'amount', label: 'Amount (GHS)', type: 'number', step: '0.01', gt: -1, required: true },
          { key: 'note', label: 'Note (e.g. transport breakdown, purpose)', type: 'textarea', full: true },
        ]}
        columns={[
          { label: 'Date', key: 'date' },
          { label: 'Type', render: (r) => badge(r.kind) },
          { label: 'Item', key: 'item' },
          { label: 'Amount', render: (r) => <b>{money(r.amount)}</b> },
          { label: 'Note', key: 'note' },
        ]}
      />
    </>
  );
}

/* ---------------- Headcount Attendance (by demographic category) ---------------- */
export function HeadcountAttendance() {
  const { data, save } = useData();
  const [date, setDate] = useState(today());
  const [service, setService] = useState('Sunday Service');
  const [edits, setEdits] = useState({});
  const serviceTouched = useRef(false);
  const upcomingEvents = useMemo(() => [...(data.events || [])]
    .filter(e => String(e.date || '') >= today())
    .sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.event_time || '').localeCompare(String(b.event_time || ''))), [data.events]);
  const eventForDate = useMemo(() => upcomingEvents.find(e => String(e.date || '').slice(0,10) === date), [upcomingEvents, date]);
  const suggestedService = useMemo(() => {
    if (eventForDate?.title) return eventForDate.title;
    const weekday = new Date(`${date}T00:00:00`).getDay();
    if (weekday === 0) return 'Sunday Service';
    if (weekday === 2) return 'Bible Study';
    if (weekday === 4) return 'Prayer Meeting';
    return 'Other';
  }, [eventForDate, date]);
  useEffect(() => {
    if (!serviceTouched.current) setService(suggestedService);
  }, [suggestedService]);
  const existing = useMemo(() => { const map=new Map(); data.attendance_headcount.forEach(r=>{if(r.date===date&&r.service===service)map.set(r.category,r);}); return map; }, [data.attendance_headcount,date,service]);
  useEffect(()=>setEdits({}),[date,service]);
  const valueFor=cat=>(cat in edits?edits[cat]:String(existing.get(cat)?.count??''));
  const val=cat=>Number(valueFor(cat))||0;
  const childrenTotal=val('Children Boys')+val('Children Girls');
  const omegaTotal=val('Youth Boys')+val('Youth Girls');
  const adultTotal=val('Adult Men')+val('Adult Women');
  const total=childrenTotal+omegaTotal+adultTotal;
  const saveAll=()=>{let n=0;HEADCOUNT_CATEGORIES.forEach(cat=>{if(!(cat in edits))return;const count=Number(edits[cat])||0;const rec=existing.get(cat);save('attendance_headcount',{id:rec?rec.id:uuid(),date,service,category:cat,count});n++;});setEdits({});alert(n?`Saved headcount for ${n} categor${n===1?'y':'ies'}. Total: ${total}.`:'No changes to save.');};
  const history=[...new Set(data.attendance_headcount.map(r=>r.date+'|'+r.service))].sort().reverse().slice(0,10).map(k=>{const[d,s]=k.split('|');const rows=data.attendance_headcount.filter(r=>r.date===d&&r.service===s);const get=c=>Number(rows.find(r=>r.category===c)?.count||0);const childrenBoys=get('Children Boys'),childrenGirls=get('Children Girls'),omegaBoys=get('Youth Boys'),omegaGirls=get('Youth Girls'),adultMen=get('Adult Men'),adultWomen=get('Adult Women');return{date:d,service:s,childrenBoys,childrenGirls,omegaBoys,omegaGirls,adultMen,adultWomen,children:childrenBoys+childrenGirls,omega:omegaBoys+omegaGirls,adults:adultMen+adultWomen,total:rows.reduce((sum,r)=>sum+Number(r.count||0),0)};});
  return <><div className="top"><h1>Headcount Attendance</h1><button className="primary" onClick={saveAll}>Save headcount</button></div>
    <div className="panel"><div className="toolbar"><div className="fld"><small>Date</small><input type="date" value={date} onChange={e=>{serviceTouched.current=false;setDate(e.target.value||today());}}/><small className="muted">{dayName(date)}</small></div><div className="fld"><small>Event / Service</small><select value={service} onChange={e=>{serviceTouched.current=true;setService(e.target.value);}}>{eventForDate?.title && <option value={eventForDate.title}>{eventForDate.title} · {date}</option>}{SERVICES.filter(s=>s!==eventForDate?.title).map(s=><option key={s}>{s}</option>)}</select></div></div>
      <div className="cards"><div className="card"><div className="label">Adults</div><strong>{adultTotal}</strong></div><div className="card"><div className="label">Omega</div><strong>{omegaTotal}</strong></div><div className="card"><div className="label">Children</div><strong>{childrenTotal}</strong></div><div className="card"><div className="label">Total attendance</div><strong>{total}</strong></div></div>
      <h2>Detailed breakdown</h2><div className="grid2">{HEADCOUNT_CATEGORIES.map(cat=><div className="fld" key={cat}><small>{headcountLabel(cat)}</small><input type="number" min="0" value={valueFor(cat)} onChange={e=>setEdits(ed=>({...ed,[cat]:e.target.value}))}/></div>)}</div>
    </div>
    <div className="panel"><h2>Recent headcount breakdowns</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Service</th><th>Adult Men</th><th>Adult Women</th><th>Omega Boys</th><th>Omega Girls</th><th>Children Boys</th><th>Children Girls</th><th>Total</th></tr></thead><tbody>{history.map(r=><tr key={r.date+r.service}><td>{r.date}</td><td>{r.service}</td><td>{r.adultMen}</td><td>{r.adultWomen}</td><td>{r.omegaBoys}</td><td>{r.omegaGirls}</td><td>{r.childrenBoys}</td><td>{r.childrenGirls}</td><td><b>{r.total}</b></td></tr>)}{!history.length&&<tr><td colSpan="9" className="empty">No headcounts recorded yet.</td></tr>}</tbody></table></div></div>
  </>;
}

/* ---------------- Users (admin only) ---------------- */
// Calls the admin-users edge function (needs the service key, so it can't run in the browser).
async function adminCall(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let m = error.message;
    try {
      const j = await error.context?.json?.();
      if (j?.error) m = j.error;
    } catch { /* keep default */ }
    if (/Failed to send|fetch/i.test(m)) m = 'Could not reach the server. Check your internet connection (and that the admin-users function is deployed).';
    throw new Error(m);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const randomPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(a, (n) => chars[n % chars.length]).join('');
};

function UserDialog({ mode, target, onClose, onDone, currentRole }) {
  // mode: 'create' | 'reset'
  const [f, setF] = useState({
    member_id: '',
    full_name: '',
    phone: '',
    role: 'viewer',
    password: randomPassword()
  });

  const [members, setMembers] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  const [roleOptions, setRoleOptions] = useState(
    isSuperAdmin(currentRole)
      ? ROLES.filter(r => r !== 'pending')
      : ROLES.filter(r => r !== 'super_admin' && r !== 'pending')
  );

  // Load available members for account creation.
  useEffect(() => {
    if (mode !== 'create') return;

    supabase
      .from('members')
      .select('id,name,member_code,phone,email,status')
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          setErr(error.message);
          return;
        }

        setMembers(
          (data || []).filter(
            m => !['Inactive', 'Left'].includes(m.status)
          )
        );
      });
  }, [mode]);

  // Load roles.
  useEffect(() => {
    supabase
      .from('role_catalog')
      .select('role_key,label')
      .neq('role_key', 'pending')
      .order('label')
      .then(({ data }) => {
        if (data?.length) {
          setRoleOptions(
            data
              .map(r => r.role_key)
              .filter(
                r => isSuperAdmin(currentRole) || r !== 'super_admin'
              )
          );
        }
      });
  }, [currentRole]);

  const set = (k) => (e) =>
    setF({
      ...f,
      [k]: e.target.value
    });

  const chooseMember = (member) => {
    setF({
      ...f,
      member_id: member.id,
      full_name: member.name || '',
      phone: member.phone || ''
    });

    setMemberSearch(member.name || '');
    setErr('');
  };

  const matches = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();

    if (!q) return members.slice(0, 30);

    return members
      .filter(m =>
        `${m.name || ''} ${m.member_code || ''} ${m.phone || ''}`
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 30);
  }, [members, memberSearch]);

  async function submit(e) {
    e.preventDefault();
    setErr('');

    if (f.password.length < 6) {
      setErr('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'create') {
      if (!f.member_id) {
        setErr('Please select an existing member.');
        return;
      }

      if (!f.phone) {
        setErr('The selected member does not have a phone number.');
        return;
      }
    }

    setBusy(true);

    try {
      if (mode === 'create') {
        await adminCall({
          action: 'create',
          member_id: f.member_id,
          full_name: f.full_name,
          phone: f.phone,
          role: f.role,
          password: f.password
        });

        setDone({
          name: f.full_name,
          phone: f.phone,
          password: f.password
        });
      } else {
        await adminCall({
          action: 'reset_password',
          user_id: target.id,
          password: f.password
        });

        setDone({
          name: target.full_name || 'User',
          phone: target.phone || target.email || '',
          password: f.password
        });
      }

      onDone();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modalbox"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalhead">
          <h2>
            {mode === 'create'
              ? 'Create user account'
              : 'Reset password'}
          </h2>

          <button className="x" onClick={onClose}>
            ×
          </button>
        </div>

        {done ? (
          <>
            <p>
              {mode === 'create'
                ? 'Account created.'
                : 'Password changed.'}{' '}
              Give these login details to the user.
            </p>

            <pre>
{`Name:      ${done.name}
Phone:     ${displayMemberLogin(done.phone)}
Password:  ${done.password}`}
            </pre>

            <div className="btnrow">
              <button
                className="secondary"
                onClick={() =>
                  navigator.clipboard?.writeText(
                    `Name: ${done.name}\nPhone: ${displayMemberLogin(done.phone)}\nPassword: ${done.password}`
                  )
                }
              >
                Copy
              </button>

              <button
                className="primary"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            {mode === 'reset' && (
              <p className="muted">
                New password for{' '}
                <b>
                  {target.full_name ||
                    target.phone ||
                    target.email}
                </b>
                .
              </p>
            )}

            <div className="formgrid">
              {mode === 'create' && (
                <>
                  <div
                    className="fld"
                    style={{ gridColumn: '1 / -1' }}
                  >
                    <small>Search existing member</small>

                    <input
                      value={memberSearch}
                      onChange={(e) => {
                        setMemberSearch(e.target.value);
                        setF({
                          ...f,
                          member_id: '',
                          full_name: '',
                          phone: ''
                        });
                      }}
                      placeholder="Search by name, member ID or phone"
                      autoFocus
                    />

                    {memberSearch && !f.member_id && (
                      <div
                        className="panel"
                        style={{
                          marginTop: 6,
                          padding: 6,
                          maxHeight: 220,
                          overflowY: 'auto'
                        }}
                      >
                        {matches.length ? (
                          matches.map((m) => (
                            <button
                              type="button"
                              key={m.id}
                              className="secondary"
                              style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                marginBottom: 4
                              }}
                              onClick={() =>
                                chooseMember(m)
                              }
                            >
                              <b>{m.name}</b>
                              <span className="muted">
                                {' '}
                                — {m.member_code || 'No ID'}
                                {m.phone
                                  ? ` — ${m.phone}`
                                  : ' — No phone'}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="empty">
                            No matching active member found.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {f.member_id && (
                    <>
                      <div className="fld">
                        <small>Selected member</small>
                        <input
                          value={f.full_name}
                          readOnly
                        />
                      </div>

                      <div className="fld">
                        <small>Phone</small>
                        <input
                          value={f.phone}
                          readOnly
                        />
                      </div>

                      <div
                        className="fld"
                        style={{ gridColumn: '1 / -1' }}
                      >
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setF({
                              ...f,
                              member_id: '',
                              full_name: '',
                              phone: ''
                            });
                            setMemberSearch('');
                          }}
                        >
                          Change member
                        </button>
                      </div>
                    </>
                  )}

                  <div className="fld">
                    <small>Role</small>

                    <select
                      value={f.role}
                      onChange={set('role')}
                    >
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div className="fld">
                <small>
                  {mode === 'create'
                    ? 'Password'
                    : 'New password'}
                </small>

                <div
                  className="btnrow"
                  style={{ flexWrap: 'nowrap' }}
                >
                  <input
                    value={f.password}
                    onChange={set('password')}
                    required
                    style={{ flex: 1 }}
                  />

                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setF({
                        ...f,
                        password: randomPassword()
                      })
                    }
                  >
                    Generate
                  </button>
                </div>
              </div>
            </div>

            {err && (
              <div
                className="err"
                style={{ margin: '10px 0' }}
              >
                {err}
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <button
                className="primary"
                disabled={busy}
              >
                {busy
                  ? 'Please wait...'
                  : mode === 'create'
                    ? 'Create account'
                    : 'Reset password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
export function Users() {
  const { user, role } = useAuth();

  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const [dialog, setDialog] = useState(null);
  const [roleOptions, setRoleOptions] = useState([]);

  const load = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at');

    if (error) {
      setMsg(error.message);
    } else {
      // Do not expose the Super Admin account to ordinary administrators.
      setRows(role === 'super_admin' ? data : data.filter(account => account.role !== 'super_admin'));
      setMsg('');
    }
  };

  useEffect(() => {
    load();

    supabase
      .from('role_catalog')
      .select('role_key,label')
      .neq('role_key', 'pending')
      .order('label')
      .then(({ data }) => {
        if (data) {
          setRoleOptions(
            data
              .map(r => r.role_key)
              .filter(
                r =>
                  isSuperAdmin(role) ||
                  r !== 'super_admin'
              )
          );
        }
      });
  }, []);

  const change = async (id, newRole) => {
    try {
      await adminCall({
        action: 'set_role',
        user_id: id,
        role: newRole
      });

      load();
    } catch (ex) {
      setMsg(ex.message);
    }
  };

  const remove = async (p) => {
    if (p?.role === 'super_admin') { setMsg('Super Admin accounts are protected and cannot be deleted.'); return; }
    if (
      !confirm(
        `Delete the account for ${
          p.full_name || p.phone || p.email
        }? They will no longer be able to sign in. Records they created are kept.`
      )
    ) {
      return;
    }

    try {
      await adminCall({
        action: 'delete',
        user_id: p.id
      });

      load();
    } catch (ex) {
      setMsg(ex.message);
    }
  };

  return (
    <>
      <div className="top">
        <h1>Users</h1>

        <div className="btnrow">
          <button
            className="secondary"
            onClick={load}
          >
            Refresh
          </button>

          <button
            className="primary"
            onClick={() =>
              setDialog({ mode: 'create' })
            }
          >
            + Create user
          </button>
        </div>
      </div>

      <div className="panel">
        <p className="muted">
          Select an existing church member, use their phone
          number for login, and assign their role. This church
          uses a single-church structure, so there is no branch
          assignment.
        </p>

        {msg && (
          <div className="err">
            {msg}
          </div>
        )}

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {(rows || []).map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>
                      {p.full_name || '—'}
                    </b>
                  </td>

                  <td>
                    {p.phone || '—'}
                  </td>

                  <td>
                    <select
                      value={p.role}
                      disabled={
                        p.id === user.id ||
                        (
                          p.role === 'super_admin' &&
                          !isSuperAdmin(role)
                        )
                      }
                      onChange={(e) =>
                        change(
                          p.id,
                          e.target.value
                        )
                      }
                    >
                      {roleOptions.map((r) => (
                        <option
                          key={r}
                          value={r}
                        >
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td>
                    {String(
                      p.created_at
                    ).slice(0, 10)}
                  </td>

                  <td className="actions">
                    {p.role !== 'super_admin' && (
                      <button
                        className="secondary"
                        onClick={() => setDialog({ mode: 'reset', target: p })}
                      >
                        Reset password
                      </button>
                    )}

                    {p.id !== user.id && p.role !== 'super_admin' && (
                      <button
                        className="danger"
                        onClick={() =>
                          remove(p)
                        }
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {rows && !rows.length && (
                <tr>
                  <td
                    colSpan="5"
                    className="empty"
                  >
                    No users.
                  </td>
                </tr>
              )}

              {!rows && (
                <tr>
                  <td
                    colSpan="5"
                    className="empty"
                  >
                    Loading...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dialog && (
        <UserDialog
          {...dialog}
          currentRole={role}
          onClose={() => setDialog(null)}
          onDone={load}
        />
      )}
    </>
  );
};

export function Visitors() {
  return <Crud table="visitors" title="Visitors" noun="visitor" sortKey="visit_date" sortDir="desc" searchKeys={['name','phone','email','source','notes']}
    filters={[{key:'status',label:'All statuses',options:['New','Contacted','Connected','Not Connected','Member']},{key:'visit_type',label:'All visit types',options:['First Visit','Returning Visitor','Special Service','Event','Other'] }]}
    defaults={{visit_date:today(),status:'New',visit_type:'First Visit'}}
    fields={[
      {key:'visit_date',label:'Visit date',type:'date',required:true},{key:'name',label:'Full name',required:true},{key:'phone',label:'Phone',type:'tel'},{key:'email',label:'Email',type:'email'},
      {key:'gender',label:'Gender',type:'select',options:['Male','Female']},{key:'visit_type',label:'Visit type',type:'select',options:['First Visit','Returning Visitor','Special Service','Event','Other'],required:true},
      {key:'source',label:'How did they hear about us?'},{key:'address',label:'Address',full:true},{key:'status',label:'Status',type:'select',options:['New','Contacted','Connected','Not Connected','Member'],required:true},
      {key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Date',key:'visit_date'},{label:'Visitor',render:r=><><b>{r.name}</b><br/><small>{r.phone||'No phone'}</small></>},{label:'Visit type',key:'visit_type'},{label:'Status',render:r=>badge(r.status)},{label:'Source',key:'source'}]}/>
}

export function ABCClass() {
  const { data, save, remove } = useData();
  const { role } = useAuth();
  const canWrite = ['admin','secretary'].includes(role) || isSuperAdmin(role);
  const [q, setQ] = useState('');
  const [date, setDate] = useState(today());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [weeks, setWeeks] = useState(12);
  const [setupMsg, setSetupMsg] = useState('');
  const [selectedMember, setSelectedMember] = useState('');
  const group = (data.groups || []).find(g => String(g.name).trim().toLowerCase() === 'abc class');
  const participants = (data.group_members || []).filter(x => x.group_id === group?.id && x.status !== 'Inactive');
  const participantIds = new Set(participants.map(x => x.member_id));
  const members = (data.members || []).filter(m => !['Inactive', 'Left'].includes(m.status));
  const search = q.trim().toLowerCase();
  const matches = members.filter(m => !search || `${m.name} ${m.member_code || ''} ${m.phone || ''}`.toLowerCase().includes(search)).slice(0, 25);
  const selectedDate = new Date(`${date}T00:00:00`);
  const start = group?.start_date ? new Date(`${group.start_date}T00:00:00`) : null;
  const weekNo = start && !Number.isNaN(selectedDate.getTime()) ? Math.floor((selectedDate - start) / 604800000) + 1 : 1;
  const attendance = new Map((data.abc_class_attendance || []).filter(a => a.group_id === group?.id && a.date === date).map(a => [a.member_id, a]));
  const completed = group?.status === 'Completed' || (group?.end_date && date > group.end_date);

  async function saveSetup() {
    if (!canWrite) return;
    if (!startDate) return setSetupMsg('Select the class start date.');
    let calculatedEnd = endDate;
    if (!calculatedEnd && Number(weeks) > 0) {
      const d = new Date(`${startDate}T00:00:00`); d.setDate(d.getDate() + (Number(weeks) - 1) * 7); calculatedEnd = d.toISOString().slice(0,10);
    }
    save('groups', { id: group?.id || uuid(), ...(group || {}), name: 'ABC Class', group_type: 'Bible Study Class', meeting_day: 'Sunday', start_date: startDate, end_date: calculatedEnd || null, number_of_weeks: Number(weeks) || null, status: 'Active' });
    setSetupMsg(`ABC Class saved. It runs for ${weeks} week(s), ending ${calculatedEnd || 'when completed'}.`);
  }
  function registerMember() {
    if (!canWrite || !group || !selectedMember) return;
    if (participantIds.has(selectedMember)) return;
    const m = members.find(x => x.id === selectedMember);
    if (!m) return;
    save('group_members', { id: uuid(), group_id: group.id, member_id: m.id, role_name: 'Participant', status: 'Active' });
    setSelectedMember('');
  }
  function toggleAttendance(memberId) {
    if (!canWrite || !group || completed) return;
    const rec = attendance.get(memberId);
    save('abc_class_attendance', { id: rec?.id || uuid(), group_id: group.id, member_id: memberId, date, week_no: weekNo, present: !rec?.present });
  }
  function completeClass() {
    if (!canWrite || !group) return;
    save('groups', { ...group, status: 'Completed' });
    setSetupMsg('ABC Class has been marked Completed. Its register and attendance history are retained.');
  }
  return <>
    <div className="top"><div><h1>ABC Class</h1><div className="muted">Temporary Sunday Bible Study class. Register selected members, record weekly attendance, and retain the completed class history.</div></div></div>
    <div className="panel"><h2>Class setup</h2><div className="formgrid">
      <div><label>Start date</label><input type="date" value={startDate || group?.start_date || ''} onChange={e=>setStartDate(e.target.value)} /></div>
      <div><label>End date</label><input type="date" value={endDate || group?.end_date || ''} onChange={e=>setEndDate(e.target.value)} /></div>
      <div><label>Number of weeks</label><input type="number" min="1" value={weeks || group?.number_of_weeks || 1} onChange={e=>setWeeks(Number(e.target.value)||1)} /></div>
      <div><label>Meeting</label><input value="Every Sunday" readOnly /></div>
    </div><div className="toolbar"><button className="primary" onClick={saveSetup} disabled={!canWrite}>Save ABC Class Setup</button>{group?.status === 'Active' && <button className="danger" onClick={completeClass} disabled={!canWrite}>Mark Class Completed</button>}{setupMsg&&<span className="muted">{setupMsg}</span>}</div></div>
    <div className="panel"><h2>Class Register</h2><div className="toolbar"><input placeholder="Search member by name or ID…" value={q} onChange={e=>setQ(e.target.value)} /><select value={selectedMember} onChange={e=>setSelectedMember(e.target.value)}><option value="">Select member</option>{matches.map(m=><option key={m.id} value={m.id}>{m.member_code} · {m.name}</option>)}</select><button className="primary" onClick={registerMember} disabled={!canWrite || !group || !selectedMember || participantIds.has(selectedMember)}>Add to ABC Class</button></div><div className="tablewrap"><table><thead><tr><th>Member ID</th><th>Name</th><th>Group</th><th>Action</th></tr></thead><tbody>{participants.map(p=>{const m=members.find(x=>x.id===p.member_id);return <tr key={p.id}><td>{m?.member_code||''}</td><td>{m?.name||'Unknown'}</td><td>{m?.member_type||'Adult'}</td><td>{canWrite&&<button className="danger sm" onClick={()=>remove('group_members',p.id)}>Remove</button>}</td></tr>})}{!participants.length&&<tr><td colSpan="4" className="empty">No members registered for this ABC Class yet.</td></tr>}</tbody></table></div></div>
    <div className="panel"><h2>Weekly Attendance Register</h2><div className="toolbar"><div className="fld"><small>Sunday</small><input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div><span className="badge">Week {weekNo}{completed ? ' · Completed' : ''}</span></div><div className="tablewrap"><table><thead><tr><th>Member ID</th><th>Member</th><th>Present</th></tr></thead><tbody>{participants.map(p=>{const m=members.find(x=>x.id===p.member_id);const a=attendance.get(p.member_id);return <tr key={p.id}><td>{m?.member_code||''}</td><td><b>{m?.name||'Unknown'}</b></td><td><button className={a?.present?'primary':'secondary'} onClick={()=>toggleAttendance(p.member_id)} disabled={!canWrite||completed}>{a?.present?'Present':'Mark Present'}</button></td></tr>})}{!participants.length&&<tr><td colSpan="3" className="empty">Register members above first.</td></tr>}</tbody></table></div></div>
  </>;
}

export function Groups() {
  return <Crud table="groups" title="Groups / House Fellowships" noun="group" sortKey="name" searchKeys={['name','leader','location']}
    filters={[{key:'status',label:'All statuses',options:['Active','Inactive']}]}
    defaults={{status:'Active',group_type:'House Fellowship'}}
    fields={[
      {key:'name',label:'Group name',required:true},{key:'group_type',label:'Type',required:true},{key:'leader',label:'Leader'},{key:'assistant_leader',label:'Assistant leader'},
      {key:'meeting_day',label:'Meeting day'},{key:'meeting_time',label:'Meeting time'},{key:'location',label:'Location'},
      {key:'status',label:'Status',type:'select',options:['Active','Inactive'],required:true},{key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Group',render:r=><b>{r.name}</b>},{label:'Type',key:'group_type'},{label:'Leader',key:'leader'},{label:'Meeting',render:r=><>{r.meeting_day||''}{r.meeting_time?` · ${r.meeting_time}`:''}</>},{label:'Status',render:r=>badge(r.status)}]}/>
}

export function FollowUps() {
  return <Crud table="follow_ups" title="Follow-up" noun="follow-up" sortKey="date" sortDir="desc" searchKeys={['person_name','member_id','phone','reason','assigned_to','outcome']}
    filters={[{key:'status',label:'All statuses',options:['Open','In Progress','Completed','Closed']},{key:'category',label:'All categories',options:['Visitor','New Convert','Member','Youth','Family','Other']}]}
    defaults={{date:today(),status:'Open',category:'Member',method:'Phone'}}
    fields={[
      {key:'date',label:'Date',type:'date',required:true},{key:'member_id',label:'Member (search by name or ID)',type:'member',memberNameKey:'person_name',required:true},{key:'phone',label:'Phone',type:'tel'},
      {key:'category',label:'Category',type:'select',options:['Visitor','New Convert','Member','Youth','Family','Other'],required:true},{key:'reason',label:'Reason',required:true},
      {key:'assigned_to',label:'Assigned to'},{key:'method',label:'Method',type:'select',options:['Phone','Visit','SMS','In Person']},
      {key:'outcome',label:'Outcome',type:'textarea',full:true},{key:'next_action',label:'Next action'},{key:'next_date',label:'Next follow-up',type:'date'},
      {key:'status',label:'Status',type:'select',options:['Open','In Progress','Completed','Closed'],required:true},{key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Date',key:'date'},{label:'Person',render:r=><><b>{r.person_name}</b><br/><small>{r.category}</small></>},{label:'Reason',key:'reason'},{label:'Assigned',key:'assigned_to'},{label:'Next date',key:'next_date'},{label:'Status',render:r=>badge(r.status)}]}/>
}

export function PrayerRequests() {
  return <Crud table="prayer_requests" title="Prayer Requests" noun="prayer request" sortKey="date" sortDir="desc" searchKeys={['requester','member_id','request','category','assigned_to']}
    filters={[{key:'status',label:'All statuses',options:['New','Assigned','Praying','Answered','Closed']},{key:'category',label:'All categories',options:['General','Healing','Family','Finance','Work','Salvation','Thanksgiving','Other']}]}
    defaults={{date:today(),status:'New',category:'General',confidential:false}}
    fields={[
      {key:'date',label:'Date',type:'date',required:true},{key:'member_id',label:'Member (search by name or ID)',type:'member',memberNameKey:'requester',required:true},{key:'phone',label:'Phone',type:'tel'},
      {key:'category',label:'Category',type:'select',options:['General','Healing','Family','Finance','Work','Salvation','Thanksgiving','Other']},
      {key:'request',label:'Prayer request',type:'textarea',required:true,full:true},{key:'confidential',label:'Confidential',type:'checkbox'},
      {key:'assigned_to',label:'Assigned to'},{key:'status',label:'Status',type:'select',options:['New','Assigned','Praying','Answered','Closed'],required:true},
      {key:'answered_date',label:'Answered date',type:'date'},{key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Date',key:'date'},{label:'Requester',key:'requester'},{label:'Request',render:r=><span title={r.request}>{String(r.request||'').slice(0,70)}{String(r.request||'').length>70?'…':''}</span>},{label:'Assigned',key:'assigned_to'},{label:'Status',render:r=>badge(r.status)}]}/>
}


export function ServicePlans() {
  return <Crud table="service_plans" title="Service Plans" noun="service item" sortKey="service_date" searchKeys={['service_name','service_item','assigned_to']}
    filters={[{key:'status',label:'All statuses',options:['Planned','Confirmed','Completed','Cancelled']}]}
    defaults={{service_date:today(),service_name:'Sunday Service',item_order:1,status:'Planned'}}
    fields={[
      {key:'service_date',label:'Service date',type:'date',required:true},{key:'service_name',label:'Service',required:true},{key:'item_order',label:'Order',type:'number',min:1,required:true},
      {key:'service_item',label:'Service item',required:true},{key:'assigned_to',label:'Assigned to'},{key:'duration',label:'Duration'},
      {key:'status',label:'Status',type:'select',options:['Planned','Confirmed','Completed','Cancelled'],required:true},{key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Date',key:'service_date'},{label:'Service',key:'service_name'},{label:'#',key:'item_order'},{label:'Item',key:'service_item'},{label:'Assigned',key:'assigned_to'},{label:'Status',render:r=>badge(r.status)}]}/>
}

export function PastoralCare() {
  return <Crud table="pastoral_cases" title="Pastoral Care" noun="case" sortKey="opened_date" sortDir="desc" searchKeys={['person_name','member_id','category','assigned_to']}
    filters={[{key:'status',label:'All statuses',options:['Open','In Progress','Resolved','Closed']},{key:'priority',label:'All priorities',options:['Low','Normal','High','Urgent']},{key:'category',label:'All categories',options:['Counselling','Prayer / Spiritual Support','Hospital / Illness','Bereavement','Marriage / Family','Financial / Welfare','Crisis / Emergency','New Member Follow-up','Other']}]}
    defaults={{opened_date:today(),status:'Open',priority:'Normal'}}
    fields={[
      {key:'opened_date',label:'Opened date',type:'date',required:true},{key:'member_id',label:'Member (search by name or ID)',type:'member',memberNameKey:'person_name',required:true},{key:'category',label:'Category',type:'select',options:['Counselling','Prayer / Spiritual Support','Hospital / Illness','Bereavement','Marriage / Family','Financial / Welfare','Crisis / Emergency','New Member Follow-up','Other'],required:true},
      {key:'assigned_to',label:'Assigned pastor / leader'},{key:'priority',label:'Priority',type:'select',options:['Low','Normal','High','Urgent'],required:true},
      {key:'status',label:'Status',type:'select',options:['Open','In Progress','Resolved','Closed'],required:true},{key:'next_follow_up',label:'Next follow-up',type:'date'},
      {key:'private_notes',label:'Confidential notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Opened',key:'opened_date'},{label:'Person',key:'person_name'},{label:'Category',key:'category'},{label:'Assigned',key:'assigned_to'},{label:'Priority',render:r=>badge(r.priority)},{label:'Status',render:r=>badge(r.status)}]}/>
}

// ---- Audit Log: readable "Record" labels ----------------------------------------------------------
// The audit log stores a snapshot of the row that changed. Instead of showing the raw UUID, build a
// short description from that snapshot (member ID + name, receipt number, amount, date ...).
// The full ID stays available as a hover tooltip. Pastoral cases store no content on purpose,
// so those rows fall back to a short reference.
const auditPretty = (v) => String(v || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const AUDIT_LABELS = {
  members: (s) => [s.member_code, s.name],
  profiles: (s) => [s.full_name || s.email, auditPretty(s.role)],
  attendance: (s, who) => [who('person_name'), s.date, s.service],
  attendance_headcount: (s) => [s.date, s.service, `${headcountLabel(s.category || '')}: ${s.count}`],
  giving: (s, who) => [who('giver'), s.amount != null && money(s.amount), s.type, s.date],
  departments: (s) => [s.name],
  events: (s) => [s.title, s.date],
  offering_entries: (s) => [s.category, s.amount != null && money(s.amount), s.date],
  member_contributions: (s, who) => [who('person_name'), s.fund, s.month && s.year ? `${MONTHS[Number(s.month) - 1] || s.month} ${s.year}` : s.year, s.amount != null && money(s.amount)],
  welfare_members: (s) => [s.ac_no && `A/C ${s.ac_no}`, s.name],
  welfare_transactions: (s) => [s.kind, s.item, s.amount != null && money(s.amount), s.date],
  visitors: (s) => [s.name, s.visit_date],
  groups: (s) => [s.name],
  follow_ups: (s, who) => [who('person_name'), s.category, s.date],
  prayer_requests: (s, who) => [s.confidential ? 'Confidential request' : who('requester'), s.date],
  volunteers: (s) => [s.person_name, s.ministry],
  service_plans: (s) => [s.service_date, s.service_name, s.service_item],
  finance_weekly_reports: (s) => [s.week_no && `Week ${s.week_no}${s.year ? ` ${s.year}` : ''}`, s.date, s.grand_total != null && money(s.grand_total)],
  finance_weekly_cash_counts: (s) => ['Weekly cash count', s.category, s.denomination != null && `${s.quantity} x ${s.denomination}`],
  finance_weekly_momo: (s) => ['Weekly MoMo', s.category, s.provider, s.amount != null && money(s.amount)],
  finance_weekday_collections: (s) => ['Weekday collection', s.collection_date],
  finance_weekday_cash_counts: (s) => ['Weekday cash count', s.denomination != null && `${s.quantity} x ${s.denomination}`],
  finance_weekday_momo: (s) => ['Weekday MoMo', s.provider, s.amount != null && money(s.amount)],
  finance_reconciliations: (s) => [s.date, s.method_filter, s.status],
  pledges: (s) => [s.member_name, s.project, s.pledged_amount != null && money(s.pledged_amount)],
  payment_receipts: (s) => [s.receipt_number || s.reference, s.member_name, s.amount != null && money(s.amount)],
  payment_requests: (s) => [s.reference, s.member_name, s.amount != null && money(s.amount)],
  expenditures: (s) => [s.pv_no && `PV ${s.pv_no}`, s.description, s.amount != null && money(s.amount)]
};
const auditSnapshot = (r) => (r.action === 'DELETE' ? r.old_row : r.new_row || r.old_row) || null;
function auditRecordLabel(r, memberMap) {
  if (r.action === 'PURGE' && r.new_row) return `${r.new_row.deleted} entries removed`;
  const s = auditSnapshot(r);
  const shortId = r.row_id ? `Ref ${String(r.row_id).slice(0, 8)}` : '';
  if (!s) return shortId;
  const m = memberMap[s.member_id];
  const who = (key) => [m?.member_code, s[key] || m?.name].filter(Boolean).join(' · ');
  const build = AUDIT_LABELS[r.table_name];
  let parts = build ? build(s, who) : [s.name, s.title, s.person_name];
  parts = parts.filter((x) => x !== undefined && x !== null && x !== false && String(x).trim() !== '' && !/undefined|NaN/.test(String(x)));
  return parts.length ? parts.join(' · ') : shortId;
}

const AUDIT_SKIP_FIELDS = new Set(['id', 'updated_at', 'created_at', 'created_by', 'updated_by']);
// Free-text and sensitive fields: the log says they changed, but does not copy the old and new text onto the screen.
const AUDIT_PRIVATE_FIELDS = new Set(['notes', 'private_notes', 'medical_notes', 'pickup_notes', 'pickup_code', 'message', 'body', 'address', 'photo_url', 'metadata', 'provider_payload', 'payload']);
const auditValue = (k, v) => {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') v = JSON.stringify(v);
  if (/(amount|total)$/.test(k) && !isNaN(Number(v))) return money(v);
  const t = String(v);
  return t.length > 40 ? `${t.slice(0, 40)}...` : t;
};
// For UPDATE rows: list which fields changed, e.g. "Status: Active -> Inactive".
function auditChanges(r) {
  if (r.action !== 'UPDATE' || !r.old_row || !r.new_row) return [];
  const hide = r.table_name === 'prayer_requests' && (r.new_row.confidential || r.old_row.confidential) ? new Set(['request', 'notes']) : null;
  const out = [];
  for (const k of Object.keys(r.new_row)) {
    if (AUDIT_SKIP_FIELDS.has(k)) continue;
    if (JSON.stringify(r.old_row[k]) === JSON.stringify(r.new_row[k])) continue;
    out.push((hide && hide.has(k)) || AUDIT_PRIVATE_FIELDS.has(k) ? `${auditPretty(k)} changed` : `${auditPretty(k)}: ${auditValue(k, r.old_row[k])} \u2192 ${auditValue(k, r.new_row[k])}`);
  }
  return out;
}
export function AuditLog() {
  const { role } = useAuth();
  const [rows,setRows]=useState([]); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [olderThan,setOlderThan]=useState('365'); const [busy,setBusy]=useState(false);
  const [memberMap,setMemberMap]=useState({});
  const load=()=>supabase.from('audit_log').select('*').order('at',{ascending:false}).limit(300).then(async({data,error})=>{
    if(error){setError(error.message);return;}
    setError(''); const list=data||[]; setRows(list);
    // Look up member ID + name for rows that point at a member, so they can be shown as e.g. "DTA12 · Kwame Mensah".
    const ids=[...new Set(list.map(r=>(auditSnapshot(r)||{}).member_id).filter(Boolean))];
    const map={};
    for(let i=0;i<ids.length;i+=100){
      const { data: ms } = await supabase.from('members').select('id,member_code,name').in('id', ids.slice(i,i+100));
      (ms||[]).forEach(m=>{map[m.id]=m;});
    }
    setMemberMap(map);
  });
  useEffect(()=>{ if(!isAdmin(role)) return; load(); },[role]);
  const purge=async()=>{
    const days=Number(olderThan);
    const label={90:'3 months',180:'6 months',365:'1 year',730:'2 years'}[days]||`${days} days`;
    if(!confirm(`Permanently delete every audit log entry older than ${label}? This cannot be undone. A note recording who did this will be kept.`)) return;
    setBusy(true); setError(''); setNotice('');
    const { data, error: err } = await supabase.rpc('purge_audit_log', { p_older_than_days: days });
    setBusy(false);
    if(err){ setError(/purge_audit_log/.test(err.message)&&/function|schema cache/i.test(err.message) ? 'The cleanup function is not installed yet. Run migration_46 in the Supabase SQL editor.' : err.message); return; }
    setNotice(`${data} old ${data===1?'entry was':'entries were'} deleted.`);
    load();
  };
  if(!isAdmin(role)) return <div className="panel"><h1>Audit Log</h1><p className="muted">Admin access only.</p></div>;
  return <><div className="top"><h1>Audit Log</h1><button className="secondary" onClick={load}>Refresh</button></div>
    {isSuperAdmin(role)&&<div className="panel"><div className="btnrow" style={{alignItems:'center',flexWrap:'wrap'}}>
      <span>Clean up: delete entries older than</span>
      <select value={olderThan} onChange={e=>setOlderThan(e.target.value)} disabled={busy}><option value="90">3 months</option><option value="180">6 months</option><option value="365">1 year</option><option value="730">2 years</option></select>
      <button className="danger" disabled={busy} onClick={purge}>{busy?'Deleting...':'Delete old entries'}</button>
    </div><p className="muted" style={{marginBottom:0}}>Only the Super Admin can do this. The list below shows the latest 300 entries.</p></div>}
    <div className="panel">{error&&<div className="err">{error}</div>}{notice&&<div style={{color:'var(--ok)',fontSize:13,marginBottom:8}}>{notice}</div>}<div className="tablewrap"><table><thead><tr><th>Time</th><th>Table</th><th>Action</th><th>Record</th><th>Actor</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{new Date(r.at).toLocaleString()}</td><td>{r.table_name}</td><td>{badge(r.action)}</td><td title={r.row_id||''}>{auditRecordLabel(r,memberMap)}{(()=>{const ch=auditChanges(r); return ch.length>0&&<div className="muted sm" style={{marginTop:4}}>{ch.slice(0,4).map((c,i)=><div key={i}>{c}</div>)}{ch.length>4&&<div>+{ch.length-4} more</div>}</div>;})()}</td><td>{r.actor_name || r.actor || 'System'}</td></tr>)}{!rows.length&&<tr><td colSpan="5" className="empty">No audit records.</td></tr>}</tbody></table></div></div></>;
}

/* ---------------- Settings ---------------- */
function ChangePassword() {
  const { updatePassword } = useAuth();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [msg, setMsg] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (p1.length < 6) return setMsg({ bad: true, t: 'Password must be at least 6 characters.' });
    if (p1 !== p2) return setMsg({ bad: true, t: 'The two passwords do not match.' });
    const { error } = await updatePassword(p1);
    if (error) setMsg({ bad: true, t: error.message });
    else { setMsg({ t: 'Password changed.' }); setP1(''); setP2(''); }
  }
  return (
    <form onSubmit={submit} style={{ marginTop: 14, maxWidth: 360 }}>
      <h2>Change password</h2>
      <label>New password</label><input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" style={{ width: '100%', marginBottom: 10 }} />
      <label>Confirm new password</label><input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" style={{ width: '100%', marginBottom: 10 }} />
      {msg && <div className={msg.bad ? 'err' : 'muted'} style={{ marginBottom: 10 }}>{msg.t}</div>}
      <button className="primary">Update password</button>
    </form>
  );
}

export function Settings() {
  const { user, profile, role } = useAuth();
  const { data, pending, failed, online, syncError, lastSync, syncNow, discardFailed, clearTestData } = useData();
  const accountMember = (data.members || []).find(m => m.user_id === user?.id || (profile?.member_id && m.id === profile.member_id));
  const accountLabel = accountMember?.phone || formatLoginId(user?.email) || user?.email;
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState(null);

  async function handleClearTestData() {
    setResetMsg(null);
    if (!isSuperAdmin(role)) return;
    if (resetPhrase.trim() !== 'CLEAR TEST DATA') {
      setResetMsg({ bad: true, t: 'Type CLEAR TEST DATA exactly to continue.' });
      return;
    }
    if (!window.confirm('This will permanently delete the church test data from Supabase. User accounts and system settings will remain. Continue?')) return;
    setResetBusy(true);
    try {
      // Best effort: keep a snapshot so cleared data can be brought back (needs migration 61).
      try { await supabase.rpc('create_backup_snapshot', { p_note: 'Before clearing test data', p_kind: 'manual' }); } catch { /* ignore */ }
      await clearTestData();
      setResetPhrase('');
      setResetMsg({ t: 'Test data cleared successfully. The system is ready for real data entry.' });
    } catch (e) {
      setResetMsg({ bad: true, t: e?.message || 'Could not clear test data.' });
    } finally {
      setResetBusy(false);
    }
  }
  return (
    <>
      <div className="top"><h1>Settings</h1></div>
      <div className="panel">
        <h2>Account</h2>
        <p><b>{profile?.full_name || accountLabel}</b><br /><span className="muted">{accountLabel} · role: {profile?.role}</span></p>
        <ChangePassword />
      </div>
      <div className="panel">
        <h2>Sync</h2>
        <p className="muted">
          {online && !syncError ? 'Connected.' : 'Working offline — changes are saved on this device and sent automatically when the connection returns.'}
          {' '}Unsynced changes: <b>{pending}</b>.{lastSync ? ` Last synced ${lastSync.toLocaleTimeString()}.` : ''}
        </p>
        <button className="secondary" onClick={syncNow}>Sync now</button>
        {failed.length > 0 && (
          <>
            <h2 style={{ marginTop: 18 }}>Changes the server rejected ({failed.length})</h2>
            <p className="muted">These changes were not applied. A conflict means another user changed the same record first; a permission or validation error means the server rejected the change.</p>
            <ul>
              {failed.map((f, i) => <li key={i}>{f.op} in <b>{f.table}</b>{f.conflict ? ' — conflict' : ''}: {f.error}</li>)}
            </ul>
            <button className="secondary" onClick={discardFailed}>Clear this list</button>
          </>
        )}
      </div>
      {isSuperAdmin(role) && <div className="panel" style={{ border: '2px solid #b91c1c' }}>
          <h2>Clear Test Data</h2>
          <p className="muted">Super Admin only. Use this once testing is complete. It permanently removes operational/test records from the church database while keeping administrator accounts, user roles, database structure and system settings.</p>
          <p><b>Before using this:</b> download a backup (Backup &amp; Restore below) if you may need any of the test records later. A server snapshot is also saved automatically when the database upgrade is installed.</p>
          <label>Type <code>CLEAR TEST DATA</code> to confirm</label>
          <input value={resetPhrase} onChange={e => setResetPhrase(e.target.value)} placeholder="CLEAR TEST DATA" style={{ width: '100%', maxWidth: 420, marginBottom: 10 }} disabled={resetBusy} />
          {resetMsg && <div className={resetMsg.bad ? 'err' : 'muted'} style={{ marginBottom: 10 }}>{resetMsg.t}</div>}
          <button className="danger" onClick={handleClearTestData} disabled={resetBusy || resetPhrase.trim() !== 'CLEAR TEST DATA'}>{resetBusy ? 'Clearing test data...' : 'Permanently Clear Test Data'}</button>
        </div>}
      {(isAdmin(role) || isSuperAdmin(role)) && <BackupPanel role={role} online={online} pending={pending} syncNow={syncNow} />}
    </>
  );
}

export { default as MemberPortal } from './memberPortal';

/* ---------------- Family / Children / Check-in ---------------- */
export function Families() {
  return <Crud
    table="families" title="Families / Households" noun="family"
    sortKey="family_name" searchKeys={['family_name','phone','address']}
    fields={[
      {key:'family_name',label:'Family name',required:true},
      {key:'phone',label:'Family phone',type:'tel'},
      {key:'address',label:'Address'},
      {key:'notes',label:'Notes',type:'textarea',full:true},
    ]}
    columns={[
      {label:'Family',key:'family_name'},
      {label:'Phone',key:'phone'},
      {label:'Address',key:'address'},
    ]}
  />;
}

export function Children() {
  const {data, save}=useData();
  const members=data.members.map(m=>({value:m.id,label:m.name}));
  const [q,setQ]=useState('');
  const [service,setService]=useState("Children's Service");
  const [msg,setMsg]=useState('');
  const active=(data.children||[]).filter(c=>c.status==='Active');
  const results=q.trim()?active.filter(c=>`${c.name} ${c.guardian_name||''} ${c.guardian_phone||''}`.toLowerCase().includes(q.toLowerCase())).slice(0,30):active.slice(0,30);
  const checked=new Set((data.attendance||[]).filter(a=>a.date===today() && a.service===service && a.status==='Present' && a.child_id).map(a=>a.child_id));
  function checkIn(c){
    if(checked.has(c.id)){setMsg(`${c.name} is already marked present for ${service}.`);return;}
    save('attendance',{id:uuid(),date:today(),service,person_name:c.name,child_id:c.id,status:'Present',note:'Children Department quick attendance'});
    setMsg(`${c.name} marked present.`);
  }
  return <>
    <Crud
      table="children" title="Children" noun="child"
      sortKey="name" searchKeys={['name','guardian_name','guardian_phone']}
      filters={[{key:'status',label:'All statuses',options:['Active','Inactive']}]}
      defaults={{status:'Active'}}
      fields={[
        {key:'name',label:'Child name',required:true},
        {key:'dob',label:'Date of birth',type:'date'},
        {key:'gender',label:'Gender',type:'select',options:['Male','Female']},
        {key:'member_id',label:'Linked member/guardian',type:'select',options:members},
        {key:'guardian_name',label:'Guardian name'},
        {key:'guardian_phone',label:'Guardian phone',type:'tel'},
        {key:'attendance_group',label:'Attendance Group / Class',placeholder:'e.g. Red Class, Blue Class'},
        {key:'pickup_notes',label:'Pickup notes',type:'textarea',full:true},
        {key:'medical_notes',label:'Medical notes',type:'textarea',full:true},
        {key:'status',label:'Status',type:'select',options:['Active','Inactive'],required:true},
      ]}
      columns={[
        {label:'Child',render:c=><><b>{c.name}</b><br/><small>{c.dob||'DOB not recorded'}</small></>},
        {label:'Guardian',render:c=><>{c.guardian_name||'Not recorded'}<br/><small>{c.guardian_phone||''}</small></>},
        {label:'Status',render:c=>badge(c.status)},
      ]}
    />
    <div className="panel" style={{marginTop:16}}>
      <div className="top" style={{marginBottom:10}}><div><h2 style={{margin:0}}>Children Quick Attendance</h2><div className="muted">The Children Department can record its attendance separately from the adult service.</div></div></div>
      <div className="toolbar">
        <div className="fld"><small>Children service</small><select value={service} onChange={e=>setService(e.target.value)}><option>Children's Service</option><option>Sunday School</option><option>Children's Special Program</option></select></div>
        <input placeholder="Search child or guardian" value={q} onChange={e=>setQ(e.target.value)} />
      </div>
      {msg&&<p className="muted">{msg}</p>}
      <div className="quicklist">
        {results.map(c=><button key={c.id} className="quickrow" onClick={()=>checkIn(c)} disabled={checked.has(c.id)}>
          <span><b>{c.name}</b><br/><small>{c.gender||''}{c.guardian_name?` · ${c.guardian_name}`:''}</small></span>
          <span className="badge">{checked.has(c.id)?'Present':'Check in'}</span>
        </button>)}
        {!results.length&&<div className="empty">No active children found.</div>}
      </div>
    </div>
  </>;
}

export function QuickAttendanceList({ mode = 'member', memberType = '', title = 'Quick Attendance' }) {
  const { data, save, remove } = useData();
  const [q, setQ] = useState('');
  const defaultService = mode === 'child' ? "Children's Service" : 'Sunday Service';
  const [service, setService] = useState(defaultService);
  const [attendanceDate, setAttendanceDate] = useState(today());
  const [eventChoice, setEventChoice] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [msg, setMsg] = useState('');
  const selectionDirty = useRef(false);
  const currentKey = `${mode}|${memberType}|${attendanceDate}|${service}`;
  const lastLoadedKey = useRef('');

  const upcomingEvents = useMemo(() => [...(data.events || [])]
    .filter(e => String(e.date || '') >= today())
    .sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.event_time || '').localeCompare(String(b.event_time || '')))
    .slice(0, 50), [data.events]);

  // Start each attendance register on today's date and, when an upcoming event exists
  // for today, use that event automatically instead of assuming Sunday Service.
  useEffect(() => {
    if (eventChoice) return;
    const eventToday = upcomingEvents.find(e => String(e.date || '').slice(0,10) === attendanceDate);
    if (eventToday) {
      setService(eventToday.title || defaultService);
      return;
    }
    const weekday = new Date(`${attendanceDate}T00:00:00`).getDay();
    if (mode !== 'child') {
      if (weekday === 0) setService('Sunday Service');
      else if (weekday === 2) setService('Bible Study');
      else if (weekday === 4) setService('Prayer Meeting');
    }
  }, [upcomingEvents, attendanceDate, mode, eventChoice, defaultService]);

  const roster = useMemo(() => {
    if (mode === 'child') {
      return [...(data.children || [])].filter(c => c.status === 'Active').sort((a,b) => {
        const ga = String(a.attendance_group || 'UNASSIGNED').toUpperCase(), gb = String(b.attendance_group || 'UNASSIGNED').toUpperCase();
        return ga.localeCompare(gb) || String(a.name || '').localeCompare(String(b.name || ''));
      });
    }
    return [...(data.members || [])].filter(m => !['Inactive', 'Left'].includes(m.status) && m.member_code && (!memberType || (m.member_type || 'Adult') === memberType)).sort(memberIdCompare);
  }, [data.children, data.members, mode, memberType]);

  const presentMap = useMemo(() => {
    const map = new Map();
    (data.attendance || []).filter(a => String(a.date || '').slice(0,10) === attendanceDate && a.service === service && a.status === 'Present').forEach(a => {
      const id = mode === 'child' ? a.child_id : a.member_id;
      if (id) map.set(id, a);
    });
    return map;
  }, [data.attendance, attendanceDate, service, mode]);

  const dailyAttendanceMap = useMemo(() => {
    const map = new Map();
    (data.attendance || []).filter(a => String(a.date || '').slice(0,10) === attendanceDate).forEach(a => {
      const id = mode === 'child' ? a.child_id : a.member_id;
      if (id && !map.has(id)) map.set(id, a);
    });
    return map;
  }, [data.attendance, attendanceDate, mode]);

  // Load the saved register when the attendance context changes. Do not reset an in-progress
  // register when optimistic saves or background sync update data.attendance.
  useEffect(() => {
    if (lastLoadedKey.current === currentKey) return;
    lastLoadedKey.current = currentKey;
    selectionDirty.current = false;
    setSelected(new Set(presentMap.keys()));
    setMsg('');
  }, [currentKey]);

  // On the initial/background data load, hydrate the register only while the user has not
  // started changing checkboxes. This prevents search/mark operations from being undone.
  useEffect(() => {
    if (!selectionDirty.current) setSelected(new Set(presentMap.keys()));
  }, [data.attendance]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return roster.filter(x => !term || (mode === 'child'
      ? `${x.name || ''} ${x.guardian_name || ''} ${x.guardian_phone || ''} ${x.attendance_group || ''}`.toLowerCase().includes(term)
      : `${x.name || ''} ${x.member_code || ''} ${x.phone || ''} ${x.grp || ''}`.toLowerCase().includes(term)));
  }, [roster, q, mode]);

  const memberPhotoMap = useMemo(() => {
    const map = new Map();
    (data.members || []).forEach(m => map.set(m.id, m.photo_url || ''));
    return map;
  }, [data.members]);

  const groups = useMemo(() => {
    const out = {};
    shown.forEach(x => {
      const g = mode === 'child' ? (x.attendance_group || 'UNASSIGNED') : (x.grp || 'UNASSIGNED');
      (out[g] ||= []).push(x);
    });
    return Object.entries(out).sort((a,b) => a[0].localeCompare(b[0]));
  }, [shown, mode]);

  const toggle = (id) => {
    selectionDirty.current = true;
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const setGroup = (items, value) => {
    selectionDirty.current = true;
    setSelected(prev => {
      const n = new Set(prev);
      items.forEach(x => {
        const existingToday = dailyAttendanceMap.get(x.id);
        const editableHere = presentMap.get(x.id);
        if (value && existingToday && !editableHere) return;
        value ? n.add(x.id) : n.delete(x.id);
      });
      return n;
    });
  };

  const chooseEvent = (value) => {
    setEventChoice(value);
    if (value.startsWith('event:')) {
      const event = upcomingEvents.find(e => `event:${e.id}` === value);
      if (event) {
        setService(event.title || defaultService);
        setAttendanceDate(String(event.date || today()).slice(0,10));
      }
    } else if (value.startsWith('service:')) {
      setService(value.slice(8));
    }
  };

  const saveAttendance = async () => {
    const current = new Map(presentMap);
    const conflicts = roster.filter(item => selected.has(item.id) && !current.has(item.id) && dailyAttendanceMap.has(item.id));
    if (conflicts.length) {
      const names = conflicts.slice(0, 5).map(x => x.name).join(', ');
      setMsg(`${conflicts.length} person${conflicts.length === 1 ? '' : 's'} already marked today: ${names}${conflicts.length > 5 ? '…' : ''}. Each person can be marked only once per day.`);
      return;
    }
    let added = 0, removed = 0;
    for (const item of roster) {
      const id = item.id, should = selected.has(id), existing = current.get(id);
      if (should && !existing) {
        const result = save('attendance', { id: uuid(), date: attendanceDate, service, person_name: item.name, ...(mode === 'child' ? { child_id: id } : { member_id: id }), status: 'Present', note: `${title} checkbox attendance` });
        if (result?.duplicate) {
          setMsg(result.error.message);
          return;
        }
        added++;
      } else if (!should && existing) {
        remove('attendance', existing.id); removed++;
      }
    }
    selectionDirty.current = false;
    setMsg(`Attendance saved. ${added} added, ${removed} cleared.`);
  };

  const day = dayName(attendanceDate);

  return <>
    <div className="top"><div><h1>{title}</h1><div className="muted">Tick the checkbox beside each person who is present, grouped by {mode === 'child' ? 'Children Group / Class' : 'Group / Cell'}.</div></div></div>
    <div className="panel">
      <div className="toolbar quick-attendance-toolbar" style={{display:'grid',gridTemplateColumns:'minmax(180px,1.25fr) 150px 105px minmax(220px,2fr) auto',gap:8,alignItems:'end'}}>
        <div className="fld"><small>Event / Service</small><select value={eventChoice || `service:${service}`} onChange={e=>chooseEvent(e.target.value)}>
          <option value={`service:${service}`}>{service}</option>
          <optgroup label="Upcoming events">{upcomingEvents.map(e=><option key={e.id} value={`event:${e.id}`}>{e.title} · {e.date}</option>)}</optgroup>
          {mode !== 'child' && <optgroup label="Standard services"><option value="service:Sunday Service">Sunday Service</option><option value="service:Bible Study">Bible Study</option><option value="service:Prayer Meeting">Prayer Meeting</option><option value="service:Special Program">Special Program</option></optgroup>}
          {mode === 'child' && <optgroup label="Children services"><option value="service:Children's Service">Children's Service</option><option value="service:Sunday School">Sunday School</option><option value="service:Children's Special Program">Children's Special Program</option></optgroup>}
        </select></div>
        <div className="fld"><small>Date</small><input type="date" value={attendanceDate} onChange={e=>{setEventChoice('');setAttendanceDate(e.target.value || today());}} /></div>
        <div className="fld"><small>Day</small><input value={day} readOnly /></div>
        <div className="fld"><small>{mode === 'child' ? 'Search child, parent, phone or class' : 'Search name, Member ID, phone or group'}</small><input placeholder={mode === 'child' ? 'Search child, parent, phone or class' : 'Search name, Member ID, phone or group'} value={q} onChange={e=>setQ(e.target.value)} /></div>
        <button className="primary" onClick={saveAttendance}>Save Attendance</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {!groups.length && <div className="empty">No active people found.</div>}
      <div className="quick-groups">
        {groups.map(([group, items]) => <div className="quick-group" key={group}>
          <div className="quick-group-head"><div><h3>{group}</h3><small>{items.length} people · {items.filter(x=>selected.has(x.id)).length} present</small></div><div><button className="secondary sm" onClick={()=>setGroup(items,true)}>All Present</button><button className="secondary sm" onClick={()=>setGroup(items,false)}>Clear</button></div></div>
          <div className="quick-check-grid">
            {items.map(x => {
              const photoPath = mode === 'child' ? (x.photo_url || memberPhotoMap.get(x.member_id) || '') : (x.photo_url || '');
              const alreadyToday = dailyAttendanceMap.get(x.id);
              const editableHere = presentMap.get(x.id);
              const blocked = !!alreadyToday && !editableHere;
              return <label className={`quick-check-row${blocked ? ' attendance-blocked' : ''}`} key={x.id} title={blocked ? `Already marked today (${alreadyToday.service || 'attendance'})` : ''}>
                <input type="checkbox" checked={selected.has(x.id)} disabled={blocked} onChange={()=>toggle(x.id)} />
                <span className="quick-check-photo"><StoragePhoto path={photoPath} size={28} alt={`${x.name || 'Person'} photo`} /></span>
                <span className="quick-check-info"><b>{x.name}</b><small>{mode === 'child' ? `${x.guardian_name || 'No guardian'}${x.guardian_phone ? ` · ${x.guardian_phone}` : ''}` : `${x.member_code || 'No ID'}${x.phone ? ` · ${x.phone}` : ''}`}{blocked ? ' · Already marked today' : ''}</small></span>
              </label>;
            })}
          </div>
        </div>)}
      </div>
    </div>
  </>;
}

export function ChildCheckIn() {
  const {data,save}=useData();
  const [q,setQ]=useState('');
  const [service,setService]=useState('Sunday Service');
  const [selected,setSelected]=useState(null);
  const [msg,setMsg]=useState('');
  const active=(data.children||[]).filter(c=>c.status==='Active');
  const results=q.trim()?active.filter(c=>`${c.name} ${c.guardian_name||''} ${c.guardian_phone||''}`.toLowerCase().includes(q.toLowerCase())).slice(0,12):[];
  const todayChecks=(data.child_checkins||[]).filter(x=>x.date===today());
  const checkedIds=new Set(todayChecks.filter(x=>!x.check_out).map(x=>x.child_id));
  function checkIn(c){
    if(checkedIds.has(c.id)){setMsg(`${c.name} is already checked in.`);return;}
    const code=String(Math.floor(100000+Math.random()*900000));
    save('child_checkins',{id:uuid(),child_id:c.id,date:today(),service,check_in:new Date().toISOString(),pickup_code:code,notes:''});
    setSelected({child:c,code}); setQ(''); setMsg(`${c.name} checked in. Give the guardian pickup code ${code}.`);
  }
  function checkOut(row){
    const code=prompt('Enter the pickup code.');
    if(!code || String(code)!==String(row.pickup_code)){alert('Pickup code does not match.');return;}
    save('child_checkins',{id:row.id,check_out:new Date().toISOString(),pickup_by:row.pickup_by||row.child_name||'Guardian'});
    setMsg('Child checked out successfully.');
  }
  const activeRows=todayChecks.map(r=>({...r,child_name:data.children.find(c=>c.id===r.child_id)?.name||'Unknown'}));
  return <>
    <div className="top"><div><h1>Children Check-in</h1><div className="muted">Fast Sunday check-in and secure pickup.</div></div></div>
    <div className="panel">
      <div className="toolbar"><div className="fld"><small>Service</small><select value={service} onChange={e=>setService(e.target.value)}><option>Sunday Service</option><option>Children's Service</option><option>Special Program</option></select></div><div className="fld" style={{flex:1}}><small>Search child, guardian or phone</small><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Type name or phone" /></div></div>
      {msg&&<p className="muted">{msg}</p>}
      {results.length>0&&<div className="quicklist">{results.map(c=><button className="quickrow" key={c.id} onClick={()=>checkIn(c)}><span><b>{c.name}</b><br/><small>{c.guardian_name||'Guardian not recorded'} · {c.guardian_phone||'No phone'}</small></span><span className="badge">Check in</span></button>)}</div>}
      {!q&&<div className="empty">Search for a child to begin.</div>}
    </div>
    <div className="panel"><h2>Today's children</h2><div className="tablewrap"><table><thead><tr><th>Child</th><th>Check-in</th><th>Pickup code</th><th>Status</th><th></th></tr></thead><tbody>{activeRows.map(r=><tr key={r.id}><td><b>{r.child_name}</b></td><td>{r.check_in?new Date(r.check_in).toLocaleTimeString():''}</td><td><b>{r.pickup_code||''}</b></td><td>{r.check_out?'Checked out':'Checked in'}</td><td className="actions">{!r.check_out&&<button className="secondary sm" onClick={()=>checkOut(r)}>Check out</button>}</td></tr>)}{!activeRows.length&&<tr><td colSpan="5" className="empty">No children checked in today.</td></tr>}</tbody></table></div></div>
    {selected&&<div className="panel"><h2>Pickup slip</h2><p><b>{selected.child.name}</b></p><p>Pickup code: <strong style={{fontSize:28,letterSpacing:4}}>{selected.code}</strong></p><button className="secondary" onClick={()=>window.print()}>Print</button></div>}
  </>;
}

export function ChildrenQuickAttendance() { return <QuickAttendanceList mode="child" title="Children Quick Attendance" />; }
export function AdultCheckIn() { return <QuickAttendanceList memberType="Adult" title="Adult Quick Attendance" />; }
export function OmegaCheckIn() { return <QuickAttendanceList memberType="Omega" title="Omega Quick Attendance" />; }

/* ---------------- Major Modules V11 ---------------- */
export function FinanceCenter() {
  const { role } = useAuth();
  if (!['admin','finance','finance_reviewer','pastor'].includes(role) && !isSuperAdmin(role)) return <div className="panel"><h2>Finance Center</h2><p className="muted">Finance access is restricted.</p></div>;
  return <FinanceCenterScreen />;
}

function FinanceCenterScreen() {
  const { data, save, remove } = useData();
  const { role, profile, hasPermission } = useAuth();
  const canReviewFinance = hasPermission('finance_reviewer.approve');
  const isPastor = role === 'pastor';
  const canPrepareFinance = hasPermission('finance.manage') && !isPastor && !canReviewFinance;

  const DENOMS = [200,100,50,20,10,5,2,1,0.5,0.2,0.1];
  const CATS = OFFERING_CATEGORIES;
  const STANDARD_CATS = CATS.filter(c=>c!=='Weekday Offering');
  const [tab,setTab] = useState('weekly');
  const [date,setDate] = useState(today());
  const [weekNo,setWeekNo] = useState(1);
  const [year,setYear] = useState(new Date().getFullYear());
  const [month,setMonth] = useState(new Date().getMonth()+1);
  const [counts,setCounts] = useState({});
  const [momo,setMomo] = useState({});
  const [refs,setRefs] = useState({});
  const [provider,setProvider] = useState({});
  const [reportId,setReportId] = useState('');
  const [report,setReport] = useState(null);
  const [notes,setNotes] = useState('');
  const [checkedBy,setCheckedBy] = useState('');
  const [approvedBy,setApprovedBy] = useState('');
  const [status,setStatus] = useState('Draft');
  const [msg,setMsg] = useState('');
  const [weekdayEntries,setWeekdayEntries] = useState([]);

  const reports = data.finance_weekly_reports || [];
  const cashRows = data.finance_weekly_cash_counts || [];
  const momoRows = data.finance_weekly_momo || [];
  const weekdayRows = data.finance_weekday_collections || [];
  const weekdayCashRows = data.finance_weekday_cash_counts || [];
  const weekdayMomoRows = data.finance_weekday_momo || [];

  const emptyWeekdayEntry = (collectionDate=today()) => ({
    id: uuid(), collection_date: collectionDate, notes:'', counts:{}, momo:'', provider:'', reference:'',
  });

  const loadReport = () => {
    const r = reports.find(x => x.date === date && Number(x.week_no) === Number(weekNo));
    const rid=r?.id || '';
    setReport(r || null); setReportId(rid); setNotes(r?.notes || ''); setCheckedBy(r?.checked_by_name || ''); setApprovedBy(r?.approved_by_name || ''); setStatus(r?.status || 'Draft');
    const c={}; cashRows.filter(x=>x.report_id===rid && x.category!=='Weekday Offering').forEach(x=>{ c[`${x.category}|${x.denomination}`]=Number(x.quantity||0); });
    const m={}; const rr={}; const pp={}; momoRows.filter(x=>x.report_id===rid && x.category!=='Weekday Offering').forEach(x=>{m[x.category]=Number(x.amount||0); rr[x.category]=x.reference||''; pp[x.category]=x.provider||'';});
    setCounts(c); setMomo(m); setRefs(rr); setProvider(pp);

    const loaded=weekdayRows.filter(x=>x.report_id===rid).sort((a,b)=>String(a.collection_date).localeCompare(String(b.collection_date)) || String(a.created_at||'').localeCompare(String(b.created_at||'')));
    setWeekdayEntries(loaded.map(x=>{
      const wc={};
      weekdayCashRows.filter(y=>y.collection_id===x.id).forEach(y=>{wc[String(y.denomination)]=Number(y.quantity||0);});
      const wm=weekdayMomoRows.find(y=>y.collection_id===x.id);
      return {id:x.id,collection_date:x.collection_date||date,notes:x.notes||'',counts:wc,momo:wm?.amount!=null?Number(wm.amount):'',provider:wm?.provider||'',reference:wm?.reference||''};
    }));
  };
  useEffect(()=>{ if(tab==='weekly') loadReport(); },[date,weekNo,reports.length,cashRows.length,momoRows.length,weekdayRows.length,weekdayCashRows.length,weekdayMomoRows.length,tab]);

  const cashTotal = (cat) => DENOMS.reduce((s,d)=>s + d*Number(counts[`${cat}|${d}`]||0),0);
  const momoTotal = (cat) => Number(momo[cat]||0);
  const categoryTotal = (cat) => cashTotal(cat)+momoTotal(cat);
  const weekdayCashTotal = (entry) => DENOMS.reduce((s,d)=>s + d*Number(entry.counts?.[String(d)]||0),0);
  const weekdayMomoTotal = (entry) => Number(entry.momo||0);
  const weekdayEntryTotal = (entry) => weekdayCashTotal(entry)+weekdayMomoTotal(entry);
  const weekdayTotal = weekdayEntries.reduce((s,e)=>s+weekdayEntryTotal(e),0);
  const totalCash = STANDARD_CATS.reduce((s,c)=>s+cashTotal(c),0) + weekdayEntries.reduce((s,e)=>s+weekdayCashTotal(e),0);
  const totalMomo = STANDARD_CATS.reduce((s,c)=>s+momoTotal(c),0) + weekdayEntries.reduce((s,e)=>s+weekdayMomoTotal(e),0);
  const grandTotal = totalCash+totalMomo;

  const setQty=(cat,d,v)=>setCounts(x=>({...x,[`${cat}|${d}`]:Math.max(0,Math.floor(Number(v)||0))}));
  const setMomoValue=(cat,v)=>setMomo(x=>({...x,[cat]:v}));
  const updateWeekday=(id,patch)=>setWeekdayEntries(xs=>xs.map(x=>x.id===id?{...x,...patch}:x));
  const setWeekdayQty=(id,d,v)=>setWeekdayEntries(xs=>xs.map(x=>x.id===id?{...x,counts:{...x.counts,[String(d)]:Math.max(0,Math.floor(Number(v)||0))}}:x));
  const addWeekdayCollection=()=>setWeekdayEntries(xs=>[...xs,emptyWeekdayEntry(date)]);
  const removeWeekdayCollection=(id)=>setWeekdayEntries(xs=>xs.filter(x=>x.id!==id));

  const transitionWeekly = (nextStatus, extra={}) => {
    if (!report) return;
    const next = {...report, status:nextStatus, ...extra};
    save('finance_weekly_reports', next); setReport(next); setStatus(nextStatus);
    setMsg(`Week ${weekNo} ${nextStatus.toLowerCase()}.`);
  };

  const saveWeekly = (nextStatus=status, extra={}) => {
    if (report && !['Draft','Reopened','Returned'].includes(report.status)) { setMsg('This report is locked. Only the Pastor can authorise reopening it.'); return; }
    const id=reportId||uuid();
    const row={id,date,week_no:Number(weekNo),year:Number(date.slice(0,4)),month:Number(date.slice(5,7)),status:nextStatus,notes,prepared_by_name:report?.prepared_by_name||profile?.full_name||'',checked_by_name:checkedBy,approved_by_name:nextStatus==='Approved'?(profile?.full_name||'Finance Reviewer'):approvedBy,total_cash:Number(totalCash.toFixed(2)),total_momo:Number(totalMomo.toFixed(2)),grand_total:Number(grandTotal.toFixed(2)),...extra};
    setStatus(nextStatus);
    const stagingRow = {...row, status: (nextStatus === 'Submitted' || nextStatus === 'Approved') ? (report?.status === 'Reopened' ? 'Reopened' : 'Draft') : nextStatus};
    save('finance_weekly_reports',stagingRow); setReportId(id); setReport(row);

    const existingCash=cashRows.filter(x=>x.report_id===id); const existingStandardCash=existingCash.filter(x=>x.category!=='Weekday Offering');
    STANDARD_CATS.forEach(cat=>DENOMS.forEach(d=>{ const qty=Number(counts[`${cat}|${d}`]||0); const old=existingStandardCash.find(x=>x.category===cat && Number(x.denomination)===Number(d)); if(qty>0){const rid=old?.id||uuid();save('finance_weekly_cash_counts',{id:rid,report_id:id,category:cat,denomination:d,quantity:qty});} else if(old) remove('finance_weekly_cash_counts',old.id); }));
    existingCash.filter(x=>x.category==='Weekday Offering').forEach(x=>remove('finance_weekly_cash_counts',x.id));

    const existingMomo=momoRows.filter(x=>x.report_id===id); const existingStandardMomo=existingMomo.filter(x=>x.category!=='Weekday Offering');
    STANDARD_CATS.forEach(cat=>{const amount=Number(momo[cat]||0); const old=existingStandardMomo.find(x=>x.category===cat); if(amount>0){const rid=old?.id||uuid();save('finance_weekly_momo',{id:rid,report_id:id,category:cat,amount:Number(amount.toFixed(2)),reference:refs[cat]||'',provider:provider[cat]||''});} else if(old) remove('finance_weekly_momo',old.id);});
    existingMomo.filter(x=>x.category==='Weekday Offering').forEach(x=>remove('finance_weekly_momo',x.id));

    const existingCollections=weekdayRows.filter(x=>x.report_id===id);
    const currentIds=new Set(weekdayEntries.map(x=>x.id));
    existingCollections.filter(x=>!currentIds.has(x.id)).forEach(x=>remove('finance_weekday_collections',x.id));
    existingCollections.filter(x=>!currentIds.has(x.id)).forEach(x=>weekdayCashRows.filter(y=>y.collection_id===x.id).forEach(y=>remove('finance_weekday_cash_counts',y.id)));
    existingCollections.filter(x=>!currentIds.has(x.id)).forEach(x=>weekdayMomoRows.filter(y=>y.collection_id===x.id).forEach(y=>remove('finance_weekday_momo',y.id)));

    weekdayEntries.forEach(entry=>{
      save('finance_weekday_collections',{id:entry.id,report_id:id,collection_date:entry.collection_date||date,notes:entry.notes||''});
      const oldCash=weekdayCashRows.filter(x=>x.collection_id===entry.id);
      DENOMS.forEach(d=>{const qty=Number(entry.counts?.[String(d)]||0);const old=oldCash.find(x=>Number(x.denomination)===Number(d));if(qty>0){save('finance_weekday_cash_counts',{id:old?.id||uuid(),collection_id:entry.id,denomination:d,quantity:qty});}else if(old)remove('finance_weekday_cash_counts',old.id);});
      const oldMomo=weekdayMomoRows.find(x=>x.collection_id===entry.id); const amount=Number(entry.momo||0);
      if(amount>0){save('finance_weekday_momo',{id:oldMomo?.id||uuid(),collection_id:entry.id,amount:Number(amount.toFixed(2)),provider:entry.provider||'',reference:entry.reference||''});}
      else if(oldMomo) remove('finance_weekday_momo',oldMomo.id);
    });
    if (nextStatus !== stagingRow.status) save('finance_weekly_reports', row);
    setMsg(`Week ${weekNo} ${nextStatus.toLowerCase()}. Total: ${money(grandTotal)}.`);
  };

  const rowsForYear = reports.filter(r=>Number(r.year||String(r.date).slice(0,4))===Number(year));
  const calcForReports = (list) => {
    const out={};
    list.forEach(r=>{
      const cat={}; CATS.forEach(c=>cat[c]=0);
      cashRows.filter(x=>x.report_id===r.id && x.category!=='Weekday Offering').forEach(x=>{cat[x.category]=(cat[x.category]||0)+Number(x.denomination||0)*Number(x.quantity||0);});
      momoRows.filter(x=>x.report_id===r.id && x.category!=='Weekday Offering').forEach(x=>{cat[x.category]=(cat[x.category]||0)+Number(x.amount||0);});
      weekdayRows.filter(x=>x.report_id===r.id).forEach(x=>{
        weekdayCashRows.filter(y=>y.collection_id===x.id).forEach(y=>{cat['Weekday Offering']=(cat['Weekday Offering']||0)+Number(y.denomination||0)*Number(y.quantity||0);});
        weekdayMomoRows.filter(y=>y.collection_id===x.id).forEach(y=>{cat['Weekday Offering']=(cat['Weekday Offering']||0)+Number(y.amount||0);});
      });
      out[r.id]=cat;
    });
    return out;
  };
  const calculated=calcForReports(rowsForYear);
  const monthRows=MONTHS.map((name,i)=>{const rs=rowsForYear.filter(r=>Number(r.month||String(r.date).slice(5,7))===i+1);const vals={};CATS.forEach(c=>vals[c]=rs.reduce((s,r)=>s+Number(calculated[r.id]?.[c]||0),0));return {name,vals,total:CATS.reduce((s,c)=>s+vals[c],0)};});
  const quarterRows=[0,1,2,3].map(q=>{const ms=monthRows.slice(q*3,q*3+3);const vals={};CATS.forEach(c=>vals[c]=ms.reduce((s,m)=>s+m.vals[c],0));return {label:`Q${q+1}`,vals,total:CATS.reduce((s,c)=>s+vals[c],0)};});
  const yearVals={};CATS.forEach(c=>yearVals[c]=monthRows.reduce((s,m)=>s+m.vals[c],0)); const yearTotal=CATS.reduce((s,c)=>s+yearVals[c],0);

  const SummaryTable=({rows,title})=><div className="panel"><h2>{title}</h2><div className="tablewrap"><table><thead><tr><th>Period</th>{CATS.map(c=><th key={c}>{c}</th>)}<th>Total</th></tr></thead><tbody>{rows.map(r=><tr key={r.name||r.label}><td><b>{r.name||r.label}</b></td>{CATS.map(c=><td key={c}>{money(r.vals[c])}</td>)}<td><b>{money(r.total)}</b></td></tr>)}</tbody></table></div></div>;

  const WeekdayCollectionCard=({entry,index})=><div className="weekday-collection-card">
    <div className="weekday-collection-head"><div><h3>Weekday Collection {index+1}</h3><span>Enter the actual collection date. Tuesday, Thursday or any special-program day is allowed.</span></div><div className="weekday-collection-total">{money(weekdayEntryTotal(entry))}</div></div>
    <div className="weekday-meta-grid">
      <div><label>Collection date</label><input type="date" value={entry.collection_date||date} onChange={e=>updateWeekday(entry.id,{collection_date:e.target.value})}/></div>
      <div className="weekday-day-display"><label>Day</label><div>{entry.collection_date?new Date(`${entry.collection_date}T00:00:00`).toLocaleDateString(undefined,{weekday:'long'}): '—'}</div></div>
      <div><label>Notes / program</label><input value={entry.notes||''} onChange={e=>updateWeekday(entry.id,{notes:e.target.value})} placeholder="e.g. Tuesday service / special program"/></div>
    </div>
    <div className="finance-denom-grid weekday-denom-grid">{DENOMS.map(d=><div className="finance-denom weekday-denom" key={d}>
      <div className="finance-denom-name">GH₵ {d.toFixed(d<1?2:0)}</div>
      <input className="finance-qty" aria-label={`Weekday collection GH₵ ${d} quantity`} type="number" min="0" step="1" value={entry.counts?.[String(d)]||''} onChange={e=>setWeekdayQty(entry.id,d,e.target.value)} placeholder="0" />
      <div className="finance-denom-amount weekday-amount">{money(d*Number(entry.counts?.[String(d)]||0))}</div>
    </div>)}</div>
    <div className="finance-cash-total"><span>Cash total</span><b>{money(weekdayCashTotal(entry))}</b></div>
    <div className="finance-momo-grid"><div><label>MoMo amount</label><input className="finance-entry finance-momo-input" type="number" min="0" step="0.01" value={entry.momo||''} onChange={e=>updateWeekday(entry.id,{momo:e.target.value})} placeholder="0.00"/></div><div><label>Provider</label><input className="finance-entry" value={entry.provider||''} onChange={e=>updateWeekday(entry.id,{provider:e.target.value})} placeholder="MTN / Telecel / AT"/></div><div><label>Reference</label><input className="finance-entry" value={entry.reference||''} onChange={e=>updateWeekday(entry.id,{reference:e.target.value})} placeholder="Optional"/></div></div>
    <button type="button" className="weekday-remove" onClick={()=>removeWeekdayCollection(entry.id)}>Remove this collection</button>
  </div>;

  return <>
    <div className="top"><div><h1>Church Finance</h1><div className="muted">Weekly cash-counting workflow based on the church finance workbook. Attendance remains in the Attendance module.</div></div></div>
    <div className="toolbar" style={{marginBottom:12}}><button className={tab==='weekly'?'primary':''} onClick={()=>setTab('weekly')}>Weekly Cash Report</button><button className={tab==='monthly'?'primary':''} onClick={()=>setTab('monthly')}>Monthly</button><button className={tab==='quarterly'?'primary':''} onClick={()=>setTab('quarterly')}>Quarterly</button><button className={tab==='yearly'?'primary':''} onClick={()=>setTab('yearly')}>Yearly</button><button className={tab==='firstfruit'?'primary':''} onClick={()=>setTab('firstfruit')}>First Fruit Register</button><button className={tab==='receipts'?'primary':''} onClick={()=>setTab('receipts')}>Digital Receipts</button></div>
    {tab==='weekly' && <>
      <div className="panel finance-header-panel"><div className="formgrid finance-header-grid"><div><label>Report date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div><div><label>Week number</label><select value={weekNo} onChange={e=>setWeekNo(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>Week {n}</option>)}</select></div><div><label>Workflow status</label><input value={report?.status || 'Draft'} readOnly />{report?.review_reason&&<small className="muted">Reviewer note: {report.review_reason}</small>}{report?.reopen_reason&&<small className="muted"> Reopen reason: {report.reopen_reason}</small>}</div></div></div>
      <fieldset disabled={!canPrepareFinance || (!!report && !['Draft','Reopened','Returned'].includes(report.status))} style={{border:0,padding:0,margin:0,minWidth:0}}><div className="panel finance-header-panel"><div className="formgrid finance-header-grid"><div><label>Checked by</label><input value={checkedBy} onChange={e=>setCheckedBy(e.target.value)} /></div><div><label>Approval recorded by Finance Reviewer</label><input value={approvedBy} onChange={e=>setApprovedBy(e.target.value)} readOnly={!canPrepareFinance} /></div><div><label>Notes</label><input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional notes" /></div></div></div>
      <div className="finance-offering-grid">{STANDARD_CATS.map((cat,catIndex)=><div className={`finance-offering-card finance-offering-${catIndex%4}`} key={cat}>
        <div className="finance-offering-head"><div><h2>{cat}</h2><span>Enter cash quantities below</span></div><strong>{money(categoryTotal(cat))}</strong></div>
        <div className="finance-denom-grid">{DENOMS.map(d=><div className="finance-denom" key={d}>
      <div className="finance-denom-name">GH₵ {d.toFixed(d<1?2:0)}</div>
      <input className="finance-qty" aria-label={`${cat} GH₵ ${d} quantity`} type="number" min="0" step="1" value={counts[`${cat}|${d}`]||''} onChange={e=>setQty(cat,d,e.target.value)} placeholder="0" />
          <div className="finance-denom-amount">{money(d*Number(counts[`${cat}|${d}`]||0))}</div>
        </div>)}</div>
        <div className="finance-cash-total"><span>Cash total</span><b>{money(cashTotal(cat))}</b></div>
        <div className="finance-momo-grid"><div><label>MoMo amount</label><input className="finance-entry finance-momo-input" type="number" min="0" step="0.01" value={momo[cat]||''} onChange={e=>setMomoValue(cat,e.target.value)} placeholder="0.00" /></div><div><label>Provider</label><input className="finance-entry" value={provider[cat]||''} onChange={e=>setProvider(x=>({...x,[cat]:e.target.value}))} placeholder="MTN / Telecel / AT" /></div><div><label>Reference</label><input className="finance-entry" value={refs[cat]||''} onChange={e=>setRefs(x=>({...x,[cat]:e.target.value}))} placeholder="Optional" /></div></div>
      </div>)}</div>

      <div className="weekday-section">
        <div className="weekday-section-head"><div><h2>Weekday Offering Collections</h2><p>Record each Tuesday, Thursday, or special-program collection separately. Add as many collection days as actually occurred during this week.</p></div><button type="button" className="primary" onClick={addWeekdayCollection}>+ Add Collection</button></div>
        {!weekdayEntries.length && <div className="weekday-empty">No weekday collection added yet. Use <b>+ Add Collection</b> when a weekday offering was collected.</div>}
        {weekdayEntries.map((entry,index)=><WeekdayCollectionCard entry={entry} index={index} key={entry.id}/>) }
        {weekdayEntries.length>0 && <div className="weekday-grand-total"><span>Weekday Offering Total</span><b>{money(weekdayTotal)}</b></div>}
      </div>

      <div className="cards"><div className="card"><div className="label">Total cash</div><div className="num">{money(totalCash)}</div></div><div className="card"><div className="label">Total MoMo</div><div className="num">{money(totalMomo)}</div></div><div className="card"><div className="label">Weekly total</div><div className="num" style={{fontSize:22}}>{money(grandTotal)}</div></div></div>
      </fieldset><div className="toolbar">{canPrepareFinance && (!report || ['Draft','Reopened','Returned'].includes(report.status)) && <><button className="secondary" onClick={()=>saveWeekly('Draft')}>Save Draft</button><button className="primary" onClick={()=>saveWeekly('Submitted',{review_reason:null})}>Submit for review</button></>}{canReviewFinance && report?.status==='Submitted' && <><button className="primary" onClick={()=>transitionWeekly('Approved',{approved_by_name:profile?.full_name||'Finance Reviewer',approved_at:new Date().toISOString(),reviewed_by_name:profile?.full_name||'Finance Reviewer',reviewed_at:new Date().toISOString(),review_reason:null})}>Approve &amp; Lock</button><button className="secondary" onClick={()=>{const reason=window.prompt('Explain what must be corrected before resubmission:');if(reason&&reason.trim())transitionWeekly('Returned',{review_reason:reason.trim(),reviewed_by_name:profile?.full_name||'Finance Reviewer',reviewed_at:new Date().toISOString()});}}>Return for correction</button><button className="secondary" onClick={()=>{const reason=window.prompt('Reason for rejecting this report:');if(reason&&reason.trim())transitionWeekly('Rejected',{review_reason:reason.trim(),reviewed_by_name:profile?.full_name||'Finance Reviewer',reviewed_at:new Date().toISOString()});}}>Reject</button></>}{role==='pastor' && ['Approved','Rejected'].includes(report?.status) && <button className="secondary" onClick={()=>{const reason=window.prompt('Why must this locked report be reopened?');if(reason&&reason.trim())transitionWeekly('Reopened',{reopen_reason:reason.trim(),reopened_by_name:profile?.full_name||'Pastor',reopened_at:new Date().toISOString()});}}>Authorise Reopening</button>}{msg&&<span className="muted">{msg}</span>}</div>
    </>}
    {tab==='monthly' && <><div className="panel"><div className="fld"><small>Year</small><input type="number" value={year} onChange={e=>setYear(Number(e.target.value)||year)} /></div></div><SummaryTable rows={monthRows} title={`Monthly Finance Summary · ${year}`} /></>}
    {tab==='quarterly' && <><div className="panel"><div className="fld"><small>Year</small><input type="number" value={year} onChange={e=>setYear(Number(e.target.value)||year)} /></div></div><SummaryTable rows={quarterRows} title={`Quarterly Finance Summary · ${year}`} /></>}
    {tab==='yearly' && <><div className="panel"><div className="fld"><small>Year</small><input type="number" value={year} onChange={e=>setYear(Number(e.target.value)||year)} /></div></div><SummaryTable rows={[{name:String(year),vals:yearVals,total:yearTotal}]} title={`Yearly Finance Report · ${year}`} /><div className="cards"><div className="card"><div className="label">Year total</div><div className="num" style={{fontSize:22}}>{money(yearTotal)}</div></div><div className="card"><div className="label">Monthly average</div><div className="num" style={{fontSize:22}}>{money(yearTotal/12)}</div></div></div></>}
    {tab==='firstfruit' && <FirstFruit />}
    {tab==='receipts' && <MemberGiving />}
  </>;
}


/* ---------------- Church Expenditure ---------------- */
export function Expenditure() {
  const { hasPermission } = useAuth();
  if (!hasPermission('expenditure.view')) {
    return (
      <div className="panel">
        <h2>Expenditure</h2>
        <p className="muted">You do not have permission to view Expenditure. Ask a Super Admin to enable it under Role Permissions.</p>
      </div>
    );
  }
  return <ExpenditureScreen />;
}

function ExpenditureScreen() {
  const { data, save, remove } = useData();
  const { hasPermission, role, profile } = useAuth();

  const canWrite = hasPermission('expenditure.manage') && role !== 'pastor' && !hasPermission('finance_reviewer.approve');
  const canReviewFinance = hasPermission('finance_reviewer.approve');
  const isPastor = role === 'pastor';

  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Other');
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [pvNo, setPvNo] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const rows = useMemo(() => {
    const q = String(search || '').trim().toLowerCase();

    return [...(data.expenditures || [])]
      .filter(r => {
        if (!q) return true;
        return [
          r.description,
          r.category,
          r.payee,
          r.pv_no,
          r.payment_reference,
          r.payment_method,
          r.notes
        ].some(v => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const d = String(b.date || '').localeCompare(String(a.date || ''));
        if (d !== 0) return d;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
  }, [data.expenditures, search]);

  const displayedTotal = rows.reduce(
    (sum, r) => sum + Number(r.amount || 0),
    0
  );

  function resetForm() {
    setDate(today());
    setDescription('');
    setCategory('Other');
    setAmount('');
    setPayee('');
    setPvNo('');
    setPaymentReference('');
    setPaymentMethod('Cash');
    setNotes('');
    setEditingId('');
  }

  function editRow(row) {
    if (!['Draft','Reopened','Returned',undefined,null,''].includes(row.status)) { setStatus('This expenditure is locked. Only the Pastor can authorise reopening it.'); return; }
    setEditingId(row.id);
    setDate(String(row.date || '').slice(0, 10) || today());
    setDescription(row.description || '');
    setCategory(row.category || 'Other');
    setAmount(row.amount ?? '');
    setPayee(row.payee || '');
    setPvNo(row.pv_no || '');
    setPaymentReference(row.payment_reference || '');
    setPaymentMethod(row.payment_method || 'Cash');
    setNotes(row.notes || '');
    setStatus('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function saveExpenditure() {
    const value = Number(amount);

    if (!date || !description.trim()) {
      setStatus('Enter the date and expenditure description.');
      return;
    }

    if (!Number.isFinite(value) || value <= 0) {
      setStatus('Enter a valid expenditure amount greater than zero.');
      return;
    }

    const existingExpense = (data.expenditures || []).find(r => r.id === editingId);
    if (existingExpense && !['Draft','Reopened','Returned',undefined,null,''].includes(existingExpense.status)) { setStatus('This expenditure is locked.'); return; }
    save('expenditures', {
      id: editingId || uuid(),
      status: existingExpense?.status || 'Draft',
      date,
      description: description.trim(),
      category: category || 'Other',
      amount: Number(value.toFixed(2)),
      payee: payee.trim(),
      pv_no: pvNo.trim(),
      payment_reference: paymentReference.trim(),
      payment_method: paymentMethod || 'Cash',
      notes: notes.trim()
    });

    setStatus(editingId ? 'Expenditure updated.' : 'Expenditure recorded.');
    resetForm();
  }

  function changeExpenditureStatus(row, nextStatus, extra={}) {
    if (nextStatus === 'Reopened' && !isPastor) return;
    if (['Approved','Returned','Rejected'].includes(nextStatus) && !canReviewFinance) return;
    if (['Returned','Rejected'].includes(nextStatus) && !String(extra.review_reason||'').trim()) { setStatus('A reason is required to return or reject a record.'); return; }
    if (nextStatus === 'Submitted' && !canWrite) return;
    save('expenditures', {...row, status:nextStatus, ...(nextStatus==='Submitted'?{review_reason:null,reviewed_by_name:null,reviewed_at:null}:{}), ...(nextStatus==='Approved'?{approved_by_name:profile?.full_name||'Finance Reviewer',approved_at:new Date().toISOString(),reviewed_by_name:profile?.full_name||'Finance Reviewer',reviewed_at:new Date().toISOString()}:{}), ...extra});
    setStatus(`Expenditure ${nextStatus.toLowerCase()}.`);
  }

  function deleteExpenditure(row) {
    if (!canWrite || !['Draft','Reopened','Returned',undefined,null,''].includes(row.status)) { setStatus('Only draft records can be deleted. Approved financial records must be corrected transparently.'); return; }

    if (!window.confirm(
      `Delete this expenditure of ${money(Number(row.amount || 0))}?`
    )) return;

    remove('expenditures', row.id);
    if (editingId === row.id) resetForm();
    setStatus('Expenditure deleted.');
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Expenditure</h1>
          <div className="muted">
            Record Church expenditure payments. These records will later feed the Church Cashbook as payments.
          </div>
        </div>
      </div>

      {canWrite && (
        <div className="panel">
          <div className="toolbar">
            <div>
              <h2>{editingId ? 'Edit Expenditure' : 'Record Expenditure'}</h2>
              <div className="muted">
                Welfare transactions are not included here.
              </div>
            </div>
          </div>

          <div className="formgrid">
            <div>
              <label>Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>

            <div>
              <label>Amount (GHS)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div>
              <label>Description</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What was the church payment for?"
              />
            </div>

            <div>
              <label>Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                <option>Utilities</option>
                <option>Maintenance</option>
                <option>Transport</option>
                <option>Stationery</option>
                <option>Church Program</option>
                <option>Equipment</option>
                <option>Staff / Ministerial</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <label>Payee</label>
              <input
                value={payee}
                onChange={e => setPayee(e.target.value)}
                placeholder="Person or supplier paid"
              />
            </div>

            <div>
              <label>PV No.</label>
              <input
                value={pvNo}
                onChange={e => setPvNo(e.target.value)}
                placeholder="Payment voucher number"
              />
            </div>

            <div>
              <label>Cheque / Payment Reference</label>
              <input
                value={paymentReference}
                onChange={e => setPaymentReference(e.target.value)}
                placeholder="Cheque no. / transfer reference"
              />
            </div>

            <div>
              <label>Payment Method</label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
              >
                <option>Cash</option>
                <option>Mobile Money</option>
                <option>Bank Transfer</option>
                <option>Cheque</option>
                <option>Other</option>
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label>Notes</label>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional note"
              />
            </div>
          </div>

          {status && (
            <div className="muted" style={{ marginTop: 10 }}>
              {status}
            </div>
          )}

          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="primary" onClick={saveExpenditure}>
              {editingId ? 'Update Expenditure' : 'Save Expenditure'}
            </button>

            {editingId && (
              <button className="secondary" onClick={resetForm}>
                Cancel Edit
              </button>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="toolbar">
          <div>
            <h2>Church Expenditure</h2>
            <div className="muted">
              Displayed total: <b>{money(displayedTotal)}</b>
            </div>
          </div>

          <div className="fld">
            <small>Search</small>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Description, payee, PV..."
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="muted">No expenditure records found.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Payee</th>
                  <th>PV No.</th>
                  <th>Payment Ref.</th>
                  <th>Method</th>
                  <th>Payment</th>
                  <th>Status</th>
                  {(canWrite || isPastor || canReviewFinance) && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td>{String(row.date || '').slice(0, 10)}</td>
                    <td>{row.description}</td>
                    <td>{row.category || 'Other'}</td>
                    <td>{row.payee || '—'}</td>
                    <td>{row.pv_no || '—'}</td>
                    <td>{row.payment_reference || '—'}</td>
                    <td>{row.payment_method || '—'}</td>
                    <td><b>{money(Number(row.amount || 0))}</b></td>
                    <td>{row.status || 'Draft'}{row.review_reason&&<div className="muted sm">Review note: {row.review_reason}</div>}</td>
                    {(canWrite || isPastor || canReviewFinance) && (
                      <td>
                        {canWrite && (!row.status || ['Draft','Reopened','Returned'].includes(row.status)) && <><button className="secondary" onClick={() => editRow(row)}>Edit</button>{' '}<button className="secondary" onClick={() => deleteExpenditure(row)}>Delete</button>{' '}<button className="primary" onClick={() => changeExpenditureStatus(row,'Submitted',{review_reason:null,reviewed_by_name:null,reviewed_at:null})}>Submit</button></>}{row.status==='Submitted' && <span className="muted">Awaiting Finance Reviewer</span>}{canReviewFinance && row.status==='Submitted' && <><button className="primary" onClick={() => changeExpenditureStatus(row,'Approved')}>Approve &amp; Lock</button>{' '}<button className="secondary" onClick={() => {const reason=window.prompt('Explain what must be corrected:');if(reason&&reason.trim())changeExpenditureStatus(row,'Returned',{review_reason:reason.trim(),reviewed_by_name:profile?.full_name||'Finance Reviewer',reviewed_at:new Date().toISOString()});}}>Return</button>{' '}<button className="secondary" onClick={() => {const reason=window.prompt('Reason for rejection:');if(reason&&reason.trim())changeExpenditureStatus(row,'Rejected',{review_reason:reason.trim(),reviewed_by_name:profile?.full_name||'Finance Reviewer',reviewed_at:new Date().toISOString()});}}>Reject</button></>}{isPastor && ['Approved','Rejected'].includes(row.status) && <button className="secondary" onClick={() => {const reason=window.prompt('Why must this locked expenditure be reopened?');if(reason&&reason.trim())changeExpenditureStatus(row,'Reopened',{reopen_reason:reason.trim(),reopened_by_name:profile?.full_name||'Pastor',reopened_at:new Date().toISOString()});}}>Authorise Reopening</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}


/* ---------------- Church Cashbook ---------------- */
export function Cashbook() {
  const { data, save, remove } = useData();
  const { role } = useAuth();
  const canWrite = ['admin','finance','secretary'].includes(role) || isSuperAdmin(role);
  const canDelete = role === 'admin' || isSuperAdmin(role);

  const [type, setType] = useState('Receipt');
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [pvNo, setPvNo] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState('');
  const [openingYear, setOpeningYear] = useState(String(new Date().getFullYear()));

  // Every entry from every source, in date order, each with the balance after it.
  const ledger = useMemo(() => {
    const manualRows = [...(data.cashbook_entries || [])];

    const reports = data.finance_weekly_reports || [];
    const cashRows = data.finance_weekly_cash_counts || [];
    const momoRows = data.finance_weekly_momo || [];
    const weekdayRows = data.finance_weekday_collections || [];
    const weekdayCashRows = data.finance_weekday_cash_counts || [];
    const weekdayMomoRows = data.finance_weekday_momo || [];

    // One receipt per weekly Finance Center report, dated on the report date (Sunday).
    // Weekday collections are included in this total, not shown as separate receipts.
    const financeRows = reports.map(r => {
      const weeklyCash = cashRows
        .filter(x => x.report_id === r.id && x.category !== 'Weekday Offering')
        .reduce((sum, x) => sum + Number(x.denomination || 0) * Number(x.quantity || 0), 0);

      const weeklyMomo = momoRows
        .filter(x => x.report_id === r.id && x.category !== 'Weekday Offering')
        .reduce((sum, x) => sum + Number(x.amount || 0), 0);

      const weekdayTotal = weekdayRows
        .filter(x => x.report_id === r.id)
        .reduce((sum, x) => {
          const weekdayCash = weekdayCashRows
            .filter(y => y.collection_id === x.id)
            .reduce((s, y) => s + Number(y.denomination || 0) * Number(y.quantity || 0), 0);

          const weekdayMomo = weekdayMomoRows
            .filter(y => y.collection_id === x.id)
            .reduce((s, y) => s + Number(y.amount || 0), 0);

          return sum + weekdayCash + weekdayMomo;
        }, 0);

      return {
        id: `finance-weekly-${r.id}`,
        entry_date: String(r.date || '').slice(0, 10),
        entry_type: 'Receipt',
        description: 'Weekly collections (including weekday collections)',
        amount: Number((weeklyCash + weeklyMomo + weekdayTotal).toFixed(2)),
        payee: '',
        pv_no: '',
        receipt_no: '',
        cheque_no: '',
        source_type: 'Finance Center',
        source_id: r.id,
        created_at: r.created_at || ''
      };
    }).filter(r => r.entry_date && r.amount > 0);

    const expenditureRows = [...(data.expenditures || [])].map(r => ({
      id: `expenditure-${r.id}`,
      entry_date: String(r.date || '').slice(0, 10),
      entry_type: 'Payment',
      description: r.description || r.category || 'Expenditure',
      amount: Number(r.amount || 0),
      payee: r.payee || '',
      pv_no: r.pv_no || '',
      receipt_no: '',
      cheque_no: '',
      source_type: 'Expenditure',
      source_id: r.id,
      created_at: r.created_at || ''
    }));

    const rank = (r) => (r.entry_type === 'Opening' ? 0 : 1);
    const sorted = [...manualRows, ...financeRows, ...expenditureRows].sort((a,b) =>
      String(a.entry_date || '').localeCompare(String(b.entry_date || '')) ||
      rank(a) - rank(b) ||
      String(a.created_at || '').localeCompare(String(b.created_at || ''))
    );

    // An Opening entry states the balance on that date, so it re-bases the running total.
    // This stops a year's carried-forward balance being counted twice.
    let bal = 0;
    return sorted.map(r => {
      const amt = Number(r.amount || 0);
      bal = r.entry_type === 'Opening' ? amt : r.entry_type === 'Receipt' ? bal + amt : bal - amt;
      bal = Number(bal.toFixed(2));
      return { ...r, balance: bal };
    });
  }, [
    data.cashbook_entries,
    data.finance_weekly_reports,
    data.finance_weekly_cash_counts,
    data.finance_weekly_momo,
    data.finance_weekday_collections,
    data.finance_weekday_cash_counts,
    data.finance_weekday_momo,
    data.expenditures
  ]);

  // The date range decides the totals. The search box only narrows the list, never the balance.
  const inRange = useMemo(() => ledger
    .filter(r => !fromDate || String(r.entry_date || '') >= fromDate)
    .filter(r => !toDate || String(r.entry_date || '') <= toDate), [ledger, fromDate, toDate]);

  const broughtForward = useMemo(() => {
    if (!fromDate) return 0;
    const before = ledger.filter(r => String(r.entry_date || '') < fromDate);
    return before.length ? before[before.length - 1].balance : 0;
  }, [ledger, fromDate]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inRange;
    return inRange.filter(r =>
      [r.description, r.payee, r.pv_no, r.receipt_no, r.cheque_no, r.source_type]
        .some(v => String(v || '').toLowerCase().includes(q))
    );
  }, [inRange, search]);

  const receipts = Number(inRange.filter(r => r.entry_type === 'Receipt').reduce((s,r) => s + Number(r.amount || 0), 0).toFixed(2));
  const payments = Number(inRange.filter(r => r.entry_type === 'Payment').reduce((s,r) => s + Number(r.amount || 0), 0).toFixed(2));
  const balance = inRange.length ? inRange[inRange.length - 1].balance : broughtForward;
  const opening = Number((balance - receipts + payments).toFixed(2));

  function addEntry(e) {
    e.preventDefault();

    const year = String(openingYear || '').trim();
    const n = Number(amount);

    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 9999) {
      setStatus('Enter a valid four-digit year.');
      return;
    }

    if (String(amount).trim() === '' || !Number.isFinite(n) || n < 0) {
      setStatus('Enter an opening balance of zero or more.');
      return;
    }

    const existing = (data.cashbook_entries || []).find(x =>
      x.entry_type === 'Opening' &&
      String(x.entry_date || '').slice(0, 4) === year
    );

    save('cashbook_entries', {
      ...(existing || {}),
      id: existing ? existing.id : uuid(),
      entry_date: `${year}-01-01`,
      entry_type: 'Opening',
      description: `Opening Balance ${year}`,
      amount: Number(n.toFixed(2)),
      payee: '',
      pv_no: '',
      receipt_no: '',
      source_type: 'manual'
    });

    setStatus(`Opening Balance for ${year} saved.`);
    setAmount('');
  }
  if (!canWrite && role !== 'viewer') {
    return (
      <div className="panel">
        <h2>Church Cashbook</h2>
        <p className="muted">
          You do not have permission to access the Cashbook.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Church Cashbook</h1>
          <div className="muted">
            Record and review church cash receipts and payments.
            Finance Center weekly collections feed receipts, including weekday collections under the Sunday date. Expenditure feeds payments automatically.
          </div>
        </div>
      </div>

      <div className="cards">
        <div className="card">
          <div className="label">Opening</div>
          <div className="num" style={{fontSize:22}}>{money(opening)}</div>
        </div>

        <div className="card">
          <div className="label">Receipts</div>
          <div className="num" style={{fontSize:22}}>{money(receipts)}</div>
        </div>

        <div className="card">
          <div className="label">Payments</div>
          <div className="num" style={{fontSize:22}}>{money(payments)}</div>
        </div>

        <div className="card">
          <div className="label">Balance</div>
          <div className="num" style={{fontSize:22}}>{money(balance)}</div>
        </div>
      </div>

      {canWrite && (
        <div className="panel">
          <h2>Set Opening Balance</h2>
          <p className="muted">Enter the cash balance on 1 January of a year. It replaces the balance carried forward from earlier years, so it is never counted twice. Saving again for the same year updates it.</p>
          <form onSubmit={addEntry}>
            <div className="grid2">
              <label>
                Year
                <input
                  type="number"
                  min="1900"
                  max="9999"
                  step="1"
                  required
                  value={openingYear}
                  onChange={e => setOpeningYear(e.target.value)}
                />
              </label>
              <label>
                Opening Balance (GH₵)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </label>
            </div>
            <div className="toolbar">
              <button className="primary" type="submit">Save Opening Balance</button>
            </div>
            {status && (
              <div className="success" style={{marginTop:8}}>
                {status}
              </div>
            )}
          </form>
        </div>
      )}

      <div className="panel">
        <div className="top">
          <div>
            <h2>Cashbook Entries</h2>
            <div className="muted">
              Opening + receipts − payments = balance. The cards follow the From / To dates; search only narrows the list.
            </div>
          </div>

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search description, payee, PV..."
          />
        </div>

        <div className="toolbar">
          <label>
            From
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
            />
          </label>

          <label>
            To
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              setFromDate('');
              setToDate('');
              setSearch('');
            }}
          >
            Clear Filters
          </button>
        </div>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Payee</th>
                <th>PV / Receipt</th>
                <th>Receipt</th>
                <th>Payment</th>
                <th>Balance</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {fromDate && !search.trim() && (
                <tr>
                  <td>{fromDate}</td>
                  <td colSpan="4"><b>Balance brought forward</b></td>
                  <td></td>
                  <td><b>{money(broughtForward)}</b></td>
                  <td></td>
                </tr>
              )}

              {rows.map(r => {
                return (
                  <tr key={r.id}>
                    <td>{r.entry_date}</td>

                    <td>
                      <b>{r.description}</b>

                      {r.source_type !== 'manual' && (
                        <>
                          <br />
                          <small className="muted">
                            Linked {r.source_type}
                          </small>
                        </>
                      )}
                    </td>

                    <td>{r.payee || ''}</td>

                    <td>{r.pv_no || r.receipt_no || ''}</td>

                    <td>
                      {r.entry_type === 'Receipt' ||
                      r.entry_type === 'Opening'
                        ? money(r.amount)
                        : ''}
                    </td>

                    <td>
                      {r.entry_type === 'Payment'
                        ? money(r.amount)
                        : ''}
                    </td>

                    <td>
                      <b>{money(r.balance)}</b>
                    </td>

                    <td>
                      {canDelete && r.source_type === 'manual' && (
                        <button
                          className="danger"
                          onClick={() =>
                            remove('cashbook_entries', r.id)
                          }
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!rows.length && (
                <tr>
                  <td colSpan="8" className="empty">
                    No Cashbook entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}


export function CommunicationCenter() {
  const { data } = useData();
  const { role } = useAuth();
  if (!['admin','secretary'].includes(role) && !isSuperAdmin(role)) return <div className="panel"><h2>Communication Center</h2><p className="muted">Only administrators and secretaries have access.</p></div>;
  const active = data.members.filter(m=>m.status==='Active' && m.phone).length;
  const announcements = [...data.announcements].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,8);
  return <>
    <div className="top"><div><h1>Communication Center</h1><div className="muted">Manage church announcements and prepare targeted member communication.</div></div></div>
    <div className="cards"><div className="card"><div className="label">Active members with phone</div><div className="num">{active}</div></div><div className="card"><div className="label">Announcements</div><div className="num">{data.announcements.length}</div></div></div>
    <Crud table="announcements" title="Church Announcements" noun="announcement" sortKey="created_at" sortDir="desc" searchKeys={['title','body','audience']} defaults={{audience:'All Members',active:true}}
      filters={[{key:'active',label:'All statuses',options:['true','false']} ,{key:'audience',label:'All audiences',options:['All Members','Youth','Children','Men','Women','Department','House Fellowship']} ]}
      fields={[{key:'title',label:'Title',required:true},{key:'body',label:'Message',type:'textarea',required:true,full:true},{key:'audience',label:'Audience',type:'select',options:['All Members','Youth','Children','Men','Women','Department','House Fellowship']},{key:'publish_from',label:'Publish from',type:'date'},{key:'publish_until',label:'Publish until',type:'date'},{key:'active',label:'Published / active',type:'checkbox'}]}
      columns={[{label:'Title',key:'title'},{label:'Announcement content',key:'body'},{label:'Audience',key:'audience'},{label:'Publish from',key:'publish_from'},{label:'Status',render:a=>badge(a.active===false?'Inactive':'Active')}]}
    />
    <div className="panel"><h2>Latest announcements</h2>{announcements.length?announcements.map(a=><p key={a.id}><b>{a.title}</b><br/><span>{a.body || 'No message content'}</span><br/><span className="muted">{a.audience} · {a.active===false?'Inactive':'Published'}</span></p>):<div className="empty">No announcements yet.</div>}</div>
  </>;
}

export function PastorDashboard({ onNavigate }) {
  const { role } = useAuth();
  if (!['admin','secretary','viewer','pastor'].includes(role) && !isSuperAdmin(role)) return <div className="panel"><h2>Pastoral Dashboard</h2><p className="muted">This dashboard is restricted to church leadership.</p></div>;
  return <PastorDashboardScreen onNavigate={onNavigate} />;
}

function PastorDashboardScreen({ onNavigate }) {
  const { data, save } = useData();
  const { role, profile } = useAuth();
  const canCase = can(role, 'pastoral_cases', 'write') || role === 'pastor' || isSuperAdmin(role);
  const canFollow = can(role, 'follow_ups', 'write') || role === 'pastor' || isSuperAdmin(role);
  const [panel, setPanel] = useState(null); // 'case' | 'followup' | 'prayers' | null
  const [msg, setMsg] = useState('');
  const [caseForm, setCaseForm] = useState({ opened_date: today(), member_id: '', person_name: '', category: 'Counselling', assigned_to: '', priority: 'Normal', status: 'Open', next_follow_up: '', private_notes: '' });
  const [followForm, setFollowForm] = useState({ date: today(), member_id: '', person_name: '', phone: '', category: 'Member', reason: '', assigned_to: '', method: 'Phone', status: 'Open', notes: '' });
  const [memberQ, setMemberQ] = useState('');


  const pastoralCases = data.pastoral_cases || [];
  const followUps = data.follow_ups || [];
  const prayerRequests = data.prayer_requests || [];
  const visitorsList = data.visitors || [];
  const membersList = data.members || [];
  const attendanceList = data.attendance || [];
  const openCases = pastoralCases.filter(x => !['Closed','Resolved'].includes(x.status)).length;
  const openFollow = followUps.filter(x => ['Open','In Progress'].includes(x.status)).length;
  const prayers = prayerRequests.filter(x => !['Answered','Closed','Praying'].includes(x.status) || ['New','Assigned','Praying','Open'].includes(x.status)).length;
  const openPrayers = prayerRequests.filter(x => !['Answered','Closed'].includes(x.status));
  const visitors = visitorsList.filter(x => String(x.visit_date || '').slice(0, 7) === today().slice(0, 7)).length;
  const active = membersList.filter(x => x.status === 'Active').length;
  const financeReports = data.finance_weekly_reports || [];
  const financeExpenses = data.expenditures || [];
  const pendingFinance = financeReports.filter(x => x.status === 'Submitted').length + financeExpenses.filter(x => x.status === 'Submitted').length;
  const lockedIncome = financeReports.filter(x => x.status === 'Approved').reduce((sum, x) => sum + Number(x.grand_total || 0), 0);
  const lockedExpense = financeExpenses.filter(x => x.status === 'Approved').reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const lastDates = [...new Set(attendanceList.map(a => a.date))].sort().reverse().slice(0, 6);
  const trend = lastDates.map(d => ({ date: d, present: attendanceList.filter(a => a.date === d && a.status === 'Present').length }));

  const memberMatches = useMemo(() => {
    const q = memberQ.trim().toLowerCase();
    if (!q) return membersList.filter(m => m.status === 'Active').slice(0, 8);
    return membersList.filter(m =>
      String(m.name || '').toLowerCase().includes(q) ||
      String(m.member_code || '').toLowerCase().includes(q) ||
      String(m.phone || '').includes(q)
    ).slice(0, 12);
  }, [membersList, memberQ]);

  const pickMember = (m, kind) => {
    setMemberQ(m.name || '');
    if (kind === 'case') setCaseForm(f => ({ ...f, member_id: m.id, person_name: m.name || '' }));
    else setFollowForm(f => ({ ...f, member_id: m.id, person_name: m.name || '', phone: m.phone || f.phone }));
  };

  const submitCase = (e) => {
    e.preventDefault();
    if (!caseForm.person_name.trim() || !caseForm.category) { setMsg('Member and category are required.'); return; }
    save('pastoral_cases', {
      id: uuid(),
      opened_date: caseForm.opened_date || today(),
      member_id: caseForm.member_id || null,
      person_name: caseForm.person_name.trim(),
      category: caseForm.category,
      assigned_to: caseForm.assigned_to.trim() || (profile?.full_name || ''),
      priority: caseForm.priority || 'Normal',
      status: caseForm.status || 'Open',
      next_follow_up: caseForm.next_follow_up || null,
      private_notes: caseForm.private_notes || '',
    });
    setMsg('Pastoral case saved.');
    setPanel(null);
    setCaseForm({ opened_date: today(), member_id: '', person_name: '', category: 'Counselling', assigned_to: '', priority: 'Normal', status: 'Open', next_follow_up: '', private_notes: '' });
    setMemberQ('');
  };

  const submitFollow = (e) => {
    e.preventDefault();
    if (!followForm.person_name.trim() || !followForm.reason.trim()) { setMsg('Member and reason are required.'); return; }
    save('follow_ups', {
      id: uuid(),
      date: followForm.date || today(),
      member_id: followForm.member_id || null,
      person_name: followForm.person_name.trim(),
      phone: followForm.phone || '',
      category: followForm.category || 'Member',
      reason: followForm.reason.trim(),
      assigned_to: followForm.assigned_to.trim() || (profile?.full_name || ''),
      method: followForm.method || 'Phone',
      status: followForm.status || 'Open',
      notes: followForm.notes || '',
    });
    setMsg('Follow-up saved.');
    setPanel(null);
    setFollowForm({ date: today(), member_id: '', person_name: '', phone: '', category: 'Member', reason: '', assigned_to: '', method: 'Phone', status: 'Open', notes: '' });
    setMemberQ('');
  };

  const openPanel = (name) => {
    setMsg('');
    setMemberQ('');
    setPanel(name);
  };

  return <>
    <div className="top">
      <div>
        <h1>Pastoral Dashboard</h1>
        <div className="muted">A leadership view of people, care and engagement. Quick actions stay on this page.</div>
      </div>
      <div className="toolbar">
        {canCase && <button className="primary" type="button" onClick={() => openPanel('case')}>+ Add pastoral case</button>}
        {canFollow && <button className="secondary" type="button" onClick={() => openPanel('followup')}>+ Add follow-up</button>}
        <button className="secondary" type="button" onClick={() => openPanel('prayers')}>View prayer requests</button>
      </div>
    </div>
    {msg && <div className="panel" style={{ borderColor: '#c6f6d5', background: '#f0fff4' }}><p className="muted" style={{ margin: 0 }}>{msg}</p></div>}

    {panel === 'case' && canCase && (
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pastor-case-title" onClick={(e) => { if (e.target === e.currentTarget) setPanel(null); }}>
        <div className="modalbox pastor-modal">
          <div className="modalhead">
            <div>
              <h2 id="pastor-case-title">New pastoral case</h2>
              <p className="muted sm" style={{ margin: '4px 0 0' }}>Record care details. Confidential notes stay with pastoral staff.</p>
            </div>
            <button type="button" className="secondary pastor-close-btn" onClick={() => setPanel(null)} aria-label="Close">✕ Close</button>
          </div>
          <form onSubmit={submitCase}>
            <div className="formgrid pastor-form-grid">
              <div><label>Opened date</label><input type="date" value={caseForm.opened_date} onChange={e => setCaseForm(f => ({ ...f, opened_date: e.target.value }))} required /></div>
              <div><label>Priority</label><select value={caseForm.priority} onChange={e => setCaseForm(f => ({ ...f, priority: e.target.value }))}>{['Low','Normal','High','Urgent'].map(o => <option key={o}>{o}</option>)}</select></div>
              <div className="full"><label>Member</label>
                <input value={memberQ} onChange={e => { setMemberQ(e.target.value); setCaseForm(f => ({ ...f, person_name: e.target.value, member_id: '' })); }} placeholder="Search by name, member ID or phone…" required autoComplete="off" />
                {memberQ && <div className="pastor-member-hits">{memberMatches.map(m => (
                  <button type="button" key={m.id} className={'pastor-member-hit' + (caseForm.member_id === m.id ? ' selected' : '')} onClick={() => pickMember(m, 'case')}>
                    <strong>{m.name}</strong>
                    <span>{[m.member_code, m.phone].filter(Boolean).join(' · ') || 'No ID / phone'}</span>
                  </button>
                ))}{!memberMatches.length && <div className="muted sm">No matching members — the name you typed will still be saved.</div>}</div>}
                {caseForm.member_id && <div className="muted sm" style={{ marginTop: 6 }}>Linked member selected.</div>}
              </div>
              <div><label>Category</label><select value={caseForm.category} onChange={e => setCaseForm(f => ({ ...f, category: e.target.value }))}>{['Counselling','Prayer / Spiritual Support','Hospital / Illness','Bereavement','Marriage / Family','Financial / Welfare','Crisis / Emergency','New Member Follow-up','Other'].map(o => <option key={o}>{o}</option>)}</select></div>
              <div><label>Status</label><select value={caseForm.status} onChange={e => setCaseForm(f => ({ ...f, status: e.target.value }))}>{['Open','In Progress','Resolved','Closed'].map(o => <option key={o}>{o}</option>)}</select></div>
              <div><label>Assigned to</label><input value={caseForm.assigned_to} onChange={e => setCaseForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="Pastor or care leader" /></div>
              <div><label>Next follow-up</label><input type="date" value={caseForm.next_follow_up} onChange={e => setCaseForm(f => ({ ...f, next_follow_up: e.target.value }))} /></div>
              <div className="full"><label>Confidential notes</label><textarea rows={4} value={caseForm.private_notes} onChange={e => setCaseForm(f => ({ ...f, private_notes: e.target.value }))} placeholder="Private pastoral notes…" /></div>
            </div>
            <div className="pastor-form-actions">
              <button type="button" className="secondary" onClick={() => setPanel(null)}>Close</button>
              <button className="primary" type="submit">Save pastoral case</button>
            </div>
          </form>
        </div>
      </div>
    )}

    {panel === 'followup' && canFollow && (
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pastor-follow-title" onClick={(e) => { if (e.target === e.currentTarget) setPanel(null); }}>
        <div className="modalbox pastor-modal">
          <div className="modalhead">
            <div>
              <h2 id="pastor-follow-title">New follow-up</h2>
              <p className="muted sm" style={{ margin: '4px 0 0' }}>Schedule or record a follow-up contact with a member or visitor.</p>
            </div>
            <button type="button" className="secondary pastor-close-btn" onClick={() => setPanel(null)} aria-label="Close">✕ Close</button>
          </div>
          <form onSubmit={submitFollow}>
            <div className="formgrid pastor-form-grid">
              <div><label>Date</label><input type="date" value={followForm.date} onChange={e => setFollowForm(f => ({ ...f, date: e.target.value }))} required /></div>
              <div><label>Method</label><select value={followForm.method} onChange={e => setFollowForm(f => ({ ...f, method: e.target.value }))}>{['Phone','Visit','SMS','In Person'].map(o => <option key={o}>{o}</option>)}</select></div>
              <div className="full"><label>Member</label>
                <input value={memberQ} onChange={e => { setMemberQ(e.target.value); setFollowForm(f => ({ ...f, person_name: e.target.value, member_id: '' })); }} placeholder="Search by name, member ID or phone…" required autoComplete="off" />
                {memberQ && <div className="pastor-member-hits">{memberMatches.map(m => (
                  <button type="button" key={m.id} className={'pastor-member-hit' + (followForm.member_id === m.id ? ' selected' : '')} onClick={() => pickMember(m, 'follow')}>
                    <strong>{m.name}</strong>
                    <span>{[m.member_code, m.phone].filter(Boolean).join(' · ') || 'No ID / phone'}</span>
                  </button>
                ))}{!memberMatches.length && <div className="muted sm">No matching members — the name you typed will still be saved.</div>}</div>}
              </div>
              <div><label>Phone</label><input type="tel" value={followForm.phone} onChange={e => setFollowForm(f => ({ ...f, phone: e.target.value }))} placeholder="Optional" /></div>
              <div><label>Category</label><select value={followForm.category} onChange={e => setFollowForm(f => ({ ...f, category: e.target.value }))}>{['Visitor','New Convert','Member','Youth','Family','Other'].map(o => <option key={o}>{o}</option>)}</select></div>
              <div className="full"><label>Reason</label><input value={followForm.reason} onChange={e => setFollowForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why is this follow-up needed?" required /></div>
              <div><label>Assigned to</label><input value={followForm.assigned_to} onChange={e => setFollowForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="Who will follow up?" /></div>
              <div><label>Status</label><select value={followForm.status} onChange={e => setFollowForm(f => ({ ...f, status: e.target.value }))}>{['Open','In Progress','Completed','Closed'].map(o => <option key={o}>{o}</option>)}</select></div>
              <div className="full"><label>Notes</label><textarea rows={4} value={followForm.notes} onChange={e => setFollowForm(f => ({ ...f, notes: e.target.value }))} placeholder="Outcome notes or next steps…" /></div>
            </div>
            <div className="pastor-form-actions">
              <button type="button" className="secondary" onClick={() => setPanel(null)}>Close</button>
              <button className="primary" type="submit">Save follow-up</button>
            </div>
          </form>
        </div>
      </div>
    )}

    {panel === 'prayers' && (
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pastor-prayer-title" onClick={(e) => { if (e.target === e.currentTarget) setPanel(null); }}>
        <div className="modalbox pastor-modal pastor-modal-wide">
          <div className="modalhead">
            <div>
              <h2 id="pastor-prayer-title">Active prayer requests</h2>
              <p className="muted sm" style={{ margin: '4px 0 0' }}>{openPrayers.length} open request{openPrayers.length === 1 ? '' : 's'} · stays on this dashboard</p>
            </div>
            <button type="button" className="secondary pastor-close-btn" onClick={() => setPanel(null)} aria-label="Close">✕ Close</button>
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>Date</th><th>Requester</th><th>Category</th><th>Request</th><th>Status</th></tr></thead>
            <tbody>
              {openPrayers.slice(0, 40).map(p => (
                <tr key={p.id}>
                  <td>{p.date || String(p.created_at || '').slice(0, 10)}</td>
                  <td><b>{p.requester || p.person_name || ''}</b></td>
                  <td>{p.category || ''}</td>
                  <td>{p.request || ''}</td>
                  <td>{badge(p.status || 'New')}</td>
                </tr>
              ))}
              {!openPrayers.length && <tr><td colSpan="5" className="empty">No open prayer requests.</td></tr>}
            </tbody>
          </table></div>
          <div className="pastor-form-actions">
            <button type="button" className="secondary" onClick={() => setPanel(null)}>Close</button>
          </div>
        </div>
      </div>
    )}

    <div className="cards">
      <div className="card"><div className="label">Active members</div><div className="num">{active}</div></div>
      <div className="card"><div className="label">Open follow-ups</div><div className="num">{openFollow}</div></div>
      <div className="card"><div className="label">Open pastoral cases</div><div className="num">{openCases}</div></div>
      <div className="card"><div className="label">Prayer requests</div><div className="num">{openPrayers.length}</div></div>
      <div className="card"><div className="label">Visitors this month</div><div className="num">{visitors}</div></div>
      {role === 'pastor' && <>
        <div className="card"><div className="label">Finance awaiting review</div><div className="num">{pendingFinance}</div></div>
        <div className="card"><div className="label">Approved income</div><div className="num">{money(lockedIncome)}</div></div>
        <div className="card"><div className="label">Approved expenditure</div><div className="num">{money(lockedExpense)}</div></div>
      </>}
    </div>
    <div className="grid2">
      <div className="panel"><h2>Recent attendance trend</h2>{trend.length ? <div className="tablewrap"><table><thead><tr><th>Date</th><th>Present</th></tr></thead><tbody>{trend.map(x => <tr key={x.date}><td>{x.date}</td><td><b>{x.present}</b></td></tr>)}</tbody></table></div> : <div className="empty">No attendance records.</div>}</div>
      <div className="panel">
        <h2>Pastoral priorities</h2>
        <p><b>{openCases}</b> pastoral cases require attention.</p>
        <p><b>{openFollow}</b> follow-ups are open or in progress.</p>
        <p><b>{openPrayers.length}</b> prayer requests are active.</p>
        <p className="muted sm">Use the buttons above to add a case or follow-up, or review prayer requests, without leaving this dashboard.</p>
        {role === 'pastor' && onNavigate && <div className="toolbar"><button className="secondary" onClick={() => onNavigate('financecenter')}>View finance reports</button><button className="secondary" onClick={() => onNavigate('expenditure')}>View expenditure</button></div>}
      </div>
    </div>
  </>;
}

/* ---------------- V12 Member Giving + Engagement Automation ---------------- */
export function MemberGiving() {
  const { data } = useData();
  const { role } = useAuth();
  if (!['admin','finance','secretary'].includes(role) && !isSuperAdmin(role)) return <div className="panel"><h2>Member Giving & Receipts</h2><p className="muted">Finance access is restricted.</p></div>;
  const rows=[...(data.payment_receipts||[])].sort((a,b)=>String(b.paid_at||b.created_at).localeCompare(String(a.paid_at||a.created_at)));
  const paid=rows.filter(r=>r.status==='Paid').reduce((a,r)=>a+Number(r.amount||0),0);
  const pending=rows.filter(r=>r.status==='Pending').reduce((a,r)=>a+Number(r.amount||0),0);
  const issueReceipt=(r)=>{
    const receipt=r.receipt_number||`R-${String(r.id).replace(/-/g,'').slice(0,8).toUpperCase()}`;
    const html=`<html><head><title>Church Receipt ${esc(receipt)}</title><style>body{font-family:Arial;padding:35px;max-width:650px;margin:auto}h1{text-align:center}hr{border:0;border-top:1px solid #ddd}.row{display:flex;justify-content:space-between;padding:9px 0}.total{font-size:24px;font-weight:700}</style></head><body><h1>${esc(import.meta.env.VITE_CHURCH_NAME||'Church')}<br><small>Giving Receipt</small></h1><hr><div class="row"><b>Receipt</b><span>${esc(receipt)}</span></div><div class="row"><b>Member / donor</b><span>${esc(r.member_name||'Anonymous')}</span></div><div class="row"><b>Fund</b><span>${esc(r.fund||'')}</span></div><div class="row"><b>Method</b><span>${esc(r.method||'')}${esc(r.provider?' / '+r.provider:'')}</span></div><div class="row"><b>Reference</b><span>${esc(r.reference||'')}</span></div><hr><div class="row total"><span>Amount</span><span>GH₵ ${Number(r.amount||0).toFixed(2)}</span></div><p>Paid: ${esc(r.paid_at||r.created_at||'')}</p><p style="color:#666">Thank you for your contribution.</p><script>window.print()</script></body></html>`;
    const w=window.open('','_blank','width=760,height=800'); if(w){w.opener=null;w.document.write(html);w.document.close();}
  };
  return <>
    <div className="top"><div><h1>Member Giving & Receipts</h1><div className="muted">Track digital giving records and print official receipts.</div></div></div>
    <div className="cards"><div className="card"><div className="label">Paid</div><div className="num">{money(paid)}</div></div><div className="card"><div className="label">Pending</div><div className="num">{money(pending)}</div></div><div className="card"><div className="label">Receipts</div><div className="num">{rows.length}</div></div></div>
    <Crud table="payment_receipts" title="Digital Giving Records" noun="receipt" sortKey="paid_at" sortDir="desc" searchKeys={['member_name','reference','receipt_number','fund']} filters={[{key:'status',label:'All statuses',options:['Pending','Paid','Failed','Refunded']},{key:'method',label:'All methods',options:['Mobile Money','Bank','Card','Cash']}]}
      defaults={{amount:0,fund:'Offering',method:'Mobile Money',status:'Paid'}}
      fields={[{key:'member_name',label:'Member / donor',required:true},{key:'amount',label:'Amount (GHS)',type:'number',step:'0.01',gt:0,required:true},{key:'fund',label:'Fund',required:true},{key:'method',label:'Method',type:'select',options:['Mobile Money','Bank','Card','Cash'],required:true},{key:'provider',label:'Provider / bank'},{key:'reference',label:'Transaction reference'},{key:'receipt_number',label:'Receipt number'},{key:'status',label:'Status',type:'select',options:['Pending','Paid','Failed','Refunded'],required:true},{key:'paid_at',label:'Paid at',type:'datetime-local'},{key:'notes',label:'Notes',type:'textarea',full:true}]}
      columns={[{label:'Member',key:'member_name'},{label:'Amount',render:r=>money(r.amount)},{label:'Fund',key:'fund'},{label:'Method',key:'method'},{label:'Reference',key:'reference'},{label:'Status',render:r=>badge(r.status)},{label:'Receipt',render:r=><button className="sm" onClick={()=>issueReceipt(r)}>Print</button>}]}
    />
  </>;
}

export function EngagementAutomation() {
  const { data } = useData();
  const { role } = useAuth();
  if (!['admin','secretary'].includes(role) && !isSuperAdmin(role)) return <div className="panel"><h2>Engagement Automation</h2><p className="muted">Only administrators and secretaries have access.</p></div>;
  const templates=[...(data.communication_templates||[])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const queue=[...(data.communication_queue||[])].sort((a,b)=>String(a.scheduled_for||'').localeCompare(String(b.scheduled_for||'')));
  const birthdayCount=data.members.filter(m=>m.dob && String(m.dob).slice(5)===today().slice(5)).length;
  const visitorCount=data.visitors.filter(v=>String(v.visit_date||'').slice(0,7)===today().slice(0,7)).length;
  return <>
    <div className="top"><div><h1>Engagement Automation</h1><div className="muted">Prepare reusable messages and queue member follow-up. Sending requires a connected SMS or email provider.</div></div></div>
    <div className="cards"><div className="card"><div className="label">Birthdays today</div><div className="num">{birthdayCount}</div></div><div className="card"><div className="label">Visitors this month</div><div className="num">{visitorCount}</div></div><div className="card"><div className="label">Templates</div><div className="num">{templates.length}</div></div><div className="card"><div className="label">Queued messages</div><div className="num">{queue.filter(q=>q.status==='Queued').length}</div></div></div>
    <Crud table="communication_templates" title="Message Templates" noun="template" sortKey="created_at" sortDir="desc" searchKeys={['name','body','audience']} filters={[{key:'channel',label:'All channels',options:['SMS','Email','In-app']},{key:'audience',label:'All audiences',options:['All Members','Youth','Children','Men','Women','New Visitors','Birthdays']}]} defaults={{channel:'SMS',audience:'All Members',active:true}}
      fields={[{key:'name',label:'Template name',required:true},{key:'channel',label:'Channel',type:'select',options:['SMS','Email','In-app'],required:true},{key:'audience',label:'Audience',type:'select',options:['All Members','Youth','Children','Men','Women','New Visitors','Birthdays'],required:true},{key:'subject',label:'Subject'},{key:'body',label:'Message',type:'textarea',required:true,full:true},{key:'active',label:'Active',type:'checkbox'}]}
      columns={[{label:'Name',key:'name'},{label:'Channel',key:'channel'},{label:'Audience',key:'audience'},{label:'Active',render:t=>badge(t.active?'Active':'Off')}]}
    />
    <Crud table="communication_queue" title="Message Queue" noun="message" sortKey="scheduled_for" sortDir="asc" searchKeys={['member_name','phone','message','trigger_type']} filters={[{key:'status',label:'All statuses',options:['Queued','Processing','Sent','Delivered','Failed','Cancelled']},{key:'trigger_type',label:'All triggers',options:['Manual','Birthday','New Visitor','Follow-up','Event Reminder']}]} defaults={{channel:'SMS',status:'Queued',trigger_type:'Manual'}}
      fields={[{key:'member_name',label:'Recipient name',required:true},{key:'phone',label:'Phone'},{key:'channel',label:'Channel',type:'select',options:['SMS','Email','In-app'],required:true},{key:'trigger_type',label:'Trigger',type:'select',options:['Manual','Birthday','New Visitor','Follow-up','Event Reminder'],required:true},{key:'scheduled_for',label:'Scheduled for',type:'datetime-local'},{key:'status',label:'Status',type:'select',options:['Queued','Sent','Failed','Cancelled'],required:true},{key:'message',label:'Message',type:'textarea',required:true,full:true}]}
      columns={[{label:'Recipient',key:'member_name'},{label:'Channel',key:'channel'},{label:'Trigger',key:'trigger_type'},{label:'Scheduled',key:'scheduled_for'},{label:'Status',render:q=>badge(q.status)}]}
    />
  </>;
}


/* ---------------- V13 Finance Reconciliation + Engagement ---------------- */
export function FinanceReconciliation() {
  const { role } = useAuth();
  if (!['admin','finance'].includes(role) && !isSuperAdmin(role)) return <div className="panel"><h2>Finance Reconciliation</h2><p className="muted">Finance access is restricted.</p></div>;
  return <FinanceReconciliationScreen />;
}

function FinanceReconciliationScreen() {
  const { data, save } = useData();
  const { role } = useAuth();
  const [date,setDate]=useState(today());
  const [method,setMethod]=useState('All');
  const [note,setNote]=useState('');
  const rows=(data.payment_receipts||[]).filter(r=>String(r.paid_at||r.created_at).slice(0,10)===date && r.status==='Paid' && (method==='All'||r.method===method));
  const giving=(data.giving||[]).filter(r=>String(r.date).slice(0,10)===date);
  const offerings=(data.offering_entries||[]).filter(r=>String(r.date).slice(0,10)===date);
  const digital=rows.reduce((n,r)=>n+Number(r.amount||0),0);
  const manualGiving=0;
  const manualOffering=offerings.reduce((n,r)=>n+Number(r.amount||0),0);
  const total=digital+manualOffering;
  const existing=(data.finance_reconciliations||[]).find(r=>r.date===date && r.method_filter===method);
  const [counted,setCounted]=useState(existing?.counted_amount ?? '');
  useEffect(()=>setCounted(existing?.counted_amount ?? ''),[existing?.id,existing?.counted_amount,date,method]);
  const difference=Number(counted||0)-total;
  function saveRec(){
    save('finance_reconciliations',{id:existing?.id||uuid(),date,method_filter:method,system_amount:Number(total.toFixed(2)),counted_amount:Number(counted||0),difference:Number(difference.toFixed(2)),notes:note||existing?.notes||'',status:Math.abs(difference)<0.01?'Balanced':'Needs Review'});
    alert(Math.abs(difference)<0.01?'Reconciliation saved as balanced.':'Reconciliation saved for review.');
  }
  return <>
    <div className="top"><div><h1>Finance Reconciliation</h1><div className="muted">Reconcile all income in one view. Manual giving should be recorded under Offerings; digital receipts include Mobile Money, bank and card payments.</div></div></div>
    <div className="panel"><div className="toolbar"><div className="fld"><small>Date</small><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div><div className="fld"><small>Payment method</small><select value={method} onChange={e=>setMethod(e.target.value)}><option>All</option><option>Mobile Money</option><option>Bank</option><option>Card</option><option>Cash</option></select></div></div></div>
    <div className="cards"><div className="card"><span className="label">Income (digital payments)</span><strong>{money(digital)}</strong></div><div className="card"><span className="label">Offering income</span><strong>{money(manualOffering)}</strong></div><div className="card"><span className="label">System total</span><strong>{money(total)}</strong></div></div>
      <div className="panel"><h2>Reconcile</h2><div className="formgrid"><div><label>Verified amount (GHS)</label><input type="number" min="0" step="0.01" value={counted} onChange={e=>setCounted(e.target.value)} /></div><div><label>Difference</label><input readOnly value={Number.isFinite(difference)?`GH₵ ${difference.toFixed(2)}`:''} /></div><div className="full"><label>Notes</label><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional reconciliation note" /></div></div><div className="toolbar"><button className="primary" onClick={saveRec}>Save reconciliation</button>{existing&&badge(existing.status)}</div></div>
    <div className="panel"><h2>Recorded transactions</h2><div className="tablewrap"><table><thead><tr><th>Source</th><th>Reference</th><th>Member / donor</th><th>Method</th><th>Amount</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td>Digital receipt</td><td>{r.reference||r.receipt_number||''}</td><td>{r.member_name||'Anonymous'}</td><td>{r.method}</td><td>{money(r.amount)}</td></tr>)}
      
      {offerings.map(r=><tr key={'o'+r.id}><td>Offering</td><td>{r.reference||''}</td><td>{r.person_name||''}</td><td>{r.method||'Cash'}</td><td>{money(r.amount)}</td></tr>)}
      {!rows.length&&!offerings.length&&<tr><td colSpan="5" className="empty">No recorded transactions for this date.</td></tr>}
    </tbody></table></div></div>
  </>;
}

export function AutomationCenter() {
  const { role } = useAuth();
  if (!['admin','secretary'].includes(role) && !isSuperAdmin(role)) return <div className="panel"><h2>Automation Center</h2><p className="muted">Only administrators and secretaries have access.</p></div>;
  return <AutomationCenterScreen />;
}

function AutomationCenterScreen() {
  const { data, save } = useData();
  const { role } = useAuth();
  const [channel,setChannel]=useState('SMS');
  const [runMsg,setRunMsg]=useState('');
  const templates=(data.communication_templates||[]).filter(t=>t.active);
  const birthdayTemplate=templates.find(t=>t.audience==='Birthdays' && t.channel===channel);
  const visitorTemplate=templates.find(t=>t.audience==='New Visitors' && t.channel===channel);
  const todayKey=today();
  const birthdays=(data.members||[]).filter(m=>m.dob && String(m.dob).slice(5)===todayKey.slice(5) && m.phone);
  const recentVisitors=(data.visitors||[]).filter(v=>String(v.visit_date||'').slice(0,7)===todayKey.slice(0,7) && v.phone);
  const alreadyQueued=new Set((data.communication_queue||[]).filter(q=>q.status!=='Cancelled').map(q=>`${q.trigger_type}:${q.member_id||q.member_name}:${String(q.scheduled_for||'').slice(0,10)}`));
  const enqueue=(m,template,type,body)=>{
    const key=`${type}:${m.id||m.name}:${todayKey}`;
    if(alreadyQueued.has(key)) return false;
    save('communication_queue',{id:uuid(),member_id:m.id||null,member_name:m.name||m.full_name||'',phone:m.phone||'',channel,template_id:template?.id||null,trigger_type:type,scheduled_for:new Date().toISOString(),status:'Queued',message:body});
    return true;
  };
  const personalize=(body,m)=>String(body||'').replaceAll('{{name}}',m.name||m.full_name||'Member').replaceAll('{{church}}',import.meta.env.VITE_CHURCH_NAME||'Church');
  function queueBirthdays(){let n=0;birthdays.forEach(m=>{if(birthdayTemplate&&enqueue(m,birthdayTemplate,'Birthday',personalize(birthdayTemplate.body,m)))n++;});setRunMsg(`${n} birthday message${n===1?'':'s'} queued.`);}
  function queueVisitors(){let n=0;recentVisitors.forEach(v=>{const m={id:null,name:v.name,phone:v.phone};if(visitorTemplate&&enqueue(m,visitorTemplate,'New Visitor',personalize(visitorTemplate.body,m)))n++;});setRunMsg(`${n} visitor follow-up message${n===1?'':'s'} queued.`);}
  return <>
    <div className="top"><div><h1>Automation Center</h1><div className="muted">Prepare birthday and new-visitor messages without sending anything until a provider is connected.</div></div></div>
    <div className="panel"><div className="toolbar"><div className="fld"><small>Channel</small><select value={channel} onChange={e=>setChannel(e.target.value)}><option>SMS</option><option>Email</option><option>In-app</option></select></div><button className="primary" onClick={queueBirthdays} disabled={!birthdayTemplate}>Queue today's birthdays</button><button onClick={queueVisitors} disabled={!visitorTemplate}>Queue new visitor follow-up</button></div>{runMsg&&<p className="muted">{runMsg}</p>}<p className="muted sm">Templates use {'{{name}}'} and {'{{church}}'} placeholders. Queued messages stay in the Communication Queue until a connected provider sends them.</p></div>
    <div className="cards"><div className="card"><span className="label">Birthdays today</span><strong>{birthdays.length}</strong></div><div className="card"><span className="label">Visitors this month</span><strong>{recentVisitors.length}</strong></div><div className="card"><span className="label">Active templates</span><strong>{templates.length}</strong></div><div className="card"><span className="label">Queued</span><strong>{(data.communication_queue||[]).filter(q=>q.status==='Queued').length}</strong></div></div>
    <div className="grid2"><div className="panel"><h2>Today's birthdays</h2>{birthdays.length?birthdays.map(m=><div className="listrow" key={m.id}><b>{m.name}</b><span className="muted"> · {m.phone}</span></div>):<div className="empty">No birthdays with phone numbers today.</div>}</div><div className="panel"><h2>Recent visitors</h2>{recentVisitors.length?recentVisitors.slice(0,20).map(v=><div className="listrow" key={v.id}><b>{v.name}</b><span className="muted"> · {v.visit_date} · {v.phone}</span></div>):<div className="empty">No visitors with phone numbers this month.</div>}</div></div>
  </>;
}


/* ---------------- Advanced Reports + Exports ---------------- */
export function AdvancedReports() {
  const { data } = useData();
  const { role } = useAuth();
  const [tab, setTab] = useState('overview');
  const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(today());
  const [memberId, setMemberId] = useState('all');
  const [exportMsg, setExportMsg] = useState('');

  const members = useMemo(() => [...(data.members || [])].sort(memberIdCompare), [data.members]);
  const attendanceAccess = can(role, 'attendance', 'read');
  const headcountAccess = can(role, 'attendance_headcount', 'read');
  const welfareAccess = can(role, 'member_contributions', 'read');
  const financeAccess = can(role, 'finance_weekly_reports', 'read');

  const validRange = startDate && endDate && startDate <= endDate;
  const inRange = (value) => {
    const d = String(value || '').slice(0, 10);
    return validRange && d >= startDate && d <= endDate;
  };
  const attendanceSummary = useMemo(() => {
    if (!validRange) return { rows: [], attendanceDays: 0 };
    const selectedMembers = memberId === 'all' ? members : members.filter(m => m.id === memberId);
    const nameToId = new Map(members.map(m => [String(m.name || '').trim().toLowerCase(), m.id]));
    const attendanceDaysSet = new Set();
    const presentDatesByMember = new Map();

    (data.attendance || []).forEach(a => {
      if (!inRange(a.date)) return;
      const date = String(a.date).slice(0, 10);
      attendanceDaysSet.add(date);
      let id = a.member_id;
      if (!id && a.person_name) id = nameToId.get(String(a.person_name).trim().toLowerCase());
      if (!id || (memberId !== 'all' && id !== memberId)) return;
      if (a.status === 'Present') {
        if (!presentDatesByMember.has(id)) presentDatesByMember.set(id, new Set());
        presentDatesByMember.get(id).add(date);
      }
    });

    const attendanceDays = attendanceDaysSet.size;
    const rows = selectedMembers.map(m => {
      const daysPresent = presentDatesByMember.get(m.id)?.size || 0;
      const percent = attendanceDays ? Math.round((daysPresent / attendanceDays) * 100) : 0;
      return {
        'Member ID': m.member_code || '',
        'Member Name': m.name || '',
        'Current Status': m.status || '',
        'Days Present': daysPresent,
        'Attendance Days': attendanceDays,
        'Present %': `${percent}%`,
      };
    });
    return { rows, attendanceDays };
  }, [data.attendance, members, memberId, startDate, endDate, validRange]);

  const attendanceRows = attendanceSummary.rows;
  const attendanceDays = attendanceSummary.attendanceDays;

  const headcountRows = useMemo(() => {
    if (!validRange) return [];
    const grouped = new Map();
    (data.attendance_headcount || []).filter(r => inRange(r.date)).forEach(r => {
      const key = `${r.date}|${r.service}`;
      if (!grouped.has(key)) grouped.set(key, { Date:r.date, Day:dayName(r.date), Service:r.service });
      grouped.get(key)[headcountLabel(r.category)] = Number(r.count || 0);
    });
    return [...grouped.values()].sort((a,b) => String(a.Date).localeCompare(String(b.Date)) || String(a.Service).localeCompare(String(b.Service))).map(r => {
      const total = HEADCOUNT_CATEGORIES.reduce((sum, c) => sum + Number(r[headcountLabel(c)] || 0), 0);
      return {...r, Total:total};
    });
  }, [data.attendance_headcount, startDate, endDate, validRange]);

  const welfareRows = useMemo(() => {
    if (!validRange) return [];
    const startMonth = startDate.slice(0,7), endMonth = endDate.slice(0,7);
    const memberMap = new Map(members.map(m => [m.id, m]));
    return (data.member_contributions || []).filter(r => {
      if (r.fund !== 'Welfare Dues') return false;
      const ym = `${r.year}-${String(r.month).padStart(2,'0')}`;
      return ym >= startMonth && ym <= endMonth;
    }).sort((a,b) => Number(a.year)-Number(b.year) || Number(a.month)-Number(b.month) || String(a.person_name).localeCompare(String(b.person_name))).map(r => {
      const m = memberMap.get(r.member_id);
      return {'Month':`${r.year}-${String(r.month).padStart(2,'0')}`,'Member ID':m?.member_code || '','Member Name':r.person_name || m?.name || '','Current Status':m?.status || '','Welfare Due':Number(r.amount || 0)};
    });
  }, [data.member_contributions, members, startDate, endDate, validRange]);

  const financeRows = useMemo(() => {
    if (!validRange) return [];
    const reports = (data.finance_weekly_reports || []).filter(r => inRange(r.date));
    const cashRows = data.finance_weekly_cash_counts || [];
    const momoRows = data.finance_weekly_momo || [];
    const weekdayRows = data.finance_weekday_collections || [];
    const weekdayCashRows = data.finance_weekday_cash_counts || [];
    const weekdayMomoRows = data.finance_weekday_momo || [];
    return reports.sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(r => {
      const vals = Object.fromEntries(OFFERING_CATEGORIES.map(c => [c, 0]));
      cashRows.filter(x => x.report_id === r.id && x.category !== 'Weekday Offering').forEach(x => { vals[x.category] = (vals[x.category] || 0) + Number(x.denomination || 0) * Number(x.quantity || 0); });
      momoRows.filter(x => x.report_id === r.id && x.category !== 'Weekday Offering').forEach(x => { vals[x.category] = (vals[x.category] || 0) + Number(x.amount || 0); });
      weekdayRows.filter(x => x.report_id === r.id).forEach(x => {
        weekdayCashRows.filter(y => y.collection_id === x.id).forEach(y => { vals['Weekday Offering'] += Number(y.denomination || 0) * Number(y.quantity || 0); });
        weekdayMomoRows.filter(y => y.collection_id === x.id).forEach(y => { vals['Weekday Offering'] += Number(y.amount || 0); });
      });
      const out = {Date:r.date, Day:dayName(r.date), 'Week Number':r.week_no || '', Status:r.status || ''};
      OFFERING_CATEGORIES.forEach(c => out[c] = Number((vals[c] || 0).toFixed(2)));
      out.Total = OFFERING_CATEGORIES.reduce((sum,c)=>sum+Number(out[c]||0),0);
      return out;
    });
  }, [data.finance_weekly_reports, data.finance_weekly_cash_counts, data.finance_weekly_momo, data.finance_weekday_collections, data.finance_weekday_cash_counts, data.finance_weekday_momo, startDate, endDate, validRange]);

  const exportRows = (name, rows) => {
    if (!rows.length) { setExportMsg(`No ${name} records found for the selected time range.`); return; }
    downloadCSV(name.replace(/\s+/g,'-').toLowerCase(), rows);
    setExportMsg(`${rows.length.toLocaleString()} ${name.toLowerCase()} row${rows.length === 1 ? '' : 's'} exported.`);
  };

  const recentSessions = [...new Set((data.attendance||[]).filter(a=>a.status==='Present' && inRange(a.date)).map(a=>`${a.date}|${a.service}`))].sort().reverse().slice(0,8);
  const activeMembers = members.filter(m => !['Inactive','Left'].includes(m.status));
  const presentIds = new Set((data.attendance||[]).filter(a=>a.status==='Present' && recentSessions.includes(`${a.date}|${a.service}`)).map(a=>a.member_id).filter(Boolean));
  const engaged = activeMembers.filter(m=>presentIds.has(m.id)).length;
  const engagementRate = activeMembers.length ? Math.round((engaged / activeMembers.length) * 100) : 0;
  const followupsOpen=(data.follow_ups||[]).filter(f=>['Open','In Progress'].includes(f.status)).length;
  const prayerOpen=(data.prayer_requests||[]).filter(p=>!['Answered','Closed'].includes(p.status)).length;
  const visitorsInRange=(data.visitors||[]).filter(v=>inRange(v.visit_date)).length;

  return <>
    <div className="top">
      <div><h1>Advanced Reports</h1><div className="muted">Current reports and exports for attendance, headcount, welfare and Finance Center data.</div></div>
      <div className="btnrow"><button className={tab==='overview'?'primary':'secondary'} onClick={()=>setTab('overview')}>Overview</button><button className={tab==='reports'?'primary':'secondary'} onClick={()=>setTab('reports')}>Reports</button></div>
    </div>

    {tab === 'overview' ? <>
      <div className="cards">
        <div className="card"><span className="label">Active members</span><strong>{activeMembers.length}</strong></div>
        <div className="card"><span className="label">Recent engagement</span><strong>{engagementRate}%</strong><span className="muted sm">present in selected period</span></div>
        <div className="card"><span className="label">Open follow-ups</span><strong>{followupsOpen}</strong></div>
        <div className="card"><span className="label">Open prayer requests</span><strong>{prayerOpen}</strong></div>
        <div className="card"><span className="label">Visitors in range</span><strong>{visitorsInRange}</strong></div>
      </div>
      <div className="panel"><h2>Recent service engagement</h2><p className="muted">Members with at least one Present record in the latest recorded services within the selected period.</p><div className="tablewrap"><table><thead><tr><th>Member</th><th>Status</th><th>Recent attendance</th></tr></thead><tbody>{activeMembers.filter(m=>recentSessions.length && !presentIds.has(m.id)).slice(0,50).map(m=><tr key={m.id}><td><b>{m.name}</b></td><td>{m.status}</td><td className="muted">No Present mark in recent recorded services</td></tr>)}{(!recentSessions.length||!activeMembers.some(m=>!presentIds.has(m.id)))&&<tr><td colSpan="3" className="empty">No engagement gaps to display from the available attendance records.</td></tr>}</tbody></table></div></div>
    </> : <>
      <div className="panel report-filter-panel">
        <div className="report-filter-grid">
          <div className="fld"><small>From</small><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} /></div>
          <div className="fld"><small>To</small><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} /></div>
          {attendanceAccess && <div className="fld"><small>Attendance member</small><select value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="all">All members</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}{m.member_code ? ` · ${m.member_code}` : ''}</option>)}</select></div>}
        </div>
        {!validRange && <div className="err">Choose a valid date range: the From date must be on or before the To date.</div>}
        {exportMsg && <div className="success" style={{marginTop:8}}>{exportMsg}</div>}
      </div>

      {attendanceAccess && <div className="panel report-export-card"><div className="top report-export-head"><div><h2>Member Attendance</h2><p className="muted">One row per member. Days Present counts distinct attendance dates marked Present within the selected range. Present % = Days Present ÷ recorded attendance days in the selected range.</p>{validRange && <p className="muted sm"><b>{attendanceDays}</b> attendance day{attendanceDays===1?'':'s'} recorded from {startDate} to {endDate}.</p>}</div><button className="primary" disabled={!validRange} onClick={()=>exportRows('Member Attendance', attendanceRows)}>Export CSV</button></div><div className="tablewrap"><table><thead><tr><th>Member ID</th><th>Member</th><th>Status</th><th>Days Present</th><th>Attendance Days</th><th>Present %</th></tr></thead><tbody>{attendanceRows.slice(0,100).map((r,i)=><tr key={i}><td>{r['Member ID']}</td><td><b>{r['Member Name']}</b></td><td>{r['Current Status']}</td><td><b>{r['Days Present']}</b></td><td>{r['Attendance Days']}</td><td><b>{r['Present %']}</b></td></tr>)}{!attendanceRows.length&&<tr><td colSpan="6" className="empty">No members or attendance records match this range.</td></tr>}</tbody></table></div>{attendanceRows.length>100&&<p className="muted sm">Showing the first 100 members here; the CSV export contains all {attendanceRows.length.toLocaleString()} members.</p>}</div>}

      {headcountAccess && <div className="panel report-export-card"><div className="top report-export-head"><div><h2>Headcount</h2><p className="muted">Export the demographic headcount breakdown by date and service.</p></div><button className="primary" disabled={!validRange} onClick={()=>exportRows('Headcount', headcountRows)}>Export CSV</button></div><div className="tablewrap"><table><thead><tr><th>Date</th><th>Day</th><th>Service</th>{HEADCOUNT_CATEGORIES.map(c=><th key={c}>{headcountLabel(c)}</th>)}<th>Total</th></tr></thead><tbody>{headcountRows.slice(0,50).map((r,i)=><tr key={i}><td>{r.Date}</td><td>{r.Day}</td><td>{r.Service}</td>{HEADCOUNT_CATEGORIES.map(c=><td key={c}>{r[headcountLabel(c)]||0}</td>)}<td><b>{r.Total}</b></td></tr>)}{!headcountRows.length&&<tr><td colSpan="10" className="empty">No headcount records match this range.</td></tr>}</tbody></table></div></div>}

      {welfareAccess && <div className="panel report-export-card"><div className="top report-export-head"><div><h2>Welfare Due</h2><p className="muted">Export Welfare Dues contributions recorded by member and month.</p></div><button className="primary" disabled={!validRange} onClick={()=>exportRows('Welfare Due', welfareRows)}>Export CSV</button></div><div className="tablewrap"><table><thead><tr><th>Month</th><th>Member ID</th><th>Member</th><th>Status</th><th>Welfare Due</th></tr></thead><tbody>{welfareRows.slice(0,50).map((r,i)=><tr key={i}><td>{r.Month}</td><td>{r['Member ID']}</td><td><b>{r['Member Name']}</b></td><td>{r['Current Status']}</td><td><b>{money(r['Welfare Due'])}</b></td></tr>)}{!welfareRows.length&&<tr><td colSpan="5" className="empty">No Welfare Dues records match this range.</td></tr>}</tbody></table></div></div>}

      {financeAccess && <div className="panel report-export-card"><div className="top report-export-head"><div><h2>Finance Center</h2><p className="muted">Export the current eight Finance Center headings for each weekly report in the selected time frame.</p></div><button className="primary" disabled={!validRange} onClick={()=>exportRows('Finance Center', financeRows)}>Export CSV</button></div><div className="tablewrap"><table><thead><tr><th>Date</th><th>Day</th><th>Week</th>{OFFERING_CATEGORIES.map(c=><th key={c}>{c}</th>)}<th>Total</th></tr></thead><tbody>{financeRows.slice(0,50).map((r,i)=><tr key={i}><td>{r.Date}</td><td>{r.Day}</td><td>{r['Week Number']}</td>{OFFERING_CATEGORIES.map(c=><td key={c}>{money(r[c])}</td>)}<td><b>{money(r.Total)}</b></td></tr>)}{!financeRows.length&&<tr><td colSpan="12" className="empty">No Finance Center reports match this range.</td></tr>}</tbody></table></div></div>}
    </>}
  </>;
}

export function MobileMoneyPayments() {
  const { data, save } = useData();
  const { role } = useAuth();
  const allowed = ['admin','finance'];
  const [memberId,setMemberId]=useState(''); const [amount,setAmount]=useState(''); const [fund,setFund]=useState('Offering');
  const [phone,setPhone]=useState(''); const [provider,setProvider]=useState('mtn'); const [status,setStatus]=useState('');
  if (!allowed.includes(role) && !isSuperAdmin(role)) return <div className="panel"><h2>Mobile Money Payments</h2><p className="muted">Only administrators and finance users have access.</p></div>;
  const members=(data.members||[]).filter(m=>m.status!=='Inactive').sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const requests=[...(data.payment_requests||[])].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,50);
  const createRequest=async()=>{ const m=members.find(x=>x.id===memberId); const n=Number(amount);
    if(!m || !phone.trim() || !n || n<=0){setStatus('Select a member and enter a valid amount and mobile money number.');return;}
    setStatus('Sending payment request to the payment service...');
    const { data: result, error } = await supabase.functions.invoke('paystack-charge',{body:{member_id:m.id,member_name:m.name,email:m.email||'',phone:phone.trim(),provider,amount:n,fund,source:'Finance Center'}});
    if(error || result?.error){setStatus(error?.message || result?.error || 'Payment request failed.');return;}
    setAmount('');setStatus(result?.display_message || 'Payment request sent. Ask the member to approve it on the phone.');
  };
  const counts=['Pending','Processing','Paid','Failed','Expired'].map(x=>[x,requests.filter(r=>r.status===x).length]);
  return <>
    <div className="top"><div><h1>Mobile Money Payments</h1><div className="muted">Create and monitor Ghana Mobile Money payment requests.</div></div></div>
    <div className="cards">{counts.map(([x,n])=><div className="card" key={x}><span className="label">{x}</span><strong>{n}</strong></div>)}</div>
    <div className="panel"><h2>Create payment request</h2><div className="formgrid">
      <div><label>Member</label><select value={memberId} onChange={e=>{setMemberId(e.target.value);const m=members.find(x=>x.id===e.target.value);if(m?.phone)setPhone(m.phone)}}><option value="">Select member</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
      <div><label>Amount (GHS)</label><input type="number" min="1" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} /></div>
      <div><label>Fund</label><select value={fund} onChange={e=>setFund(e.target.value)}><option>Tithe</option><option>Offering</option><option>Donation</option><option>Pledge</option><option>Project</option><option>Thanksgiving</option></select></div>
      <div><label>Mobile money provider</label><select value={provider} onChange={e=>setProvider(e.target.value)}><option value="mtn">MTN MoMo</option><option value="vod">Telecel Cash</option><option value="atl">AirtelTigo / ATMoney</option></select></div>
      <div><label>Mobile number</label><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="0551234567" /></div>
    </div><div className="toolbar"><button className="primary" onClick={createRequest}>Create payment request</button>{status&&<span className="muted">{status}</span>}</div></div>
    <div className="panel"><h2>Recent payment requests</h2><div className="tablewrap"><table><thead><tr><th>Created</th><th>Member</th><th>Amount</th><th>Fund</th><th>Provider</th><th>Reference</th><th>Status</th></tr></thead><tbody>{requests.map(r=><tr key={r.id}><td>{String(r.created_at||'').slice(0,16).replace('T',' ')}</td><td>{r.member_name}</td><td>{money(r.amount)}</td><td>{r.fund}</td><td>{r.provider}</td><td>{r.reference||r.provider_reference||''}</td><td>{badge(r.status)}</td></tr>)}{!requests.length&&<tr><td colSpan="7" className="empty">No payment requests yet.</td></tr>}</tbody></table></div></div>
    <div className="panel"><h2>Provider setup</h2><p className="muted">The browser must never contain the Paystack secret key. The supplied Supabase Edge Functions keep that key server-side. Configure <code>PAYSTACK_SECRET_KEY</code>, deploy <code>paystack-charge</code> and <code>paystack-webhook</code>, then set the Paystack webhook URL to the webhook function.</p></div>
  </>;
}


/* ---------------- V17 Delivery Center ---------------- */
export function DeliveryCenter() {
  const { data, syncNow } = useData();
  const { role } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const allowed = ['admin','secretary'].includes(role) || isSuperAdmin(role);
  const queue = [...(data.communication_queue||[])].sort((a,b)=>String(a.scheduled_for||'').localeCompare(String(b.scheduled_for||'')));
  const queued = queue.filter(q=>q.status==='Queued');
  const failed = queue.filter(q=>q.status==='Failed');
  const sent = queue.filter(q=>['Sent','Delivered'].includes(q.status));
  const process = async () => {
    setBusy(true); setMsg('');
    try {
      const { data: result, error } = await supabase.functions.invoke('notification-worker', { body: { limit: 25 } });
      if (error) throw error;
      setMsg(result?.message || `Processed ${result?.processed||0} message(s).`);
      await syncNow();
    } catch (e) { setMsg(e?.message || 'Could not start the notification worker.'); }
    finally { setBusy(false); }
  };
  if (!allowed) return <div className="panel"><h2>Delivery Center</h2><p className="muted">Only administrators and secretaries have access.</p></div>;
  return <>
    <div className="top"><div><h1>Delivery Center</h1><div className="muted">Send queued SMS messages through the secure Supabase Edge Function.</div></div><button className="primary" onClick={process} disabled={busy}>{busy?'Processing...':'Process queue now'}</button></div>
    <div className="cards"><div className="card"><div className="label">Queued</div><div className="num">{queued.length}</div></div><div className="card"><div className="label">Sent</div><div className="num">{sent.length}</div></div><div className="card"><div className="label">Failed</div><div className="num">{failed.length}</div></div><div className="card"><div className="label">Total queue</div><div className="num">{queue.length}</div></div></div>
    {msg&&<div className="panel"><p className="muted">{msg}</p></div>}
    <div className="panel"><h2>Provider setup</h2><p className="muted">SMS uses SMSOnlineGH. Keep provider credentials in Supabase Edge Function secrets, never in Vite environment variables.</p><div className="tablewrap"><table><thead><tr><th>Channel</th><th>Secrets</th><th>Notes</th></tr></thead><tbody><tr><td>SMS</td><td><code>SMSONLINEGH_API_KEY</code><br/><code>SMSONLINEGH_SENDER_ID</code></td><td>Sender ID must be approved by your SMS provider.</td></tr></tbody></table></div></div>
    <div className="panel"><h2>Recent delivery queue</h2><div className="tablewrap"><table><thead><tr><th>Scheduled</th><th>Recipient</th><th>Channel</th><th>Trigger</th><th>Status</th><th>Error</th></tr></thead><tbody>{queue.slice(0,100).map(q=><tr key={q.id}><td>{String(q.scheduled_for||'').slice(0,16).replace('T',' ')}</td><td>{q.member_name||q.phone||q.email||''}</td><td>{q.channel}</td><td>{q.trigger_type||''}</td><td>{badge(q.status)}</td><td className="muted sm">{q.last_error||q.error_message||''}</td></tr>)}{!queue.length&&<tr><td colSpan="6" className="empty">No messages in the queue.</td></tr>}</tbody></table></div></div>
    <div className="panel"><h2>Automatic processing</h2><p className="muted">After deploying <code>notification-worker</code>, create a Supabase Cron job to call it every minute. Supabase supports invoking Edge Functions from Cron jobs, so scheduled messages can be processed without leaving a browser open.</p><pre>{`supabase functions deploy notification-worker\nsupabase secrets set SMSONLINEGH_API_KEY=... SMSONLINEGH_SENDER_ID=... NOTIFICATION_CRON_SECRET=...`}</pre></div>
  </>;
}

/* ---------------- V15 Church-wide Notification Center ---------------- */
export function NotificationCenter() {
  const { role } = useAuth();
  const allowed = ['admin','secretary'];
  if (!allowed.includes(role) && !isSuperAdmin(role)) return <div className="panel"><h2>Notification Center</h2><p className="muted">Only administrators and secretaries have access.</p></div>;
  return <NotificationCenterScreen />;
}

function NotificationCenterScreen() {
  const { data, save } = useData();
  const [channel,setChannel] = useState('In-app');
  const [audience,setAudience] = useState('All Members');
  const [title,setTitle] = useState('');
  const [message,setMessage] = useState('');
  const [schedule,setSchedule] = useState('');
  const [status,setStatus] = useState('');

  const members=(data.members||[]).filter(m=>m.status!=='Inactive');
  const targetMembers = useMemo(() => {
    if (audience==='All Members') return members;
    if (audience==='Youth') return members.filter(m=>['Youth','Young Adult'].includes(m.category)||String(m.grp||'').toLowerCase().includes('youth'));
    if (audience==='Men') return members.filter(m=>String(m.gender||'').toLowerCase()==='male');
    if (audience==='Women') return members.filter(m=>String(m.gender||'').toLowerCase()==='female');
    if (audience==='New Visitors') return (data.visitors||[]).filter(v=>v.phone).map(v=>({id:null,name:v.name,phone:v.phone,email:v.email}));
    return members;
  },[audience,members,data.visitors]);

  const queueCampaign = () => {
    if (!title.trim() || !message.trim()) { setStatus('Enter a title and message first.'); return; }
    const campaignId=uuid();
    const now=new Date().toISOString();
    save('notification_campaigns',{id:campaignId,title:title.trim(),message:message.trim(),channel,audience,scheduled_for:schedule?new Date(schedule).toISOString():now,status:'Queued',recipient_count:targetMembers.length});
    targetMembers.forEach(m=>save('communication_queue',{id:uuid(),member_id:m.id||null,member_name:m.name||m.full_name||'',phone:m.phone||'',email:m.email||'',channel,trigger_type:'Campaign',scheduled_for:schedule?new Date(schedule).toISOString():now,status:'Queued',message:message.trim(),campaign_id:campaignId,campaign_title:title.trim()}));
    setTitle(''); setMessage(''); setSchedule('');
    setStatus(`${targetMembers.length} recipient message${targetMembers.length===1?'':'s'} queued.`);
  };

  const campaigns=[...(data.notification_campaigns||[])].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,30);
  const queued=(data.communication_queue||[]).filter(q=>q.status==='Queued').length;
  return <>
    <div className="top"><div><h1>Notification Center</h1><div className="muted">Create church-wide or targeted messages and place them in the delivery queue.</div></div></div>
    <div className="cards"><div className="card"><span className="label">Active members</span><strong>{members.length}</strong></div><div className="card"><span className="label">Recipients now</span><strong>{targetMembers.length}</strong></div><div className="card"><span className="label">Queued messages</span><strong>{queued}</strong></div><div className="card"><span className="label">Campaigns</span><strong>{(data.notification_campaigns||[]).length}</strong></div></div>
    <div className="panel"><h2>Create notification</h2><div className="formgrid">
      <div><label>Channel</label><select value={channel} onChange={e=>setChannel(e.target.value)}><option>In-app</option><option>SMS</option><option>Email</option></select></div>
      <div><label>Audience</label><select value={audience} onChange={e=>setAudience(e.target.value)}><option>All Members</option><option>Youth</option><option>Men</option><option>Women</option><option>New Visitors</option></select></div>
      <div className="full"><label>Title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Sunday Service Reminder" /></div>
      <div className="full"><label>Message</label><textarea rows="5" value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write the message to be sent..." /></div>
      <div><label>Schedule (optional)</label><input type="datetime-local" value={schedule} onChange={e=>setSchedule(e.target.value)} /></div>
    </div><div className="toolbar"><button className="primary" onClick={queueCampaign}>Queue notification</button><span className="muted">Recipients: {targetMembers.length}</span></div>{status&&<p className="muted">{status}</p>}<p className="muted sm">Messages are queued first. SMS and other enabled delivery channels require a connected provider before they are actually sent.</p></div>
    <div className="panel"><h2>Recent campaigns</h2><div className="tablewrap"><table><thead><tr><th>Created</th><th>Title</th><th>Channel</th><th>Audience</th><th>Recipients</th><th>Status</th></tr></thead><tbody>{campaigns.map(c=><tr key={c.id}><td>{String(c.created_at||'').slice(0,16).replace('T',' ')}</td><td><b>{c.title}</b></td><td>{c.channel}</td><td>{c.audience}</td><td>{c.recipient_count||0}</td><td>{badge(c.status)}</td></tr>)}{!campaigns.length&&<tr><td colSpan="6" className="empty">No campaigns created yet.</td></tr>}</tbody></table></div></div>
  </>;
}
