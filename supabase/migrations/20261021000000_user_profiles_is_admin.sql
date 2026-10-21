-- Assumes public.user_profiles.id references auth.users.id.
-- New accounts are never admins by default. Assign is_admin only from a trusted
-- SQL/service-role administrative workflow, never from the public client.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT profile.is_admin
    FROM public.user_profiles AS profile
    WHERE profile.id = auth.uid()
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_current_user_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_current_user_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_user_profiles_is_admin_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') AND (
    (TG_OP = 'INSERT' AND NEW.is_admin IS TRUE)
    OR (TG_OP = 'UPDATE' AND NEW.is_admin IS DISTINCT FROM OLD.is_admin)
  ) THEN
    RAISE EXCEPTION 'is_admin can only be changed by a trusted administrative process'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_user_profiles_is_admin_change ON public.user_profiles;
CREATE TRIGGER prevent_user_profiles_is_admin_change
  BEFORE INSERT OR UPDATE OF is_admin ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_profiles_is_admin_change();
