CREATE OR REPLACE FUNCTION public.reset_my_swipe_deck()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  user_id_value uuid := auth.uid();
  deleted_count integer;
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  DELETE FROM public.profile_swipes
  WHERE swiper_id = user_id_value;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_my_swipe_deck() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_my_swipe_deck() TO authenticated;
