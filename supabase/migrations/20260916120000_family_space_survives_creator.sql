-- A family space survives its creator.
--
-- Before this, family_spaces.created_by cascaded from accounts, so when the
-- relative who set the space up deleted their account the whole family lost
-- their shared walls, commitments, and wavering history. Family recovery does
-- not depend on any one person staying — the space should not either.
--
-- Succession rule (documented choice): ownership passes to the LONGEST-STANDING
-- remaining member — the earliest family_members.joined_at, ties broken by
-- family_members.id. Most-recent-activity was considered and rejected because
-- the member who has been in the space longest is the one the rest of the
-- family already knows, and the rule is deterministic without touching any
-- activity table. The space is deleted only when no other member remains.
--
-- Mechanics: a BEFORE DELETE trigger on public.accounts (which also fires for
-- the cascade from auth.users that delete_own_account relies on) transfers or
-- deletes each space the account created. The created_by FK is switched to
-- ON DELETE RESTRICT so that if the trigger is ever dropped, deleting a creator
-- fails loudly instead of silently wiping a family's space.
--
-- RLS: the existing policies key on created_by ("owner update", "creator
-- select") and on membership ("member select"), so the successor gains owner
-- rights the moment created_by moves — no policy change required. The
-- successor's family_members.role is set to 'owner' so the UI agrees.

CREATE OR REPLACE FUNCTION public.transfer_family_spaces_before_account_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_space record;
  v_successor record;
BEGIN
  FOR v_space IN
    SELECT fs.id, fs.name
    FROM public.family_spaces AS fs
    WHERE fs.created_by = OLD.id
  LOOP
    SELECT fm.account_id, a.first_name
      INTO v_successor
    FROM public.family_members AS fm
    JOIN public.accounts AS a ON a.id = fm.account_id
    WHERE fm.family_space_id = v_space.id
      AND fm.account_id <> OLD.id
    ORDER BY fm.joined_at ASC, fm.id ASC
    LIMIT 1;

    IF v_successor.account_id IS NULL THEN
      -- Nobody left to hand the space to.
      DELETE FROM public.family_spaces WHERE id = v_space.id;
      CONTINUE;
    END IF;

    UPDATE public.family_spaces
       SET created_by = v_successor.account_id,
           -- The space is shown as "<owner first name>'s Family"; keep the
           -- old name only when the successor has no first name on file.
           name = COALESCE(NULLIF(btrim(v_successor.first_name), ''), v_space.name)
     WHERE id = v_space.id;

    UPDATE public.family_members
       SET role = 'owner'
     WHERE family_space_id = v_space.id
       AND account_id = v_successor.account_id;
  END LOOP;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_family_spaces_before_account_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS transfer_family_spaces_before_account_delete ON public.accounts;
CREATE TRIGGER transfer_family_spaces_before_account_delete
  BEFORE DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.transfer_family_spaces_before_account_delete();

ALTER TABLE public.family_spaces
  DROP CONSTRAINT IF EXISTS family_spaces_created_by_fkey;
ALTER TABLE public.family_spaces
  ADD CONSTRAINT family_spaces_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.accounts(id) ON DELETE RESTRICT;
