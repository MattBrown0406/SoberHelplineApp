import type { LetterDraft } from '../api/types';

export const INTERVENTION_LETTER_PAGE_CHAR_LIMIT = 1500;

export function interventionLetterText(draft: LetterDraft): string {
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
    && interventionLetterText(draft).length <= INTERVENTION_LETTER_PAGE_CHAR_LIMIT;
}
