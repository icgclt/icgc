-- Human-readable audit actors. Existing audit rows are resolved in the UI from profiles;
-- new rows also store a snapshot so the name remains visible even if a profile changes later.
alter table public.audit_log add column if not exists actor_name text;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
begin
  select coalesce(nullif(trim(full_name), ''), email) into v_actor_name
  from public.profiles where id = v_actor;

  if tg_op = 'DELETE' then
    insert into public.audit_log (table_name, row_id, action, actor, actor_name, old_row)
    values (tg_table_name, old.id, tg_op, v_actor, v_actor_name, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, row_id, action, actor, actor_name, old_row, new_row)
    values (tg_table_name, new.id, tg_op, v_actor, v_actor_name, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log (table_name, row_id, action, actor, actor_name, new_row)
    values (tg_table_name, new.id, tg_op, v_actor, v_actor_name, to_jsonb(new));
    return new;
  end if;
end $$;

revoke all on function public.audit_row() from public, anon, authenticated;
