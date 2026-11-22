ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS photo_url text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_photo_url,
  ADD CONSTRAINT profiles_photo_url
    CHECK (
      photo_url IS NULL
      OR (
        char_length(photo_url) <= 2048
        AND photo_url ~ '^https://'
      )
    );

ALTER TABLE public.runner_discovery
  ADD COLUMN IF NOT EXISTS photo_url text;

ALTER TABLE public.runner_discovery
  DROP CONSTRAINT IF EXISTS runner_discovery_photo_url,
  ADD CONSTRAINT runner_discovery_photo_url
    CHECK (
      photo_url IS NULL
      OR (
        char_length(photo_url) <= 2048
        AND photo_url ~ '^https://'
      )
    );

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
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      intention = EXCLUDED.intention,
      children_preference = EXCLUDED.children_preference,
      city = EXCLUDED.city,
      neighborhood = EXCLUDED.neighborhood,
      photo_url = EXCLUDED.photo_url,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_runner_discovery_profile ON public.profiles;
CREATE TRIGGER sync_runner_discovery_profile
  AFTER INSERT OR UPDATE OF display_name, intention, children_preference, city, neighborhood, photo_url
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_runner_discovery_profile();

UPDATE public.runner_discovery AS discovery
SET photo_url = profile.photo_url,
    updated_at = now()
FROM public.profiles AS profile
WHERE discovery.user_id = profile.user_id
  AND discovery.photo_url IS DISTINCT FROM profile.photo_url;

GRANT UPDATE (photo_url) ON public.profiles TO authenticated;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'profile-photos',
  'profile-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Anyone can view profile photos" ON storage.objects;
CREATE POLICY "Anyone can view profile photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'profile-photos');

DROP POLICY IF EXISTS "Users can upload their profile photos" ON storage.objects;
CREATE POLICY "Users can upload their profile photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can update their profile photos" ON storage.objects;
CREATE POLICY "Users can update their profile photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can delete their profile photos" ON storage.objects;
CREATE POLICY "Users can delete their profile photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE TABLE IF NOT EXISTS public.profile_swipes (
  swiper_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  liked boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (swiper_id, target_user_id),
  CONSTRAINT profile_swipes_distinct_users
    CHECK (swiper_id <> target_user_id)
);

ALTER TABLE public.profile_swipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own profile swipes" ON public.profile_swipes;
CREATE POLICY "Users can read their own profile swipes"
  ON public.profile_swipes FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = swiper_id);

REVOKE ALL ON public.profile_swipes FROM anon, authenticated;
GRANT SELECT ON public.profile_swipes TO authenticated;

CREATE TABLE IF NOT EXISTS public.profile_matches (
  user_one_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  user_two_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_one_id, user_two_id),
  CONSTRAINT profile_matches_ordered_users
    CHECK (user_one_id < user_two_id)
);

ALTER TABLE public.profile_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own matches" ON public.profile_matches;
CREATE POLICY "Users can read their own matches"
  ON public.profile_matches FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = user_one_id
    OR (SELECT auth.uid()) = user_two_id
  );

REVOKE ALL ON public.profile_matches FROM anon, authenticated;
GRANT SELECT ON public.profile_matches TO authenticated;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  match_user_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type = 'match'),
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_user_id, type)
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own notifications" ON public.notifications;
CREATE POLICY "Users can read their own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can mark their own notifications read" ON public.notifications;
CREATE POLICY "Users can mark their own notifications read"
  ON public.notifications FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.record_profile_swipe(
  p_target_user_id uuid,
  p_liked boolean
)
RETURNS TABLE (matched boolean, matched_user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_id_value uuid := (SELECT auth.uid());
  target_name text;
  did_create_match boolean := false;
  created_match_count integer := 0;
  existing_match boolean := false;
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF p_target_user_id IS NULL
    OR p_target_user_id = user_id_value
    OR p_liked IS NULL
  THEN
    RAISE EXCEPTION 'A valid target profile and swipe decision are required.';
  END IF;

  SELECT display_name
  INTO target_name
  FROM public.runner_discovery
  WHERE user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The target dating profile does not exist.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      LEAST(user_id_value::text, p_target_user_id::text)
        || ':'
        || GREATEST(user_id_value::text, p_target_user_id::text),
      0
    )
  );

  INSERT INTO public.profile_swipes (
    swiper_id,
    target_user_id,
    liked,
    updated_at
  )
  VALUES (user_id_value, p_target_user_id, p_liked, now())
  ON CONFLICT (swiper_id, target_user_id) DO UPDATE
  SET liked = EXCLUDED.liked,
      updated_at = now();

  IF p_liked AND EXISTS (
    SELECT 1
    FROM public.profile_swipes
    WHERE swiper_id = p_target_user_id
      AND target_user_id = user_id_value
      AND liked
  ) THEN
    INSERT INTO public.profile_matches (user_one_id, user_two_id)
    VALUES (
      LEAST(user_id_value, p_target_user_id),
      GREATEST(user_id_value, p_target_user_id)
    )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS created_match_count = ROW_COUNT;
    did_create_match := created_match_count > 0;

    IF did_create_match THEN
      INSERT INTO public.notifications (user_id, match_user_id, type, title, body)
      VALUES
        (
          user_id_value,
          p_target_user_id,
          'match',
          'It''s a match!',
          'You and ' || target_name || ' both liked each other.'
        ),
        (
          p_target_user_id,
          user_id_value,
          'match',
          'It''s a match!',
          'You and ' || (
            SELECT display_name
            FROM public.runner_discovery
            WHERE user_id = user_id_value
          ) || ' both liked each other.'
        )
      ON CONFLICT (user_id, match_user_id, type) DO NOTHING;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profile_matches
    WHERE user_one_id = LEAST(user_id_value, p_target_user_id)
      AND user_two_id = GREATEST(user_id_value, p_target_user_id)
  )
  INTO existing_match;

  RETURN QUERY SELECT existing_match, CASE WHEN existing_match THEN p_target_user_id ELSE NULL END;
END;
$$;

REVOKE ALL ON FUNCTION public.record_profile_swipe(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_profile_swipe(uuid, boolean) TO authenticated;
