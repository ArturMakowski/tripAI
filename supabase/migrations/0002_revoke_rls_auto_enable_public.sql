-- Security advisor 0028/0029: the pre-existing SECURITY DEFINER helper must not be callable via PostgREST.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
