// Deterministic backstop for the model's safety override. HIGH PRECISION by
// design: moderation runs on every member line and the model can break
// character itself, so these patterns only catch unambiguous first-person
// disclosures — "I want to die", "I took all my pills", "my husband hit me
// again". Anything figurative or ambiguous ("I'm killing myself working two
// jobs", "I'm going to die one day", "me lastimó lo que hiciste") is left to
// moderation and the model instead of hard-breaking a rehearsal.
//
// Deliberately first-person, so practicing a conversation ABOUT a loved one's
// past attempt — or a letter line to them ("when you hit me…") — never trips.
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

// ---------------- Moderation (defense in depth) ----------------

/**
 * Verdict from OpenAI's moderation endpoint, a second opinion on every member
 * line (run alongside the partner call), on read-aloud transcripts, on the
 * part of a long spoken turn beyond the one-line cap, and before coaching.
 * Only self-harm counts — never violence, which members legitimately describe
 * to their loved one. Intent or instructions count; a bare
 * "self-harm" depiction counts only with some intent signal, so talking about
 * a loved one's past overdose doesn't stop the practice.
 */
export function moderationIndicatesCrisis(data: unknown): boolean {
  const results = (data as { results?: unknown })?.results;
  if (!Array.isArray(results)) return false;
  return results.some((r) => {
    const categories = (r as { categories?: Record<string, unknown> })?.categories ?? {};
    const scores = (r as { category_scores?: Record<string, unknown> })?.category_scores ?? {};
    const intentScore = typeof scores['self-harm/intent'] === 'number' ? (scores['self-harm/intent'] as number) : 0;
    return categories['self-harm/intent'] === true ||
      categories['self-harm/instructions'] === true ||
      (categories['self-harm'] === true && intentScore >= 0.2);
  });
}

export const MAX_MODERATION_CHARS = 8_000;
export const MODERATION_TIMEOUT_MS = 3_000;

// ---------------- Prepared words vs. what was said ----------------

type WordSpan = { word: string; start: number; end: number };

function wordSpans(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)) {
    spans.push({
      word: m[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'"),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }
  return spans;
}

/**
 * Which words of `text` belong to a run of ≥ `minRun` consecutive words that
 * also appears, in order, in `reference` — compared word by word, so a short
 * "No." is never "found" inside "know".
 */
export function coveredByRuns(text: string, reference: string, minRun = 4): { spans: WordSpan[]; covered: boolean[] } {
  const spans = wordSpans(text);
  const covered = spans.map(() => false);
  const ref = wordSpans(reference).map((s) => s.word);
  if (spans.length < minRun || ref.length < minRun) return { spans, covered };
  const grams = new Set<string>();
  for (let i = 0; i + minRun <= ref.length; i++) grams.add(ref.slice(i, i + minRun).join(' '));
  for (let i = 0; i + minRun <= spans.length; i++) {
    if (grams.has(spans.slice(i, i + minRun).map((s) => s.word).join(' '))) {
      for (let j = i; j < i + minRun; j++) covered[j] = true;
    }
  }
  return { spans, covered };
}

/**
 * What the member said beyond the prepared text they were reading: every run
 * of ≥ 4 words taken from the letter is removed. The letter itself is the
 * member's prepared words and is not screened (a letter quoting "you said you
 * wanted to die" must stay practicable); anything they add while reading is.
 */
export function spokenBeyond(text: string, prepared: string, minRun = 4): string {
  const { spans, covered } = coveredByRuns(text, prepared, minRun);
  if (!covered.some(Boolean)) return text;
  let out = '';
  let cursor = 0;
  spans.forEach((span, i) => {
    if (!covered[i]) return;
    out += text.slice(cursor, span.start);
    cursor = span.end;
    out += ' ';
  });
  out += text.slice(cursor);
  // Punctuation left behind by the removed runs is not speech.
  return out
    .replace(/(^|\s)[^\p{L}\p{N}\s]+(?=\s|$)/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------- Slurs and sexual insults ----------------

// A small blocklist (EN/ES). The character may swear in heated temperaments,
// but never uses slurs or sexual insults — not even when the family's notes
// quote the real person saying them.
const SLUR_PATTERNS = [
  /\bn[i1!|]gg(?:a|ah|as|az|er|ers|uh)\b/i,
  /\b(?:fag|fags|faggot|faggots|dyke|dykes|tranny|trannies|retard|retards|retarded)\b/i,
  /\b(?:spic|spics|wetback|wetbacks|beaner|beaners|chink|chinks|gook|gooks|kike|kikes|raghead|towelhead|coon|coons|wop|wops)\b/i,
  /\b(?:whore|whores|slut|sluts|skank|skanks|cunt|cunts|bitch|bitches|hoe|hoes)\b/i,
  /(?:^|[^\p{L}])(?:puta|putas|puto|putos|zorra|zorras|perra|perras|maric[óo]n|maricones|marica|joto|jotos|sudaca|sudacas|mayate|negrata|retrasad[oa]s?|mongol[oa]?)(?![\p{L}])/iu,
];

export function containsSlur(text: string): boolean {
  const bounded = text.slice(0, MAX_SCREEN_CHARS);
  return SLUR_PATTERNS.some((re) => re.test(bounded));
}

// ---------------- The character's own lines ----------------

/** The model's break token in any case or separator (BREAK_CHARACTER, Break Character, BREAK-CHARACTER…). */
export function hasBreakToken(text: string): boolean {
  return /BREAK[_\s-]*CHARACTER/i.test(text);
}

// Threats of violence by the character: a threat opener + a violent verb + a
// target, a bare "kill/stab/shoot you", or a maiming threat. "I'm going to hit
// the road" and "I'll never hurt you" are not threats.
const VIOLENCE_THREAT_PATTERNS = [
  /\b(?:i['’]?ll|i will|i['’]?m (?:going to|gonna)|i am (?:going to|gonna)|gonna|i swear i['’]?ll|i could|i should)\s+(?!never\b|not\b)(?:\w+\s+)?(?:kill|hurt|beat|hit|punch|stab|shoot|strangle|choke|smack|slap)\s+(?:you|him|her|them|someone|somebody|anyone|everyone|your|his|her|their)\b/i,
  /\b(?:kill|stab|shoot|strangle)\s+(?:you|him|her|them|everyone)\b/i,
  /\bbreak (?:your|his|her|their) (?:neck|face|jaw|nose|arms?|legs?|teeth|skull)\b/i,
  /\b(?:smash|bash|kick|knock|punch) (?:your|his|her|their) (?:face|head|teeth|skull)(?: in)?\b/i,
  /\bburn (?:this|the|your) (?:house|place) down\b/i,
  /(?:^|[^\p{L}])(?:te|lo|la|los|las) (?:voy|vamos) a (?:matar|pegar|golpear|apuñalar|disparar|lastimar|hacer daño|romper)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])(?:voy|vamos) a (?:matar|pegar|golpear|apuñalar|lastimar)(?:te|lo|la|los|las)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])romper(?:te|le|les)? (?:la cara|el cuello|la boca|los dientes|la cabeza)(?![\p{L}])/iu,
  /(?:^|[^\p{L}])te mato(?![\p{L}])/iu,
];

// Veiled or explicit self-harm from the character ("I should just disappear",
// "I'd rather die than go to rehab") — on top of the first-person crisis
// patterns, which fit the character too.
const CHARACTER_SELF_HARM_PATTERNS = [
  /\b(?:suicide|suicidal)\b/i,
  /\bbetter off (?:dead|without me)\b/i,
  /\bend it all\b/i,
  /\bi['’]?d (?:much )?rather (?:just )?(?:die|be dead)\b/i,
  /\bi (?:wanted|have wanted|used to want) to die\b/i,
  /\b(?:drink|drank|drinking|use|using|drug|drugging|shoot|shooting) (?:myself|meself) to death\b/i,
  /\btake my (?:own )?life\b/i,
  // "I'm not gonna die" is a minimization, not a threat.
  /(?<!\bnot\s)(?<!n['’]t\s)(?<!never\s)\b(?:wanna|want to|going to|gonna)\s+(?:just\s+)?die\b/i,
  /(?<!\bnot\s)(?<!n['’]t\s)(?<!never\s)\b(?:should|could|might as well|want to|wanna|gonna|going to)\s+(?:just\s+)?disappear\b/i,
  /\bdisappear (?:forever|for good)\b/i,
  /\b(?:overdose|od) on purpose\b/i,
  /(?:^|[^\p{L}])(?:suicid\p{L}*|mejor muert[oa]s?|acabar con todo|desaparecer para siempre|mejor (?:me )?desaparezco|deber[íi]a desaparecer|quiero desaparecer|prefiero morir(?:me)?|prefiero estar muert[oa]|beber hasta morir(?:me)?)(?![\p{L}])/iu,
];

/**
 * Deterministic output guard: true when the partner's in-character line
 * crosses a hard limit — a self-harm or suicide threat, a threat of violence,
 * or a slur / sexual insult.
 */
export function partnerReplyUnsafe(text: string): boolean {
  const bounded = text.slice(0, MAX_SCREEN_CHARS);
  // A break token in any spelling is never voiced or shown as the loved one's line.
  return hasBreakToken(bounded) ||
    userInCrisis(bounded) ||
    VIOLENCE_THREAT_PATTERNS.some((re) => re.test(bounded)) ||
    CHARACTER_SELF_HARM_PATTERNS.some((re) => re.test(bounded)) ||
    containsSlur(bounded);
}

// Family notes and names that would steer the character toward self-harm,
// suicide, violence, or slurs are dropped before they reach a prompt — even
// when the real person really said them. Third person included ("he said he'd
// kill himself"), unlike the user-crisis screen.
const HARM_MENTION_PATTERNS = [
  /\b(?:suicid\w*|kill(?:s|ed|ing)?|murder\w*|stab\w*|shoot\w*|shot (?:me|him|her|you|them)|guns?|knife|knives|weapons?)\b/i,
  /\b(?:hang|cut|cutting|hurt|hurting|harm|harming)\s+(?:my|him|her|them|your)sel(?:f|ves)\b/i,
  /\b(?:slit|slash)\w*\s+(?:my|his|her|their) wrists?\b/i,
  /\b(?:end|ending|take|taking)\s+(?:it all|(?:my|his|her|their) (?:own )?life)\b/i,
  /\b(?:want|wants|wanted|wanna|going|gonna|rather)\s+(?:to\s+)?(?:die|be dead)\b/i,
  /\bbetter off (?:dead|without (?:me|him|her))\b/i,
  /\b(?:punch\w*|strangl\w*|chok(?:e|ed|es|ing) (?:me|him|her|you|us|them)|beat (?:me|him|her|you|us|them|up)|hit (?:me|him|her|you|us|them)|threaten\w* (?:me|him|her|you|us|them|to (?:kill|hurt|hit|beat|shoot|stab)))\b/i,
  /\bdisappear (?:forever|for good)\b/i,
  /\b(?:overdose|od)(?:d?ed)? on purpose\b/i,
  /(?:^|[^\p{L}])(?:suicid\p{L}*|matar\p{L}*|mato|mató|asesin\p{L}*|apuñal\p{L}*|dispar\p{L}*|pistolas?|armas?|cuchill\p{L}*|ahorc\p{L}*|cortar(?:me|se)|quitar(?:me|se) la vida|hacer(?:me|se) daño|morir(?:me|se)?|mejor muert[oa]s?|golpe\p{L}*|pegar(?:me|le|te)|amenaz\p{L}*)(?![\p{L}])/iu,
];

export function mentionsHarm(text: string): boolean {
  const bounded = text.slice(0, MAX_SCREEN_CHARS);
  return userInCrisis(bounded) || partnerReplyUnsafe(bounded) || HARM_MENTION_PATTERNS.some((re) => re.test(bounded));
}

/**
 * Prepared text (a letter, a script) is the member's own words: it is not
 * crisis-screened, but any sentence that mentions self-harm, violence, or a
 * slur is left out of what the character sees — the rest of the letter stays.
 */
export function harmFilteredSentences(text: string): string {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .filter((sentence) => sentence.trim() && !mentionsHarm(sentence))
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ---------------- Request gates ----------------

/** 'crisis' = self-harm/suicide (988/911); 'abuse' = she is being hurt (911 + DV hotline). */
export type ReplyGate = 'crisis' | 'abuse' | 'warmup_complete' | 'ok';

/**
 * Order matters: a crisis disclosure always wins over every other refusal, so
 * someone who says they want to die in a warm-up's fourth line still gets the
 * crisis break, not "warm-up complete". Screened on the raw text (before the
 * model-facing cap) plus any screening-only transcript (a letter read aloud,
 * already reduced to what was said beyond the letter). `moderationCrisis` is
 * the async moderation verdict for the same text, when one was run.
 */
export function replyGate(input: {
  incomingOpening: boolean;
  lastUserRaw: string | undefined;
  screeningText: string | undefined;
  warmupOver: boolean;
  moderationCrisis?: boolean;
}): ReplyGate {
  if (!input.incomingOpening) {
    const kind = (input.lastUserRaw ? crisisKind(input.lastUserRaw) : null) ??
      (input.screeningText ? crisisKind(input.screeningText) : null) ??
      (input.moderationCrisis ? 'self_harm' : null);
    if (kind === 'self_harm') return 'crisis';
    if (kind === 'abuse') return 'abuse';
  }
  return input.warmupOver ? 'warmup_complete' : 'ok';
}

/** A transcript that contains a crisis disclosure is never sent for coaching. */
export function debriefGate(userTextsRaw: readonly string[], moderationCrisis = false): 'safety_break' | 'ok' {
  return moderationCrisis || userTextsRaw.some((text) => userInCrisis(text)) ? 'safety_break' : 'ok';
}

export const CRISIS_BREAK_TEXT: Record<'en' | 'es', string> = {
  en: "Let's pause the practice. What you just shared matters more than any rehearsal — please reach out for real support right now: call or text 988, or call 911 if you're in danger.",
  es: 'Pausemos la práctica. Lo que acabas de compartir importa más que cualquier ensayo — busca apoyo real ahora mismo: llama o envía un mensaje al 988, o llama al 911 si estás en peligro.',
};

/** For abuse she is suffering: safety first, and the hotline built for it. */
export const ABUSE_BREAK_TEXT: Record<'en' | 'es', string> = {
  en: "Let's pause the practice. You deserve to be safe — if you're in danger right now, call 911. The National Domestic Violence Hotline is free and confidential, 24/7: call 1-800-799-7233 or text START to 88788.",
  es: 'Pausemos la práctica. Mereces estar a salvo — si estás en peligro ahora mismo, llama al 911. La Línea Nacional sobre la Violencia Doméstica es gratuita y confidencial, las 24 horas: llama al 1-800-799-7233 o envía START al 88788.',
};

export function breakTextFor(kind: CrisisKind, language: string | undefined): string {
  const lang = language === 'es' ? 'es' : 'en';
  return kind === 'abuse' ? ABUSE_BREAK_TEXT[lang] : CRISIS_BREAK_TEXT[lang];
}

export type Debrief = {
  wentWell: string[];
  workOn: string[];
  /**
   * Parallel to workOn: the 0-based index (among the user's turns) of the line
   * each item is about, or null when it can't be pinned to one turn. Debriefs
   * saved before this field existed simply lack it — readers treat that as all
   * null, and workOn stays a plain string[] so old clients keep rendering.
   */
  workOnTurns: (number | null)[];
  drill: string;
  scores: { love: number; ask: number; boundaries: number; calm: number };
};

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quoted fragments inside a feedback item — the coach is required to quote the user verbatim. */
function quotedFragments(item: string): string[] {
  const out: string[] = [];
  const re = /"([^"]{6,})"|“([^”]{6,})”|«([^»]{6,})»/g;
  for (const m of item.matchAll(re)) {
    // An elided quote ("I love you… but I need") is matched piece by piece.
    for (const piece of (m[1] ?? m[2] ?? m[3] ?? '').split(/\.{3}|…/)) {
      const fragment = normalizeForMatch(piece);
      if (fragment.split(' ').length >= 2) out.push(fragment);
    }
  }
  return out;
}

/**
 * Pins a workOn item to the user turn it quotes. The verbatim quote is the
 * ground truth; the model's turn number (1-based) is the fallback, clamped to
 * the transcript. Without the user's turns nothing can be validated → null.
 */
export function resolveWorkOnTurn(item: string, modelTurn: unknown, userTurns: string[]): number | null {
  if (userTurns.length === 0) return null;
  const n = typeof modelTurn === 'number' ? modelTurn : typeof modelTurn === 'string' ? Number.parseFloat(modelTurn) : Number.NaN;
  const claimed = Number.isFinite(n) ? Math.min(userTurns.length, Math.max(1, Math.round(n))) - 1 : null;
  const normalizedTurns = userTurns.map(normalizeForMatch);
  for (const fragment of quotedFragments(item)) {
    const matches = normalizedTurns.flatMap((turn, i) => (turn.includes(fragment) ? [i] : []));
    if (matches.length === 0) continue;
    return claimed !== null && matches.includes(claimed) ? claimed : matches[matches.length - 1];
  }
  return claimed;
}

// The model's JSON is untrusted: coerce it to exactly the shape the app renders
// (and stores in history) so a malformed field can never crash the debrief.
// workOn items may arrive as plain strings (the original shape) or as
// {text, turn} objects; `userTurns` (the user's lines, in order) lets each
// item be pinned to the turn it is about for "Redo from here".
export function normalizeDebrief(raw: unknown, userTurns: string[] = []): Debrief | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const clean = (x: unknown) => (typeof x === 'string' && x.trim().length > 0 ? x.trim().slice(0, 700) : null);
  const strings = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
      .map(clean)
      .filter((x): x is string => x !== null)
      .slice(0, max);
  const score = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN;
    return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
  };
  const sc = (r.scores && typeof r.scores === 'object' ? r.scores : {}) as Record<string, unknown>;
  const wentWell = strings(r.wentWell, 3);
  const workOnItems = (Array.isArray(r.workOn) ? r.workOn : r.workOn !== undefined ? [r.workOn] : [])
    .map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const text = clean(o.text);
        return text ? { text, turn: o.turn } : null;
      }
      const text = clean(item);
      return text ? { text, turn: undefined } : null;
    })
    .filter((x): x is { text: string; turn: unknown } => x !== null)
    .slice(0, 2);
  const workOn = workOnItems.map((item) => item.text);
  if (wentWell.length === 0 && workOn.length === 0) return null;
  return {
    wentWell,
    workOn,
    workOnTurns: workOnItems.map((item) => resolveWorkOnTurn(item.text, item.turn, userTurns)),
    drill: typeof r.drill === 'string' ? r.drill.trim().slice(0, 700) : '',
    scores: { love: score(sc.love), ask: score(sc.ask), boundaries: score(sc.boundaries), calm: score(sc.calm) },
  };
}
