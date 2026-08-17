import React from 'react';
import type { ProductFeature } from '../../api/types';
import { useAccount } from '../../contexts/AccountContext';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { FreeTierPaywall } from '../ui/FreeTierPaywall';

export function Gate({
  feature,
  children,
  fallback,
}: {
  feature: ProductFeature;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { isLoading } = useAccount();
  const allowed = useFeatureAccess(feature);

  if (isLoading) return null;
  if (!allowed) return <>{fallback ?? <FreeTierPaywall />}</>;
  return <>{children}</>;
}