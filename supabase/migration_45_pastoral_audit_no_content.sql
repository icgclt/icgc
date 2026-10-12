-- V45: pastoral care is audited without copying its contents.
-- Before: every change stored a full copy of the case (including counselling notes) in audit_log,
-- readable by admins. After: the log keeps who changed a case, what kind of change, and when.

create or replace function public.audit_row_no_content() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  select coalesce(nullif(trim(full_name), ''), email) into v_actor_name
  from public.profiles where id = v_actor;

  insert into public.audit_log (table_name, row_id, action, actor, actor_name)
  values (tg_table_name, v_id, tg_op, v_actor, v_actor_name);

  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.audit_row_no_content() from public, anon, authenticated;

drop trigger if exists pastoral_cases_audit on public.pastoral_cases;
create trigger pastoral_cases_audit
  after insert or update or delete on public.pastoral_cases
  for each row execute function public.audit_row_no_content();

-- Remove the copies already stored. This keeps the who / when / action rows and clears only the contents.
-- Delete this statement before running if you want to keep the old copies.
update public.audit_log
set old_row = null, new_row = null
where table_name = 'pastoral_cases' and (old_row is not null or new_row is not null);
