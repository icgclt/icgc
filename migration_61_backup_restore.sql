-- V61: Backup & Restore
--  * Automatic daily snapshots kept inside the database (undo button for accidents / bad edits).
--  * Manual snapshots and an automatic "pre-restore" snapshot taken before every restore.
--  * An all-or-nothing restore: either the whole restore succeeds, or nothing changes.
--  * Restore bypasses the finance lock/workflow guards, audit and history triggers ONLY inside the
--    restore transaction, so locked/approved finance records come back exactly as they were.
-- Safe to run more than once. Run in the Supabase SQL Editor (as the postgres owner).
-- NOTE: snapshots live in the SAME database. They protect against mistakes, not against losing the
-- whole Supabase project. Also download a backup file regularly (Settings > Backup) and keep it elsewhere.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.backup_snapshots (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null default 'manual' check (kind in ('auto','manual','pre-restore')),
  note        text,
  created_by  uuid default auth.uid(),
  row_counts  jsonb not null default '{}'::jsonb,
  total_rows  integer not null default 0,
  size_bytes  bigint not null default 0,
  checksum    text,
  data        jsonb not null
);
create index if not exists backup_snapshots_created_idx on public.backup_snapshots (created_at desc);
alter table public.backup_snapshots enable row level security;
drop policy if exists backup_snapshots_select on public.backup_snapshots;
create policy backup_snapshots_select on public.backup_snapshots for select to authenticated
  using (public.app_role() = 'admin');
revoke all on public.backup_snapshots from public, anon, authenticated;
grant select on public.backup_snapshots to authenticated;

-- Holds an uploaded backup in small pieces while it is being restored. Only the functions below touch it.
create table if not exists public.backup_restore_staging (
  session_id uuid not null,
  table_name text not null,
  seq        integer not null,
  rows       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, table_name, seq)
);
alter table public.backup_restore_staging enable row level security;
revoke all on public.backup_restore_staging from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
-- Every restorable table, parents first (so foreign keys are satisfied when inserting in this order).
create or replace function public.backup_table_list() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'branches','families','members','children','departments','groups','events','volunteers',
    'welfare_members','finance_weekly_reports','finance_weekday_collections',
    'notification_campaigns','communication_templates',
    'attendance','attendance_headcount','giving','offering_entries','member_contributions',
    'welfare_transactions','expenditures','cashbook_entries','visitors','follow_ups','prayer_requests',
    'service_plans','pastoral_cases','event_registrations','announcements','child_checkins',
    'department_members','group_members','group_attendance','pledges','payment_receipts',
    'communication_queue','finance_reconciliations','notification_logs','payment_requests',
    'payment_webhook_events','member_notification_preferences','member_group_history',
    'member_status_history','abc_class_attendance','finance_weekly_cash_counts','finance_weekly_momo',
    'finance_weekday_cash_counts','finance_weekday_momo','volunteer_schedules','finance_workflow_audit'
  ]::text[]
$$;
revoke all on function public.backup_table_list() from public, anon;
grant execute on function public.backup_table_list() to authenticated;

create or replace function public._backup_assert_admin() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- app_role() is null for anonymous callers, so they are rejected too.
  if coalesce(public.app_role(), '') <> 'admin' then
    raise exception 'Only an administrator can use backup and restore.' using errcode = '42501';
  end if;
end $$;
revoke all on function public._backup_assert_admin() from public, anon, authenticated;

create or replace function public._build_backup_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; v_rows jsonb; v_result jsonb := '{}'::jsonb;
begin
  foreach t in array public.backup_table_list() loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_rows;
      v_result := v_result || jsonb_build_object(t, v_rows);
    end if;
  end loop;
  return v_result;
end $$;
revoke all on function public._build_backup_data() from public, anon, authenticated;

create or replace function public._take_snapshot(p_kind text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_data jsonb; v_counts jsonb := '{}'::jsonb; v_total integer := 0; v_n integer; t text;
  v_text text; v_sum text; v_id uuid; v_last text;
begin
  v_data := public._build_backup_data();
  v_text := v_data::text;
  v_sum  := md5(v_text);
  -- Skip an automatic snapshot when nothing has changed since the previous automatic one.
  if p_kind = 'auto' then
    select checksum into v_last from public.backup_snapshots where kind = 'auto' order by created_at desc limit 1;
    if v_last is not null and v_last = v_sum then
      return jsonb_build_object('skipped', true, 'reason', 'no changes since the last automatic snapshot');
    end if;
  end if;
  for t in select jsonb_object_keys(v_data) loop
    v_n := jsonb_array_length(v_data -> t);
    v_counts := v_counts || jsonb_build_object(t, v_n);
    v_total := v_total + v_n;
  end loop;
  insert into public.backup_snapshots (kind, note, created_by, row_counts, total_rows, size_bytes, checksum, data)
  values (p_kind, p_note, auth.uid(), v_counts, v_total, octet_length(v_text), v_sum, v_data)
  returning id into v_id;
  -- Retention: 14 automatic, 20 manual, 10 pre-restore snapshots.
  delete from public.backup_snapshots where kind = 'auto' and id not in
    (select id from public.backup_snapshots where kind = 'auto' order by created_at desc limit 14);
  delete from public.backup_snapshots where kind = 'manual' and id not in
    (select id from public.backup_snapshots where kind = 'manual' order by created_at desc limit 20);
  delete from public.backup_snapshots where kind = 'pre-restore' and id not in
    (select id from public.backup_snapshots where kind = 'pre-restore' order by created_at desc limit 10);
  return jsonb_build_object('id', v_id, 'total_rows', v_total, 'size_bytes', octet_length(v_text), 'row_counts', v_counts);
end $$;
revoke all on function public._take_snapshot(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- restore engine
create or replace function public._restore_core(p_data jsonb, p_mode text, p_tables text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_all text[] := public.backup_table_list();
  v_sel text[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_result jsonb := '{}'::jsonb;
  t text; i integer; col text; cur text := '(start)';
  v_pk text[]; v_cols text[]; v_authfk text[]; v_sample jsonb;
  v_ins text; v_sel_expr text; v_set text; v_pk_csv text; v_join text;
  n_ins integer; n_upd integer; n_del integer; v_seq text;
begin
  if p_mode not in ('merge', 'replace') then raise exception 'Unknown restore mode "%"', p_mode; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'The backup data is empty or invalid.'; end if;

  foreach t in array v_all loop
    if p_data ? t and jsonb_typeof(p_data -> t) = 'array' and (p_tables is null or t = any(p_tables)) then
      if to_regclass(format('public.%I', t)) is null then
        v_skipped := v_skipped || to_jsonb(t);
      else
        v_sel := v_sel || t;
      end if;
    end if;
  end loop;
  if coalesce(array_length(v_sel, 1), 0) = 0 then
    return jsonb_build_object('tables', '{}'::jsonb, 'skipped', v_skipped, 'note', 'Nothing to restore.');
  end if;

  begin
    -- Bypass finance guards / audit / history triggers for these tables, inside this transaction only.
    -- (Foreign-key constraints stay enforced. If anything fails below, the disable is rolled back too.)
    foreach t in array v_sel loop
      cur := t;
      execute format('alter table public.%I disable trigger user', t);
    end loop;

    -- Phase 1 (exact-copy mode only): remove rows that are not in the backup, children first.
    if p_mode = 'replace' then
      for i in reverse array_length(v_sel, 1) .. 1 loop
        t := v_sel[i]; cur := t;
        select array_agg(a.attname::text order by a.attnum) into v_pk
          from pg_index x join pg_attribute a on a.attrelid = x.indrelid and a.attnum = any (x.indkey)
         where x.indrelid = format('public.%I', t)::regclass and x.indisprimary;
        if v_pk is null then raise exception 'table has no primary key'; end if;
        select string_agg(format('r.%I', k), ', ') into v_pk_csv from unnest(v_pk) k;
        select string_agg(format('k.%I = d.%I', k, k), ' and ') into v_join from unnest(v_pk) k;
        execute format('create temp table _bk_keys on commit drop as select %s from public.%I r where false', v_pk_csv, t);
        execute format('insert into _bk_keys select %s from jsonb_populate_recordset(null::public.%I, $1 -> %L) r',
                       v_pk_csv, t, t) using p_data;
        execute format('delete from public.%I d where not exists (select 1 from _bk_keys k where %s)', t, v_join);
        get diagnostics n_del = row_count;
        execute 'drop table _bk_keys';
        v_result := v_result || jsonb_build_object(t, jsonb_build_object('deleted', n_del));
      end loop;
    end if;

    -- Phase 2: insert missing rows and update existing ones, parents first.
    foreach t in array v_sel loop
      cur := t;
      n_del := coalesce((v_result -> t ->> 'deleted')::integer, 0);
      v_sample := p_data -> t -> 0;
      if v_sample is null then
        v_result := v_result || jsonb_build_object(t, jsonb_build_object('inserted', 0, 'updated', 0, 'deleted', n_del, 'in_backup', 0));
        continue;
      end if;
      select array_agg(a.attname::text order by a.attnum) into v_pk
        from pg_index x join pg_attribute a on a.attrelid = x.indrelid and a.attnum = any (x.indkey)
       where x.indrelid = format('public.%I', t)::regclass and x.indisprimary;
      if v_pk is null then raise exception 'table has no primary key'; end if;
      -- Only columns that exist in this database AND in the backup (older backups may miss newer columns).
      select array_agg(c.column_name::text order by c.ordinal_position) into v_cols
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t and c.is_generated = 'NEVER'
         and (c.is_identity = 'NO' or c.identity_generation = 'BY DEFAULT')
         and v_sample ? c.column_name::text;
      if v_cols is null or not (v_pk <@ v_cols) then raise exception 'the backup is missing the key column(s) of this table'; end if;
      -- Columns pointing at auth.users: keep the value only if that user still exists in THIS project.
      select coalesce(array_agg(a.attname::text), '{}') into v_authfk
        from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.conrelid = format('public.%I', t)::regclass;

      select string_agg(format('%I', k), ', ') into v_ins from unnest(v_cols) k;
      select string_agg(
               case when k = any (v_authfk) then format('case when exists (select 1 from auth.users u where u.id = r.%I) then r.%I end', k, k)
                    when k = 'updated_at' then 'now()'
                    else format('r.%I', k) end, ', ') into v_sel_expr
        from unnest(v_cols) k;
      select string_agg(format('%I', k), ', ') into v_pk_csv from unnest(v_pk) k;
      select string_agg(format('%I = excluded.%I', k, k), ', ') into v_set from unnest(v_cols) k where not (k = any (v_pk));

      execute format(
        'with up as (insert into public.%1$I (%2$s) select %3$s from jsonb_populate_recordset(null::public.%1$I, $1 -> %4$L) r where true '
        || 'on conflict (%5$s) do %6$s returning (xmax = 0) as was_insert) '
        || 'select count(*) filter (where was_insert), count(*) filter (where not was_insert) from up',
        t, v_ins, v_sel_expr, t, v_pk_csv,
        case when v_set is null then 'nothing' else 'update set ' || v_set end)
        into n_ins, n_upd using p_data;

      -- Keep identity/serial counters ahead of the restored ids.
      if array_length(v_pk, 1) = 1 then
        v_seq := pg_get_serial_sequence(format('public.%I', t), v_pk[1]);
        if v_seq is not null then
          execute format('select setval(%L, greatest(coalesce((select max(%I) from public.%I), 0), 1), (select max(%I) from public.%I) is not null)',
                         v_seq, v_pk[1], t, v_pk[1], t);
        end if;
      end if;
      v_result := v_result || jsonb_build_object(t, jsonb_build_object(
        'inserted', n_ins, 'updated', n_upd, 'deleted', n_del, 'in_backup', jsonb_array_length(p_data -> t)));
    end loop;

    foreach t in array v_sel loop
      cur := t;
      execute format('alter table public.%I enable trigger user', t);
    end loop;
  exception when others then
    raise exception 'Restore failed on "%" - nothing was changed. Reason: %', cur, sqlerrm using errcode = sqlstate;
  end;

  return jsonb_build_object('tables', v_result, 'skipped', v_skipped, 'mode', p_mode);
end $$;
revoke all on function public._restore_core(jsonb, text, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------- public (admin-only) entry points
create or replace function public.create_backup_snapshot(p_note text default null, p_kind text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._backup_assert_admin();
  if p_kind not in ('manual', 'pre-restore') then raise exception 'Invalid snapshot kind'; end if;
  return public._take_snapshot(p_kind, left(p_note, 300));
end $$;

create or replace function public.delete_backup_snapshot(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._backup_assert_admin();
  delete from public.backup_snapshots where id = p_id;
end $$;

create or replace function public.backup_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cron boolean := false; v_last timestamptz; v_counts jsonb;
begin
  perform public._backup_assert_admin();
  begin
    select exists (select 1 from cron.job where jobname = 'church-auto-backup') into v_cron;
  exception when others then v_cron := false;
  end;
  select max(created_at) into v_last from public.backup_snapshots;
  select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) into v_counts
    from (select kind, count(*) as n from public.backup_snapshots group by kind) s;
  return jsonb_build_object('installed', true, 'version', 1, 'auto_scheduled', v_cron,
                            'last_snapshot_at', v_last, 'snapshot_counts', v_counts);
end $$;

create or replace function public.backup_restore_stage(p_session uuid, p_table text, p_seq integer, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._backup_assert_admin();
  if not (p_table = any (public.backup_table_list())) then raise exception 'Table "%" cannot be restored', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a JSON array'; end if;
  delete from public.backup_restore_staging where created_at < now() - interval '1 day';
  insert into public.backup_restore_staging (session_id, table_name, seq, rows)
  values (p_session, p_table, p_seq, p_rows)
  on conflict (session_id, table_name, seq) do update set rows = excluded.rows;
end $$;

create or replace function public.backup_restore_apply(p_session uuid, p_mode text default 'merge', p_tables text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_data jsonb; v_result jsonb;
begin
  perform public._backup_assert_admin();
  -- Re-assemble each staged table (pieces in order). An empty table sent as [] arrives as one empty piece.
  select coalesce(jsonb_object_agg(table_name, rows_all), '{}'::jsonb) into v_data
    from (select s.table_name,
                 coalesce(jsonb_agg(e.elem order by s.seq, e.ord) filter (where e.elem is not null), '[]'::jsonb) as rows_all
            from public.backup_restore_staging s
            left join lateral jsonb_array_elements(s.rows) with ordinality as e(elem, ord) on true
           where s.session_id = p_session
           group by s.table_name) x;
  if v_data = '{}'::jsonb then raise exception 'No staged backup data found for this restore session.'; end if;
  v_result := public._restore_core(v_data, p_mode, p_tables);
  delete from public.backup_restore_staging where session_id = p_session;
  return v_result;
end $$;

create or replace function public.backup_restore_abort(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._backup_assert_admin();
  delete from public.backup_restore_staging where session_id = p_session;
end $$;

create or replace function public.restore_from_snapshot(p_snapshot uuid, p_mode text default 'merge', p_tables text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_data jsonb;
begin
  perform public._backup_assert_admin();
  select data into v_data from public.backup_snapshots where id = p_snapshot;
  if v_data is null then raise exception 'Snapshot not found.'; end if;
  return public._restore_core(v_data, p_mode, p_tables);
end $$;

-- Only signed-in users may call these; each one re-checks that the caller is an administrator.
revoke all on function public.create_backup_snapshot(text, text) from public, anon;
revoke all on function public.delete_backup_snapshot(uuid) from public, anon;
revoke all on function public.backup_status() from public, anon;
revoke all on function public.backup_restore_stage(uuid, text, integer, jsonb) from public, anon;
revoke all on function public.backup_restore_apply(uuid, text, text[]) from public, anon;
revoke all on function public.backup_restore_abort(uuid) from public, anon;
revoke all on function public.restore_from_snapshot(uuid, text, text[]) from public, anon;
grant execute on function public.create_backup_snapshot(text, text) to authenticated;
grant execute on function public.delete_backup_snapshot(uuid) to authenticated;
grant execute on function public.backup_status() to authenticated;
grant execute on function public.backup_restore_stage(uuid, text, integer, jsonb) to authenticated;
grant execute on function public.backup_restore_apply(uuid, text, text[]) to authenticated;
grant execute on function public.backup_restore_abort(uuid) to authenticated;
grant execute on function public.restore_from_snapshot(uuid, text, text[]) to authenticated;

-- ---------------------------------------------------------------- automatic daily snapshot (pg_cron)
create or replace function public.auto_backup_snapshot() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public._take_snapshot('auto', 'Automatic daily snapshot');
end $$;
-- Only the scheduler (database owner) runs this; the website cannot call it.
revoke all on function public.auto_backup_snapshot() from public, anon, authenticated;

create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'church-auto-backup') then
    perform cron.unschedule('church-auto-backup');
  end if;
  -- Every day at 01:00 GMT (same as Ghana time).
  perform cron.schedule('church-auto-backup', '0 1 * * *', 'select public.auto_backup_snapshot();');
end $$;

-- Take the first snapshot now so there is something to restore from straight away.
select public._take_snapshot('auto', 'Initial snapshot (migration 61)');
