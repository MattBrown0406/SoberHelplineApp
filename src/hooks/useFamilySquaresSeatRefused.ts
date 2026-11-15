import { useEffect, useState } from 'react';
import { familySquaresSeatRefusedHere, subscribeFamilySquaresSeatRefused } from '../lib/familySquaresRegistration';

/**
 * True while this device's own Save tap for the coming Family Squares meeting
 * stands refused by the website (familySquaresRegistration). Asked again on
 * every draw, so last week's refusal says nothing about this week, and heard
 * at once by every screen that shows the seat panel.
 */
export function useFamilySquaresSeatRefused(accountId: string | null): boolean {
  const [, setChanges] = useState(0);
  useEffect(() => subscribeFamilySquaresSeatRefused(() => setChanges((count) => count + 1)), []);
  return familySquaresSeatRefusedHere(accountId);
}
