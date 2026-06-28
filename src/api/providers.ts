import { createClient } from '@supabase/supabase-js';

// Public anon key — safe to embed; soberhelpline.com provider directory is read-only public data
const SHL_URL = process.env.EXPO_PUBLIC_SHL_SUPABASE_URL ?? 'https://anwqprmpzmcqbkttmxos.supabase.co';
const SHL_KEY = process.env.EXPO_PUBLIC_SHL_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFud3Fwcm1wem1jcWJrdHRteG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwMDE1MTcsImV4cCI6MjA3OTU3NzUxN30.zvikfr-0JzQwwqMgOcoZFMuU-w0VyGL28pxB3AXVj2k';
const shl = createClient(SHL_URL, SHL_KEY);

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
  // Contact (shown on detail screen)
  phone?: string;
  email?: string;
  website?: string;
}

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

// Website category strings → app ProviderType
function mapCategory(cat: string): ProviderType {
  if (cat === 'Interventionists') return 'interventionist';
  if (cat === 'Sober Coaches/Companions') return 'coach';
  return 'center';
}

// App ProviderType → website category strings to query
function categoryFilters(type: ProviderType): string[] {
  switch (type) {
    case 'interventionist': return ['Interventionists'];
    case 'coach': return ['Sober Coaches/Companions'];
    case 'center': return ['Inpatient Treatment', 'Outpatient Treatment', 'Sober Living', 'Therapists', 'Psychiatrists'];
  }
}

function buildLevels(row: Record<string, unknown>): string[] {
  const cat = (row.category as string) ?? '';
  const levels: string[] = [];
  if (cat === 'Inpatient Treatment') {
    if (row.detox_available) levels.push('Detox');
    levels.push('Residential');
    if (row.detox_only_services) return ['Detox'];
  }
  if (cat === 'Outpatient Treatment') {
    levels.push('PHP', 'IOP', 'Outpatient');
    if (row.telehealth_available) levels.push('Telehealth');
  }
  if (cat === 'Sober Living') levels.push('Sober Living');
  if (cat === 'Therapists') {
    levels.push('Individual Therapy', 'Group Therapy');
    if (row.telehealth_available) levels.push('Telehealth');
  }
  if (cat === 'Psychiatrists') {
    levels.push('Psychiatric Services');
    if (row.telehealth_available) levels.push('Telehealth');
  }
  return levels;
}

function buildPopulations(row: Record<string, unknown>): string[] {
  const pops: string[] = [];
  if (row.lgbt_supportive) pops.push('LGBTQ+ affirming');
  if (row.adolescent_services) pops.push('Adolescent (under 18)');
  const genders = (row.gender_specific_treatment as string[] | null) ?? [];
  genders.forEach((g) => pops.push(`${g}-specific`));
  return pops;
}

function buildTags(row: Record<string, unknown>, type: ProviderType): string[] {
  const tags: string[] = [];
  if (type === 'interventionist') {
    const modalities = (row.intervention_modalities as string[] | null) ?? [];
    tags.push(...modalities);
    if (row.cip_certified) tags.push('CIP Certified');
    if (row.works_nationally) tags.push('Travels nationally');
    if (row.works_internationally) tags.push('Travels internationally');
    if (row.adolescent_services) tags.push('Adolescent');
  } else if (type === 'coach') {
    const modalities = (row.therapeutic_modalities as string[] | null) ?? [];
    tags.push(...modalities);
    if (row.in_person_companion_work) tags.push('In-person available');
    if (row.has_valid_passport) tags.push('Travel-ready');
    if (row.hourly_coaching_sessions) tags.push('Hourly sessions');
  } else {
    const modalities = (row.therapeutic_modalities as string[] | null) ?? [];
    tags.push(...modalities);
    const fellowships = (row.recovery_fellowships as string[] | null) ?? [];
    fellowships.forEach((f) => tags.push(f.split('(')[0].trim()));
    if (row.detox_available) tags.push('Detox available');
    if (row.telehealth_available) tags.push('Telehealth');
    if (row.sliding_scale_available) tags.push('Sliding scale');
  }
  return [...new Set(tags)].slice(0, 6);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Provider {
  const type = mapCategory(row.category ?? '');
  const location = [row.city, row.state].filter(Boolean).join(', ');

  const years = row.year_started
    ? `${new Date().getFullYear() - (row.year_started as number)}+`
    : undefined;

  const serves =
    type === 'interventionist'
      ? row.works_internationally
        ? 'International'
        : row.works_nationally
          ? 'Nationwide'
          : location
      : type === 'coach'
        ? row.in_person_companion_work
          ? `In-person (${location}) + remote`
          : 'Remote (nationwide)'
        : undefined;

  const approach =
    type === 'interventionist' && (row.intervention_modalities as string[] | null)?.length
      ? (row.intervention_modalities as string[]).join(', ')
      : type === 'coach' && (row.therapeutic_modalities as string[] | null)?.length
        ? (row.therapeutic_modalities as string[]).join(', ')
        : undefined;

  const price =
    row.cost
      ? String(row.cost)
      : type === 'coach' && row.daily_companion_fee
        ? `${row.daily_companion_fee}/day`
        : type === 'coach' && row.hourly_coaching_rate
          ? `${row.hourly_coaching_rate}/hr`
          : 'Contact for pricing';

  return {
    id: row.id as string,
    type,
    name: (row.provider_name as string) ?? '',
    location,
    availability: 'lim',
    insurance: (row.insurances_accepted as string[] | null) ?? [],
    tags: buildTags(row, type),
    price,
    about: (row.description_of_services as string) ?? '',
    levels: type === 'center' ? buildLevels(row) : undefined,
    conditions: (row.co_occurring_diagnoses as string[] | null) ?? [],
    populations: buildPopulations(row),
    years,
    approach,
    serves,
    phone: (row.phone_number as string | null) ?? undefined,
    email: (row.email as string | null) ?? undefined,
    website: (row.website as string | null) ?? undefined,
  };
}

export async function fetchProviders(
  type: ProviderType,
  opts: { state?: string; insurance?: string[] } = {},
): Promise<Provider[]> {
  let q = shl
    .from('provider_submissions_public')
    .select('*')
    .eq('status', 'approved')
    .in('category', categoryFilters(type));

  if (opts.state) q = q.eq('state', opts.state);
  if (opts.insurance?.length) q = q.overlaps('insurances_accepted', opts.insurance);

  const { data, error } = await q.order('provider_name').limit(50);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function fetchProviderById(id: string): Promise<Provider | undefined> {
  const { data, error } = await shl
    .from('provider_submissions_public')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return undefined;
  return mapRow(data);
}

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
