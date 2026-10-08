-- Account deletion now erases the network address from the account's audit rows (spec section 50).
--
-- The audit log stays append-only. Before this change the only permitted edit was the foreign key's ON DELETE SET NULL, which
-- removes the user link but left the address the request came from. The address is the one personal detail those rows carry
-- (everything else in them is an action name, a time and an identifier of a record that is deleted with the account), so the
-- trigger now also permits the single edit that erases it: user_id and ip both become NULL and nothing else changes.
CREATE OR REPLACE FUNCTION "audit_logs_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  -- the foreign key's ON DELETE SET NULL
  IF NEW."user_id" IS NULL
     AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN
    RETURN NEW;
  END IF;
  -- the erasure of the link and the address together, at account deletion
  IF NEW."user_id" IS NULL
     AND NEW."ip" IS NULL
     AND (to_jsonb(NEW) - 'user_id' - 'ip') = (to_jsonb(OLD) - 'user_id' - 'ip') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
