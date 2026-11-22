ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE public.runner_discovery
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_runner_discovery_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.runner_discovery (
    user_id,
    display_name,
    intention,
    children_preference,
    city,
    neighborhood,
    photo_url,
    is_demo,
    updated_at
  )
  VALUES (
    NEW.user_id,
    NEW.display_name,
    NEW.intention,
    NEW.children_preference,
    NEW.city,
    NEW.neighborhood,
    NEW.photo_url,
    NEW.is_demo,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      intention = EXCLUDED.intention,
      children_preference = EXCLUDED.children_preference,
      city = EXCLUDED.city,
      neighborhood = EXCLUDED.neighborhood,
      photo_url = EXCLUDED.photo_url,
      is_demo = EXCLUDED.is_demo,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_runner_discovery_profile ON public.profiles;
CREATE TRIGGER sync_runner_discovery_profile
  AFTER INSERT OR UPDATE OF display_name, intention, children_preference,
    city, neighborhood, photo_url, is_demo
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_runner_discovery_profile();

UPDATE public.runner_discovery AS discovery
SET is_demo = profile.is_demo,
    updated_at = now()
FROM public.profiles AS profile
WHERE discovery.user_id = profile.user_id
  AND discovery.is_demo IS DISTINCT FROM profile.is_demo;
