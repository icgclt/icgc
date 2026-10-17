-- V46: lets the Super Admin delete old audit log entries (Audit Log page > "Delete old entries").
-- Only the Super Admin can run it, nothing newer than 30 days can be deleted, and a PURGE row is kept
-- recording who cleaned up, when, and how many entries were removed.
create or replace function public.purge_audit_log(p_older_than_days integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_name text;
  v_cutoff timestamptz;
  v_count integer;
begin
  select role, coalesce(nullif(trim(full_name), ''), email) into v_role, v_name
  from public.profiles where id = v_actor;

  if v_role is distinct from 'super_admin' then
    raise exception 'Only the Super Admin can delete audit log entries.';
  end if;
  if p_older_than_days is null or p_older_than_days < 30 then
    raise exception 'Audit entries from the last 30 days cannot be deleted.';
  end if;

  v_cutoff := now() - make_interval(days => p_older_than_days);
  delete from public.audit_log where at < v_cutoff;
  get diagnostics v_count = row_count;

  insert into public.audit_log (table_name, row_id, action, actor, actor_name, new_row)
  values ('audit_log', null, 'PURGE', v_actor, v_name,
          jsonb_build_object('deleted', v_count, 'older_than', v_cutoff));

  return v_count;
end $$;

revoke all on function public.purge_audit_log(integer) from public, anon;
grant execute on function public.purge_audit_log(integer) to authenticated;
