DO $$
DECLARE
  target_function record;
  function_definition text;
  old_brand text := 'Pace' || 'Mate';
BEGIN
  FOR target_function IN
    SELECT procedure.oid
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'create_profile_for_new_user'
  LOOP
    function_definition := pg_catalog.pg_get_functiondef(target_function.oid);
    IF position(old_brand IN function_definition) > 0 THEN
      EXECUTE replace(function_definition, old_brand, 'Opinionated');
    END IF;
  END LOOP;
END;
$$;
