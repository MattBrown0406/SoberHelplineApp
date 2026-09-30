import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearProtectedDiyInterventionPlan } from '../storage/diyInterventionPlanner';
import { clearProtectedFamilyVisitationPlan } from '../storage/familyVisitationPlan';
import { clearProtectedHomecomingWeek } from '../storage/homecomingWeek';
import { clearProtectedTreatmentActionPlan } from '../storage/treatmentActionPlan';
import { accountLocalKeys } from './accountLocalKeys';

/**
 * After an account is deleted, nothing it wrote may stay on the phone: the
 * Safety Wallet (address, weapons, overdose history), check-in notes, letter
 * drafts, queued writes and the protected planners.
 */
export async function purgeAccountLocalData(accountId: string, authUserId: string | null): Promise<void> {
  const ids = [accountId, authUserId ?? ''];
  const doomed = accountLocalKeys(await AsyncStorage.getAllKeys(), ids);
  if (doomed.length) await AsyncStorage.multiRemove(doomed);
  await Promise.allSettled([
    clearProtectedDiyInterventionPlan(accountId),
    clearProtectedFamilyVisitationPlan(accountId),
    clearProtectedHomecomingWeek(accountId),
    clearProtectedTreatmentActionPlan(accountId),
  ]);
}
