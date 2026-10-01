// First-person crisis disclosures (self-harm; abuse she is suffering) — the
// app-side twin of crisisKind()/userInCrisis() in
// supabase/functions/_shared/rehearsal-safety.ts, which invitation-coach runs
// on everything a family types. The app cannot import from supabase/functions,
// so everything below this header is a VERBATIM copy of that file from its
// CLAUSE_END constant up to its "Moderation" section.
// tests/invitation-crisis.test.ts fails if the two drift: when
// rehearsal-safety.ts changes, copy that block here again.
const CLAUSE_END = String.raw`\s*(?:[.!?,;…]|$)`;
/** The end of a sentence only (no comma). */
const SENTENCE_END = String.raw`\s*(?:[.!?…]|$)`;
/** End of the thought, or the sentence carries on with and/but/because. */
const THOUGHT_END = String.raw`(?:${CLAUSE_END}|\s+(?:and|but|because|cause|so)\b)`;
const THOUGHT_END_ES = String.raw`(?:${CLAUSE_END}|\s+(?:y|pero|porque)(?![\p{L}]))`;
// `\b` belongs on the word, not before the n't: "won't", "don't", "can't"
// count; "done / quit / stopped / refuse to / tired of" are boundaries too.
const NOT_NEGATED = String.raw`(?<!(?:\bnever|\bnot|n['’]t|\bdone|\bquit|\bstopped|\brefuse to|\btired of)\s+(?:\w+\s+){0,2})`;
const NOT_NEGATED_ES = String.raw`(?<!(?:^|[^\p{L}])(?:no|nunca|jam[áa]s)\s+(?:\p{L}+\s+){0,2})`;
/** "killing myself working two jobs", "hurting myself by enabling you", "cutting myself off". */
const NOT_IDIOM = String.raw`(?!\s+(?:to|for|trying|working|by|over|keeping|worrying|covering|paying|off|some (?:slack|time|space|grace)|out|more than|every (?:day|night|single day|time)|day and night|helping|giving|staying|enabling|just to|so (?:that|you)|at work|on (?:the|my) job|in the foot|if i (?:eat|have|see|hear|watch|do|drink) (?:another|one more))\b)`;
const NOT_IDIOM_ES = String.raw`(?!\s+(?:al|por|para (?:ayudar|proteger|salvar|pagar|mantener)|(?!cuando(?![\p{L}]))\p{L}+(?:ando|iendo)(?![\p{L}])|el pelo|el cabello|la barba|las u[ñn]as|con (?:tus|sus|su|tu)|mucho|de ti|de ellos))`;
const ADVERBS = String.raw`(?:\s+(?:just|really|honestly|seriously|sometimes|kind of|kinda|still|actually|literally)){0,2}`;
const L = String.raw`\p{L}`;
const ABUSER = String.raw`(?:he|she|they|(?:my|your) (?:husband|wife|partner|boyfriend|girlfriend|ex|son|daughter|dad|father|mom|mother|brother|sister|stepdad|stepfather|stepmom|stepmother))`;
const ABUSER_ES = String.raw`(?:[ée]l|ella|(?:mi|tu) (?:esposo|esposa|marido|mujer|pareja|novio|novia|hijo|hija|padre|madre|pap[áa]|mam[áa]|hermano|hermana|ex|padrastro|madrastra))`;
/** Ongoing forms ("he's been hitting me for years", "he hits me at night") — only "hits me up for money" etc. are figurative. */
const NOT_FIGURATIVE_ONGOING = String.raw`(?!\s+(?:up (?:for|on|about|asking|with)\b|at (?:cards|chess|poker|checkers|games?|tennis|golf|pool|\w+ing)\b|with(?:\s+\S+){0,4}?\s+(?:news|bills?|questions?|words?|comments?|excuses?|guilt|lawsuits?|demands?|lies|control|attitude|rules|silence|expectations|kindness|love|drinking|behaviou?r)\b|to\b|home\b|down\b|out\b|off\b|aside\b|away\b|on (?:facebook|instagram|social|line|the phone)|over the phone|verbally|emotionally|into\b|toward|towards))`;
/** Past forms: "hit me up", "beat me at cards", "beat me to it", "kicked me out", "hit me with the news". */
const NOT_FIGURATIVE_PAST = String.raw`(?!\s+(?:up\b|to\b|at (?:cards|chess|poker|checkers|games?|tennis|golf|pool|\w+ing)\b|home\b|there\b|down\b|out\b|off\b|aside\b|away\b|by\b|for\b|into (?:doing|a corner|\w+ing)\b|toward|towards|on (?:facebook|instagram|social|line|the phone)|over the phone|verbally|emotionally|with(?:\s+\S+){0,4}?\s+(?:news|bills?|questions?|words?|comments?|excuses?|guilt|lawsuits?|demands?|lies|control|attitude|rules|silence|expectations|kindness|love|drinking|behaviou?r)\b))`;
/** Old history, not current danger: "my dad hit me when I was a kid", "he threatened to kill me last year". */
const NOT_HISTORY = String.raw`(?![^.!?]{0,40}\b(?:when (?:i|you|we) (?:was|were) (?:a kid|kids|a child|children|little|young|small|a teen(?:ager)?)|as a (?:kid|child|teen(?:ager)?)|growing up|years ago|last year|a long time ago|when i was growing up))`;
/** "He just hit me", "my son actually punched me", "he finally threatened to kill me". */
const ADV = String.raw`(?:\s+(?:just|actually|finally|even|really|again))?`;
/** "pushing me for money / about rehab / to get help / too far / around", "pushed me past my limit". */
const NOT_FIGURATIVE_PUSH = String.raw`(?!\s+(?:for|about|on|and|to|too|past|toward|towards|around|away|aside|out|off|over|down|into (?:doing|giving|a corner|\w+ing)|harder|hard to)\b)`;
const NOT_HISTORY_ES = String.raw`(?![^.!?]{0,40}(?:cuando (?:era|éramos|eras) (?:niñ[oa]s?|chic[oa]s?|pequeñ[oa]s?|joven(?:es)?)|de niñ[oa]|de chic[oa]|hace (?:años|mucho)|el año pasado))`;
const NOT_FIGURATIVE_ES_HIT = String.raw`(?!\s+(?:un susto|un grito|gritos|la gripe|el resfriado|la costumbre|duro|muy duro|fuerte|mucho|la noticia|la realidad|la confianza|con (?:sus|tus) palabras))`;

function en(source: string): RegExp {
  return new RegExp(source, 'iu');
}
function es(source: string, negatable = true): RegExp {
  return new RegExp(String.raw`(?:^|[^${L}])${negatable ? NOT_NEGATED_ES : ''}(?:${source})(?![${L}])`, 'iu');
}

const SELF_HARM_PATTERNS = [
  // ---- English ----
  // "I'm only / just hurting myself" is the loved one's classic denial line, not a disclosure.
  en(String.raw`${NOT_NEGATED}\b(?:(?:kill|hurt|harm|cut|shoot|hang|poison|drown|stab)|(?<!\b(?:only|just)\s+)(?:killing|hurting|harming|cutting|shooting|hanging|poisoning|drowning|stabbing)) myself\b${NOT_IDIOM}`),
  // "I can't stop hurting myself" is ongoing self-harm, not a negation.
  en(String.raw`\b(?:can['’]t|cannot|can not|couldn['’]t) stop (?:hurting|cutting|harming|burning|starving) myself\b`),
  // Uncertainty about staying safe.
  en(String.raw`\b(?:can['’]t|cannot) (?:promise|say|swear)(?: that)? i (?:won['’]t|will not|wouldn['’]t) (?:hurt|kill|harm|cut) myself\b`),
  en(String.raw`\b(?:not sure|don['’]t know if|don['’]t know whether) i (?:won['’]t|will not|can keep from) (?:hurt|kill|harm|cut|hurting|killing) myself\b`),
  en(String.raw`\b(?:can['’]t|cannot|can not|don['’]t think i can|not sure i can) keep myself safe\b`),
  en(String.raw`\b(?:use (?:it|the gun|a gun|them|the pills) on|turn (?:it|the gun) on) myself\b`),
  en(String.raw`\bi(?:['’]m|\s+am|['’]ll|\s+will)?${ADVERBS}(?:\s+(?:going to|gonna|want to|wanna|plan to|planning to|thinking (?:of|about)|might|could|should|need to|am going to))?(?:\s+just)?\s+(?:end|take|ending|taking) my (?:own )?life\b(?!\s+(?:savings|away|over|back|as i knew))`),
  // "I want to die" at the end of the thought (or going on with because/and/but/so, every day…);
  // never "want to die when I see you like this / of embarrassment / inside".
  en(String.raw`\bi${ADVERBS}\s+(?:want|wanna)\s+(?:to\s+)?(?:just\s+)?die(?:\s+(?:so bad|so badly|so much|right now|tonight|already|every (?:day|night|single day)|all the time))?(?:${THOUGHT_END}|\s+so (?:this|the) pain)`),
  en(String.raw`\bi(?:['’]ve| have) been wanting to die\b`),
  en(String.raw`\bi(?:\s+just)? feel like (?:dying|killing myself|ending (?:it all|my life))${THOUGHT_END}`),
  en(String.raw`\bi wish i could (?:just )?die${CLAUSE_END}`),
  en(String.raw`\bi(?:['’]m| am) ready to die\b(?!\s+for\b)`),
  en(String.raw`\bi(?:['’]d| would) (?:much )?rather (?:just )?be dead${CLAUSE_END}`),
  en(String.raw`\bi (?:don't|do not|dont|don’t) want to (?:live|be alive)(?:\s+(?:anymore|any more))?${THOUGHT_END}`),
  // "be here" goes on so often ("…and pretend", "…because I'm scared of you",
  // "…anymore, so I'm moving out") that it only counts at the end of a sentence.
  en(String.raw`\bi (?:don't|do not|dont|don’t) want to be here(?:\s+(?:anymore|any more))?${SENTENCE_END}`),
  en(String.raw`\bi (?:don['’]t|do not) care (?:if|whether) i live or die\b`),
  en(String.raw`\bi (?:don['’]t|do not|can['’]t) see (?:the|a|any) point in (?:living|life|going on)\b`),
  en(String.raw`\bi (?:can['’]t|cannot) go on (?:anymore|any more|living(?: like this)?)${CLAUSE_END}`),
  en(String.raw`\bi(?:['’]m|\s+am|\s+feel|\s+felt|\s+was|['’]ve been|\s+have been)(?:\s+feeling)?\s+(?:so\s+|really\s+|kind of\s+|very\s+)?suicidal\b`),
  en(String.raw`\bi(?:['’]ve|\s+have|\s+had|['’]m|\s+am|\s+keep|\s+can['’]t stop|\s+sometimes|\s+often)?(?:\s+been)?\s+(?:having\s+|getting\s+)?(?:suicidal (?:thoughts|feelings|urges|ideas)|thoughts (?:of|about) (?:suicide|killing myself|ending my life)|(?:thinking|think|thought) (?:about|of) (?:suicide|killing myself|ending my life|(?:taking|swallowing) all (?:of )?my (?:pills|meds|medication|tablets)))\b`),
  en(String.raw`\bi (?:just )?(?:took|swallowed|ate) (?:all (?:of )?my|a (?:whole )?bottle of|a bunch of|too many|way too many) (?:pills|meds|medications?|tablets|sleeping pills)\b(?!\s+(?:out|away|to|back|and (?:flushed|threw|got rid|hid))\b)`),
  en(String.raw`\bi(?:['’]m|\s+am)?${ADVERBS}\s+(?:going to|gonna|want to|wanna|plan to|planning to|about to)\s+(?:take|swallow|down) (?:all (?:of )?my|a (?:whole )?bottle of|a bunch of|all the|all of the) (?:pills|meds|medications?|tablets|sleeping pills)\b(?!\s+(?:out|away|to (?:the|a)|back|and (?:flushed|threw|got rid|hid))\b)`),
  en(String.raw`\bi(?:['’]m|\s+am)?${ADVERBS}\s+(?:going to|gonna|want to|wanna|plan to|planning to|about to)\s+(?:overdose|od)\b(?!\s+on\s+(?:sugar|chocolate|cake|coffee|caffeine|candy))`),
  en(String.raw`\bi (?:have|['’]ve got|got) (?:the|my) pills (?:ready|right here|in my hand|lined up)\b`),
  en(String.raw`\bi (?:overdosed|od['’]?d|o\.d\.['’]?d) on purpose\b`),
  en(String.raw`\bi wish i (?:was|were) dead\b`),
  en(String.raw`\bi wish i (?:had|['’]d)?\s*never (?:been born|woken up)\b`),
  en(String.raw`\bi (?:wish i could|want to|wanna|just want to|would like to|could just|hope i) (?:just )?(?:go to sleep|fall asleep|sleep) and (?:not|never) wake up\b`),
  en(String.raw`\bi (?:wouldn['’]t mind|don['’]t care|would(?:n['’]t)? be (?:fine|okay|ok)) if i (?:didn['’]t|never|don['’]t) wake up\b`),
  en(String.raw`\bi (?:don't|do not|dont|don’t|never|don['’]t ever) (?:ever )?want to wake up(?: (?:tomorrow|again|anymore|ever again))?${THOUGHT_END}`),
  en(String.raw`\bi(?:['’]m| am) done with (?:life|living)${CLAUSE_END}`),
  en(String.raw`\b(?:everyone|everybody|my family|my kids|the kids|the world|people|they|you all|y['’]all|all of you)(?:['’]d| would)(?: all)? be better off without me${CLAUSE_END}`),
  en(String.raw`\bi(?:['’]d|\s+would)(?:\s+be)?(?:\s+(?:so much|a lot|just|probably))?\s+better off dead\b`),
  en(String.raw`\bi${ADVERBS}(?:\s+(?:want|wanna|need)\s+to|['’]ll|\s+will|['’]m\s+going\s+to|['’]m\s+gonna|\s+am\s+going\s+to)\s+(?:just\s+)?end it all${THOUGHT_END}`),
  en(String.raw`\btonight,?\s+i(?:['’]m|\s+am)\s+(?:going to|gonna)\s+end it${CLAUSE_END}`),
  // ---- Spanish ----
  // "matarme" is hers only when no one else is the subject ("me amenazó con
  // matarme", "intentó matarme", "dijo que va a matarme" are abuse, below).
  es(String.raw`(?<!(?:amenaz(?:a|ó|o|aba|ando) con|va a|iba a|van a|quiere|quer[íi]a|intent[óo]|trat[óo] de|quiso|dijo que (?:va|iba) a)\s+)(?:matarme|suicidarme|quitarme la vida|hacerme da[ñn]o)${NOT_IDIOM_ES}`),
  es(String.raw`me (?:quiero|voy a|pienso|podr[íi]a) (?:matar|suicidar|quitar la vida|hacer da[ñn]o)${NOT_IDIOM_ES}`),
  es(String.raw`(?:me )?(?:quiero|quisiera) morir(?:me)?${THOUGHT_END_ES}`),
  es(String.raw`ojal[áa] (?:me muriera|me muera|estuviera muert[oa]|no despertara|no hubiera nacido)`),
  es(String.raw`prefiero (?:morir(?:me)?|estar muert[oa])${THOUGHT_END_ES}`),
  // First-person, present-tense self-harm — checked before any abuse form.
  // "Solo me hago daño a mí mismo" is the classic denial line, not a disclosure.
  es(String.raw`(?<!(?:solo|s[óo]lo|solamente|nom[áa]s)\s+)me (?:lastimo|corto|golpeo|quemo|hago da[ñn]o|estoy lastimando|estoy cortando|estoy haciendo da[ñn]o|he estado (?:cortando|lastimando|haciendo da[ñn]o))${NOT_IDIOM_ES}`),
  es(String.raw`(?:me (?:voy a )?pego|(?:voy a |quiero )?pegarme|me (?:voy a|quiero) pegar) un tiro`),
  es(String.raw`me mato(?=\s*(?:[.!?,;…]|$)|\s+(?:si|y ya|de una vez|hoy|ahora|esta noche)(?![${L}]))`),
  es(String.raw`pensamientos suicidas|ganas de morir(?:me)?|pienso en (?:el suicidio|suicidarme|matarme)`),
  es(String.raw`(?:me tom[ée]|me voy a tomar|voy a tomarme|me quiero tomar|quiero tomarme) (?:todas (?:mis|las) pastillas|un frasco(?: de pastillas)?|demasiadas pastillas)`),
  es(String.raw`dormirme y no despertar|no (?:quiero|quisiera) despertar(?:me)?(?: m[áa]s| ma[ñn]ana)?${THOUGHT_END_ES}`, false),
  new RegExp(String.raw`(?:^|[^${L}])no quiero (?:vivir|seguir viviendo)(?: m[áa]s)?${THOUGHT_END_ES}`, 'iu'),
  new RegExp(String.raw`(?:^|[^${L}])no quiero estar aqu[íi](?: m[áa]s)?${SENTENCE_END}`, 'iu'),
];

// Abuse she is suffering: an explicit third-person abuser and "me", present or
// past ("my husband hit me again", "mi esposo me pegó"), or explicit threat
// framing ("he threatened to kill me", "me amenazó con matarme"). Second
// person ("when you hit me…", "me pegaste") is a line in a letter to the loved
// one and never breaks; figurative uses ("hit me up", "beat me at cards",
// "me pegó un grito", "he's going to kill me when he finds out") and childhood
// history ("my dad hit me when I was a kid") are left to moderation and the model.
const ABUSE_PATTERNS = [
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+are|['’]re|\s+has|\s+have|\s+was|\s+were)?(?:\s+been)?${ADV}\s+(?:hitting|beating|choking|strangling|kicking|punching|hits|beats|chokes|strangles|kicks|punches)\s+me\b${NOT_FIGURATIVE_ONGOING}${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}${ADV}\s+(?:keeps?|kept|started|began)(?:\s+on)?\s+(?:hitting|beating|choking|strangling|kicking|punching|slapping)\s+me\b${NOT_FIGURATIVE_ONGOING}`),
  en(String.raw`\b${ABUSER}${ADV}\s+(?:keeps?|kept)(?:\s+on)?\s+(?:shoving|pushing)\s+me\b${NOT_FIGURATIVE_PUSH}`),
  en(String.raw`\b${ABUSER}\s+(?:abuses|is abusing|['’]s abusing) me${CLAUSE_END}|\bi(?:['’]m| am) being (?:abused|beaten|hit|choked)\b`),
  en(String.raw`\b${ABUSER}\s+(?:slammed|smashed|banged|hit) my head (?:into|against|on)\b`),
  en(String.raw`(?<!\bremember when\s+)\b${ABUSER}(?:['’]s|\s+has|\s+have)?(?:\s+been)?${ADV}\s+(?:hit|beat|beaten|choked|strangled|punched|kicked|slapped|raped|assaulted|attacked)\s+me\b${NOT_FIGURATIVE_PAST}${NOT_HISTORY}(?![^.!?]{0,40}\bwith (?:that|the|this|his|her|their|those) (?:news|words?|comments?|remarks?|questions?))`),
  en(String.raw`(?<!\bremember when\s+)\b${ABUSER}(?:['’]s|\s+has|\s+have)?(?:\s+been)?${ADV}\s+(?:pushed|shoved)\s+me\b${NOT_FIGURATIVE_PUSH}${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+has)?${ADV}\s+(?:choked|strangled) me out\b`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+has)?\s+(?:beat|beats|beaten|beating)\s+me up\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}\s+(?:beat|beats|has beaten)\s+(?:the (?:crap|hell|shit|living daylights) out of me|me (?:black and blue|so (?:bad|badly|hard)))\b`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+has|\s+have|\s+was)?(?:\s+been)?${ADV}\s+(?:keeps\s+)?(?:threatened|threatens|threatening) to (?:kill|hurt|shoot|stab|beat|strangle) me\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}\s+(?:has|have|['’]s got|got) a (?:gun|knife|weapon|pistol)\b[^.!?]{0,40}\b(?:threaten\w*|kill me|shoot me|hurt me|use it on me)\b`),
  en(String.raw`\b(?:kill|shoot|stab) me\b[^.!?]{0,40}\b${ABUSER}\s+(?:has|have|['’]s got|got) a (?:gun|knife|weapon|pistol)\b`),
  en(String.raw`\b${ABUSER}\s+(?:threatened|threatens|has threatened) me with (?:a|his|her|their) (?:knife|gun|pistol|bat|hammer|weapon)\b`),
  en(String.raw`\b${ABUSER}\s+(?:pulled|drew) (?:a|his|her|their) (?:knife|gun|pistol) on me\b`),
  en(String.raw`\b${ABUSER}\s+(?:held|put|pressed) (?:a|his|her|their) (?:knife|gun|pistol) (?:to|against) my (?:throat|head|neck|chest)\b`),
  en(String.raw`\b${ABUSER}(?:\s+has)?${ADV}\s+(?:tried|attempted) to (?:kill|choke|strangle|stab|shoot|drown|smother|suffocate) me\b`),
  // Explicit threat framing only: "he said he's going to kill me" — never the bare
  // "he's going to kill me (when he finds out)".
  en(String.raw`\b${ABUSER}\s+(?:said|says|told me|keeps saying|has said)(?: that)? (?:he|she|they)(?:['’]s| is| was| are|['’]re)? (?:going to|gonna) (?:kill|shoot|stab|strangle|hurt) me\b(?![^.!?]{0,30}\b(?:if|when) (?:he|she|they) (?:finds? out|sees?|hears?|knows?))`),
  en(String.raw`\b${ABUSER}\s+(?:said|says|told me|keeps saying|has said)(?: that)? (?:he|she|they)(?:['’]d|['’]ll| would| will) (?:kill|shoot|stab|strangle|hurt) me\b(?![^.!?]{0,30}\b(?:if|when) (?:he|she|they) (?:finds? out|sees?|hears?|knows?))`),
  en(String.raw`\b(?:scared|afraid|terrified)(?: that)? ${ABUSER}(?:['’]ll| will| is going to| is gonna|['’]s going to|['’]s gonna) (?:kill|hurt|beat) me\b(?!\s+with\b)(?![^.!?]{0,30}\b(?:if|when) (?:he|she|they) (?:finds? out|sees?|hears?|knows?))`),
  en(String.raw`\b${ABUSER} (?:grabbed|held|had|pinned) me by the (?:throat|neck)\b`),
  en(String.raw`\b${ABUSER} (?:pushed|shoved|threw|slammed) me (?:down (?:the )?stairs|into (?:a|the) wall|against (?:a|the) wall|to the (?:ground|floor)|on(?:to)? the (?:ground|floor))\b`),
  en(String.raw`\b${ABUSER} (?:put|wrapped|had) (?:his|her|their) hands? (?:around|on) my (?:neck|throat)\b`),
  es(String.raw`me (?:est[áa]n?|estaba|estaban) (?:pegando|golpeando|ahorcando|estrangulando)`),
  es(String.raw`me sigui[óo] (?:pegando|golpeando|ahorcando|pateando)`),
  es(String.raw`${ABUSER_ES} me (?:pegaba|golpeaba|ahorcaba|pateaba)${NOT_FIGURATIVE_ES_HIT}${NOT_HISTORY_ES}`),
  es(String.raw`me (?:peg[óo]|golpe[óo]|pate[óo]|abofete[óo]) (?:en la (?:cara|cabeza|boca)|con (?:el|un|una|su) (?:cintur[óo]n|pu[ñn]o|palo|botella|zapato|bate))`),
  es(String.raw`tiene (?:una|un) (?:pistola|arma|cuchillo|navaja)[^.!?]{0,30}(?:me amenaza|amenaz\p{L}*|matarme|me va a matar)`),
  es(String.raw`${ABUSER_ES} me (?:pega|golpea|maltrata|ahorca|patea|viola|peg[óo]|golpe[óo]|ahorc[óo]|pate[óo]|viol[óo]|ha pegado|ha golpeado|ha ahorcado|ha violado)${NOT_FIGURATIVE_ES_HIT}${NOT_HISTORY_ES}`),
  // Subjectless only with a time, "again", or "when he drinks" — "me pegó anoche", "me pega cuando bebe".
  es(String.raw`me (?:peg[óo]|golpe[óo]|ahorc[óo]|pate[óo]) (?:anoche|ayer|hoy|esta ma[ñn]ana|esta noche|otra vez|de nuevo)`),
  es(String.raw`me (?:pega|golpea|ahorca) cuando (?:toma|bebe|est[áa] borracho|se emborracha|se droga)`),
  // "(Mi esposo) me volvió a pegar", "me acaba de pegar", "anoche me pegó", "me quiso ahorcar".
  es(String.raw`me (?:volvi[óo]|ha vuelto) a (?:pegar|golpear|ahorcar|patear|empujar)${NOT_FIGURATIVE_ES_HIT}(?!\s+a\s+\p{L}+r(?:le|les|me|te|lo|la|nos)?(?![\p{L}]))`),
  es(String.raw`me acaba de (?:pegar|golpear|ahorcar|patear|empujar)${NOT_FIGURATIVE_ES_HIT}`),
  es(String.raw`(?:anoche|ayer|hoy|esta ma[ñn]ana|esta noche|otra vez) me (?:peg[óo]|golpe[óo]|ahorc[óo]|pate[óo])${NOT_FIGURATIVE_ES_HIT}`),
  es(String.raw`me (?:quiso|trat[óo] de|intent[óo]) (?:ahorcar|estrangular|ahogar|matar)(?!\s+(?:de|a)\s)`),
  // A whole sentence that is only "Me pegó." / "Me ahorcó." — the subject is someone else.
  new RegExp(String.raw`(?:^|[.!¡]\s*)me (?:peg[óo]|golpe[óo]|ahorc[óo]|estrangul[óo]|viol[óo]|pate[óo])\s*(?:[.!,;…]|$)`, 'iu'),
  // Explicit threats and attempts — every lead-in the self-harm "matarme" form excludes, except
  // the figurative "va a / iba a" ("esta angustia me va a matar"), which is left to the model.
  es(String.raw`(?:me (?:est[áa] )?)?amenaz(?:a|ó|o|aba|ando) con (?:matarme|un cuchillo|una pistola|un arma|una navaja)|me (?:est[áa] )?amenaz(?:a|ó|o|aba|ando) de muerte`),
  es(String.raw`(?:intent[óo]|trat[óo] de|quiso) (?:matarme|ahorcarme|estrangularme|ahogarme|apu[ñn]alarme)`),
  es(String.raw`${ABUSER_ES} (?:me )?(?:quiere|quer[íi]a|intent[óo]|trat[óo] de|quiso) (?:matar|ahorcar|estrangular|ahogar)(?:me)?(?!\s+(?:si|cuando) se (?:entera|entere|enter[óo]))`),
  es(String.raw`(?:dijo|dice|me dijo|ha dicho|me dice) que (?:me )?(?:va|iba) a (?:matar(?:me)?|ahorcar(?:me)?)`),
  es(String.raw`miedo (?:de )?que me (?:mate|vaya a matar|pegue|golpee)`),
  es(String.raw`${ABUSER_ES} me (?:empuj[óo]|tir[óo]|avent[óo]|lanz[óo]) (?:por las escaleras|escaleras abajo|contra la pared|al suelo|al piso)`),
  es(String.raw`me (?:agarr[óo]|apret[óo]|tom[óo]) (?:del|el) cuello|me (?:agarr[óo]|apret[óo]) la garganta`),
  es(String.raw`me (?:dio|dieron) una (?:golpiza|paliza)`),
  es(String.raw`me apunt[óo] con (?:una|un|su) (?:pistola|arma|cuchillo|navaja)`),
];

/** Upper bound on any text screened for a crisis — far above a 3-minute spoken turn. */
export const MAX_SCREEN_CHARS = 10_000;

export type CrisisKind = 'self_harm' | 'abuse';

/** Which crisis, if any, a member's own words disclose. Self-harm wins when both appear. */
export function crisisKind(text: string): CrisisKind | null {
  const bounded = text.slice(0, MAX_SCREEN_CHARS);
  if (SELF_HARM_PATTERNS.some((re) => re.test(bounded))) return 'self_harm';
  if (ABUSE_PATTERNS.some((re) => re.test(bounded))) return 'abuse';
  return null;
}

export function userInCrisis(text: string): boolean {
  return crisisKind(text) !== null;
}
