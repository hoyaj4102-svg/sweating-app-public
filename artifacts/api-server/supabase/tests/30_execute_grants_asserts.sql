-- Privileges after 20261122. No rows. Safe to run again.
-- Synthetic catalog checks only. Do not run against a hosted project.

\set ON_ERROR_STOP on

do $$
declare
  fn text;
  config text;
  pinned boolean;
begin
  foreach fn in array array[
    'public.is_admin()',
    'public.enforce_like_participants()'
  ]
  loop
    if to_regprocedure(fn) is null then
      raise exception '% is missing', fn;
    end if;

    select coalesce(pg_catalog.array_to_string(p.proconfig, ','), '')
      into config
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.oid = to_regprocedure(fn);

    pinned := config like '%search_path=%'
      and config not like '%search_path=public%'
      and config not like '%search_path="public"%'
      and config not like '%search_path=pg_catalog, public%';
    if not pinned then
      raise exception '% search_path is not an empty pin: %', fn, config;
    end if;

    if has_function_privilege('anon', to_regprocedure(fn), 'EXECUTE')
       or has_function_privilege('public', to_regprocedure(fn), 'EXECUTE') then
      raise exception '% is still executable by anon or public', fn;
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.is_admin()', 'EXECUTE') then
    raise exception 'is_admin() lost authenticated or service_role execute';
  end if;

  if has_function_privilege('authenticated', 'public.enforce_like_participants()', 'EXECUTE') then
    raise exception 'authenticated can still execute enforce_like_participants()';
  end if;

  if not has_function_privilege('service_role', 'public.enforce_like_participants()', 'EXECUTE') then
    raise exception 'service_role lost enforce_like_participants()';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'likes_enforce_participants'
      and not tgisinternal
  ) then
    raise exception 'likes_enforce_participants trigger is missing';
  end if;
end $$;

\echo 'PASS: anon and public cannot execute is_admin or enforce_like_participants'
