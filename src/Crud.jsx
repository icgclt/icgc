import { useEffect, useMemo, useState } from 'react';
import { useAuth, can } from './auth';
import { useData } from './data';
import { supabase } from './supabase';
import { uuid } from './utils';

export function StoragePhoto({ path, bucket = 'member-photos', size = 42, alt = 'Member photo' }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let active = true;
    if (!path) { setUrl(null); return () => { active = false; }; }
    if (typeof path === 'string' && /^https?:\/\//i.test(path)) { setUrl(path); return () => { active = false; }; }
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => { if (active) setUrl(data?.signedUrl || null); });
    return () => { active = false; };
  }, [path, bucket]);
  return url ? <img loading="lazy" decoding="async" src={url} alt={alt} style={{ width: size, height: Math.round(size * 1.25), objectFit: 'cover', borderRadius: 6, display: 'block' }} /> : <div className="photo-thumb-placeholder" style={{ width: size, height: Math.round(size * 1.25) }}>👤</div>;
}

function PhotoField({ f, value, onChange, error }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = null;
    const load = async () => {
      if (value instanceof File) {
        objectUrl = URL.createObjectURL(value);
        if (active) setPreview(objectUrl);
        return;
      }
      if (!value) { if (active) setPreview(null); return; }
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) { if (active) setPreview(value); return; }
      setLoading(true);
      const { data } = await supabase.storage.from(f.bucket || 'member-photos').createSignedUrl(value, 3600);
      if (active) { setPreview(data?.signedUrl || null); setLoading(false); }
    };
    load();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [value, f.bucket]);

  return <div className={f.full ? 'full' : ''}>
    <label htmlFor={'f_' + f.key}>{f.label}</label>
    <div className="photo-field">
      <div className="photo-preview">{preview ? <img src={preview} alt="Member passport photo" /> : <span>{loading ? 'Loading…' : 'No photo'}</span>}</div>
      <div className="photo-actions">
        <input id={'f_' + f.key} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onChange(file); }} />
        {value && <button type="button" className="secondary sm" onClick={() => onChange(null)}>Remove photo</button>}
        <div className="muted sm">Passport photo is resized and compressed before upload. Maximum source size: 5 MB.</div>
      </div>
    </div>
    {error && <div className="err">{error}</div>}
  </div>;
}

function Field({ f, value, error, onChange, list, members }) {
  const common = { id: 'f_' + f.key, value: value ?? '', onChange: (e) => onChange(e.target.value) };
  if (f.type === 'photo') return <PhotoField f={f} value={value} onChange={onChange} error={error} />;
  let input;
  if (f.type === 'member') {
    input = <select {...common}><option value="">Search/select member</option>{(members || []).filter(m => !['Inactive', 'Left'].includes(m.status)).sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(m => <option key={m.id} value={m.id}>{m.member_code || 'No ID'} · {m.name}{m.phone ? ` · ${m.phone}` : ''}</option>)}</select>;
  } else if (f.type === 'select') {
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
        placeholder={f.placeholder}
        readOnly={!!f.readOnly}
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

async function compressMemberPhoto(file, maxWidth = 300, maxHeight = 400, quality = 0.78) {
  if (!(file instanceof File)) return file;
  if (!file.type.startsWith('image/')) throw new Error('Please choose a JPG, PNG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('The selected photo is larger than 5 MB. Please choose a smaller image.');
  const bitmap = await createImageBitmap(file);
  const targetRatio = maxWidth / maxHeight;
  const sourceRatio = bitmap.width / bitmap.height;
  let cropW = bitmap.width;
  let cropH = bitmap.height;
  let sx = 0;
  let sy = 0;
  if (sourceRatio > targetRatio) {
    cropW = Math.round(bitmap.height * targetRatio);
    sx = Math.round((bitmap.width - cropW) / 2);
  } else if (sourceRatio < targetRatio) {
    cropH = Math.round(bitmap.width / targetRatio);
    sy = Math.round((bitmap.height - cropH) / 2);
  }
  const scale = Math.min(maxWidth / cropW, maxHeight / cropH);
  const width = Math.max(1, Math.round(cropW * scale));
  const height = Math.max(1, Math.round(cropH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, cropW, cropH, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not process the photo. Please try another image.');
  return new File([blob], 'passport.jpg', { type: 'image/jpeg', lastModified: Date.now() });
}

export default function Crud({
  table, title, noun, fields, columns,
  filters = [], searchKeys = [], sortKey, sortDir = 'asc', sortCompare, defaults = {}, suggest = {}, onSaved, onDeleted, prepareRecord,
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
    const memberMatches = s ? (data.members || []).filter(m => `${m.name || ''} ${m.member_code || ''} ${m.phone || ''}`.toLowerCase().includes(s)) : [];
    const memberNames = new Set(memberMatches.map(m => String(m.name || '').trim().toLowerCase()));
    const memberIds = new Set(memberMatches.map(m => m.id));
    let r = data[table].filter(
      (x) =>
        (!s || searchKeys.some((k) => String(x[k] ?? '').toLowerCase().includes(s)) ||
          (memberMatches.length > 0 && (memberIds.has(x.member_id) || searchKeys.some(k => ['person_name','member_name','requester','name','giver'].includes(k) && memberNames.has(String(x[k] || '').trim().toLowerCase()))))) &&
        filters.every((f) => !fv[f.key] || String(x[f.key] ?? '') === fv[f.key]),
    );
    if (sortKey) {
      const dir = sortDir === 'desc' ? -1 : 1;
      r = [...r].sort(
        (a, b) => {
          const primary = sortCompare
            ? sortCompare(a, b)
            : String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''));
          return primary * dir || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
        },
      );
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, table, q, fv, sortKey, sortDir, sortCompare]);

  const openForm = (row) => {
    const values = {};
    fields.forEach((f) => { values[f.key] = row ? row[f.key] ?? '' : defaults[f.key] ?? f.default ?? ''; });
    setForm({ original: row || null, values, errors: {} });
  };

  const submit = async (e) => {
    e.preventDefault();
    const errors = {};
    const out = {};
    for (const f of fields) {
      const visible = !f.showIf || f.showIf(form.values);
      if (!visible) continue;
      let v = form.values[f.key];
      if (typeof v === 'string' && f.type !== 'checkbox' && f.type !== 'member') v = v.trim();
      if (f.type === 'member' && f.memberNameKey) {
        const picked = (data.members || []).find(m => m.id === v);
        if (picked) out[f.memberNameKey] = picked.name;
      }
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
    // Client-side uniqueness check for fields explicitly marked as unique.
    // This gives a clear prompt before the record is queued for Supabase.
    for (const f of fields) {
      if (!f.unique || out[f.key] == null || out[f.key] === '') continue;
      const duplicate = data[table].some((row) => row.id !== form.original?.id && String(row[f.key] ?? '').trim().toLowerCase() === String(out[f.key]).trim().toLowerCase());
      if (duplicate) {
        setForm({ ...form, errors: { ...form.errors, [f.key]: `${f.label} already exists. Please enter a different value.` } });
        return;
      }
    }
    const recordId = form.original?.id || uuid();
    let record = { ...(form.original || {}), ...out, id: recordId };
    if (prepareRecord) record = prepareRecord(record, form.original || null) || record;

    // Photo fields are uploaded to Supabase Storage, never stored as binary data in PostgreSQL.
    for (const f of fields.filter((x) => x.type === 'photo')) {
      const photoValue = form.values[f.key];
      const bucket = f.bucket || 'member-photos';
      const oldPath = form.original?.[f.key] || null;
      if (photoValue instanceof File) {
        const compressed = await compressMemberPhoto(photoValue, f.maxWidth || 300, f.maxHeight || 400, f.quality || 0.78);
        const path = `${recordId}/passport.jpg`;
        const { error: uploadError } = await supabase.storage.from(bucket).upload(path, compressed, {
          upsert: true, contentType: 'image/jpeg', cacheControl: '31536000',
        });
        if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);
        record[f.key] = path;
        if (oldPath && oldPath !== path && !/^https?:\/\//i.test(oldPath)) await supabase.storage.from(bucket).remove([oldPath]);
      } else if (photoValue === null && oldPath) {
        if (/^https?:\/\//i.test(oldPath)) { record[f.key] = null; }
        const { error: removeError } = /^https?:\/\//i.test(oldPath) ? { error: null } : await supabase.storage.from(bucket).remove([oldPath]);
        if (removeError) throw new Error(`Could not remove the old photo: ${removeError.message}`);
        record[f.key] = null;
      }
    }

    const result = save(table, record);
    if (result?.duplicate) {
      setForm({ ...form, errors: { ...form.errors, person_name: result.error?.message || 'Attendance has already been marked for this person today.' } });
      return;
    }
    if (onSaved) onSaved(record, form.original || null);
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
                        <button className="danger" onClick={() => { if (confirm('Delete this record?')) { remove(table, r.id); if (onDeleted) onDeleted(r); } }}>
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
          <form className="modalbox" onSubmit={(e) => submit(e).catch((err) => setForm((current) => current ? { ...current, errors: { ...current.errors, __photo: err?.message || 'Photo upload failed' } } : current))}>
            <div className="modalhead">
              <h2>{form.original ? 'Edit' : 'Add'} {noun}</h2>
              <button type="button" className="x" onClick={() => setForm(null)}>×</button>
            </div>
            <div className="formgrid">
              {fields.filter((f) => !f.showIf || f.showIf(form.values)).map((f) => (
                <Field
                  key={f.key}
                  f={f}
                  value={form.values[f.key]}
                  error={form.errors[f.key]}
                  list={suggest[f.key]}
                  members={data.members}
                  onChange={(v) => setForm({ ...form, values: { ...form.values, [f.key]: v }, errors: { ...form.errors, [f.key]: undefined } })}
                />
              ))}
            </div>
            {form.errors.__photo && <div className="err" style={{ marginTop: 8 }}>{form.errors.__photo}</div>}
            <br />
            <button type="submit" className="primary">Save</button>
          </form>
        </div>
      )}
    </>
  );
}
