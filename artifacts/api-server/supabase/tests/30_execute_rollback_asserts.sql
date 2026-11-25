-- Privileges after the 20261122 rollback and before that migration is
-- applied again. No rows. Do not run against a hosted project.

\set ON_ERROR_STOP on

do $$
declare
  fn text;
  config text;
begin
  foreach fn in array array[
    'public.is_admin()',
    'public.enforce_like_participants()'
  ]
  loop
    if to_regprocedure(fn) is null then
      raise exception 'rollback dropped %', fn;
    end if;

    select coalesce(pg_catalog.array_to_string(p.proconfig, ','), '')
      into config
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.oid = to_regprocedure(fn);

    if config not like '%search_path=public%'
       and config not like '%search_path="public"%' then
      raise exception 'rollback left % search_path as %', fn, config;
    end if;

    if not has_function_privilege('anon', to_regprocedure(fn), 'EXECUTE')
       or not has_function_privilege('authenticated', to_regprocedure(fn), 'EXECUTE')
       or not has_function_privilege('service_role', to_regprocedure(fn), 'EXECUTE') then
      raise exception 'rollback did not restore execute on %', fn;
    end if;

    if has_function_privilege('public', to_regprocedure(fn), 'EXECUTE') then
      raise exception 'rollback granted public execute on %', fn;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'likes_enforce_participants'
      and not tgisinternal
  ) then
    raise exception 'rollback dropped likes_enforce_participants';
  end if;
end $$;

\echo 'PASS: execute rollback restores anon and keeps public revoked'
