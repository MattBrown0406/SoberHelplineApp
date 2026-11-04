import type { LovedOne, LovedOneInput, LovedOneStatus } from '../hooks/useLovedOne';

export interface LovedOneForm {
  relationship: string | null;
  firstName: string;
  substances: string[];
  stage: string | null;
  status: LovedOneStatus | null;
}

/**
 * Only what she filled in and changed: an untouched (or not yet loaded) form
 * never clears a saved profile when onboarding runs again on a reinstall or
 * a second phone.
 */
export function lovedOneChanges(saved: LovedOne | null, form: LovedOneForm): LovedOneInput {
  const input: LovedOneInput = {};
  const name = form.firstName.trim();
  if (form.relationship && form.relationship !== saved?.relationship) input.relationship = form.relationship;
  if (name && name !== saved?.first_name) input.first_name = name;
  if (form.substances.length && form.substances.join() !== (saved?.substances ?? []).join()) input.substances = form.substances;
  if (form.stage && form.stage !== saved?.stage) input.stage = form.stage;
  if (form.status && form.status !== saved?.status) input.status = form.status;
  return input;
}
