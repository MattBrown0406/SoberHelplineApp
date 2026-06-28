/**
 * Treatment Finder — provider data + helpers.
 *
 * v1 ships static sample data so the UI is fully navigable. Swap PROVIDERS for a
 * Supabase-backed query (a `providers` table + filter RPC) without touching the
 * screens — keep the Provider shape and helpers stable.
 */

export type ProviderType = 'center' | 'interventionist' | 'coach';
export type Availability = 'now' | 'lim' | 'wait';

export interface Provider {
  id: string;
  type: ProviderType;
  name: string;
  location: string;
  distance?: string;
  availability: Availability;
  insurance: string[];
  tags: string[];
  price: string;
  about: string;
  // Treatment-center specific
  levels?: string[];
  conditions?: string[];
  populations?: string[];
  // Interventionist / coach specific
  years?: string;
  cases?: string;
  approach?: string;
  serves?: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'oceanside', type: 'center', name: 'Oceanside Recovery',
    location: 'Fort Lauderdale, FL', distance: '4 mi', availability: 'now',
    insurance: ['BCBS', 'Aetna', 'Cigna'],
    tags: ['Residential 30/60', 'DBT', 'EMDR', 'MAT-friendly'],
    price: 'In-network · BCBS',
    about: 'Beachside residential and PHP program with a strong trauma track. Small cohorts, individualized clinical care, and family programming every week.',
    levels: ['Detox', 'Residential', 'PHP', 'IOP'],
    conditions: ['Trauma / PTSD', 'Anxiety', 'Depression'],
    populations: ['Professionals', 'LGBTQ+ affirming'],
  },
  {
    id: 'cypress', type: 'center', name: 'Cypress Trail Wellness',
    location: 'Delray Beach, FL', distance: '12 mi', availability: 'lim',
    insurance: ['BCBS', 'UnitedHealthcare', 'Self-pay'],
    tags: ['PHP', 'IOP', 'CBT', 'Holistic'],
    price: 'In-network · BCBS',
    about: 'Dual-diagnosis PHP/IOP with holistic add-ons (yoga, acupuncture, nutrition) alongside evidence-based clinical care.',
    levels: ['PHP', 'IOP', 'Outpatient'],
    conditions: ['Anxiety', 'Bipolar', 'ADHD'],
    populations: ['Young adult'],
  },
  {
    id: 'harbor', type: 'center', name: 'Harbor House Detox',
    location: 'Boca Raton, FL', distance: '15 mi', availability: 'now',
    insurance: ['Aetna', 'Cigna', 'Humana', 'Self-pay'],
    tags: ['Detox', 'Residential', 'MAT-friendly'],
    price: 'In-network · Aetna',
    about: 'Medically supervised detox with 24/7 nursing and a smooth step-down into residential or PHP.',
    levels: ['Detox', 'Residential'],
    conditions: ['Depression', 'Anxiety'],
    populations: ['Veterans'],
  },
  {
    id: 'willow', type: 'center', name: 'Willow Springs (Women)',
    location: 'Naples, FL', distance: '2 hr', availability: 'wait',
    insurance: ['BCBS', 'Cigna', 'Self-pay'],
    tags: ['Residential 60/90', 'EMDR', 'Trauma'],
    price: 'Waitlist · ~2 wks',
    about: 'Women-only residential with a specialized trauma and eating-disorder track and on-site family weekends.',
    levels: ['Residential', 'PHP'],
    conditions: ['Trauma / PTSD', 'Eating disorders', 'BPD'],
    populations: ['Pregnant women', 'Female'],
  },
  {
    id: 'newleaf', type: 'center', name: 'New Leaf Sober Living',
    location: 'Fort Lauderdale, FL', distance: '5 mi', availability: 'now',
    insurance: ['Self-pay'],
    tags: ['Sober Living', '12-step', 'Outpatient-friendly'],
    price: 'Self-pay · $1,200/mo',
    about: 'Structured, supportive sober-living homes with house managers, drug testing, and IOP coordination.',
    levels: ['Sober Living'],
    conditions: [],
    populations: ['Professionals', 'Male'],
  },
  {
    id: 'mbrown', type: 'interventionist', name: 'Matt Brown, CIP',
    location: 'Serves nationwide · based in FL', availability: 'now',
    insurance: ['Self-pay'],
    tags: ['ARISE model', 'Family-first', '24–48 hr mobilization'],
    price: 'Flat fee · free consult',
    years: '20+', cases: '1,500+',
    about: 'Certified Intervention Professional specializing in compassionate, family-systems interventions. Travels nationwide and stays engaged through admission and the first weeks of treatment.',
    approach: 'A non-confrontational, invitational model. We prepare the family together, rehearse, and lead the conversation — then coordinate transport and a warm handoff to the right program.',
    serves: 'Nationwide (travels)',
  },
  {
    id: 'rivera', type: 'interventionist', name: 'Dana Rivera, CIP-II',
    location: 'Serves Southeast US', availability: 'lim',
    insurance: ['Self-pay'],
    tags: ['Adolescent', 'Co-occurring', 'Trauma-informed'],
    price: 'Flat fee',
    years: '12', cases: '600+',
    about: 'Interventionist focused on adolescents and young adults with co-occurring mental-health conditions.',
    approach: 'Trauma-informed and developmentally aware. Heavy emphasis on coaching parents and aligning siblings before the conversation.',
    serves: 'FL, GA, SC, NC, AL',
  },
  {
    id: 'coleman', type: 'coach', name: 'Terrence Coleman',
    location: 'Fort Lauderdale, FL + remote', availability: 'now',
    insurance: ['Self-pay'],
    tags: ['Recovery companion', 'Travel-ready', '12-step'],
    price: '$85/hr · packages',
    years: '9',
    about: 'Sober companion and recovery coach. Available for daily check-ins, transport, accountability, and travel companionship during high-risk windows.',
    approach: 'Boots-on-the-ground support: I meet people where they are, build routine, and bridge the gap between treatment and real life.',
    serves: 'In-person (South FL) + remote',
  },
  {
    id: 'park', type: 'coach', name: 'Jamie Park',
    location: 'Remote (nationwide)', availability: 'lim',
    insurance: ['Self-pay'],
    tags: ['Family coaching', 'Non-12-step', 'Professionals'],
    price: '$95/hr',
    years: '7',
    about: 'Recovery coach for professionals and their families, with a non-12-step, harm-reduction-friendly approach.',
    approach: 'Structured weekly coaching for the person in recovery, plus optional parallel coaching for the family so everyone moves together.',
    serves: 'Remote, all US time zones',
  },
];

export interface LocOption {
  key: string;
  title: string;
  subtitle: string;
}

export const LOC_OPTIONS: Record<ProviderType, LocOption[]> = {
  center: [
    { key: 'decide', title: 'Help me decide', subtitle: "Not sure what level — we'll guide you" },
    { key: 'detox', title: 'Detox', subtitle: 'Medically supervised withdrawal' },
    { key: 'residential', title: 'Residential — 30/60/90 day', subtitle: 'Live-in, structured treatment' },
    { key: 'php', title: 'PHP', subtitle: 'Day treatment, ~6 hrs/day' },
    { key: 'iop', title: 'IOP', subtitle: 'Intensive outpatient, evenings ok' },
    { key: 'op', title: 'Outpatient', subtitle: 'Weekly sessions, lowest intensity' },
    { key: 'sober', title: 'Sober Living', subtitle: 'Supportive housing in recovery' },
  ],
  interventionist: [
    { key: 'asap', title: 'As soon as possible', subtitle: 'Things feel urgent right now' },
    { key: 'week', title: 'Within a week', subtitle: 'Planning the conversation soon' },
    { key: 'explore', title: 'Just exploring', subtitle: 'Learning what an intervention involves' },
  ],
  coach: [
    { key: 'home', title: 'Coming home from treatment', subtitle: 'Support the transition back' },
    { key: 'early', title: 'Currently in early recovery', subtitle: 'Day-to-day accountability' },
    { key: 'risk', title: 'High-risk moment / travel', subtitle: 'Companion for a tough stretch' },
    { key: 'explore', title: 'Just exploring', subtitle: 'Learning how coaching works' },
  ],
};

const AVAIL_RANK: Record<Availability, number> = { now: 0, lim: 1, wait: 2 };

export function sortByAvailability(list: Provider[]): Provider[] {
  return [...list].sort((a, b) => AVAIL_RANK[a.availability] - AVAIL_RANK[b.availability]);
}

export function availabilityLabel(a: Availability): string {
  return a === 'now' ? 'Available now' : a === 'lim' ? 'Limited availability' : 'Waitlist';
}

export function typeLabel(t: ProviderType): string {
  return t === 'center' ? 'Treatment center' : t === 'interventionist' ? 'Interventionist' : 'Sober coach';
}

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
