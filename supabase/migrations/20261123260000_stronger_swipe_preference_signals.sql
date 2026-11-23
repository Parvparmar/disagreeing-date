CREATE OR REPLACE FUNCTION public.learn_from_profile_swipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  interaction_signal smallint := CASE WHEN NEW.liked THEN 2 ELSE -1 END;
  preference_signal smallint := CASE WHEN NEW.liked THEN 4 ELSE -2 END;
BEGIN
  INSERT INTO public.recommendation_interactions (user_id, candidate_id, signal, updated_at)
  VALUES (NEW.swiper_id, NEW.target_user_id, interaction_signal, now())
  ON CONFLICT (user_id, candidate_id) DO UPDATE
  SET signal = EXCLUDED.signal, updated_at = now();

  BEGIN
    PERFORM public.apply_face_preference_signal(
      NEW.swiper_id,
      NEW.target_user_id,
      preference_signal
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Face preference update failed for swipe user % and candidate %: %',
      NEW.swiper_id, NEW.target_user_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
