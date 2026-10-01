// Invitation Engine — crisis screen for what a family types into the kit
// (today's observation) and the pattern map's recent incidents. These are
// usually addressed TO the loved one ("you shoved me against the wall"), so
// the first-person userInCrisis() check from rehearsal-safety.ts misses them.
// A hit means: no invitation lines — show 911 / 988 / DV hotline instead.
// The member's stored safety answer is never changed by this.
//
// KEEP IN SYNC with src/lib/invitationCrisis.ts (the app cannot import from
// supabase/functions and deployed functions cannot import from src/).
// tests/invitation-crisis.test.ts checks the two copies are identical and
// behave the same.

const L = String.raw`[^\p{L}]`;
const PERSON = String.raw`(?:you|he|she|they|my\s+(?:husband|wife|partner|boyfriend|girlfriend|ex|son|daughter|dad|father|mom|mother|brother|sister|stepdad|stepfather|stepmom|stepmother|kid|child))`;
// "he hit me", "he really hit me" — or a coordinated verb: "he got drunk and hit me".
const ACTOR = String.raw`\b${PERSON}\s+(?:[\w'’]+\s+){0,2}?`;
const ACTOR_THEN = String.raw`\b${PERSON}\b[^.!?]{0,60}?\b(?:and|then)\s+(?:then\s+)?`;
// Something the loved one said or threatened — with a subject ("he said…") or
// none ("Says he'll kill himself…"), never "I said…" or "the doctor said…".
const SAID = String.raw`(?:\b${PERSON}\b[^.!?]{0,40}?|^\s*|[.!?;]\s*)\b(?:said|says|threatened|threatens|swore|swears|tried|tries|talked about|talks about|talking about|keeps saying|kept saying|keeps talking about|kept talking about|told (?:me|us|them))\s+(?:[\w'’]+\s+){0,4}?`;
const BODY = String.raw`(?:neck|throat|face|head|hair|arm|arms|wrist|wrists|shoulder|shoulders|chest|leg|legs|jaw|nose|mouth|eye|eyes|back|stomach|rib|ribs)`;
const US = String.raw`(?:me|us|the\s+kids?)\b`;
// Spanish: "dijo que…", "me dijiste que…", "amenazó con…", "intentó…", "habló de…".
const DIJO = String.raw`(?:dijo|dijiste|dice|dices|amenaz\p{L}*|jur\p{L}*|intent\p{L}*|habl[óo] de|hablaste de|habla de|hablas de|sigue hablando de|sigues hablando de)\s+(?:que\s+)?(?:\p{L}+\s+){0,3}?`;
const NOT_INFINITIVE = String.raw`(?!\s+a\s+\p{L}+r(?!\p{L}))`;
const NOT_FIGURATIVE_ES = String.raw`(?!\s+(?:un\s+susto|un\s+grito|la\s+gripe|el\s+resfriado|un\s+resfriado|el\s+virus|duro|fuerte|mucho|el\s+sol|la\s+noticia))`;

/** Violent verb + me/us, said near the actor or as a coordinated verb, with per-verb idiom exclusions. */
function violent(verbs: string, idioms = ''): RegExp[] {
  const tail = String.raw`(?:${verbs})\s+${US}${idioms}`;
  return [new RegExp(`${ACTOR}${tail}`, 'i'), new RegExp(`${ACTOR_THEN}${tail}`, 'i')];
}

export const INVITATION_CRISIS_PATTERNS: readonly RegExp[] = [
  // Physical violence toward her (or the kids) — never the idioms: "hit me up",
  // "hit me with the same excuse", "pushed me away / into paying / too far",
  // "kicked me out", "beat me at cards / to the punch", "threw me a party".
  ...violent('choked|strangled|punched|slapped|smacked|backhanded|tackled|slammed|head-?butted|bit|pinned'),
  ...violent('attacked', String.raw`(?!\s+(?:verbally|with\s+words)\b)`),
  ...violent('grabbed', String.raw`(?!\s+(?:a|an|some|lunch|dinner|breakfast|coffee|food|drinks?)\b)`),
  ...violent('dragged', String.raw`(?!\s+(?:into\s+(?:this|that|his|her|the|all)\b|down\s+with\b|along\b|to\s+(?:a|the|another|his|her)\s+(?:party|meeting|store|game|event)\b))`),
  ...violent('hit', String.raw`(?!\s+(?:up|with\s+(?:the\s+same|another|an?\s+(?:excuse|lie|story|question|request|guilt\s+trip|bill)|the\s+(?:bill|news)|excuses|questions|requests|bills))\b)`),
  ...violent('beat', String.raw`(?!\s+(?:at\b|in\s+(?:a|the)\s+(?:race|game|match|argument)\b|to\s+(?:the\s+(?:punch|door|car|phone|finish|bathroom)|it|there)\b))`),
  ...violent('shoved|pushed', String.raw`(?!\s+(?:away\b(?!\s+(?:so\s+)?hard)|too\s+far\b|to\s+(?:get|go|be|do|seek|stop|try|change|make|take|see|my\s+limit)\b|past\s+my\s+limit\b|into\s+\w+ing\b))`),
  ...violent('kicked', String.raw`(?!\s+out\b)`),
  ...violent('threw', String.raw`(?!\s+(?:a\b|an\b|under\b|for\b|off\b(?!\s+(?:the|a|his|her|my)\b)|out\b(?!\s+of\s+(?:the|a|his|her|my)\s+(?:car|truck|window|moving)\b)))`),
  // Ongoing: "he was hitting me", "he keeps hitting me", "started choking me".
  new RegExp(String.raw`\b(?:was|were|is|are|['’]s|been|keeps|kept|started|began|starts|begins)\s+(?:hitting|beating|choking|strangling|punching|kicking|slapping|smacking|shoving|attacking)\s+${US}`, 'i'),
  new RegExp(String.raw`\btri(?:ed|es)\s+to\s+(?:choke|hit|hurt|beat|strangle|stab|shoot|smother|drown|punch|kick|run\s+over)\s+${US}`, 'i'),
  /\b(?:put|puts|laid|lays)\s+(?:(?:his|her|their|your)\s+)?hands\s+on\s+(?:me|us)\b/i,
  new RegExp(String.raw`\b(?:gets?|got|getting|was|were|is|are|becomes?|became)\s+(?:\w+\s+)?(?:violent|physical|rough)\s+with\s+${US}`, 'i'),
  /\b(?:gets?|got|getting|becomes?|became)\s+(?:really\s+|so\s+|very\s+)?violent\b/i,
  /\b(?:sexually\s+)?(?:assaulted|raped|molested)\s+(?:me|us)\b/i,
  // …or a body part ("grabbed my arm", "slammed my head into the wall"), never an object.
  new RegExp(`${ACTOR}(?:hit|shoved|pushed|choked|punched|slapped|smacked|slammed|kicked|grabbed|bit|twisted|squeezed|broke)\\s+(?:my|our|her)\\s+${BODY}\\b(?!\\s+off\\b)`, 'i'),
  new RegExp(`${ACTOR_THEN}(?:hit|shoved|pushed|choked|punched|slapped|smacked|slammed|kicked|grabbed|twisted|broke)\\s+(?:my|our|her)\\s+${BODY}\\b(?!\\s+off\\b)`, 'i'),
  // "pulled my hair" — not "pulled my leg".
  new RegExp(`${ACTOR}pulled\\s+(?:my|our|her)\\s+hair\\b`, 'i'),
  /\bheld\s+(?:me|us)\s+(?:down|against|by\s+the\s+(?:throat|neck|hair|arms?|wrists?))\b/i,
  /\bforced\s+(?:himself|herself|themselves)\s+on\s+(?:me|us)\b/i,
  /\b(?:he|she|they|you)(?:['’]s|['’]re|\s+is|\s+are)\s+(?:going\s+to|gonna)\s+(?:kill|hurt|shoot|stab)\s+(?:me|us|the\s+kids?)\b/i,
  new RegExp(`\\bbroke\\s+(?:my|our|her)\\s+(?:nose|arm|jaw|ribs?|fingers?|wrist|leg|tooth|teeth|cheekbone|collarbone)\\b`, 'i'),
  /\b(?:hands?|arms?|fingers)\s+(?:around|round|on)\s+(?:my|our|her)\s+(?:neck|throat)\b/i,
  /\bthrew\s+(?:\w+\s+){0,3}?at\s+(?:me|us|my\s+(?:head|face))\b/i,
  /\b(?:kicked|punched|beat|hit|choked|threw|hurt)\s+(?:my|our|the)\s+(?:dog|cat|pet|puppy|kitten)\b/i,
  // Threats of violence — not "threatened to leave" / "threatened me with divorce".
  /\bthreaten(?:ed|s|ing)?\s+to\s+(?:kill|hurt|shoot|stab|beat|hit|strangle|choke)\b/i,
  /\bthreaten(?:ed|s|ing)?\s+(?:me|us|her)\s+with\s+(?:a\s+|the\s+|his\s+|her\s+)?(?:gun|knife|weapon|bat|violence)\b/i,
  new RegExp(`${SAID}(?:kill|shoot|stab|strangle)\\s+(?:me|us|the\\s+kids?|my\\s+(?:kids?|children|son|daughter))\\b`, 'i'),
  // Self-harm the loved one said or threatened — not worry ("you'll kill
  // yourself drinking", "if you keep drinking") and not "cut himself off".
  new RegExp(`${SAID}(?:kill(?:ing)?|hurt(?:ing)?|harm(?:ing)?|shoot(?:ing)?|cut(?:ting)?)\\s+(?:yourself|himself|herself|themselves|themself)\\b(?!\\s+(?:off\\b|if\\s+(?:you|he|she|they)\\s+keep|drinking|using))`, 'i'),
  /\b(?:wants?|wanted)\s+to\s+(?:kill|hurt|harm)\s+(?:yourself|himself|herself|themselves|themself)\b/i,
  /\btried\s+to\s+(?:kill|hurt|harm)\s+(?:yourself|himself|herself|themselves|themself)\b/i,
  /\b(?:end|ending|take|taking)\s+(?:my|your|his|her|their)\s+(?:own\s+)?life\b(?!\s+(?:back|seriously|into|in\s+hand))/i,
  /\bend\s+it\s+all\b/i,
  /\bsuicid/i,
  /\brather\s+(?:be\s+dead|die)\b/i,
  /\bbetter\s+off\s+(?:dead|without\s+(?:him|her|them|me))\b/i,
  /\b(?:wants?|wanted)\s+to\s+die\b/i,
  /\b(?:he|she|they)\s+(?:[\w'’]+\s+){0,2}?(?:doesn['’]?t|does\s+not|don['’]?t|do\s+not|didn['’]?t)\s+want\s+to\s+(?:live|be\s+alive|be\s+here)(?:\s+any\s*more\b|\s*[.!?,;]|\s*$)/i,
  /\boverdos(?:e|ed|ing)\s+on\s+purpose\b/i,
  // Weapons.
  /\b(?:gun|knife|pistol|blade|razor)\s+to\s+(?:his|her|their|your|my)\s+(?:head|throat|neck|chest|wrists?)\b/i,
  /\b(?:held|put|pointed)\s+(?:a|the|his|her)\s+(?:gun|knife|pistol|blade)\s+(?:to|at)\s+(?:me|us|my\s+\w+)\b/i,
  /\buse\s+it\s+on\s+(?:himself|herself|themselves|me|us)\b/i,
  /\b(?:nobody|no\s+one)\s+would\s+(?:miss|care\s+about)\s+(?:him|her|them)\s+if\s+(?:he|she|they)\s+(?:was|were|died)\b/i,
  /\b(?:pulled|grabbed|waved|pointed|brandished)\s+(?:a|the|his|her|their)\s+(?:gun|knife|weapon|pistol|rifle)\b/i,
  /\b(?:came at|went after|chased|threatened)\s+(?:me|us|her)\s+with\s+(?:a|the|his|her|their)\s+(?:gun|knife|weapon|bat)\b/i,
  // Spanish.
  new RegExp(`(?:^|${L})me\\s+(?:pegaste|golpeaste|empujaste|ahorcaste|estrangulaste|abofeteaste|pateaste|aventaste|mordiste|peg[óo]|golpe[óo]|empuj[óo]|ahorc[óo]|estrangul[óo]|abofete[óo]|pate[óo]|mordi[óo])(?!\\p{L})${NOT_INFINITIVE}${NOT_FIGURATIVE_ES}`, 'iu'),
  new RegExp(`(?:^|${L})me\\s+(?:pega|pegas|golpea|golpeas|ahorca|ahorcas|patea|pateas|empuja|empujas|estrangula|agredi[óo]|agrediste|agrede|agredes)(?!\\p{L})${NOT_INFINITIVE}${NOT_FIGURATIVE_ES}`, 'iu'),
  new RegExp(`(?:^|${L})(?:fue|es|era|se\\s+puso|se\\s+pone|est[áa]|estaba)\\s+(?:muy\\s+)?violent[oa]\\s+(?:conmigo|con\\s+nosotros|con\\s+los\\s+ni[ñn]os)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})(?:quiere|quieres|quer[íi]a|quer[íi]as|quiso|quisiste)\\s+(?:matarse|matarte|suicidarse|suicidarte|quitarse\\s+la\\s+vida|quitarte\\s+la\\s+vida)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})me\\s+(?:estaba|estabas|est[áa]|est[áa]s|sigue|sigues|segu[íi]a|segu[íi]as)\\s+(?:pegando|golpeando|ahorcando|estrangulando|empujando|pateando|asfixiando)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})(?:empez[óo]|empezaste|comenz[óo]|comenzaste|sigui[óo]|seguiste)\\s+a\\s+(?:pegar|golpear|ahorcar|estrangular|patear|empujar|asfixiar)(?:me|nos)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})(?:intent[óo]|intentaste|trat[óo]\\s+de|trataste\\s+de|quiso|quisiste)\\s+(?:ahorcar|estrangular|pegar|golpear|matar|asfixiar|ahogar|apu[ñn]alar)(?:me|nos)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})me\\s+(?:agarr[óo]|agarraste|apret[óo]|apretaste|tom[óo]|tomaste|jal[óo]|jalaste)\\s+(?:del?|el|la|los)\\s+(?:cuello|garganta|pelo|cabello)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})me\\s+(?:rompiste|rompi[óo])\\s+(?:la|el|los|las)\\s+(?:nariz|brazo|mand[íi]bula|costillas?|dedos?|mu[ñn]eca|pierna|dientes?)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:manos?|dedos)\\s+(?:en|alrededor\\s+de|sobre)\\s+(?:mi|el|su)\\s+(?:cuello|garganta)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})me\\s+(?:aventaste|lanzaste|arrojaste|avent[óo]|lanz[óo]|arroj[óo])(?!\\p{L})`, 'iu'),
  // "Me tiró X" only when it was thrown AT her (not "me tiró la comida / la puerta").
  new RegExp(`(?:^|${L})me\\s+(?:tiraste|tir[óo])\\s+(?:el|la|un|una|los|las|su|tu)\\s+(?!puerta(?!\\p{L}))\\p{L}+\\s+(?:a\\s+la\\s+(?:cara|cabeza)|en\\s+la\\s+(?:cara|cabeza)|encima|contra\\s+m[íi])(?!\\p{L})`, 'iu'),
  // Amenazas solo con violencia: no "me amenazó con irse de la casa".
  new RegExp(`amenaz\\p{L}*\\s+con\\s+(?:matar\\p{L}*|lastimar\\p{L}*|pegar\\p{L}*|golpear\\p{L}*|hacer(?:me|nos|se|te)?\\s+da[ñn]o|suicid\\p{L}*|quitar(?:se|te|me)?\\s+la\\s+vida|un\\s+arma|una\\s+pistola|un\\s+cuchillo|una\\s+navaja)`, 'iu'),
  new RegExp(`${DIJO}(?:matarme|matarnos|matarte|matarse|suicidarte|suicidarse|quitarse\\s+la\\s+vida|quitarte\\s+la\\s+vida)(?!\\p{L})`, 'iu'),
  new RegExp(`${DIJO}(?:te|se)\\s+(?:matar[íi]as?|suicidar[íi]as?|ibas?\\s+a\\s+(?:matar|suicidar))(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})se\\s+(?:quiere|quer[íi]a|quiso|va\\s+a|iba\\s+a)\\s+(?:matar|morir|suicidar)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})(?:quiere|quieres|quer[íi]a|quer[íi]as)\\s+morir(?:se|te)?(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})no\\s+(?:quiere|quieres|quer[íi]a)\\s+(?:vivir|seguir\\s+viviendo|estar\\s+viv[oa])(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})te\\s+(?:quer[íi]as|ibas\\s+a|quieres|vas\\s+a)\\s+(?:matar|morir|suicidar)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})(?:prefiero|prefiere|prefieres|preferir[íi]as?)\\s+(?:estar\\s+muert[oa]|morir(?:me|se|te)?)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})acabar\\s+con\\s+(?:todo|su\\s+vida|tu\\s+vida)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})(?:tengo\\s+miedo\\s+de\\s+que|temo\\s+que)\\s+me\\s+(?:mate|pegue|golpee|lastime)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:pistola|cuchillo|arma|navaja)\\s+(?:en|a|contra)\\s+(?:la|su|mi|tu)\\s+(?:cabeza|cuello|garganta|sien)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:^|${L})(?:sac[óo]|sacaste|apunt[óo]|apuntaste)\\s+(?:un|una|el|la|su|tu)\\s+(?:pistola|cuchillo|arma|navaja)(?!\\p{L})`, 'iu'),
  new RegExp(`(?:vino|viniste|fue|fuiste|se\\s+me\\s+vino)\\s+(?:hacia\\s+m[íi]\\s+|encima\\s+)?con\\s+(?:un|una|el|la|su)\\s+(?:pistola|cuchillo|arma|navaja)(?!\\p{L})`, 'iu'),
];

/** True when one piece of family text describes violence, threats, weapons or self-harm. */
export function invitationTextInCrisis(text: string): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return INVITATION_CRISIS_PATTERNS.some((pattern) => pattern.test(text));
}

export function invitationTextsInCrisis(texts: readonly (string | null | undefined)[]): boolean {
  return texts.some((text) => typeof text === 'string' && invitationTextInCrisis(text));
}
