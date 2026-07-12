import { FEATURED_PROVIDER } from '../config';
import type { StaffMember } from '../api/types';

/** Public provider identity used until a staff-directory RPC is available. */
export const PRIMARY_ON_CALL: StaffMember = {
  id: 'matt-brown',
  firstName: FEATURED_PROVIDER.name.split(' ')[0] ?? FEATURED_PROVIDER.name,
  lastName: FEATURED_PROVIDER.name.split(' ').slice(1).join(' '),
  clinicalLicense: FEATURED_PROVIDER.credential,
  roleLabel: 'Coach',
  credentialDisplay: FEATURED_PROVIDER.credential,
  orgName: FEATURED_PROVIDER.org,
  avatarUrl: null,
  isAvailable: true,
  isOnCall: true,
  yearsExperience: null,
  replyEstimate: null,
};
