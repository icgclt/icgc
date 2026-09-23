import { useMemo, useState } from 'react';
import { useAuth, can } from './auth';
import { useData } from './data';
import { uuid } from './utils';

function Field({ f, value, error, onChange, list }) {
  const common = { id: 'f_' + f.key, value: value ?? '', onChange: (e) => onChange(e.target.value) };
  let input;
  if (f.type === 'select') {
    input = (
      <select {...common}>
        {!f.required && <option value=""></option>}
        {f.options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  } else if (f.type === 'textarea') {
    input = <textarea {...common} />;
  } else if (f.type === 'checkbox') {
    input = <input id={'f_' + f.key} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  } else {
    input = (
      <input
        {...common}
        type={f.type || 'text'}
        step={f.step}
        min={f.min}
        list={list ? 'dl_' + f.key : undefined}
        autoComplete="off"
      />
    );
  }
  return (
    <div className={f.full ? 'full' : ''}>
      <label htmlFor={'f_' + f.key}>{f.label}{f.required ? ' *' : ''}</label>
      {input}
      {list && <datalist id={'dl_' + f.key}>{list.map((o) => <option key={o} value={o} />)}</datalist>}
      {error && <div className="err">{error}</div>}
    </div>
  );
}

export default function Crud({
  table, title, noun, fields, columns,
  filters = [], searchKeys = [], sortKey, sortDir = 'asc', defaults = {}, suggest = {},
}) {
  const { data, save, remove } = useData();
  const { role } = useAuth();
  const canWrite = can(role, table, 'write');
  const canDel = can(role, table, 'del');

  const [q, setQ] = useState('');
  const [fv, setFv] = useState({});
  const [limit, setLimit] = useState(100);
  const [form, setForm] = useState(null); // { original, values, errors }

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    let r = data[table].filter(
      (x) =>
        (!s || searchKeys.some((k) => String(x[k] ?? '').toLowerCase().includes(s))) &&
        filters.every((f) => !fv[f.key] || String(x[f.key] ?? '') === fv[f.key]),
    );
    if (sortKey) {
      const dir = sortDir === 'desc' ? -1 : 1;
      r = [...r].sort(
        (a, b) =>
          String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? '')) * dir ||
          String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
      );
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, table, q, fv]);

  const openForm = (row) => {
    const values = {};
    fields.forEach((f) => { values[f.key] = row ? row[f.key] ?? '' : defaults[f.key] ?? f.default ?? ''; });
    setForm({ original: row || null, values, errors: {} });
  };

  const submit = (e) => {
    e.preventDefault();
    const errors = {};
    const out = {};
    for (const f of fields) {
      let v = form.values[f.key];
      if (typeof v === 'string' && f.type !== 'checkbox') v = v.trim();
      if (v === '' && f.fallback) v = f.fallback;
      if (f.required && (v === '' || v == null)) errors[f.key] = 'Required';
      const isText = !f.type || f.type === 'text' || f.type === 'textarea';
      if (v === '' && !isText && f.type !== 'checkbox') v = null;
      if (f.type === 'number' && v !== null) {
        v = Number(v);
        if (!Number.isFinite(v) || (f.gt != null && v <= f.gt)) errors[f.key] = f.gt != null ? `Must be greater than ${f.gt}` : 'Invalid number';
      }
      out[f.key] = v;
    }
    if (Object.keys(errors).length) { setForm({ ...form, errors }); return; }
    save(table, { ...(form.original || {}), ...out, id: form.original?.id || uuid() });
    setForm(null);
  };

  const shown = rows.slice(0, limit);

  return (
    <>
      <div className="top">
        <h1>{title}</h1>
        {canWrite && <button className="primary" onClick={() => openForm(null)}>+ Add {noun}</button>}
      </div>
      <div className="panel">
        <div className="toolbar">
          {searchKeys.length > 0 && (
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {filters.map((f) =>
            f.type === 'date' ? (
              <div className="fld" key={f.key}>
                <small>{f.label}</small>
                <input type="date" value={fv[f.key] || ''} onChange={(e) => setFv({ ...fv, [f.key]: e.target.value })} />
              </div>
            ) : (
              <select key={f.key} value={fv[f.key] || ''} onChange={(e) => setFv({ ...fv, [f.key]: e.target.value })}>
                <option value="">{f.label}</option>
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ),
          )}
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                {columns.map((c) => <th key={c.label}>{c.label}</th>)}
                {(canWrite || canDel) && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  {columns.map((c) => <td key={c.label}>{c.render ? c.render(r) : r[c.key]}</td>)}
                  {(canWrite || canDel) && (
                    <td className="actions">
                      {canWrite && <button className="secondary" onClick={() => openForm(r)}>Edit</button>}
                      {canDel && (
                        <button className="danger" onClick={() => { if (confirm('Delete this record?')) remove(table, r.id); }}>
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={columns.length + 1} className="empty">No records found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="rowcount">
          Showing {shown.length} of {rows.length}
          {rows.length > limit && <button className="secondary sm" onClick={() => setLimit(limit + 100)}>Show more</button>}
        </div>
      </div>

      {form && (
        <div className="modal show" onMouseDown={(e) => { if (e.target === e.currentTarget) setForm(null); }}>
          <form className="modalbox" onSubmit={submit}>
            <div className="modalhead">
              <h2>{form.original ? 'Edit' : 'Add'} {noun}</h2>
              <button type="button" className="x" onClick={() => setForm(null)}>×</button>
            </div>
            <div className="formgrid">
              {fields.map((f) => (
                <Field
                  key={f.key}
                  f={f}
                  value={form.values[f.key]}
                  error={form.errors[f.key]}
                  list={suggest[f.key]}
                  onChange={(v) => setForm({ ...form, values: { ...form.values, [f.key]: v }, errors: { ...form.errors, [f.key]: undefined } })}
                />
              ))}
            </div>
            <br />
            <button type="submit" className="primary">Save</button>
          </form>
        </div>
      )}
    </>
  );
}
