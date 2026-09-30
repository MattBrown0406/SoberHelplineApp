import type { LetterDraft } from '../api/types';

export const INTERVENTION_LETTER_PAGE_CHAR_LIMIT = 1500;

export type LetterBottomLines = {
  heading: string;
  /** Text of the boundaries the writer confirmed they will follow through on. */
  boundaries: string[];
};

/**
 * The letter as read aloud. Confirmed boundaries are appended as a separate
 * "if you choose not to" section after the closing question — read only if the
 * answer is no — and do not count toward the one-page letter limit.
 */
export function interventionLetterText(draft: LetterDraft, bottomLines?: LetterBottomLines): string {
  const letter = interventionLetterBody(draft);
  const lines = (bottomLines?.boundaries ?? []).map((b) => b.trim()).filter(Boolean);
  if (!letter || lines.length === 0 || !bottomLines) return letter;
  return `${letter}\n\n${bottomLines.heading}\n${lines.map((line) => `• ${line}`).join('\n')}`;
}

export function confirmedBoundaryTexts(
  draft: LetterDraft,
  walls: readonly { id: string; text: string }[],
): string[] {
  return draft.p3ConfirmedBoundaryIds
    .map((id) => walls.find((wall) => wall.id === id)?.text ?? '')
    .filter((text) => text.trim().length > 0);
}

function interventionLetterBody(draft: LetterDraft): string {
  const experiences = draft.p2Experiences
    .filter((experience) => experience.when.trim() || experience.felt.trim())
    .map((experience) => `${experience.when.trim()} ${experience.felt.trim()}`.trim())
    .join(' ');

  return [
    draft.p1Body,
    `${draft.p2OpenerLabel} ${experiences}`,
    draft.p3Request,
    draft.p3Hope,
    draft.p3HealthySupport,
    draft.p3ClosingQuestion,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function interventionLetterReadyToFinish(draft: LetterDraft): boolean {
  const hasCompleteExperience = draft.p2Experiences.some(
    (experience) => experience.when.trim().length > 0 && experience.felt.trim().length > 0,
  );
  return draft.p1Body.trim().length > 0
    && draft.p2OpenerLabel.trim().length > 0
    && hasCompleteExperience
    && draft.p3Request.trim().length > 0
    && draft.p3Hope.trim().length > 0
    && draft.p3ClosingQuestion.trim().length > 0
    && interventionLetterBody(draft).length <= INTERVENTION_LETTER_PAGE_CHAR_LIMIT;
}
