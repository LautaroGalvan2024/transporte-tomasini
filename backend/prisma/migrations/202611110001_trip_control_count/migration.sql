-- Existing trips have no recorded count. NULL preserves that distinction from zero.
DO $$
BEGIN
  IF current_database() !~ '^tomasini_[a-z0-9_]+$'
     OR current_user <> (current_database() || '_migrator') THEN
    RAISE EXCEPTION 'Destino o rol de migración de Tomasini incorrecto';
  END IF;
END $$;

ALTER TABLE "tomasini"."Trip"
  ADD COLUMN "controlCount" INTEGER,
  ADD CONSTRAINT "Trip_controlCount_nonnegative" CHECK ("controlCount" >= 0);
