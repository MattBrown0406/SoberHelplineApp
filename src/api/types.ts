/**
 * Sober Helpline — API contract types
 *
 * This file is the authoritative spec for the API surface the mobile app
 * consumes. The website team (soberhelpline repo) builds endpoints that
 * return these shapes. All fields are as they arrive from the API unless
 * marked "derived client-side".
 *
 * Account states:
 *   attached        — family supervised by a provider org; zero commerce
 *   direct-essential — App Store subscriber, $19/mo; messaging only
 *   direct-premium   — App Store subscriber, $49/mo; adds live calls
 *
 * Coach vs Counselor label rule:
 *   StaffMember.clinicalLicense === null  → display "Coach"
 *   StaffMember.clinicalLicense !== null  → display "Counselor"
 *   roleLabel is computed server-side and returned for convenience.
 */

// ─── Branding ─────────────────────────────────────────────────────────────────

/**
 * White-label branding payload delivered per-account at login.
 * Super admin approves once; org admins configure in provider console.
 * null in both fields = use Sober Helpline defaults (#1a365d / #d9913b).
 */
export interface OrgBranding {
  orgId: string;
  orgName: string;           // e.g. "Freedom Interventions"
  logoUrl: string | null;    // hosted URL; null = show default Sober Helpline logo
  primaryColor: string;      // hex — replaces app teal (#1a365d)
  secondaryColor: string;    // hex — replaces app amber (#d9913b)
}

// ─── Account & Entitlements ───────────────────────────────────────────────────

/** The three possible account states. All commerce gating is driven by this. */
export type AccountState = 'attached' | 'direct-essential' | 'direct-premium';

/**
 * Feature gates returned from the API.
 * Attached accounts: all relevant gates true (provider org pays).
 * Direct accounts: derived from the active IAP subscription tier.
 * The client renders based on these — never re-derives from price/tier strings.
 */
export interface Entitlements {
  canMessageOnCallCoach: boolean;    // Essential + Premium + attached
  canCallCoach: boolean;             // Premium + attached (during coach biz hours)
  canCallAfterHours: boolean;        // add-on (TBD mechanics) + some attached tiers
  canAccessGroups: boolean;          // Essential + Premium + attached
  canAccessLearningContent: boolean; // all tiers including free/unauthenticated
  hasAssignedCoach: boolean;         // attached only — drives "Your team" UI
}

// ─── Auth / User ──────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  accountState: AccountState;
  entitlements: Entitlements;
  orgId: string | null;         // null for direct (App Store) members
  branding: OrgBranding | null; // null for direct members — use app defaults
  joinedAt: string;             // ISO 8601
}

// ─── Staff / Coach ────────────────────────────────────────────────────────────

/**
 * Clinical license types that trigger the "Counselor" label.
 * Any non-null value here means the credential has been verified by the platform.
 * "Coach" is the default; "Counselor" appears only when this is set.
 */
export type ClinicalLicense =
  | 'LPC'   // Licensed Professional Counselor
  | 'LCSW'  // Licensed Clinical Social Worker
  | 'LMFT'  // Licensed Marriage and Family Therapist
  | 'PhD'
  | 'PsyD'
  | 'MD'
  | 'DO'
  | 'CADC'  // Certified Alcohol and Drug Counselor (does NOT trigger "Counselor")
  | 'CIP';  // Certified Intervention Professional (does NOT trigger "Counselor")

/** License types that elevate the label from "Coach" to "Counselor". */
export const CLINICAL_LICENSES: ReadonlySet<ClinicalLicense> = new Set([
  'LPC', 'LCSW', 'LMFT', 'PhD', 'PsyD', 'MD', 'DO',
]);

export interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  /**
   * Verified credential on file. CADC/CIP → still "Coach".
   * LPC/LCSW/LMFT/PhD/PsyD/MD/DO → "Counselor".
   * null → "Coach" with no credential badge.
   */
  clinicalLicense: ClinicalLicense | null;
  /** Server-computed display label. Drives "COACH" vs "COUNSELOR" chip. */
  roleLabel: 'Coach' | 'Counselor';
  /** Short credential string shown in the chip, e.g. "CIP", "LPC", "LCSW". */
  credentialDisplay: string | null;
  /** Provider org name, or null for platform crisis network coaches. */
  orgName: string | null;
  avatarUrl: string | null;
  isAvailable: boolean;
  isOnCall: boolean;
  yearsExperience: number | null;
  /** Human-readable reply estimate, e.g. "Replies within hours", "~3 min". */
  replyEstimate: string | null;
}

// ─── On-Call Roster ───────────────────────────────────────────────────────────

/**
 * Returned at session bootstrap and can be polled for availability changes.
 * Attached accounts: roster is set by the provider admin.
 * Direct accounts: platform crisis network, controlled by super admin.
 */
export interface OnCallRoster {
  primaryOnCall: StaffMember;
  available: StaffMember[];   // excludes primaryOnCall
  lastUpdatedAt: string;      // ISO 8601
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export type SessionType = 'group' | 'one-on-one' | 'family-therapy';
export type SessionStatus = 'scheduled' | 'confirmed' | 'cancelled' | 'completed';

/** Scheduled or completed session from the provider's calendar. */
export interface Session {
  id: string;
  title: string;
  type: SessionType;
  status: SessionStatus;
  scheduledAt: string;        // ISO 8601
  durationMinutes: number;
  staff: StaffMember[];
  joinUrl: string | null;     // Zoom / video link, available ~1hr before
  calendarAdded: boolean;     // user has added to their device calendar
}

// ─── Check-Ins ────────────────────────────────────────────────────────────────

/** 1 = worst, 5 = best. Maps to the 5 mood emoji buttons (😞 😕 😐 🙂 😊). */
export type MoodScore = 1 | 2 | 3 | 4 | 5;

export interface CheckIn {
  id: string;
  userId: string;
  moodScore: MoodScore;
  note: string | null;
  completedAt: string;  // ISO 8601
  /**
   * false = stored locally only; true = acknowledged by server.
   * The sync layer flips this after a successful POST /check-ins.
   */
  synced: boolean;
}

export interface CheckInStreak {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: string | null; // YYYY-MM-DD
}

// ─── Boundaries ───────────────────────────────────────────────────────────────

export type AnchorType = 'enablement' | 'harm';

/**
 * A boundary wall the user has anchored.
 * Always written "I will…" per the castle framework in the prototype.
 */
export interface BoundaryWall {
  id: string;
  userId: string;
  text: string;
  anchorType: AnchorType | null;
  /** Tag from the anchor question UI, e.g. 'e-fin', 'h-emo', 'h-phys'. */
  anchorTag: string | null;
  createdAt: string;                // ISO 8601
  sharedWithCoachAt: string | null; // ISO 8601; null = not yet shared
}

// ─── Tracker ─────────────────────────────────────────────────────────────────

export type SignType = 'warning' | 'recovery';

export type SignCategory =
  | 'behavioral'
  | 'recovery-routine'
  | 'financial'
  | 'physical'
  | 'emotional'
  | 'social'
  | 'transparency'
  | 'accountability'
  | 'reconnection'
  | 'reliability';

/** Master list of observable signs — seeded by the platform, never by the client. */
export interface TrackerSignDefinition {
  id: string;
  label: string;
  category: SignCategory;
  signType: SignType;
}

/**
 * The user's observation log for a given week.
 * A new record is created each Monday; the client upserts it throughout the week.
 * warningLevel and recoveryMomentum are computed server-side (0–100 scale).
 */
export interface TrackerLog {
  id: string;
  userId: string;
  weekStartDate: string;             // YYYY-MM-DD (Monday)
  activeWarningSignIds: string[];
  activeRecoverySignIds: string[];
  updatedAt: string;                 // ISO 8601
  warningLevel: number;              // 0–100; drives risk bar width
  recoveryMomentum: number;          // 0–100; drives recovery bar width
  /** Non-null when server triggered a coach notification for this week. */
  coachNotifiedAt: string | null;
}

// ─── Today Feed ───────────────────────────────────────────────────────────────

export interface DailyFocusItem {
  id: string;
  icon: string;           // emoji
  title: string;
  subtitle: string;
  accentColor: string;    // hex background for icon box
  actionType: 'script' | 'exercise' | 'reminder' | null;
  actionId: string | null;
}

/**
 * Server-assembled daily feed. Personalized per user and updated daily.
 * The streak shown in the hero card comes from CheckInStreak (local + sync),
 * not from this payload.
 */
export interface TodayFeed {
  dayCount: number;           // days since the family's journey started
  contextLabel: string;       // e.g. "SON IN RESIDENTIAL TREATMENT"
  dailyQuote: string;
  boundariesHeld: number;     // count of active BoundaryWalls this week
  groupSessions: number;      // sessions attended this week
  focus: DailyFocusItem[];
  checkInCompleted: boolean;  // server-side record; used for sync reconciliation
}

// ─── Scripts ─────────────────────────────────────────────────────────────────

export type ScriptTag = 'MONEY' | 'CRISIS' | 'SUSPICION' | 'REPAIR' | 'CUSTOM' | string;

export interface Script {
  id: string;
  tag: ScriptTag;
  tagBackgroundColor: string; // hex
  tagTextColor: string;       // hex
  title: string;
  trySaying: string;
  avoid: string;
  why: string;
  isCustom: boolean;
  /** Set when coach has authored a custom script for this user. */
  requestedFromCoachId: string | null;
}

// ─── Support Groups ──────────────────────────────────────────────────────────

export type GroupScheduleType = 'recurring' | 'drop-in' | 'one-time';

export interface SupportGroup {
  id: string;
  name: string;
  icon: string;            // emoji
  accentColor: string;     // hex background for icon
  onlineCount: number;
  nextSessionAt: string | null; // ISO 8601
  scheduleLabel: string;   // e.g. "Weekly · Thursdays 8 PM", "Drop-in anytime"
  scheduleType: GroupScheduleType;
  joinUrl: string | null;
  requiresPremium: boolean;
  liveRoomId: string | null; // LiveKit room name (e.g. "shp-parents"), null = no live option
}

// ─── Family Alignment ─────────────────────────────────────────────────────────

export type CommitmentStatus = 'committed' | 'declined' | 'wavering';

export interface FamilyMember {
  id: string;
  displayName: string;
  role: 'owner' | 'member';
  joinedAt: string; // ISO 8601
}

export interface WallCommitment {
  memberId: string;
  status: CommitmentStatus;
  updatedAt: string;
}

export interface SharedWall {
  id: string;
  familySpaceId: string;
  text: string;
  proposedBy: string;
  anchor: 'enabling' | 'harm' | 'both' | null;
  createdAt: string;
  commitments: WallCommitment[];
}

export interface FamilySpace {
  id: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  members: FamilyMember[];
  sharedWalls: SharedWall[];
}

// ─── Letter Builder ───────────────────────────────────────────────────────────

export interface ExperienceBlock {
  when: string;
  felt: string;
}

export interface ConfirmedBoundary {
  wallId?: string;
  text: string;
  anchor: 'enabling' | 'harm' | 'both' | null;
  followThroughConfirmed: true;
}

export interface LetterDraft {
  recipientName: string;
  p1Body: string;
  p2OpenerLabel: string;
  p2Experiences: ExperienceBlock[];
  p3Request: string;
  p3Hope: string;
  p3HealthySupport: string;
  p3ConfirmedBoundaryIds: string[];
  p3ClosingQuestion: string;
  status: 'draft' | 'complete';
  updatedAt: string;
}

// ─── Rehearsal ────────────────────────────────────────────────────────────────

export interface RehearsalSession {
  id: string;
  source: { type: 'script' | 'wall'; id: string };
  count: number;
}

// ─── API Response Envelope ────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
  error: null;
}

export interface ApiFailure {
  data: null;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
