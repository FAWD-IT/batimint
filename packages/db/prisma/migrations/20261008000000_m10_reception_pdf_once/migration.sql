-- PV signé : le PDF peut être rendu une seule fois après coup (PV importé ou du seed de démo) ;
-- une empreinte déjà enregistrée ne change plus jamais.
CREATE OR REPLACE FUNCTION receptions_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'signed' AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."reception_date" IS DISTINCT FROM OLD."reception_date"
    OR NEW."notes" IS DISTINCT FROM OLD."notes"
    OR NEW."attendees" IS DISTINCT FROM OLD."attendees"
    OR NEW."signer_name" IS DISTINCT FROM OLD."signer_name"
    OR NEW."signed_at" IS DISTINCT FROM OLD."signed_at"
    OR (OLD."pdf_sha256" IS NOT NULL AND NEW."pdf_sha256" IS DISTINCT FROM OLD."pdf_sha256")
    OR (OLD."pdf_key" IS NOT NULL AND NEW."pdf_key" IS DISTINCT FROM OLD."pdf_key")
  ) THEN
    RAISE EXCEPTION 'Un PV de réception signé ne se modifie pas.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
