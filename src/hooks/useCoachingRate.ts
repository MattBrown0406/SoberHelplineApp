import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../contexts/AccountContext';
import { coachingRateCopy, isCoachingMember, type CoachingRateCopy } from '../lib/coachingPrice';

/** The coaching price this member sees: "$125 member price" for members, "$150" otherwise. */
export function useCoachingRate(): CoachingRateCopy {
  const { entitlements } = useAccount();
  const { t } = useTranslation('common');
  const member = isCoachingMember(entitlements);
  return useMemo(() => coachingRateCopy(member, t as never), [member, t]);
}
