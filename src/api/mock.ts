/**
 * Mock data for development and App Review demo logins.
 * Swap getMockAuthUser() return values to exercise different account states.
 *
 * Three states to test (per App Store Review requirement):
 *   mockAttachedUser()     — provider-org family (Sarah / Freedom Interventions)
 *   mockDirectEssential()  — App Store $14.99/mo
 *   mockDirectPremium()    — App Store $44.99/mo
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

const MATT: StaffMember = {
  id: 'staff-matt',
  firstName: 'Matt',
  lastName: 'Brown',
  clinicalLicense: 'CIP',
  roleLabel: 'Coach',
  credentialDisplay: 'CIP',
  orgName: 'Sober Helpline',
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
    primaryOnCall: MATT,
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

// ─── Script library ───────────────────────────────────────────────────────────

const SCRIPTS: Script[] = [
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
    avoid: 'Long late-night negotiations. Crisis hours favor manipulation over honesty.',
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
    avoid: 'Rehashing the intervention or past hurts in the first visits. There will be time — with a counselor present.',
    why: 'Early visits set the tone for the whole family system. Keep them short, warm, and future-facing.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-denial',
    tag: 'DENIAL',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    title: "They say there's no problem",
    trySaying: "I'm not here to argue. I'm here to tell you what I've seen and how I feel. You don't have to agree right now.",
    avoid: '"How can you say that?!" — escalating the denial makes it a debate instead of a door.',
    why: 'Denial is a symptom, not a character flaw. Your job is to plant a seed, not win the argument. Say it once, clearly.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-anger',
    tag: 'ANGER',
    tagBackgroundColor: '#fbeae7',
    tagTextColor: '#c4604f',
    title: 'They get angry or defensive',
    trySaying: "I can see you're upset. That's okay. I'm not going anywhere. I'll be here when you're ready to talk.",
    avoid: 'Matching their volume or tone. Anger is designed to end the conversation.',
    why: 'A calm, consistent presence is more powerful than any argument. Let them see that your care is bigger than their reaction.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-promises',
    tag: 'PROMISES',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    title: "They promise to stop on their own",
    trySaying: "I want to believe you. I've believed you before. Today I'm asking for something different — a program, not a promise.",
    avoid: '"You\'ve said that a hundred times." — shaming the past closes off the future.',
    why: 'Addiction takes more than willpower. A personal promise without structure is hope without a plan. Ask for the structure.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-treatment-ask',
    tag: 'TREATMENT',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#4d7c5f',
    title: 'Asking them to go to treatment today',
    trySaying: "I want you to go to treatment with me today. Not tomorrow. Today. I'll drive you.",
    avoid: '"Would you consider...?" or "Maybe when you\'re ready..." — conditional language gives them permission to delay.',
    why: 'The intervention moment is carefully chosen. Every hour of delay reduces the chance of a yes. The ask must be today.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-guilt',
    tag: 'GUILT',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    title: 'They try to guilt-trip you',
    trySaying: "This conversation isn't about what I've done. I'll be accountable to my part — after you're in treatment.",
    avoid: 'Defending yourself or relitigating the past. Guilt is a deflection from the real question.',
    why: 'Guilt-shifting moves the conversation off the addiction and onto you. Acknowledge once, then redirect.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-enabling-family',
    tag: 'ENABLING',
    tagBackgroundColor: '#f0ecf8',
    tagTextColor: '#6b3fa0',
    title: 'A family member is enabling them',
    trySaying: "I know you love them and you're trying to help. I think we might be protecting them from the consequences that could actually save them.",
    avoid: '"You\'re the reason they\'re still using." — blame fractures the family before the conversation starts.',
    why: 'Enabling looks like help. You need this person as an ally, not an opponent. Name the pattern without naming a villain.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-relapse',
    tag: 'RELAPSE',
    tagBackgroundColor: '#fbeae7',
    tagTextColor: '#c4604f',
    title: "They've relapsed after treatment",
    trySaying: "I love you and I'm not giving up. Relapse is part of this for a lot of people. What do we do next?",
    avoid: '"I knew this would happen." — that phrase ends the conversation and confirms their shame.',
    why: "A relapse is information, not a final verdict. How you respond in the first 24 hours shapes what comes next.",
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-boundary-broken',
    tag: 'LIMITS',
    tagBackgroundColor: '#e8f4f8',
    tagTextColor: '#1a5a7a',
    title: "They've crossed a boundary you set",
    trySaying: "I told you this would change things, and I meant it. I still love you. And I can't [action] anymore.",
    avoid: "Warning them again without following through. An empty consequence is worse than none.",
    why: "A boundary's power comes entirely from follow-through. The first time you hold it matters most.",
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-phone-limits',
    tag: 'LIMITS',
    tagBackgroundColor: '#e8f4f8',
    tagTextColor: '#1a5a7a',
    title: 'They keep calling at all hours',
    trySaying: "I'm turning my phone off after 9 PM. I love you. If it's a true emergency, call 911.",
    avoid: '"Just this once" — there is no such thing.',
    why: 'Late-night calls are often designed to reach you when your resolve is lowest. Protecting your sleep protects your capacity to help.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-gathering',
    tag: 'FAMILY',
    tagBackgroundColor: '#f0ecf8',
    tagTextColor: '#6b3fa0',
    title: 'At a family gathering where they are drinking',
    trySaying: "I'm stepping out for a few minutes. I care about you — I just can't watch this right now.",
    avoid: 'A public confrontation. The room is not the right place, and shame makes people drink more, not less.',
    why: 'Removing yourself without drama keeps the focus on the issue, not a scene. You can have the real conversation later.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-impaired',
    tag: 'SAFETY',
    tagBackgroundColor: '#fbeae7',
    tagTextColor: '#c4604f',
    title: "You discover they've been driving impaired",
    trySaying: "I need to tell you what I saw, and I need to tell you that I won't stay quiet about it again if it happens.",
    avoid: '"I\'m sure it was just that once." — silence is a vote for the behavior to continue.',
    why: 'This is a safety issue that extends beyond your family. Say it plainly, once, calmly.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-job',
    tag: 'CRISIS',
    tagBackgroundColor: '#fbeae7',
    tagTextColor: '#c4604f',
    title: "They're about to lose their job",
    trySaying: "I know work is falling apart and that's real. I also think the job might not be the main problem right now.",
    avoid: 'Helping cover for them at work. It delays the consequence that might be the turning point.',
    why: 'Job loss is painful but survivable. Keeping the secret keeps the addiction alive longer.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-housing',
    tag: 'LIMITS',
    tagBackgroundColor: '#e8f4f8',
    tagTextColor: '#1a5a7a',
    title: 'Asking them to leave your home',
    trySaying: "I love you and I can't keep you in this house while you're using. That's not changing. Let's talk about what help looks like.",
    avoid: 'A deadline you won\'t follow through on. If you say Friday, mean Friday.',
    why: 'Your home should be a place of safety. That is non-negotiable. When they are in recovery, the conversation changes.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-milestone',
    tag: 'RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#4d7c5f',
    title: 'Celebrating a sobriety milestone',
    trySaying: "I see what you're doing and I want you to know it matters to me. I'm proud of you.",
    avoid: '"Finally!" or making it about the past. Milestones are about now and forward.',
    why: 'Early recovery is fragile. Simple, sincere acknowledgment reinforces what they are building. Less is more.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-fear',
    tag: 'RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#4d7c5f',
    title: 'They express fear about going to treatment',
    trySaying: "I hear that you're scared. That's okay. I'll be scared with you. Let's go anyway.",
    avoid: '"It won\'t be that bad" — minimizing the fear doesn\'t land. Presence does.',
    why: 'Fear before treatment is almost universal. Meeting it with presence rather than reassurance is what helps.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-trust',
    tag: 'RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#4d7c5f',
    title: 'Rebuilding trust after sobriety',
    trySaying: "I want to rebuild this with you. It's going to take time and that's honest. I'm not going anywhere.",
    avoid: '"But how do I know you won\'t..." — trust is rebuilt through behavior over time, not through promises.',
    why: 'Recovery is real. So is the damage. Both can be true. Start small and build forward without requiring proof upfront.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-kids',
    tag: 'FAMILY',
    tagBackgroundColor: '#f0ecf8',
    tagTextColor: '#6b3fa0',
    title: 'Talking to children about addiction',
    trySaying: "Dad is sick in a way that makes him act differently sometimes. It's not your fault. We're getting him help.",
    avoid: "Protecting kids with silence — they know more than we think, and silence itself is frightening.",
    why: "Children are not too young to sense something is wrong. Naming it safely reduces shame and confusion.",
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-parents-disagree',
    tag: 'FAMILY',
    tagBackgroundColor: '#f0ecf8',
    tagTextColor: '#6b3fa0',
    title: 'Your parents disagree with the intervention',
    trySaying: "I know this feels extreme. I've watched this get worse for two years. I need you to trust me on this one.",
    avoid: '"You\'ve always protected him." — family history derails the current conversation.',
    why: 'Family systems pull toward the familiar, even when the familiar is harmful. Lead with what you have observed, not the past dynamic.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-borrowed',
    tag: 'MONEY',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    title: 'Money borrowed and never repaid',
    trySaying: "I'm not going to bring up the money anymore. What I am going to ask is that you get help.",
    avoid: 'Itemizing the debt. The money is gone. The goal is recovery, not repayment.',
    why: "Connecting money to the addiction conversation muddles the message. Let the debt go as a strategy, not as a reward.",
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-stolen',
    tag: 'CRISIS',
    tagBackgroundColor: '#fbeae7',
    tagTextColor: '#c4604f',
    title: 'You discovered they stole from family',
    trySaying: "I found out what happened and I need you to know that I know. It tells me how serious this has gotten.",
    avoid: 'Protecting them from the family members they stole from. The secret enables the behavior.',
    why: "Theft is a desperate act. It can be the moment that wakes everyone up — or the one that gets buried. Don't bury it.",
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-dui',
    tag: 'SAFETY',
    tagBackgroundColor: '#fbeae7',
    tagTextColor: '#c4604f',
    title: 'After a DUI or legal trouble',
    trySaying: "This is serious and I want to help — but not by making it go away. A lawyer won't fix what's underneath.",
    avoid: 'Hiring an attorney to minimize consequences before treatment is secured.',
    why: 'Legal consequences can be the most powerful lever for treatment. Using resources to escape them removes the pressure.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-self-harm',
    tag: 'SAFETY',
    tagBackgroundColor: '#fbeae7',
    tagTextColor: '#c4604f',
    title: 'They threaten self-harm',
    trySaying: "I'm taking this seriously and I'm calling 988 right now. I'll stay with you.",
    avoid: 'Treating it as manipulation without evaluation — even if it has been before, it must be addressed every time.',
    why: 'Addiction and mental health overlap. A threat of self-harm always requires a response, not a judgment call.',
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-first-convo',
    tag: 'CONVERSATION',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    title: 'The first time you bring it up',
    trySaying: "I've been wanting to say this for a while and I care about you too much to stay quiet. I'm worried.",
    avoid: '"I think you might have a problem..." — the hedge invites denial. Say what you see.',
    why: "The first conversation plants a seed. It doesn't need to fix everything. It needs to be honest.",
    isCustom: false,
    requestedFromCoachId: null,
  },
  {
    id: 'script-negotiate',
    tag: 'TREATMENT',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#4d7c5f',
    title: 'They try to negotiate alternatives to treatment',
    trySaying: "I hear you. And today I'm only here for one thing. Treatment. That's the only conversation I'm here for.",
    avoid: 'Engaging with the counter-offer. Every alternative they propose is a delay tactic.',
    why: '"I\'ll go to AA" or "I\'ll see a therapist" can be real commitments — after treatment, not instead of it.',
    isCustom: false,
    requestedFromCoachId: null,
  },
];

// 14-day rotation: each pair appears on a specific day-slot, no script repeats within 14 days.
const DAILY_SCRIPT_PAIRS: [string, string][] = [
  ['script-money', 'script-crisis'],             // Day 0
  ['script-suspicion', 'script-repair'],          // Day 1
  ['script-denial', 'script-anger'],              // Day 2
  ['script-promises', 'script-treatment-ask'],    // Day 3
  ['script-guilt', 'script-enabling-family'],     // Day 4
  ['script-relapse', 'script-boundary-broken'],   // Day 5
  ['script-phone-limits', 'script-gathering'],    // Day 6
  ['script-impaired', 'script-job'],              // Day 7
  ['script-housing', 'script-milestone'],         // Day 8
  ['script-fear', 'script-trust'],                // Day 9
  ['script-kids', 'script-parents-disagree'],     // Day 10
  ['script-borrowed', 'script-stolen'],           // Day 11
  ['script-dui', 'script-self-harm'],             // Day 12
  ['script-first-convo', 'script-negotiate'],     // Day 13
];

export function getMockScripts(): Script[] {
  return SCRIPTS;
}

export function getDailyScriptPair(daySlot: number): Script[] {
  const byId = new Map(SCRIPTS.map((s) => [s.id, s]));
  const [id1, id2] = DAILY_SCRIPT_PAIRS[daySlot % 14] ?? DAILY_SCRIPT_PAIRS[0];
  return [byId.get(id1), byId.get(id2)].filter(Boolean) as Script[];
}
