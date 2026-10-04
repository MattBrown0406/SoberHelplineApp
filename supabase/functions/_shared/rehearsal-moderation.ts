// Rehearsal Partner — what a moderation verdict means for her line (Deno only:
// it combines rehearsal-safety.ts with the invitation screen's property-only
// rule, so it lives apart from the crisis block the app copies).
//
// Self-harm always counts, exactly as moderationIndicatesCrisis judges it.
// Violence counts ONLY where the caller asks for it — the per-line reply gate,
// which offers "I'm safe — keep practicing" — and only when the line is about
// violence SHE is suffering right now (violenceAgainstHer). Never on the
// debrief or a transcript, which have no way past the pause.
import { type CrisisKind, MAX_MODERATION_CHARS, moderationIndicatesCrisis } from './rehearsal-safety.ts';
import { propertyOnlyViolence } from './invitation-moderation.ts';

// She is the one it happened to: "me" / "us" (but not "called me", "told me",
// "scared me"), "myself", "my nose / my face / my life", "I was / we were
// beaten…"; "me" / "nos" (but not "me dijo", "me da miedo"), "a mí",
// "conmigo", "golpearme", "fui golpeada". A bare "my" doesn't count — "my son"
// is who did it, in almost every line.
const VICTIM_BODY = String.raw`(?:neck|face|head|arms?|hands?|legs?|throat|ribs?|nose|jaw|eyes?|chest|back|wrists?|hair|stomach|body|life|safety|cuello|cara|cabeza|brazos?|manos?|piernas?|garganta|costillas?|nariz|mand[íi]bula|ojos?|pecho|espalda|mu[ñn]ecas?|pelo|cabello|est[óo]mago|cuerpo|vida)`;
const NOT_AFTER_BENIGN_EN = String.raw`(?<!\b(?:call(?:s|ed|ing)?|text(?:s|ed|ing)?|told|tell(?:s|ing)?|ask(?:s|ed|ing)?|show(?:s|ed|ing)?|g(?:ive|ave|ives|iving)|sen(?:d|ds|t|ding)|e-?mail(?:s|ed)?|messag(?:e|es|ed|ing)|remind(?:s|ed)?|let|lets|help(?:s|ed)?|thank(?:s|ed)?|excuse|believe(?:s|d)?|scar(?:e|es|ed)|frighten(?:s|ed)?|worr(?:y|ies|ied)|haunt(?:s|ed)?|terrif(?:y|ies|ied)|upset(?:s)?|miss(?:es|ed)?|love(?:s|d)?|hate(?:s|d)?|from|near|around|behind|beside|next to|without|than|like|about|for)\s+)`;
const HER_AS_VICTIM: readonly RegExp[] = [
  // "me" (EN object or ES clitic), "us", "nos" — never after "called / told / scared / from …", never "me dijo / me da miedo".
  new RegExp(String.raw`(?:^|[^\p{L}])${NOT_AFTER_BENIGN_EN}(?:me|us|nos)(?![\p{L}])(?!\s+(?:dijo|dice|dec[íi]a|llam[óo]|llama|escribi[óo]|escribe|cont[óo]|pidi[óo]|pide|mand[óo]|habl[óo]|pregunt[óo]|(?:da|dio|daba|dan) (?:mucho |tanto )?(?:miedo|terror|pena|tristeza)|asust[óo]|asusta|preocupa|duele el coraz[óo]n))|\b(?:myself|ourselves)\b`, 'iu'),
  new RegExp(String.raw`(?:^|[^\p{L}])(?:my|our|mi|mis|nuestr[oa]s?)\s+${VICTIM_BODY}(?![\p{L}])`, 'iu'),
  // Passive, with or without the "I": "I was beaten by…", "im being hit", "we were attacked", "got beat up by my son".
  /(?:\b(?:i\s+was|i\s+got|i['’]m being|im being|i\s+am being|i['’]ve been|ive been|i\s+have been|i\s+had been|i\s+keep getting|we\s+were|we\s+got|we['’]re being|we\s+are being|we['’]ve been|we\s+have been|we\s+had been)|(?:^|[.!?…]\s*)(?:just\s+)?(?:got|was|been|getting))\s+(?:\w+\s+){0,2}?(?:hit|beaten|beat|attacked|assaulted|choked|strangled|punched|kicked|slapped|stabbed|shot|raped|pushed|shoved|thrown|threatened|hurt|burned|bitten|jumped|knocked|smacked|dragged|grabbed|pinned|held)\b/i,
  /(?:^|[^\p{L}])(?:conmigo|(?:a|contra|hacia|para) (?:m[íi]|nosotr[oa]s)|m[íi] misma)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])(?:fui|fuimos|he sido|hemos sido|estoy siendo|estamos siendo) (?:golpead|agredid|violad|apu[ñn]alad|ahorcad|amenazad|atacad|empujad|patead|quemad|herid)[ao]s?(?![\p{L}])/iu,
  /(?<![\p{L}])\p{L}+(?:ar|er|ir|[aá]ndo|i[ée]ndo)(?:me|nos)(?![\p{L}])/iu,
];

// Spoken TO the loved one — her letter lines describe violence legitimately:
// "when you threw the chair at me…", "if you hit me again I'll call the
// police", "me pegaste", "me pegas cuando tomas", "que me golpees", "si me
// vuelves a pegar". Words to the app itself ("can you help", "are you there",
// "tú qué harías") are taken out first, so they never hide a disclosure.
const TO_THE_APP = /(?:\b(?:can|could|would|will) (?:you|u) (?:please )?(?:help|tell|advise|call|get)(?: me| 911| someone| the police| for help)?|\bare (?:you|u) (?:there|still there|listening|real|a (?:real )?(?:person|human|bot))|\bsorry (?:to bother|for bothering) (?:you|u)|\bi know (?:you|u)(?:['’]re|\s+are|re) (?:just |only )?(?:an? )?(?:app|bot|ai|program|computer)|\bwhat (?:do|would|should) (?:you|u) (?:think|suggest|recommend|say|do)(?: i should do)?|\b(?:you|u) (?:have|need|got) to help(?: me)?|\bi need (?:you|u) to (?:know|help|understand|listen)|\b(?:do|did) (?:you|u) (?:hear|see|understand)(?: me| this)?|\bthank (?:you|u)|\b(?:you|u)['’]?re the only one|t[úu] qu[ée] har[íi]as|qu[ée] (?:me )?(?:recomiendas|sugieres|hago)|(?:me )?(?:puedes|podr[íi]as) (?:ayudar(?:me)?|llamar(?: al 911| a (?:alguien|la polic[íi]a))?)|est[áa]s ah[íi]|perd[óo]n (?:por|que te) molest(?:arte|e)|s[ée] que (?:eres|solo eres) (?:una )?(?:app|aplicaci[óo]n|m[áa]quina|robot|programa))/giu;
const NOT_SECOND_PERSON_ES = String.raw`(?!(?:las|los|les|mas|m[áa]s|tres|seis|antes|veces|meses|noches|tardes|horas|d[íi]as|semanas|ellas|ellos|unas|unos|esas|esos|estas|estos|aquellas|aquellos|todas|todos|mis|tus|sus|nuestras|nuestros|cosas|personas)(?![\p{L}]))`;
const SPOKEN_TO_HIM: readonly RegExp[] = [
  /\b(?:you|your|yours|yourself|you['’](?:re|ve|ll|d)|youre|u|ur|y['’]all)\b/i,
  /(?:^|[^\p{L}])(?:t[úu]|te|ti|tus?|contigo|usted(?:es)?|vos)(?![\p{L}])/iu,
  // Second-person verbs with no pronoun: preterite/imperfect "me pegaste", "intentaste", "ibas a", "querías", "estabas".
  /(?:^|[^\p{L}])(?!(?:triste|existe|insiste|consiste|asiste|resiste|desiste|persiste|subsiste|contraste|desgaste|traste|baste|chiste|alpiste|paste|taste|waste|haste|caste|chaste|toothpaste|foretaste)(?![\p{L}]))\p{L}+(?:aste|iste|abas)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])(?:ibas|ser[íi]as|(?:quer|pod|dec|ten|hac|sab|ven|beb|sal|pon|deb|ped|ve)[íi]as|vas|eres|est[áa]s|tienes|hiciste|dijiste|fuiste)(?![\p{L}])/iu,
  // …and present / subjunctive after a clitic: "me pegas", "me empujas", "me pides", "que me golpees", "nos gritas".
  new RegExp(String.raw`(?:^|[^\p{L}])(?:me|te|nos) ${NOT_SECOND_PERSON_ES}\p{L}+(?:as|es)(?![\p{L}])`, 'iu'),
  // …formal "usted": "no me pegue", "ya no me empuje"; an enclitic "-ándote": "aquí sigo amándote".
  /(?:^|[^\p{L}])(?:no|ya no|que) (?:me|nos) (?:pegue|empuje|golpee|grite|toque|lastime|insulte|amenace|jale|patee|ahorque|maltrate|vuelva a)(?![\p{L}])/iu,
  /(?<![\p{L}])\p{L}+(?:[aá]ndo|i[ée]ndo)te(?![\p{L}])/iu,
  // …a vocative: "Son, …", "…, honey.", "Mijo, …", "Mom, Dad hurt me again".
  /(?:^|[.!?]\s*)(?:son|honey|sweetheart|sweetie|baby|buddy|kiddo|mom|dad|mama|papa|mijo|mija|hijo|hija|mi amor|cari[ñn]o|pap[áa]|mam[áa]|papi|mami)\s*,|,\s*(?:son|honey|sweetheart|sweetie|baby|buddy|kiddo|mom|dad|mijo|mija|hijo|hija|mi amor|cari[ñn]o|pap[áa]|mam[áa])\s*[.!?]?\s*$/iu,
  // …and a clause opened by "si / cuando": "si me vuelves a pegar", "cuando tomas", "cuando bebes".
  new RegExp(String.raw`(?:^|[^\p{L}])(?:si|cuando) (?:(?:no|ya|me|nos|te|lo|la) )?${NOT_SECOND_PERSON_ES}\p{L}+(?:as|es)(?![\p{L}])`, 'iu'),
];

// Not violence happening to her now: childhood or old history, the news or a
// show, generic subjects and boundary statements ("nobody gets to hit me
// anymore", "I've been hit for the last time", "nadie me vuelve a pegar").
const NOT_HERS_NOW: readonly RegExp[] = [
  /\b(?:when (?:i|we) (?:was|were) (?:a kid|kids|a child|children|little|young|small|a teen(?:ager)?|\d{1,2})|as a (?:kid|child|teen(?:ager)?|little girl)|growing up|grew up|years ago|last year|a long time ago|back then|used to|in (?:high school|college)|that (?:night|day|time)|the night (?:the|that|when|he|you|my)|(?:the )?last time|pretending it never happened|still (?:have|has) the (?:scar|bruise))\b/i,
  /(?:^|[^\p{L}])(?:cuando (?:era|éramos|eras) (?:niñ[oa]s?|chic[oa]s?|pequeñ[oa]s?|joven(?:es)?|adolescente)|de (?:niñ[oa]|chic[oa]|pequeñ[oa])|hace (?:años|mucho)|el año pasado|esa noche|aquella noche|ese d[íi]a|aquel d[íi]a|esa vez|aquella vez)(?![\p{L}])/iu,
  /\b(?:(?:saw|heard|read|watched|watching|seen) (?:it )?(?:on|in) (?:the )?news|on the news|in the news|news (?:story|report|article)|(?:a|the|that|this) (?:movie|film|show|documentary|series|tv show)|on (?:tv|netflix|youtube|tiktok))\b/i,
  /(?:^|[^\p{L}])(?:noticias|noticiero|en la tele|en la televisi[óo]n|(?:una|la|esa) (?:pel[íi]cula|serie|telenovela)|(?:un|el|ese) (?:programa|documental))(?![\p{L}])/iu,
  /\b(?:anyone|anybody|nobody|no one|no-one|someone|somebody|whoever|the (?:person|man|one) (?:i|who)|for the last time|never again|ever again|draw the line|my boundary|won['’]t (?:accept|tolerate|allow|live with|stay with)|not something i (?:will|would|can)|(?:ever|never) (?:accept|tolerate|allow))\b/i,
  /(?:^|[^\p{L}])(?:nadie|alguien|quien sea|cualquiera|nunca m[áa]s|(?:ya )?no voy a (?:permitir|dejar|aguantar|tolerar))(?![\p{L}])/iu,
];

/**
 * True when a moderation violence verdict is about her, as the victim, now —
 * not a line spoken to the loved one, not history / the news / a generic or
 * boundary statement, and not violence aimed only at a thing ("he punched a
 * hole in my wall", set aside exactly as the invitation screen does).
 */
export function violenceAgainstHer(text: string): boolean {
  const bounded = text.slice(0, MAX_MODERATION_CHARS);
  const toHim = bounded.replace(TO_THE_APP, ' ');
  return HER_AS_VICTIM.some((re) => re.test(toHim)) &&
    !SPOKEN_TO_HIM.some((re) => re.test(toHim)) &&
    !NOT_HERS_NOW.some((re) => re.test(toHim)) &&
    !propertyOnlyViolence(toHim);
}

/**
 * The kind of crisis a moderation result shows for `text` (the exact text
 * that was moderated): self-harm as `moderationIndicatesCrisis` judges it;
 * and — only when `options.violence` is set (the per-line reply gate, before
 * she has said she's safe) — 'abuse' when moderation flags violence or a
 * threat and `violenceAgainstHer(text)`.
 */
export function moderationCrisisKind(data: unknown, text: string, options: { violence?: boolean } = {}): CrisisKind | null {
  if (moderationIndicatesCrisis(data)) return 'self_harm';
  if (!options.violence) return null;
  const results = (data as { results?: unknown })?.results;
  if (!Array.isArray(results)) return null;
  const violence = results.some((r) => {
    const categories = (r as { categories?: Record<string, unknown> })?.categories ?? {};
    return categories['violence'] === true || categories['harassment/threatening'] === true;
  });
  return violence && violenceAgainstHer(text) ? 'abuse' : null;
}
