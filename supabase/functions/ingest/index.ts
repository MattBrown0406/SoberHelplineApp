// Hub Ingest — POST /ingest
//
// Receives property events, resolves identity, and syncs to HubSpot.
// Auth: Authorization: Bearer HUB_INGEST_KEY
// Body: { email, property, event, name?, phone?, utm?, props?, payment?, occurred_at?, local_id? }
//
// Guarantee: Supabase writes happen before HubSpot sync so that outbox
// retries (triggered by our 5xx on HubSpot failure) replay idempotently
// without double-writing people/events/payments.

import { createClient } from 'npm:@supabase/supabase-js@2';

// ─── HubSpot constants ────────────────────────────────────────────────────────

const HS_BASE = 'https://api.hubapi.com';
const FREEDOM_PIPELINE = '2304354008';

// event name → HubSpot deal stage id (in pipeline progression order)
const DEAL_STAGE: Record<string, string> = {
  assessment_completed: '3723634371',
  session_booked:       '3723634374',
  contract_sent:        '3723634379',
  contract_signed:      '3723634380',
  payment:              '3723634381',
};

// Rank for "only advance, never regress" deal stage logic
const STAGE_RANK: Record<string, number> = {
  '3723634371': 1,
  '3723634374': 2,
  '3723634379': 3,
  '3723634380': 4,
  '3723634381': 5,
};

// These events create or advance a Deal; bare page views / calls do not.
const QUALIFYING = new Set(Object.keys(DEAL_STAGE));

// Custom HubSpot contact properties to provision once per worker lifetime
const CUSTOM_PROPS = [
  { name: 'first_touch_source',  label: 'First Touch Source',       type: 'string',   fieldType: 'text' },
  { name: 'utm_source',          label: 'UTM Source',                type: 'string',   fieldType: 'text' },
  { name: 'utm_medium',          label: 'UTM Medium',                type: 'string',   fieldType: 'text' },
  { name: 'utm_campaign',        label: 'UTM Campaign',              type: 'string',   fieldType: 'text' },
  { name: 'utm_content',         label: 'UTM Content',               type: 'string',   fieldType: 'text' },
  { name: 'phone_e164',          label: 'Phone E.164',               type: 'string',   fieldType: 'text' },
  { name: 'contact_type',        label: 'Contact Type',              type: 'string',   fieldType: 'text' },
  { name: 'product_tier',        label: 'Product Tier',              type: 'string',   fieldType: 'text' },
  { name: 'journey_stage',       label: 'Journey Stage',             type: 'string',   fieldType: 'text' },
  { name: 'engagement_score',    label: 'Engagement Score',          type: 'number',   fieldType: 'number' },
  { name: 'last_engagement_at',  label: 'Last Engagement At',        type: 'datetime', fieldType: 'date' },
  { name: 'lifetime_value',      label: 'Lifetime Value (cents)',     type: 'number',   fieldType: 'number' },
  { name: 'familybridge_status', label: 'FamilyBridge Status',       type: 'string',   fieldType: 'text' },
  { name: 'is_marketing_contact', label: 'Is Marketing Contact',     type: 'bool',     fieldType: 'booleancheckbox' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentPayload {
  id:           string;
  processor?:   string;
  amount_cents: number;
  kind?:        string;
  occurred_at?: string;
}

interface IngestBody {
  email:        string;
  property:     string;
  event:        string;
  name?:        string;
  phone?:       string;
  utm?:         Record<string, string>;
  props?:       Record<string, unknown>;
  payment?:     PaymentPayload;
  occurred_at?: string;
  local_id?:    string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 7) return `+${digits}`;
  return null;
}

function err(msg: string, status: number): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── HubSpot API helpers ──────────────────────────────────────────────────────

async function hsReq(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${HS_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  const data = res.ok ? await res.json().catch(() => ({})) : await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, data };
}

// ─── HubSpot property provisioning (once per worker) ─────────────────────────

let propsReady = false;

async function ensureContactProperties(token: string): Promise<void> {
  if (propsReady) return;
  for (const p of CUSTOM_PROPS) {
    const r = await hsReq(token, 'POST', '/crm/v3/properties/contacts', {
      name:       p.name,
      label:      p.label,
      type:       p.type,
      fieldType:  p.fieldType,
      groupName:  'contactinformation',
    });
    // 409 = already exists, which is fine
    if (!r.ok && r.status !== 409) {
      throw new Error(`HubSpot property "${p.name}": ${r.status} ${JSON.stringify(r.data)}`);
    }
  }
  propsReady = true;
}

// ─── HubSpot contact search ───────────────────────────────────────────────────

async function findHsContact(
  token: string,
  email: string,
  phone_e164: string | null,
): Promise<string | null> {
  // Search by email first
  const byEmail = await hsReq(token, 'POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties:   ['hs_object_id', 'email'],
    limit: 1,
  });
  if (byEmail.ok) {
    const results = (byEmail.data as { results?: { id: string }[] }).results ?? [];
    if (results.length > 0) return results[0].id;
  }

  // Fallback: search by our custom phone_e164 property
  if (phone_e164) {
    const byPhone = await hsReq(token, 'POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [{ propertyName: 'phone_e164', operator: 'EQ', value: phone_e164 }] }],
      properties:   ['hs_object_id'],
      limit: 1,
    });
    if (byPhone.ok) {
      const results = (byPhone.data as { results?: { id: string }[] }).results ?? [];
      if (results.length > 0) return results[0].id;
    }
  }

  return null;
}

// ─── HubSpot contact create/update ───────────────────────────────────────────

function buildContactProps(
  person: Record<string, unknown>,
  eventName: string,
  utm?: Record<string, string>,
  isNew = false,
): Record<string, unknown> {
  const nameParts = ((person.full_name as string) ?? '').trim().split(/\s+/);
  const props: Record<string, unknown> = {
    email:             person.email,
    firstname:         nameParts[0] ?? '',
    lastname:          nameParts.slice(1).join(' ') || undefined,
    phone:             person.phone_e164,
    phone_e164:        person.phone_e164,
    contact_type:      person.contact_type,
    product_tier:      person.product_tier,
    journey_stage:     person.journey_stage,
    engagement_score:  person.engagement,
    lifetime_value:    person.ltv_cents,
    last_engagement_at: new Date().toISOString(),
    first_touch_source: person.first_source,
    utm_source:         utm?.source         ?? (person.first_utm as Record<string, string>)?.source,
    utm_medium:         utm?.medium         ?? (person.first_utm as Record<string, string>)?.medium,
    utm_campaign:       utm?.campaign       ?? (person.first_utm as Record<string, string>)?.campaign,
    utm_content:        utm?.content        ?? (person.first_utm as Record<string, string>)?.content,
  };

  // New contacts enter as non-marketing
  if (isNew) props.is_marketing_contact = false;
  // cart_abandoned flips to marketing for nurture
  if (eventName === 'cart_abandoned') props.is_marketing_contact = true;

  // Strip undefined so HubSpot doesn't complain
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v != null));
}

async function syncHsContact(
  token: string,
  contactId: string | null,
  props: Record<string, unknown>,
): Promise<string> {
  if (contactId) {
    const r = await hsReq(token, 'PATCH', `/crm/v3/objects/contacts/${contactId}`, { properties: props });
    if (!r.ok) throw new Error(`HubSpot contact update ${contactId}: ${r.status} ${JSON.stringify(r.data)}`);
    return contactId;
  }
  const r = await hsReq(token, 'POST', '/crm/v3/objects/contacts', { properties: props });
  if (!r.ok) throw new Error(`HubSpot contact create: ${r.status} ${JSON.stringify(r.data)}`);
  return (r.data as { id: string }).id;
}

// ─── HubSpot deal create/advance ─────────────────────────────────────────────

async function syncHsDeal(
  token: string,
  dealId: string | null,
  contactId: string,
  eventName: string,
  person: Record<string, unknown>,
  amountCents?: number,
): Promise<string | null> {
  if (!QUALIFYING.has(eventName)) return dealId;

  const targetStage = DEAL_STAGE[eventName];

  if (dealId) {
    // Fetch current stage; only advance, never regress
    const fetch = await hsReq(token, 'GET', `/crm/v3/objects/deals/${dealId}?properties=dealstage,amount`);
    const currentStage = fetch.ok
      ? ((fetch.data as { properties?: { dealstage?: string } }).properties?.dealstage ?? '')
      : '';

    const currentRank = STAGE_RANK[currentStage] ?? 0;
    const targetRank  = STAGE_RANK[targetStage]  ?? 0;

    const updates: Record<string, unknown> = {};
    if (targetRank > currentRank) updates.dealstage = targetStage;
    if (eventName === 'payment' && amountCents != null) updates.amount = (amountCents / 100).toFixed(2);

    if (Object.keys(updates).length > 0) {
      const r = await hsReq(token, 'PATCH', `/crm/v3/objects/deals/${dealId}`, { properties: updates });
      if (!r.ok) throw new Error(`HubSpot deal update ${dealId}: ${r.status} ${JSON.stringify(r.data)}`);
    }
    return dealId;
  }

  // Create deal (assessment_completed / session_booked / payment are typical triggers)
  const dealProps: Record<string, unknown> = {
    dealname:  `Freedom Interventions — ${(person.full_name as string) ?? (person.email as string)}`,
    pipeline:  FREEDOM_PIPELINE,
    dealstage: targetStage,
  };
  if (eventName === 'payment' && amountCents != null) {
    dealProps.amount = (amountCents / 100).toFixed(2);
  }

  const r = await hsReq(token, 'POST', '/crm/v3/objects/deals', {
    properties:   dealProps,
    associations: [{
      to:    { id: contactId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
    }],
  });
  if (!r.ok) throw new Error(`HubSpot deal create: ${r.status} ${JSON.stringify(r.data)}`);
  return (r.data as { id: string }).id;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return err('method not allowed', 405);

  // Auth
  const ingestKey = Deno.env.get('HUB_INGEST_KEY') ?? '';
  if (!ingestKey) return err('server misconfigured', 500);
  if (req.headers.get('Authorization') !== `Bearer ${ingestKey}`) {
    return err('unauthorized', 401);
  }

  // Parse
  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return err('invalid json', 400);
  }

  const { email: rawEmail, property, event: eventName, name, phone, utm, props, payment, local_id } = body;
  if (!rawEmail || !property || !eventName) {
    return err('email, property, and event are required', 400);
  }

  const email      = normalizeEmail(rawEmail);
  const phone_e164 = phone ? normalizePhone(phone) : null;
  const occurredAt = body.occurred_at ?? new Date().toISOString();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── 1. Upsert person ────────────────────────────────────────────────────────

  let person: Record<string, unknown> | null = null;

  // Match by email
  {
    const { data } = await supabase.from('people').select('*').eq('email', email).maybeSingle();
    if (data) person = data;
  }

  // Match by phone
  if (!person && phone_e164) {
    const { data } = await supabase.from('people').select('*').eq('phone_e164', phone_e164).maybeSingle();
    if (data) person = data;
  }

  if (person) {
    const updates: Record<string, unknown> = {
      last_source: property,
      updated_at:  new Date().toISOString(),
    };
    if (name       && !person.full_name)   updates.full_name   = name;
    if (phone_e164 && !person.phone_e164)  updates.phone_e164  = phone_e164;
    if (email      && !person.email)       updates.email       = email;

    const { data, error } = await supabase
      .from('people').update(updates).eq('id', person.id).select().single();
    if (error) return err(`people update: ${error.message}`, 500);
    person = data;
  } else {
    const { data, error } = await supabase
      .from('people')
      .insert({
        email,
        phone_e164,
        full_name:   name ?? null,
        first_source: property,
        first_utm:   utm ?? null,
        last_source: property,
      })
      .select()
      .single();
    if (error) return err(`people insert: ${error.message}`, 500);
    person = data;
  }

  if (!person || typeof person.id !== 'string') {
    return err('people upsert returned no record', 500);
  }
  const personId = person.id;

  // ── 2. Upsert identity (if local_id provided) ────────────────────────────────

  if (local_id) {
    await supabase.from('identities').upsert({ person_id: personId, property, local_id });
  }

  // ── 3. Insert event (idempotent via unique index) ────────────────────────────

  await supabase.from('events').upsert(
    {
      person_id:   personId,
      property,
      name:        eventName,
      props:       props ?? null,
      utm:         utm ?? null,
      occurred_at: occurredAt,
    },
    { onConflict: 'person_id,name,occurred_at', ignoreDuplicates: true },
  );

  // ── 4. Payment upsert + LTV recompute ────────────────────────────────────────

  if (payment?.id) {
    await supabase.from('payments').upsert({
      id:          payment.id,
      person_id:   personId,
      processor:   payment.processor ?? null,
      amount_cents: payment.amount_cents,
      kind:        payment.kind ?? null,
      occurred_at: payment.occurred_at ?? occurredAt,
    });

    const { data: pmts } = await supabase
      .from('payments').select('amount_cents').eq('person_id', personId);
    const ltv = (pmts ?? []).reduce((s: number, p: { amount_cents: number }) => s + (p.amount_cents ?? 0), 0);

    await supabase.from('people').update({ ltv_cents: ltv, updated_at: new Date().toISOString() }).eq('id', personId);
    person = { ...person, ltv_cents: ltv };
  }

  // ── 5. HubSpot sync ──────────────────────────────────────────────────────────

  const hsToken = Deno.env.get('HUBSPOT_TOKEN');
  if (!hsToken) return err('HUBSPOT_TOKEN not set', 500);

  try {
    await ensureContactProperties(hsToken);

    // Resolve existing HS contact id (stored or search)
    let hsContactId: string | null = (person.hubspot_contact_id as string) ?? null;
    if (!hsContactId) {
      hsContactId = await findHsContact(hsToken, email, phone_e164);
    }

    const isNewContact = !hsContactId;
    const contactProps = buildContactProps(person, eventName, utm, isNewContact);
    hsContactId = await syncHsContact(hsToken, hsContactId, contactProps);

    // Resolve/advance deal
    let hsDealId: string | null = (person.hubspot_deal_id as string) ?? null;
    hsDealId = await syncHsDeal(
      hsToken,
      hsDealId,
      hsContactId,
      eventName,
      person,
      payment?.amount_cents,
    );

    // Persist HS ids back to people
    const hsUpdates: Record<string, string | null> = {};
    if (hsContactId !== person.hubspot_contact_id) hsUpdates.hubspot_contact_id = hsContactId;
    if (hsDealId    !== person.hubspot_deal_id)    hsUpdates.hubspot_deal_id    = hsDealId;
    if (Object.keys(hsUpdates).length > 0) {
      await supabase.from('people').update({ ...hsUpdates, updated_at: new Date().toISOString() }).eq('id', personId);
    }
  } catch (e) {
    // Return 5xx so the outbox retries; Supabase writes are already committed.
    console.error('HubSpot sync failed:', e);
    return err(`HubSpot sync failed: ${(e as Error).message}`, 502);
  }

  return new Response(JSON.stringify({ ok: true, person_id: personId }), {
    status:  200,
    headers: { 'Content-Type': 'application/json' },
  });
});
