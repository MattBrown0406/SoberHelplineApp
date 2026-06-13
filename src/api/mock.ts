/**
 * Mock data for development and App Review demo logins.
 * Swap getMockAuthUser() return values to exercise different account states.
 *
 * Three states to test (per App Store Review requirement):
 *   mockAttachedUser()     — provider-org family (Sarah / Freedom Interventions)
 *   mockDirectEssential()  — App Store $19/mo
 *   mockDirectPremium()    — App Store $49/mo
 */

import type {
  AuthUser,
  TodayFeed,
  OnCallRoster,
  StaffMember,
  SupportGroup,
  Script,
  Session,
  Entitlements,
  FamilySpace,
} from './types';

// ─── Staff fixtures ───────────────────────────────────────────────────────────

const MARIA: StaffMember = {
  id: 'staff-maria',
  firstName: 'Maria',
  lastName: 'Delgado',
  clinicalLicense: 'CIP',
  roleLabel: 'Coach',
  credentialDisplay: 'CIP',
  orgName: 'Freedom Interventions',
  avatarUrl: null,
  isAvailable: true,
  isOnCall: true,
  yearsExperience: null,
  replyEstimate: 'Replies within hours',
};

const DR_ANNE: StaffMember = {
  id: 'staff-anne',
  firstName: 'Anne',
  lastName: 'Liu',
  clinicalLicense: 'LPC',
  roleLabel: 'Counselor',
  credentialDisplay: 'LPC',
  orgName: 'Freedom Interventions',
  avatarUrl: null,
  isAvailable: true,
  isOnCall: false,
  yearsExperience: null,
  replyEstimate: null,
};

const DENISE: StaffMember = {
  id: 'staff-denise',
  firstName: 'Denise',
  lastName: 'Carter',
  clinicalLicense: 'CIP',
  roleLabel: 'Coach',
  credentialDisplay: 'CIP',
  orgName: null,
  avatarUrl: null,
  isAvailable: true,
  isOnCall: true,
  yearsExperience: null,
  replyEstimate: 'replies in ~3 min',
};

const SAM: StaffMember = {
  id: 'staff-sam',
  firstName: 'Sam',
  lastName: 'Whitfield',
  clinicalLicense: null,
  roleLabel: 'Coach',
  credentialDisplay: null,
  orgName: null,
  avatarUrl: null,
  isAvailable: true,
  isOnCall: false,
  yearsExperience: 12,
  replyEstimate: null,
};

// ─── Entitlements ─────────────────────────────────────────────────────────────

const ATTACHED_ENTITLEMENTS: Entitlements = {
  canMessageOnCallCoach: true,
  canCallCoach: true,
  canCallAfterHours: true,
  canAccessGroups: true,
  canAccessLearningContent: true,
  hasAssignedCoach: true,
};

const ESSENTIAL_ENTITLEMENTS: Entitlements = {
  canMessageOnCallCoach: true,
  canCallCoach: false,
  canCallAfterHours: false,
  canAccessGroups: true,
  canAccessLearningContent: true,
  hasAssignedCoach: false,
};

const PREMIUM_ENTITLEMENTS: Entitlements = {
  canMessageOnCallCoach: true,
  canCallCoach: true,
  canCallAfterHours: false,
  canAccessGroups: true,
  canAccessLearningContent: true,
  hasAssignedCoach: false,
};

// ─── Auth user fixtures ───────────────────────────────────────────────────────

function mockAttachedUser(): AuthUser {
  return {
    id: 'user-sarah',
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah@example.com',
    avatarUrl: null,
    accountState: 'attached',
    entitlements: ATTACHED_ENTITLEMENTS,
    orgId: 'org-freedom',
    branding: {
      orgId: 'org-freedom',
      orgName: 'Freedom Interventions',
      logoUrl: null,
      primaryColor: '#1a365d',
      secondaryColor: '#d9913b',
    },
    joinedAt: '2024-01-15T10:00:00Z',
  };
}

function mockDirectEssentialUser(): AuthUser {
  return {
    id: 'user-direct-ess',
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah@example.com',
    avatarUrl: null,
    accountState: 'direct-essential',
    entitlements: ESSENTIAL_ENTITLEMENTS,
    orgId: null,
    branding: null,
    joinedAt: '2024-03-01T10:00:00Z',
  };
}

function mockDirectPremiumUser(): AuthUser {
  return {
    id: 'user-direct-prem',
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah@example.com',
    avatarUrl: null,
    accountState: 'direct-premium',
    entitlements: PREMIUM_ENTITLEMENTS,
    orgId: null,
    branding: null,
    joinedAt: '2024-03-01T10:00:00Z',
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/** Toggle this to exercise different account states during development. */
export function getMockAuthUser(): AuthUser {
  return mockAttachedUser();
  // return mockDirectEssentialUser();
  // return mockDirectPremiumUser();
}

export function getMockTodayFeed(): TodayFeed {
  return {
    dayCount: 47,
    contextLabel: 'SON IN RESIDENTIAL TREATMENT',
    dailyQuote: "You didn't cause it, you can't control it, you can't cure it.",
    boundariesHeld: 3,
    groupSessions: 2,
    focus: [
      {
        id: 'f1',
        icon: '📞',
        title: 'Family call with treatment center — 4:00 PM',
        subtitle: 'Prep script ready: "First call after week 6"',
        accentColor: '#e8eef6',
        actionType: 'script',
        actionId: 'script-family-call',
      },
      {
        id: 'f2',
        icon: '🛡️',
        title: 'Boundary practice: money requests',
        subtitle: '2-min rehearsal exercise',
        accentColor: '#fdf3e3',
        actionType: 'exercise',
        actionId: 'boundary-money',
      },
      {
        id: 'f3',
        icon: '🌿',
        title: 'Your own recovery: 10-min walk',
        subtitle: "Caring for yourself isn't selfish — it's the plan",
        accentColor: '#e9f2ec',
        actionType: null,
        actionId: null,
      },
    ],
    checkInCompleted: false,
  };
}

export function getMockOnCallRoster(accountState: 'attached' | 'direct'): OnCallRoster {
  if (accountState === 'attached') {
    return {
      primaryOnCall: MARIA,
      available: [DR_ANNE],
      lastUpdatedAt: new Date().toISOString(),
    };
  }
  return {
    primaryOnCall: DENISE,
    available: [SAM],
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function getMockUpcomingSessions(): Session[] {
  return [
    {
      id: 'sess-1',
      title: 'Monday Night Family Support',
      type: 'group',
      status: 'scheduled',
      scheduledAt: '2024-01-22T19:00:00-05:00',
      durationMinutes: 60,
      staff: [MARIA],
      joinUrl: null,
      calendarAdded: false,
    },
    {
      id: 'sess-2',
      title: '1:1 with Maria',
      type: 'one-on-one',
      status: 'confirmed',
      scheduledAt: '2024-01-24T14:00:00-05:00',
      durationMinutes: 50,
      staff: [MARIA],
      joinUrl: null,
      calendarAdded: false,
    },
    {
      id: 'sess-3',
      title: 'Family session with Dr. Liu',
      type: 'family-therapy',
      status: 'confirmed',
      scheduledAt: '2024-01-25T17:30:00-05:00',
      durationMinutes: 60,
      staff: [DR_ANNE],
      joinUrl: null,
      calendarAdded: false,
    },
  ];
}

// Moderated groups — open to every member, attached or direct.
// requiresPremium: false on all so access is never gated by plan.
export function getMockSupportGroups(): SupportGroup[] {
  return [
    {
      id: 'group-parents',
      name: 'Parents of Addicted Young Adults',
      icon: '👨‍👩‍👦',
      accentColor: '#fdf3e3',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: 'Weekly · moderated',
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-parents',
    },
    {
      id: 'group-spouses',
      name: 'Spouses & Partners of Addicted Individuals',
      icon: '💞',
      accentColor: '#fbeae7',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: 'Weekly · moderated',
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-spouses',
    },
    {
      id: 'group-boundaries',
      name: 'Setting & Holding Boundaries',
      icon: '🏰',
      accentColor: '#e8eef5',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: 'Weekly · moderated',
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-boundaries',
    },
    {
      id: 'group-treatment',
      name: 'Finding the Right Treatment Program',
      icon: '🧭',
      accentColor: '#e9f2ec',
      onlineCount: 0,
      nextSessionAt: null,
      scheduleLabel: 'Weekly · moderated',
      scheduleType: 'recurring',
      joinUrl: null,
      requiresPremium: false,
      liveRoomId: 'shp-treatment',
    },
  ];
}

export function getMockFamilySpace(): FamilySpace {
  return {
    id: 'family-johnson',
    name: 'The Johnson Family',
    createdBy: 'user-sarah',
    inviteCode: 'JHN-4821',
    members: [
      { id: 'user-sarah', displayName: 'Sarah (You)', role: 'owner', joinedAt: '2024-01-15T10:00:00Z' },
      { id: 'user-david', displayName: 'David', role: 'member', joinedAt: '2024-01-16T10:00:00Z' },
      { id: 'user-linda', displayName: 'Linda', role: 'member', joinedAt: '2024-01-17T10:00:00Z' },
    ],
    sharedWalls: [
      {
        id: 'sw-1',
        familySpaceId: 'family-johnson',
        text: 'I will not give money directly — I will offer to pay bills directly.',
        proposedBy: 'user-sarah',
        anchor: 'enabling',
        createdAt: '2024-01-20T10:00:00Z',
        commitments: [
          { memberId: 'user-sarah', status: 'committed', updatedAt: '2024-01-20T10:00:00Z' },
          { memberId: 'user-david', status: 'committed', updatedAt: '2024-01-21T10:00:00Z' },
          { memberId: 'user-linda', status: 'wavering', updatedAt: '2024-01-22T10:00:00Z' },
        ],
      },
      {
        id: 'sw-2',
        familySpaceId: 'family-johnson',
        text: 'I will not make excuses for missed appointments.',
        proposedBy: 'user-david',
        anchor: 'enabling',
        createdAt: '2024-01-21T10:00:00Z',
        commitments: [
          { memberId: 'user-sarah', status: 'committed', updatedAt: '2024-01-21T10:00:00Z' },
          { memberId: 'user-david', status: 'committed', updatedAt: '2024-01-21T10:00:00Z' },
          { memberId: 'user-linda', status: 'committed', updatedAt: '2024-01-22T10:00:00Z' },
        ],
      },
    ],
  };
}

export function getMockScripts(): Script[] {
  return [
    {
      id: 'script-money',
      tag: 'MONEY',
      tagBackgroundColor: '#fdf3e3',
      tagTextColor: '#9a6717',
      title: 'When they ask you for money',
      trySaying: "I love you, and I'm not able to give you money. I'm happy to bring you a meal or drive you to a meeting.",
      avoid: '"After everything we\'ve done for you?" — guilt invites a fight, not a change.',
      why: 'Offering non-cash support keeps the relationship open while protecting the boundary. Rehearse it out loud — twice.',
      isCustom: false,
      requestedFromCoachId: null,
    },
    {
      id: 'script-crisis',
      tag: 'CRISIS',
      tagBackgroundColor: '#fbeae7',
      tagTextColor: '#c4604f',
      title: 'The 2 AM phone call',
      trySaying: "I hear that you're hurting. I'll talk with you tomorrow when we're both rested. If this is an emergency, call 911.",
      avoid: "Long late-night negotiations. Crisis hours favor manipulation over honesty.",
      why: "You're allowed to protect your sleep. A boundary stated calmly once is stronger than an argument repeated ten times.",
      isCustom: false,
      requestedFromCoachId: null,
    },
    {
      id: 'script-suspicion',
      tag: 'SUSPICION',
      tagBackgroundColor: '#e8eef6',
      tagTextColor: '#1a365d',
      title: "You suspect they've relapsed",
      trySaying: "I've noticed some changes and I'm concerned. I'm not accusing you — I'm telling you what I see because I love you.",
      avoid: "Searching their room or phone before the conversation. Lead with observation, not evidence.",
      why: 'Describing behavior ("I noticed...") lands differently than labeling ("You\'re using again"). Log what you\'ve seen in the Tracker first.',
      isCustom: false,
      requestedFromCoachId: null,
    },
    {
      id: 'script-repair',
      tag: 'REPAIR',
      tagBackgroundColor: '#e9f2ec',
      tagTextColor: '#4d7c5f',
      title: 'First visit after treatment begins',
      trySaying: "I'm proud of the work you're doing. I'm working on my side of this too.",
      avoid: "Rehashing the intervention or past hurts in the first visits. There will be time — with a counselor present.",
      why: "Early visits set the tone for the whole family system. Keep them short, warm, and future-facing.",
      isCustom: false,
      requestedFromCoachId: null,
    },
  ];
}
