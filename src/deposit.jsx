import { useEffect, useMemo, useState } from 'react';
import { useData } from './data';
import { useAuth, can } from './auth';
import { uuid, today } from './utils';
import {
  NOTES, num, r2, gh, esc, fmtDate, fmtDT, nowLocal, addDays, amountWords,
  suggestNotes, countedFor, cashValue, computeSlip, nextWorkingDay, fmtLongDate,
} from './depositHelpers';

const CHURCH = import.meta.env.VITE_CHURCH_NAME || 'ICGC Dominion Temple';
const blankCheques = () => [{ no: '', bank: '', amount: '' }, { no: '', bank: '', amount: '' }, { no: '', bank: '', amount: '' }];
const STATUS_STYLE = {
  Prepared: { background: '#fff4dc', color: '#8a5a00' },
  Deposited: { background: '#dff3e4', color: '#16642f' },
  Acknowledged: { background: '#dde9fb', color: '#1b4a99' },
};
const StatusBadge = ({ status }) => (
  <span className="badge" style={STATUS_STYLE[status] || {}}>{status}</span>
);

// ---------------------------------------------------------------- printing
function printSlip(v) {
  const rows = v.rows.map((r) => `<tr><td>GHS ${r.d}</td><td class="r">${r.total || ''}</td><td class="r">${r.total ? (r.amount).toFixed(2) : ''}</td></tr>`).join('');
  const chq = v.cheques.map((c) => `<tr><td>${esc(c.no)}&nbsp;</td><td>${esc(c.bank)}</td><td class="r">${num(c.amount) ? num(c.amount).toFixed(2) : ''}</td></tr>`).join('');
  const html = `<html><head><title>Deposit Slip ${esc(fmtDate(v.slipDate))}</title><style>
  @page{size:A4;margin:14mm}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;margin:0}
  .slip{border:2px solid #111;padding:16px 20px;max-width:720px;margin:auto}
  h1{text-align:center;margin:0;font-size:20px;letter-spacing:1px}
  h2{text-align:center;margin:2px 0 4px;font-size:14px}
  .sub{text-align:center;font-size:10px;color:#444;margin-bottom:10px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin:6px 0}
  .f{border-bottom:1px solid #111;padding:3px 0;min-height:16px}
  .f b{font-weight:bold}
  .full{grid-column:1/3}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  th,td{border:1px solid #111;padding:4px 6px}
  th{background:#eee;text-align:left}
  .r{text-align:right}
  .tot td{font-weight:bold;background:#f4f4f4}
  .sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-top:34px}
  .sig div{border-top:1px solid #111;padding-top:4px;font-size:11px;text-align:center}
  .bank{border:1px dashed #555;padding:8px;margin-top:16px;font-size:11px}
  .note{font-size:10px;color:#555;margin-top:8px}
  .box{display:inline-block;width:11px;height:11px;border:1px solid #111;margin:0 3px -2px 8px;text-align:center;line-height:11px;font-size:10px}
  </style></head><body><div class="slip">
  <h1>${esc((v.bankName || 'BANK').toUpperCase())}</h1>
  <h2>CASH / CHEQUE DEPOSIT SLIP</h2>
  <div class="sub">${esc(CHURCH)}</div>
  <div class="grid">
    <div class="f"><b>Branch:</b> ${esc(v.branch)}</div>
    <div class="f"><b>Date (DD/MM/YYYY):</b> ${esc(fmtDate(v.slipDate))}</div>
    <div class="f"><b>Currency:</b> <span class="box">${v.currency === 'GHS' ? '&#10003;' : ''}</span>GHS <span class="box">${v.currency === 'USD' ? '&#10003;' : ''}</span>USD <span class="box">${v.currency === 'GBP' ? '&#10003;' : ''}</span>GBP <span class="box">${v.currency === 'EUR' ? '&#10003;' : ''}</span>EUR</div>
    <div class="f"><b>Account type:</b> <span class="box">${v.accountType === 'Savings' ? '&#10003;' : ''}</span>Savings <span class="box">${v.accountType === 'Current' ? '&#10003;' : ''}</span>Current</div>
    <div class="f full"><b>Account Number:</b> ${esc(v.accountNumber)}</div>
    <div class="f full"><b>Account Name:</b> ${esc(v.accountName)}</div>
    <div class="f full"><b>Depositor's Full Name:</b> ${esc(v.depositor)}</div>
    <div class="f"><b>Phone Number:</b> ${esc(v.phone)}</div>
    <div class="f"><b>ID Type &amp; Number:</b> ${esc(v.idno)}</div>
    <div class="f full"><b>Purpose / Source of Funds:</b> ${esc(v.purpose)}</div>
  </div>
  <table><tr><th>Denomination</th><th class="r">No. of Notes</th><th class="r">Amount (GHS)</th></tr>
  ${rows}
  <tr><td>Coins</td><td class="r"></td><td class="r">${v.coinsAmount ? v.coinsAmount.toFixed(2) : ''}</td></tr>
  <tr class="tot"><td colspan="2">TOTAL CASH</td><td class="r">${v.totalCash.toFixed(2)}</td></tr></table>
  <b>CHEQUE DETAILS (if applicable)</b>
  <table><tr><th>Cheque No.</th><th>Drawer's Bank</th><th class="r">Amount</th></tr>${chq}
  <tr class="tot"><td colspan="2">TOTAL CHEQUES (GHS):</td><td class="r">${v.chequeTotal ? v.chequeTotal.toFixed(2) : ''}</td></tr></table>
  <div class="f"><b>TOTAL DEPOSIT (GHS) in figures:</b> ${v.totalDeposit.toFixed(2)}</div>
  <div class="f"><b>Amount in words:</b> ${esc(amountWords(v.totalDeposit))}</div>
  <div class="sig"><div>Depositor's Signature</div><div>Teller's Signature / Stamp</div><div>Date &amp; Time</div></div>
  <div class="bank"><b>FOR BANK USE ONLY:</b><br><br>Transaction Ref: ____________________ &nbsp;&nbsp; Verified by: ____________________</div>
  <div class="note">Prepared from the weekly offering report of ${esc(fmtDate(v.reportDate))} (Week ${esc(v.weekNo)}).${v.withdraw ? ` Includes ${esc(gh(v.withdraw))} withdrawn from Mobile Money / online payments.` : ''}</div>
  </div><script>window.onload=function(){window.print();}</script></body></html>`;
  const w = window.open('', '_blank', 'width=860,height=1000');
  if (w) { w.opener = null; w.document.write(html); w.document.close(); } else alert('Please allow pop-ups for this site to print the slip.');
}

// ---------------------------------------------------------------- main screen
export function DepositSlip() {
  const { data, save, remove } = useData();
  const { role, profile } = useAuth();
  const allowed = ['super_admin', 'admin', 'finance', 'finance_reviewer', 'pastor'].includes(role);
  const canManage = can(role, 'offering_deposits', 'write');
  const isPastor = role === 'pastor';

  const reports = useMemo(() => [...(data.finance_weekly_reports || [])]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.week_no || 0) - (a.week_no || 0)), [data.finance_weekly_reports]);
  const deposits = data.offering_deposits || [];
  const settings = (data.bank_deposit_settings || [])[0];
  const holidays = data.public_holidays || [];
  const holidaySet = useMemo(() => new Set((data.public_holidays || []).map((h) => String(h.holiday_date).slice(0, 10))), [data.public_holidays]);
  const alertSettings = (data.deposit_alert_settings || [])[0];

  const [reportId, setReportId] = useState('');
  const report = reports.find((r) => r.id === reportId) || reports[0];
  const rid = report?.id;
  const deposit = deposits.find((d) => d.report_id === rid);
  const locked = !!deposit && deposit.status !== 'Prepared';
  const dueDate = report ? nextWorkingDay(report.date, holidaySet) : null;
  const isDone = !!deposit && ['Deposited', 'Acknowledged'].includes(deposit.status);
  const overdue = !!dueDate && !isDone && new Date().toISOString() >= `${dueDate}T12:00:00.000Z`;

  const [msg, setMsg] = useState('');
  const [showBank, setShowBank] = useState(false);
  const [bank, setBank] = useState({});
  useEffect(() => {
    setBank({
      bank_name: settings?.bank_name || '', branch: settings?.branch || '', account_type: settings?.account_type || 'Current',
      account_number: settings?.account_number || '', account_name: settings?.account_name || '', currency: settings?.currency || 'GHS',
      default_purpose: settings?.default_purpose || 'Weekly church offering',
      depositor_name: settings?.depositor_name || '', depositor_phone: settings?.depositor_phone || '', depositor_id: settings?.depositor_id || '',
    });
  }, [settings?.id, settings?.updated_at]);
  const bankSaved = !!(settings?.bank_name && settings?.account_number);

  // live counted figures from the weekly report
  const live = useMemo(() => (rid ? countedFor(rid, data) : { notes: {}, coinAmt: 0, coinPieces: 0, momo: 0 }), [
    rid, data.finance_weekly_cash_counts, data.finance_weekday_collections, data.finance_weekday_cash_counts, data.finance_weekly_momo, data.finance_weekday_momo,
  ]);

  const blankForm = () => ({ extra: {}, extraCoins: '', withdrawOverride: '', includeOnline: true, onlineFrom: '', onlineTo: '', cheques: blankCheques(), depositor: '', phone: '', idno: '', purpose: '', slipDate: today() });
  const [form, setForm] = useState(blankForm());
  const [baseline, setBaseline] = useState('');
  const loadKey = `${rid}|${deposit?.id || ''}|${deposit?.updated_at || ''}|${deposit ? '' : settings?.updated_at || ''}`;
  useEffect(() => {
    if (!report) return;
    let f;
    if (deposit?.slip) {
      const s = deposit.slip;
      f = {
        extra: s.extra || {}, extraCoins: s.extraCoins ?? '', withdrawOverride: s.withdrawOverride ?? '', includeOnline: s.includeOnline !== false,
        onlineFrom: s.onlineFrom || addDays(report.date, -6), onlineTo: s.onlineTo || report.date,
        cheques: s.cheques?.length ? s.cheques : blankCheques(),
        depositor: deposit.depositor_name || '', phone: deposit.depositor_phone || '', idno: deposit.depositor_id || '',
        purpose: deposit.purpose || '', slipDate: deposit.slip_date || today(),
      };
    } else {
      f = {
        ...blankForm(), onlineFrom: addDays(report.date, -6), onlineTo: report.date,
        depositor: settings?.depositor_name || profile?.full_name || '', phone: settings?.depositor_phone || '', idno: settings?.depositor_id || '',
        purpose: settings?.default_purpose || 'Weekly church offering',
      };
    }
    setForm(f); setBaseline(JSON.stringify(f));
  }, [loadKey]);
  const dirty = !locked && JSON.stringify(form) !== baseline;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // online (portal) payments in the chosen window
  const onlineRows = useMemo(() => (data.payment_receipts || []).filter((p) => p.status === 'Paid'
    && String(p.method || '').toLowerCase() !== 'cash'
    && form.onlineFrom && form.onlineTo
    && String(p.paid_at || '').slice(0, 10) >= form.onlineFrom && String(p.paid_at || '').slice(0, 10) <= form.onlineTo), [data.payment_receipts, form.onlineFrom, form.onlineTo]);
  const onlineLive = r2(onlineRows.reduce((s, p) => s + num(p.amount), 0));

  const counted = locked && deposit?.slip?.counted ? deposit.slip.counted : live;
  const momoTotal = locked && deposit?.slip ? num(deposit.slip.momoTotal) : live.momo;
  const onlineTotal = locked && deposit?.slip ? num(deposit.slip.onlineTotal) : onlineLive;
  const calc = computeSlip({ counted, momoTotal, onlineTotal, form });
  const cashCounted = cashValue(counted);
  const stale = !!deposit && deposit.status === 'Prepared' && deposit.slip?.counted
    && Math.abs(cashValue(deposit.slip.counted) - cashValue(live)) > 0.004;

  const bView = locked ? deposit : null;
  const view = {
    bankName: bView?.bank_name ?? settings?.bank_name ?? '', branch: bView?.branch ?? settings?.branch ?? '',
    accountNumber: bView?.account_number ?? settings?.account_number ?? '', accountName: bView?.account_name ?? settings?.account_name ?? '',
    accountType: bView?.account_type ?? settings?.account_type ?? '', currency: bView?.currency ?? settings?.currency ?? 'GHS',
    depositor: form.depositor, phone: form.phone, idno: form.idno, purpose: form.purpose, slipDate: form.slipDate,
    rows: calc.rows, coinsAmount: calc.coinsAmount, totalCash: calc.totalCash, cheques: form.cheques, chequeTotal: calc.chequeTotal,
    totalDeposit: calc.totalDeposit, withdraw: calc.withdraw, reportDate: report?.date, weekNo: report?.week_no,
  };

  // ---- actions
  const saveBank = () => {
    if (!bank.bank_name.trim() || !bank.account_number.trim()) { setMsg('Enter at least the bank name and account number.'); return; }
    save('bank_deposit_settings', { id: settings?.id || uuid(), singleton: true, ...bank,
      bank_name: bank.bank_name.trim(), branch: bank.branch.trim(), account_number: bank.account_number.trim(), account_name: bank.account_name.trim() });
    setShowBank(false); setMsg('Bank details saved. Every new slip will fill them in automatically.');
  };
  const saveSlip = () => {
    if (!report) return;
    const slip = {
      extra: form.extra, extraCoins: form.extraCoins, withdrawOverride: form.withdrawOverride, includeOnline: form.includeOnline,
      onlineFrom: form.onlineFrom, onlineTo: form.onlineTo, cheques: form.cheques,
      counted: { notes: live.notes, coinAmt: live.coinAmt, coinPieces: live.coinPieces }, momoTotal: live.momo, onlineTotal: onlineLive, withdraw: calc.withdraw,
    };
    save('offering_deposits', {
      ...(deposit || {}), id: deposit?.id || uuid(), report_id: report.id, report_date: report.date, week_no: report.week_no,
      slip, slip_date: form.slipDate, total_cash: calc.totalCash, withdrawn_amount: calc.withdraw, cheque_total: calc.chequeTotal, total_deposit: calc.totalDeposit,
      bank_name: settings?.bank_name || '', branch: settings?.branch || '', account_number: settings?.account_number || '', account_name: settings?.account_name || '',
      account_type: settings?.account_type || '', currency: settings?.currency || 'GHS',
      depositor_name: form.depositor, depositor_phone: form.phone, depositor_id: form.idno, purpose: form.purpose,
      status: 'Prepared', prepared_by_name: deposit?.prepared_by_name || profile?.full_name || '',
    });
    setMsg('Deposit slip saved. Print it, take it to the bank, then come back and mark it as deposited.');
  };
  const deleteSlip = () => {
    if (!deposit || !confirm('Delete this saved slip? The weekly report is not affected.')) return;
    remove('offering_deposits', deposit.id); setMsg('Slip deleted.');
  };

  const [depAt, setDepAt] = useState(nowLocal());
  const [depRef, setDepRef] = useState('');
  const [depNote, setDepNote] = useState('');
  const [depSerial, setDepSerial] = useState('');
  const [holDate, setHolDate] = useState('');
  const [holName, setHolName] = useState('');
  const [alertDraft, setAlertDraft] = useState(null);
  const [ackNote, setAckNote] = useState('');
  const markDeposited = () => {
    if (!deposit || dirty) return;
    if (!depSerial.trim()) { setMsg('Enter the serial number printed on the deposit form first.'); return; }
    if (!calc.balanced) { setMsg('The slip does not balance yet. Share out the withdrawn Mobile Money / online money first.'); return; }
    if (!confirm(`Confirm that ${gh(deposit.total_deposit)} has been deposited at the bank with deposit form serial no. ${depSerial.trim()}? The slip will be locked${alertSettings?.alerts_enabled ? ' and an SMS will go to the Pastor and the Finance Reviewer' : ''}.`)) return;
    save('offering_deposits', { ...deposit, status: 'Deposited', deposited_at: new Date(depAt || Date.now()).toISOString(),
      deposited_by_name: profile?.full_name || '', slip_serial_no: depSerial.trim(), bank_reference: depRef.trim(), deposit_note: depNote.trim() });
    setMsg(`Marked as deposited. The Pastor can now see it.${alertSettings?.alerts_enabled ? ' The Pastor and Finance Reviewer will receive an SMS with the serial number.' : ' SMS alerts are switched off, so no SMS was sent.'}`);
    setDepSerial('');
  };
  const undoDeposit = () => {
    if (!deposit || !confirm('Undo "Deposited"? Use this only if it was marked by mistake.')) return;
    save('offering_deposits', { ...deposit, status: 'Prepared', slip_serial_no: null }); setMsg('Deposit undone. The slip is open for editing again.');
  };
  const acknowledge = () => {
    if (!deposit || !confirm(`Acknowledge that the offering of ${gh(deposit.total_deposit)} for ${fmtDate(deposit.report_date)} has been deposited?`)) return;
    save('offering_deposits', { ...deposit, status: 'Acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by_name: profile?.full_name || 'Pastor', acknowledgement_note: ackNote.trim() });
    setMsg('Thank you. The deposit is now acknowledged.');
  };

  if (!allowed) return <div className="panel empty">Finance access is restricted.</div>;
  const history = [...deposits].sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));
  const setExtra = (d, v) => set({ extra: { ...form.extra, [d]: v === '' ? '' : Math.max(0, Math.floor(Number(v) || 0)) } });
  const setCheque = (i, k, v) => set({ cheques: form.cheques.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });
  const suggest = () => { const s = suggestNotes(calc.withdraw); set({ extra: s.extra, extraCoins: s.coins || '' }); };

  return <>
    <div className="top">
      <div><h1>Deposit Slip</h1><div className="muted">The week's counted offering, ready to print for the bank, with a record of when it was deposited.</div></div>
      <select value={rid || ''} onChange={(e) => { setReportId(e.target.value); setMsg(''); }}>
        {reports.map((r) => {
          const d = deposits.find((x) => x.report_id === r.id);
          return <option key={r.id} value={r.id}>{fmtDate(r.date)} · Week {r.week_no} · report {r.status}{d ? ` · ${d.status}` : ' · no slip'}</option>;
        })}
      </select>
    </div>
    {msg && <div className="panel" style={{ borderLeft: '4px solid #1f6fb2' }}>{msg}</div>}

    <div className="panel">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Bank details {bankSaved && <span className="badge" style={STATUS_STYLE.Deposited}>Saved</span>}</h2>
        {canManage && <button className="secondary" onClick={() => setShowBank((s) => !s)}>{showBank || !bankSaved ? 'Hide' : bankSaved ? 'Edit' : 'Enter details'}</button>}
      </div>
      {!bankSaved && <p className="muted">Enter these once and save. They fill in on every slip automatically.{!canManage && ' Ask Finance or an Administrator to enter them.'}</p>}
      {bankSaved && !showBank && <p className="muted" style={{ marginBottom: 0 }}><b>{settings.bank_name}</b>{settings.branch ? `, ${settings.branch}` : ''} · {settings.account_type} account · {settings.account_number} · {settings.account_name}</p>}
      {canManage && (showBank || !bankSaved) && <>
        <div className="formgrid">
          <div><label>Bank name</label><input value={bank.bank_name || ''} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} placeholder="e.g. Ghana Commercial Bank" /></div>
          <div><label>Branch</label><input value={bank.branch || ''} onChange={(e) => setBank({ ...bank, branch: e.target.value })} /></div>
          <div><label>Account type</label><select value={bank.account_type || 'Current'} onChange={(e) => setBank({ ...bank, account_type: e.target.value })}><option>Current</option><option>Savings</option></select></div>
          <div><label>Currency</label><select value={bank.currency || 'GHS'} onChange={(e) => setBank({ ...bank, currency: e.target.value })}><option>GHS</option><option>USD</option><option>GBP</option><option>EUR</option></select></div>
          <div><label>Account number</label><input value={bank.account_number || ''} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} /></div>
          <div><label>Account name</label><input value={bank.account_name || ''} onChange={(e) => setBank({ ...bank, account_name: e.target.value })} /></div>
          <div><label>Usual purpose / source of funds</label><input value={bank.default_purpose || ''} onChange={(e) => setBank({ ...bank, default_purpose: e.target.value })} /></div>
          <div><label>Usual depositor (optional)</label><input value={bank.depositor_name || ''} onChange={(e) => setBank({ ...bank, depositor_name: e.target.value })} /></div>
          <div><label>Depositor phone (optional)</label><input value={bank.depositor_phone || ''} onChange={(e) => setBank({ ...bank, depositor_phone: e.target.value })} /></div>
          <div><label>Depositor ID type &amp; number (optional)</label><input value={bank.depositor_id || ''} onChange={(e) => setBank({ ...bank, depositor_id: e.target.value })} placeholder="e.g. Ghana Card GHA-..." /></div>
        </div>
        <div className="toolbar"><button className="primary" onClick={saveBank}>Save bank details</button></div>
      </>}
    </div>

    {alertSettings && <div className="panel">
      <h2 style={{ marginTop: 0 }}>Deposit SMS alerts <span className="badge" style={alertSettings.alerts_enabled ? STATUS_STYLE.Deposited : STATUS_STYLE.Prepared}>{alertSettings.alerts_enabled ? 'ON' : 'OFF'}</span></h2>
      <p className="muted">When a deposit is marked as made, an SMS with the deposit form's serial number goes to the Pastor and the Finance Reviewer. If a Sunday's offering has not been deposited, they are reminded by SMS every day at 12:00 noon, starting on the due day (the next working day after Sunday, skipping weekends and the holidays below). SMS go to every Pastor and Finance Reviewer user whose member record has a phone number, and are sent by the notification worker.</p>
      {canManage && <div className="formgrid">
        <div><label><input type="checkbox" checked={(alertDraft ?? alertSettings).alerts_enabled} onChange={(e) => setAlertDraft({ ...(alertDraft ?? alertSettings), alerts_enabled: e.target.checked })} /> Send deposit SMS alerts</label></div>
        <div><label>Only for offerings dated from</label><input type="date" value={String((alertDraft ?? alertSettings).start_date).slice(0, 10)} onChange={(e) => setAlertDraft({ ...(alertDraft ?? alertSettings), start_date: e.target.value })} /></div>
      </div>}
      {canManage && alertDraft && <div className="toolbar"><button className="primary" onClick={() => { save('deposit_alert_settings', { ...alertSettings, alerts_enabled: alertDraft.alerts_enabled, start_date: alertDraft.start_date }); setAlertDraft(null); setMsg('SMS alert settings saved.'); }}>Save alert settings</button><button className="secondary" onClick={() => setAlertDraft(null)}>Cancel</button></div>}
      {!canManage && <p className="muted">Starting from {String(alertSettings.start_date).slice(0, 10)}. Only Admin and Finance can change this.</p>}
      <h3>Public holidays</h3>
      <p className="muted sm">The deposit is due before noon on the next working day after Sunday. Add a holiday here and a Monday holiday moves the due day to Tuesday.</p>
      {canManage && <div className="toolbar"><input type="date" value={holDate} onChange={(e) => setHolDate(e.target.value)} /><input placeholder="Holiday name (optional)" value={holName} onChange={(e) => setHolName(e.target.value)} /><button className="secondary" disabled={!holDate} onClick={() => { if (holidaySet.has(holDate)) { setMsg('That date is already listed.'); return; } save('public_holidays', { id: uuid(), holiday_date: holDate, name: holName.trim() }); setHolDate(''); setHolName(''); }}>Add holiday</button></div>}
      {[...holidays].sort((a, b) => String(b.holiday_date).localeCompare(String(a.holiday_date))).slice(0, 15).map((h) => <p key={h.id} style={{ margin: '4px 0' }}>{fmtLongDate(h.holiday_date)}{h.name ? ` · ${h.name}` : ''} {canManage && <button className="danger" onClick={() => { if (confirm('Remove this holiday?')) remove('public_holidays', h.id); }}>Remove</button>}</p>)}
      {!holidays.length && <p className="muted">No holidays listed yet.</p>}
    </div>}

    {!report ? <div className="panel empty">No weekly offering reports yet. Record one under Finance → Finance Center first.</div> : <>
      <div className="cards">
        <div className="card"><span className="label">Cash counted</span><strong>{gh(cashCounted)}</strong></div>
        <div className="card"><span className="label">Mobile Money (report)</span><strong>{gh(momoTotal)}</strong></div>
        <div className="card"><span className="label">Online (portal)</span><strong>{gh(onlineTotal)}</strong></div>
        <div className="card"><span className="label">Total to deposit</span><strong>{gh(calc.totalDeposit)}</strong></div>
        <div className="card"><span className="label">Status</span><strong>{deposit ? <StatusBadge status={deposit.status} /> : 'No slip yet'}</strong></div>
        <div className="card"><span className="label">Deposit due</span><strong style={{ fontSize: '1rem' }}>{fmtLongDate(dueDate)}, before 12:00 noon</strong>{overdue && <span className="badge" style={{ background: '#fde2dd', color: '#a8381c' }}>OVERDUE</span>}{isDone && <span className="badge" style={STATUS_STYLE.Deposited}>Done</span>}</div>
      </div>
      {report.status !== 'Approved' && <div className="panel" style={{ borderLeft: '4px solid #d9822b' }}>The weekly report for this date is <b>{report.status}</b>, not yet approved. You can still prepare the slip, but check that the figures are final.</div>}
      {stale && <div className="panel" style={{ borderLeft: '4px solid #c0392b' }}>The weekly report figures have <b>changed</b> since this slip was saved. Click <b>Update slip</b> to refresh it.</div>}

      <fieldset disabled={!canManage || locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="panel">
          <h2>Mobile Money and online payments</h2>
          <p className="muted">Money received by Mobile Money or online is withdrawn and added to the physical cash, so it goes on the same slip. Mobile Money already entered in the weekly report is included automatically. Online (portal) payments are picked up from the receipts in the dates below.</p>
          <div className="formgrid">
            <div><label>Online payments from</label><input type="date" value={form.onlineFrom} onChange={(e) => set({ onlineFrom: e.target.value })} /></div>
            <div><label>to</label><input type="date" value={form.onlineTo} onChange={(e) => set({ onlineTo: e.target.value })} /></div>
            <div><label><input type="checkbox" checked={form.includeOnline} onChange={(e) => set({ includeOnline: e.target.checked })} /> Include online payments ({onlineRows.length} receipt{onlineRows.length === 1 ? '' : 's'}, {gh(onlineTotal)})</label></div>
            <div><label>Amount withdrawn and added to cash (GHS)</label><input type="number" min="0" step="0.01" value={form.withdrawOverride === '' ? calc.withdraw : form.withdrawOverride} onChange={(e) => set({ withdrawOverride: e.target.value })} /></div>
          </div>
          <p className="muted sm">If the Mobile Money amounts in the weekly report already include some online payments, untick the box so they are not counted twice. Change the withdrawn amount if you withdrew a different sum (for example after charges).</p>
          {calc.withdraw > 0 && <div className="toolbar"><button className="secondary" onClick={suggest}>Suggest notes for GHS {calc.withdraw.toFixed(2)}</button><span className="muted">or type the notes you actually received in the column below.</span></div>}
          {calc.withdraw > 0 && <p style={{ margin: '4px 0 0', color: calc.balanced ? '#16642f' : '#a8381c', fontWeight: 600 }}>{calc.balanced ? 'Withdrawn money is fully shared out into notes.' : `Still to share out: ${gh(calc.unallocated)}${calc.unallocated < 0 ? ' (too much entered)' : ''}`}</p>}
        </div>

        <div className="panel">
          <h2>Deposit slip figures</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>Denomination</th><th style={{ textAlign: 'right' }}>Counted notes</th><th style={{ textAlign: 'right' }}>From Mobile Money / online</th><th style={{ textAlign: 'right' }}>No. of notes</th><th style={{ textAlign: 'right' }}>Amount (GHS)</th></tr></thead>
            <tbody>
              {calc.rows.map((r) => <tr key={r.d}>
                <td>GHS {r.d}</td><td style={{ textAlign: 'right' }}>{r.counted || ''}</td>
                <td style={{ textAlign: 'right' }}><input type="number" min="0" style={{ width: 90, textAlign: 'right' }} value={form.extra?.[r.d] ?? ''} onChange={(e) => setExtra(r.d, e.target.value)} /></td>
                <td style={{ textAlign: 'right' }}><b>{r.total || ''}</b></td><td style={{ textAlign: 'right' }}>{r.total ? r.amount.toFixed(2) : ''}</td>
              </tr>)}
              <tr><td>Coins</td><td style={{ textAlign: 'right' }}>{counted.coinAmt ? counted.coinAmt.toFixed(2) : ''}</td>
                <td style={{ textAlign: 'right' }}><input type="number" min="0" step="0.01" style={{ width: 90, textAlign: 'right' }} value={form.extraCoins} onChange={(e) => set({ extraCoins: e.target.value })} /></td>
                <td></td><td style={{ textAlign: 'right' }}>{calc.coinsAmount ? calc.coinsAmount.toFixed(2) : ''}</td></tr>
              <tr><td colSpan={4}><b>TOTAL CASH</b></td><td style={{ textAlign: 'right' }}><b>{calc.totalCash.toFixed(2)}</b></td></tr>
            </tbody></table></div>
          <p className="muted sm">Counted notes come straight from the weekly report (Sunday offerings and weekday collections together), in the same denominations.</p>
        </div>

        <div className="panel">
          <h2>Cheques (if any) and depositor</h2>
          <div className="tablewrap"><table><thead><tr><th>Cheque no.</th><th>Drawer's bank</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>
            {form.cheques.map((c, i) => <tr key={i}><td><input value={c.no} onChange={(e) => setCheque(i, 'no', e.target.value)} /></td><td><input value={c.bank} onChange={(e) => setCheque(i, 'bank', e.target.value)} /></td><td style={{ textAlign: 'right' }}><input type="number" min="0" step="0.01" style={{ width: 120, textAlign: 'right' }} value={c.amount} onChange={(e) => setCheque(i, 'amount', e.target.value)} /></td></tr>)}
          </tbody></table></div>
          <div className="formgrid">
            <div><label>Slip date</label><input type="date" value={form.slipDate} onChange={(e) => set({ slipDate: e.target.value })} /></div>
            <div><label>Depositor's full name</label><input value={form.depositor} onChange={(e) => set({ depositor: e.target.value })} /></div>
            <div><label>Phone number</label><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
            <div><label>ID type &amp; number</label><input value={form.idno} onChange={(e) => set({ idno: e.target.value })} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label>Purpose / source of funds</label><input value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} /></div>
          </div>
          <p><b>TOTAL DEPOSIT:</b> {gh(calc.totalDeposit)}<br /><span className="muted">{amountWords(calc.totalDeposit)}</span></p>
        </div>
      </fieldset>

      <div className="panel">
        <h2>Print and track</h2>
        <div className="toolbar">
          <button className="secondary" onClick={() => printSlip(view)}>🖨 Print slip</button>
          {canManage && !locked && <button className="primary" onClick={saveSlip}>{deposit ? 'Update slip' : 'Save slip'}</button>}
          {canManage && deposit?.status === 'Prepared' && <button className="danger" onClick={deleteSlip}>Delete slip</button>}
        </div>
        {dirty && <p className="muted">You have unsaved changes. Click {deposit ? 'Update slip' : 'Save slip'} before marking it as deposited.</p>}

        {!deposit && <p className="muted">Save the slip first. After the money is banked, the depositor comes back here and marks it as deposited so the Pastor knows.</p>}

        {deposit?.status === 'Prepared' && canManage && <div className="panel" style={{ background: '#f6f9fc', marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Money deposited? Tell the Pastor</h3>
          <p className="muted">After the teller has stamped the slip, enter the serial number from the bank's deposit form and confirm. The slip is then locked, it appears on the Pastor's dashboard, and (when SMS alerts are on) the Pastor and the Finance Reviewer receive an SMS with the serial number.</p>
          <div className="formgrid">
            <div><label>Date and time deposited</label><input type="datetime-local" value={depAt} onChange={(e) => setDepAt(e.target.value)} /></div>
            <div><label>Serial number on the deposit form (required)</label><input value={depSerial} onChange={(e) => setDepSerial(e.target.value)} placeholder="Printed on the bank's deposit slip" /></div>
            <div><label>Bank transaction ref / teller receipt no. (optional)</label><input value={depRef} onChange={(e) => setDepRef(e.target.value)} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label>Note (optional)</label><input value={depNote} onChange={(e) => setDepNote(e.target.value)} /></div>
          </div>
          <div className="toolbar"><button className="primary" disabled={dirty || !calc.balanced || !depSerial.trim()} onClick={markDeposited}>✔ I have deposited this money</button></div>
          {!calc.balanced && <p style={{ color: '#a8381c' }}>Share out the withdrawn Mobile Money / online money first (see above), then save the slip.</p>}
        </div>}
        {deposit?.status === 'Prepared' && !canManage && <p className="muted">Waiting for the depositor to mark this slip as deposited.</p>}

        {deposit?.status === 'Deposited' && <div className="panel" style={{ background: '#eef8f0', marginTop: 12 }}>
          <b>Deposited</b> on {fmtDT(deposit.deposited_at)} by {deposit.deposited_by_name || 'the depositor'}{deposit.slip_serial_no ? ` · Serial no. ${deposit.slip_serial_no}` : ''}{deposit.bank_reference ? ` · Ref ${deposit.bank_reference}` : ''}.{deposit.deposit_note ? ` Note: ${deposit.deposit_note}` : ''}
          {isPastor && <div style={{ marginTop: 10 }}>
            <label>Note (optional)</label><input value={ackNote} onChange={(e) => setAckNote(e.target.value)} />
            <div className="toolbar"><button className="primary" onClick={acknowledge}>Acknowledge deposit</button></div></div>}
          {!isPastor && <p className="muted" style={{ marginBottom: 0 }}>Waiting for the Pastor to acknowledge.</p>}
          {canManage && <div className="toolbar"><button className="secondary" onClick={undoDeposit}>Undo (marked by mistake)</button></div>}
        </div>}

        {deposit?.status === 'Acknowledged' && <div className="panel" style={{ background: '#eaf1fc', marginTop: 12 }}>
          <b>Deposited</b> on {fmtDT(deposit.deposited_at)} by {deposit.deposited_by_name || 'the depositor'}{deposit.slip_serial_no ? ` · Serial no. ${deposit.slip_serial_no}` : ''}{deposit.bank_reference ? ` · Ref ${deposit.bank_reference}` : ''}.<br />
          <b>Acknowledged</b> by {deposit.acknowledged_by_name || 'the Pastor'} on {fmtDT(deposit.acknowledged_at)}.{deposit.acknowledgement_note ? ` Note: ${deposit.acknowledgement_note}` : ''}
        </div>}
      </div>

      <div className="panel"><h2>Deposit history</h2><div className="tablewrap"><table>
        <thead><tr><th>Week</th><th style={{ textAlign: 'right' }}>Total deposit</th><th>Status</th><th>Deposited</th><th>Serial no.</th><th>Bank ref</th><th>Pastor</th><th></th></tr></thead>
        <tbody>{history.map((d) => <tr key={d.id}>
          <td>{fmtDate(d.report_date)} · Week {d.week_no}</td><td style={{ textAlign: 'right' }}>{gh(d.total_deposit)}</td><td><StatusBadge status={d.status} /></td>
          <td>{d.deposited_at ? `${fmtDT(d.deposited_at)} (${d.deposited_by_name || ''})` : ''}</td><td>{d.slip_serial_no || ''}</td><td>{d.bank_reference || ''}</td>
          <td>{d.acknowledged_at ? `${fmtDT(d.acknowledged_at)}` : ''}</td>
          <td><button onClick={() => { setReportId(d.report_id); setMsg(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Open</button></td>
        </tr>)}
          {!history.length && <tr><td colSpan={8} className="empty">No deposit slips saved yet.</td></tr>}</tbody></table></div></div>
    </>}
  </>;
}

// ---------------------------------------------------------------- Pastor dashboard panel
export function DepositAlerts() {
  const { data, save } = useData();
  const { role, profile } = useAuth();
  const deposits = data.offering_deposits || [];
  const reports = data.finance_weekly_reports || [];
  const byReport = new Set(deposits.map((d) => d.report_id));
  const cutoff = addDays(today(), -90);
  const holidaySet = new Set((data.public_holidays || []).map((h) => String(h.holiday_date).slice(0, 10)));
  const dueText = (iso) => { const d = nextWorkingDay(iso, holidaySet); return ` · due ${fmtDate(d)} 12:00${new Date().toISOString() >= `${d}T12:00:00.000Z` ? ' · OVERDUE' : ''}`; };
  const awaitingAck = deposits.filter((d) => d.status === 'Deposited').sort((a, b) => String(b.deposited_at).localeCompare(String(a.deposited_at)));
  const notDeposited = deposits.filter((d) => d.status === 'Prepared');
  const noSlip = reports.filter((r) => ['Submitted', 'Checked', 'Approved'].includes(r.status) && !byReport.has(r.id) && num(r.grand_total) > 0 && String(r.date) >= cutoff)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const recent = deposits.filter((d) => d.status === 'Acknowledged').sort((a, b) => String(b.acknowledged_at).localeCompare(String(a.acknowledged_at))).slice(0, 3);
  const ack = (d) => {
    if (!confirm(`Acknowledge that ${gh(d.total_deposit)} for ${fmtDate(d.report_date)} has been deposited?`)) return;
    save('offering_deposits', { ...d, status: 'Acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by_name: profile?.full_name || 'Pastor', acknowledgement_note: '' });
  };
  return <div className="panel">
    <h2>Offering deposits</h2>
    <div className="cards">
      <div className="card"><span className="label">Deposited, awaiting your acknowledgement</span><strong>{awaitingAck.length}</strong></div>
      <div className="card"><span className="label">Slip prepared, not yet deposited</span><strong>{notDeposited.length}</strong></div>
      <div className="card"><span className="label">Counted, no slip yet (90 days)</span><strong>{noSlip.length}</strong></div>
    </div>
    {awaitingAck.map((d) => <p key={d.id} style={{ margin: '6px 0' }}>
      <b>{fmtDate(d.report_date)} · Week {d.week_no}</b>: {gh(d.total_deposit)} deposited {fmtDT(d.deposited_at)} by {d.deposited_by_name || 'the depositor'}{d.slip_serial_no ? ` · serial no. ${d.slip_serial_no}` : ''}{d.bank_reference ? ` (ref ${d.bank_reference})` : ''}{' '}
      {role === 'pastor' && <button className="primary" onClick={() => ack(d)}>Acknowledge</button>}
    </p>)}
    {notDeposited.map((d) => <p key={d.id} className="muted" style={{ margin: '6px 0' }}>Not yet deposited: {fmtDate(d.report_date)} · Week {d.week_no}, {gh(d.total_deposit)}{dueText(d.report_date)}</p>)}
    {noSlip.map((r) => <p key={r.id} className="muted" style={{ margin: '6px 0' }}>No deposit slip yet: {fmtDate(r.date)} · Week {r.week_no}, {gh(r.grand_total)} counted{dueText(r.date)}</p>)}
    {recent.length > 0 && <p className="muted sm" style={{ marginTop: 10 }}>Recently acknowledged: {recent.map((d) => `${fmtDate(d.report_date)} (${gh(d.total_deposit)})`).join(' · ')}</p>}
    {!awaitingAck.length && !notDeposited.length && !noSlip.length && <p className="muted">All counted offerings are deposited and acknowledged.</p>}
  </div>;
}
