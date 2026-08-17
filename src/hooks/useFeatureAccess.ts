import type { ProductFeature } from '../api/types';
import { useAccount } from '../contexts/AccountContext';
import { canAccessFeature } from '../lib/featureAccess';

export function useFeatureAccess(feature: ProductFeature): boolean {
  const { entitlements } = useAccount();
  return canAccessFeature({ feature, entitlements });
}