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
const CLAUSE_END = String.raw`\s*(?:[.!?,;:…]|$)`;
/** The end of a sentence only (no comma). */
const SENTENCE_END = String.raw`\s*(?:[.!?…]|$)`;
/** End of the thought, or the sentence carries on with and/but/because. */
const THOUGHT_END = String.raw`(?:${CLAUSE_END}|\s+(?:and|but|because|cause|so)\b)`;
const THOUGHT_END_ES = String.raw`(?:${CLAUSE_END}|\s+(?:y|pero|porque)(?![\p{L}]))`;
/** For "want to die / don't want to live / end it all": typed run-ons too — "…please help", "…rn", "…at this point", "…bc", "…i can't do this". */
const THOUGHT_END_MORE = String.raw`(?:${THOUGHT_END}|\s+(?:please|pls|plz|help|rn|tbh|honestly|idk|ugh|omg|fr|bc|cuz|coz|cus|at this point|after (?:all|everything)|from (?:all )?(?:this|that)|i)\b)`;
/** "me quiero morir ya / de verdad / en serio / no puedo más", and Spanglish "…honestly / rn". */
const THOUGHT_END_ES_MORE = String.raw`(?:${THOUGHT_END_ES}|\s+(?:ya|de verdad|en serio|ahora(?: mismo)?|ahorita|por favor|ayuda|ay[úu]dame|no (?:puedo|aguanto)|ya no|neta|la neta|de veras|honestly|rn|tbh|fr|pls|please|help|omg|ugh)(?![\p{L}]))`;
/**
 * The loved one's words quoted in her line are not hers: "when you said I want to die, I froze", "you looked at
 * me and said “I want to die”", "your text said I want to die". "I said I want to die" (her own words) still counts.
 */
const QUOTE_LEAD = String.raw`(?:\b(?:you|he|she|they)\b(?:(?!\bi\b)[^.!?]){0,30}?|\byour (?:text|message|note|post|letter|email)s?\s+)\b(?:said|say|says|told me|tell me|tells me|texted(?: me)?|wrote(?: me)?|posted|messaged(?: me)?|screamed(?: at me)?|yelled(?: at me)?|keeps? saying|kept saying)(?:\s+(?:to me|that))?\s*[,:]?(?:\s+(?:mom|mommy|mama|ma|dad)\s*,?)?\s+`;
const NOT_QUOTED = String.raw`(?<!${QUOTE_LEAD})`;
/** "dijiste “me quiero morir”", "me escribiste “me voy a matar”". */
const NOT_QUOTED_ES = String.raw`(?<!(?:dijiste|dices|dec[íi]as|escribiste|gritaste|publicaste|dijo|dice|escribi[óo]|grit[óo]|me (?:dijiste|dices|escribiste|gritaste|mandaste|dijo|escribi[óo]|grit[óo]|mand[óo]))(?:\s+que)?\s*[,:]?(?:\s+(?:mam[áa]|mami|ma|pap[áa])\s*,?)?\s+(?:ya\s+)?(?:me\s+)?)`;
// `\b` belongs on the word, not before the n't: "won't", "don't", "can't"
// count; "done / quit / stopped / refuse to / tired of" are boundaries too.
const NOT_NEGATED = String.raw`(?<!(?:\bnever|\bnot|n['’]t|\bdone|\bquit|\bstopped|\brefuse to|\btired of)\s+(?:\w+\s+){0,2})`;
// A "no" negates only the verb phrase it heads ("no voy a matarme", "no me quiero matar", "no tengo ganas
// de morir") — never a later clause ("ya no aguanto más quiero morir", "ya no puedo más, quiero morirme").
const NOT_NEGATED_ES = String.raw`(?<!(?:^|[^\p{L}])(?:no|nunca|jam[áa]s)\s+(?:(?:me|te|se|lo|la|le|voy|vas|va|vamos|van|iba|a|quiero|quiere|quisiera|pienso|podr[íi]a|tengo|que|estoy|est[áa]|he|ha|hab[íi]a)\s+){0,2})`;
/** "killing myself working two jobs", "hurting myself by enabling you", "cutting myself off". */
const NOT_IDIOM = String.raw`(?!\s+(?:to|for|trying|working|by|over|keeping|worrying|covering|paying|off|some (?:slack|time|space|grace)|out|more than|every (?:day|night|single day|time)|day and night|helping|giving|staying|enabling|just to|so (?:that|you)|at work|on (?:the|my) job|in the foot|if i (?:eat|have|see|hear|watch|do|drink) (?:another|one more)|shaving|cooking|gardening|cleaning|chopping|falling|when i (?:fell|slipped|tripped)|on (?:the|a) (?:ladder|stairs)|with (?:worry|stress|guilt|work|this|all this)|on (?:a|an|the|some)\s+(?:\w+\s+)?(?:glass|glasses|fence|nail|can|knife|edge|corner|window|mirror|wire|metal|branch|rock|counter|door|tool|saw|bottle|plate|dish|jar|lid|shard|piece))\b)`;
const NOT_IDIOM_ES = String.raw`(?!\s+(?:al|por|para (?:ayudar|proteger|salvar|pagar|mantener)|(?!cuando(?![\p{L}]))\p{L}+(?:ando|iendo)(?![\p{L}])|el pelo|el cabello|la barba|las u[ñn]as|con (?:tus|sus|su|tu)|mucho|de ti|de ellos))`;
const ADVERBS = String.raw`(?:\s+(?:just|really|honestly|seriously|sometimes|kind of|kinda|still|actually|literally)){0,2}`;
const L = String.raw`\p{L}`;
/** Who: "my husband", "my ex-husband", "my stepson", "my fiancé", "my grandson". */
const RELATION = String.raw`(?:(?:ex[- ]?|step[- ]?|grand)?(?:husband|wife|partner|boyfriend|girlfriend|son|daughter|dad|father|mom|mother|brother|sister|bf|gf)|ex|stepdad|stepfather|stepmom|stepmother|fianc[ée]e?|hubby|hubs|dh|baby['’]?s? (?:daddy|dad|father|mama|mother)|nephew|niece|(?:son|daughter|brother|sister|father|mother)[- ]in[- ]law)`;
const RELATION_ES = String.raw`(?:(?:ex[- ]?)?(?:esposo|esposa|marido|mujer|pareja|novio|novia)|hijo|hija|hijastr[oa]|niet[oa]|prometid[oa]|padre|madre|pap[áa]|mam[áa]|hermano|hermana|ex|padrastro|madrastra|yerno|nuera|sobrin[oa]|cu[ñn]ad[oa]|suegr[oa])`;
/**
 * Who: up to three words between "my" and the relation ("my 19 year old son", "my adult son", "my ex bf"),
 * then optionally who they are right now ("my son who is using meth", "my husband who's drunk right now").
 * Spanglish too: "mi esposo hit me again", "mi husband me pegó".
 */
const ABUSER = String.raw`(?:he|she|they|the (?:father|dad|mother|mom) of my (?:kids|children|son|daughter|baby|babies|grandkids)|(?:my|your|mi|our|his|her|the)(?:\s+(?!(?:my|your|mi|our|his|her|the)\b)[\p{L}\p{N}'’-]+){0,3}?\s+(?:${RELATION}|${RELATION_ES})(?:\s+of\s+(?:\d{1,2}|\p{L}+)\s+years)?(?:\s+(?:who|that)(?:['’]s|\s+is|\s+was|\s+has been|\s+had been)(?:\s+[\p{L}\p{N}'’-]+){1,5}?)?)`;
const ABUSER_ES = String.raw`(?:[ée]l|ella|(?:el|mi) (?:pap[áa]|padre) de (?:mis|los) (?:hij[oa]s|ni[ñn][oa]s)|(?:mi|tu|my) (?:${RELATION_ES}|${RELATION})(?:\s+(?:mayor|menor|adolescente|adult[oa]|borrach[oa]|drogad[oa]|de \d{1,2}(?: a[ñn]os)?|que (?:\p{L}+\s+){0,3}?\p{L}+))?)`;
/** Ongoing forms ("he's been hitting me for years", "he hits me at night") — only "hits me up (for money / every day)" etc. are figurative. */
const NOT_FIGURATIVE_ONGOING = String.raw`(?!\s+(?:up (?:for|on|about|asking|with)\b|at (?:cards|chess|poker|checkers|games?|tennis|golf|pool|\w+ing)\b|with(?:\s+\S+){0,4}?\s+(?:news|bills?|questions?|words?|comments?|excuses?|guilt|lawsuits?|demands?|lies|control|attitude|rules|silence|expectations|kindness|love|drinking|behaviou?r|payments?|loans?|debts?|rent|fees?|costs?)\b|to\b|home\b|down\b|(?<!(?:chok|strangl)\w*\s+(?:me|us)\s+)out\b|off\b|aside\b|away\b|on (?:facebook|instagram|social|line|the phone)|over the phone|verbally|emotionally|into\b|toward|towards|where it hurts\b|in (?:his|her|their|my) sleep\b)|(?<=\bhit(?:s|ting)?\s+(?:me|us))\s+up\b)`;
/** Past forms: "hit me up", "beat me at cards", "beat me to it", "kicked me out", "hit me with the news". */
const NOT_FIGURATIVE_PAST = String.raw`(?!\s+(?:up\b|to\b|at (?:cards|chess|poker|checkers|games?|tennis|golf|pool|\w+ing)\b|home\b|there\b|down\b(?!\s+(?:the |a |some )?(?:stairs|steps|staircase|hall|hallway|driveway)\b)|out\b|off\b|aside\b|away\b|by\b|for\b|into (?:doing|a corner|\w+ing)\b|toward|towards|on (?:facebook|instagram|social|line|the phone)|over the phone|verbally|emotionally|where it hurts\b|with(?:\s+\S+){0,4}?\s+(?:news|bills?|questions?|words?|comments?|excuses?|guilt|lawsuits?|demands?|lies|control|attitude|rules|silence|expectations|kindness|love|drinking|behaviou?r|payments?|loans?|debts?|rent|fees?|costs?)\b)|(?<=\bshot\s+(?:me|us))\s+(?:(?:a|an|the|this|that|some|his|her|one|another|quick|dirty|nasty)\s+){0,2}(?:texts?|looks?|glances?|messages?|smiles?|winks?|e-?mails?|dms?|notes?|lines?|pics?|pictures?|photos?|videos?|grins?|glares?|warnings?|stares?|repl(?:y|ies)|snaps?)\b|(?<=\bstabbed\s+(?:me|us))\s+in the back\b(?!\s+with\b)|(?<=\bcut\s+(?:me|us))\s+(?:some|loose|a check|in line|short|deep|to the|any|no|a break|down)\b|(?<=\bburn(?:ed|t)\s+(?:me|us))\s+(?:out|up|a cd|a copy)\b|\s+with (?:a |the |his |her |their |big )?(?:pillow|snowball|water balloon|nerf\w*|ball|toy|hugs?|kiss(?:es)?|tickles?|love)\b|\s+in (?:his|her|their|my) sleep\b)`;
/** Old history, not current danger: "my dad hit me when I was a kid", "he threatened to kill me last year". */
const NOT_HISTORY = String.raw`(?![^.!?]{0,40}\b(?:when (?:i|you|we) (?:was|were) (?:a kid|kids|a child|children|little|young|small|a teen(?:ager)?)|as a (?:kid|child|teen(?:ager)?)|growing up|years ago|last year|a long time ago|when i was growing up))`;
/** "He just hit me", "my son actually punched me", "he finally threatened to kill me". */
const ADV = String.raw`(?:\s+(?:just|actually|finally|even|really|again|literally|seriously|always|sometimes|still|often|usually|constantly|occasionally|does|did)){0,2}`;
/** "mi esposo siempre / a veces / todavía / ya / otra vez me pega". */
const ADV_ES = String.raw`(?:\s+(?:siempre|casi siempre|a veces|todav[íi]a|ya|otra vez|de nuevo|tambi[ée]n|seguido|cada rato)){0,2}`;
/** Her or her and the kids: "he hit me", "he is hitting us". */
const ME_US = String.raw`(?:me|us)`;
/** "pushing me for money / about rehab / to get help / too far / around", "pushed me past my limit". */
const NOT_FIGURATIVE_PUSH = String.raw`(?!\s+(?:for|about|on|and(?!\s+i\s+(?:fell|hit my|landed|went down|tripped))|to|too|past|toward|towards|around|away|aside|out|off|over|down (?:the |my |his |her |a )?(?:list|priority|priorities|road|line|ladder|ranks?|path)|into (?:doing|giving|a corner|\w+ing)|harder|hard to)\b)`;
const NOT_HISTORY_ES = String.raw`(?![^.!?]{0,40}(?:cuando (?:era|éramos|eras) (?:niñ[oa]s?|chic[oa]s?|pequeñ[oa]s?|joven(?:es)?)|de niñ[oa]|de chic[oa]|hace (?:años|mucho)|el año pasado))`;
/** "Me quiere matar cuando vea la cuenta / si se entera / de un susto / con sus mentiras" are figures of speech. */
const NOT_FIGURATIVE_KILL_ES = String.raw`(?!\s+(?:si|cuando|de (?:un susto|la risa|coraje|preocupaci[óo]n|angustia|pena|los nervios|hambre|disgustos?)|con (?:sus|su|tus|tu) (?:mentiras|forma|manera|actitud|palabras|vicio|drogas|bebida))(?![\p{L}]))(?![^.!?]{0,30}(?:si|cuando) se ente)`;
/**
 * Up to three words, then who: "… mi esposo", "… fuerte mi hijo", "… en la cara mi esposo", "… el papá de mis
 * hijos" — never across "cuando / si / y…", and never past an object ("me pegó la gripe mi hijo", "me cortó el
 * pelo mi hija", "me quemó la comida mi esposo").
 */
const BEFORE_WHO_ES = String.raw`(?:\s+en (?:la|el) (?:cara|cabeza|boca|est[óo]mago|espalda|pecho|ojo|panza))?(?:\s+(?!(?:cuando|si|porque|pero|y|que|mientras|para|con|a|el|la|los|las|un|una|unos|unas|mis|tus|sus)(?![\p{L}]))\p{L}+){0,3}?\s+(?:(?:mi|el|la) (?:${RELATION_ES})|(?:el|mi) (?:pap[áa]|padre) de (?:mis|los) (?:hij[oa]s|ni[ñn][oa]s))(?![\p{L}])`;
/** Past-time words: with them "me golpeo / me lastimo" is an accent-dropped "golpeó / lastimó" (he did it). */
const PAST_TIME_ES = String.raw`(?:anoche|ayer|antier|anteayer|otra vez|de nuevo)`;
/** "Me lastimó (ayer) lo que dijiste / con sus palabras" is emotional. */
const NOT_FIGURATIVE_ES_HURT = String.raw`(?![^.!?]{0,40}(?:lo que (?:dijo|dijiste|hizo|hiciste)|(?:sus|tus) (?:palabras|mentiras|comentarios)|con lo que|el coraz[óo]n))`;
const NOT_FIGURATIVE_ES_HIT = String.raw`(?!\s+(?:un susto|un grito|gritos|la gripe|la gripa|los piojos|el covid|el resfriado|la costumbre|duro|muy duro|fuerte|mucho|la noticia|la realidad|la confianza|con (?:sus|tus) palabras))`;
/** With a named abuser "me pegó fuerte / mucho" is literal; only shouts, colds and news stay figurative. */
const NOT_FIGURATIVE_ES_HIT_BY = String.raw`(?!\s+(?:un susto|un grito|gritos|la gripe|la gripa|los piojos|el covid|el resfriado|la costumbre|la noticia|la realidad|la confianza|con (?:sus|tus) palabras))`;
/** Long past, not current danger: "I took an overdose years ago", "…in college". */
const NOT_LONG_AGO = String.raw`(?![^.!?]{0,30}\b(?:years ago|when i was|last year|in (?:19|20)\d\d|as a (?:kid|teen(?:ager)?)|in (?:high school|college)|a long time ago)\b)`;
/** What she could overdose on: pills by kind, or a common drug by name ("a bottle of Tylenol", "50 Xanax"). */
const PILLS = String.raw`(?:(?:sleeping |sleep |pain |anxiety |nerve )?(?:pills|meds|medications?|tablets|capsules)|painkillers|pain killers|antidepressants|tylenol|acetaminophen|advil|ibuprofen|aspirin|aleve|xanax|ambien|oxy(?:contin|codone|s)?|percocets?|vicodin|valium|klonopin|ativan|benadryl|insulin|fentanyl|heroin|morphine|tramadol)`;
/** All of them, a bottle, a handful, too many: "all my", "a whole bottle of his", "a bunch of". */
const PILL_AMOUNT = String.raw`(?:all (?:of )?my(?:\s+\p{L}+['’]?s)?|(?:(?:a|my) (?:whole |full |entire )?bottle|the (?:whole|entire) bottle|(?:two|three|\d) bottles|a bunch|a handful|a fistful|too many|way too many)(?: of)?(?:\s+(?:my|his|her|the|those|these))?)`;
/** Ten or more: "30 pills", "fifty Xanax", "like 40 of my pills" — never "2 Tylenol". */
const MANY = String.raw`(?:(?:like|about|around|maybe|over|almost|nearly|at least|more than)\s+)?(?:[1-9]\d{1,3}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|a hundred|a dozen|dozens of)(?:\s+of\s+(?:my|his|her|the|those|these))?`;
/** "I took", "I just swallowed", "I've taken", "I have just swallowed". */
const I_TOOK = String.raw`\bi(?:(?:\s+just)?\s+(?:took|swallowed|ate|popped|downed)|(?:['’]ve|\s+have)(?:\s+just)?\s+(?:taken|swallowed|eaten|popped|downed))`;
/** Pills taken away or taken as prescribed: "…out of the cabinet", "…and flushed them", "…for today", "…for my headache". */
const NOT_PILLS_AWAY = String.raw`(?!\s+(?:out|away|back|from|off|with me|to (?:the|a|an|his|her|him|them|my|their|work|school|church)|and (?:flush|flushed|throw|threw|get rid|got rid|hide|hid|lock|locked|put|give|gave|dump|dumped|dispose|disposed|turn|turned)|for (?:the day|today|the week|(?:my|a|the) (?:\w+ )?(?:headache|migraine|back|pain|cramps|cold|fever|toothache|arthritis))|as prescribed|like (?:the|my) doctor)\b)`;
/** Her routine dose or a headache: "…before bed like the doctor said", "…as prescribed", "…, my head is pounding". */
const NOT_ROUTINE = String.raw`(?![^.!?]{0,40}\b(?:(?:like|as) (?:the|my) doctor|as prescribed|before bed|at bedtime|with (?:breakfast|lunch|dinner|food)|headache|migraine|my head (?:is|was) (?:pounding|killing me)|toothache|cramps|back pain)\b)`;
/** Spread over time, not at once: "30 pills over the last month", "10 Advil a day". */
const NOT_DOSE_SPAN = String.raw`(?![^.!?]{0,30}\b(?:(?:a|per|each|every) (?:day|night|week|month)|over (?:the|a|two|three|several) |in (?:a|the|one) (?:week|month|year)|this (?:week|month|year))\b)`;
/** Wrists or throat — never a wrist brace / band / watch. */
const WRISTS = String.raw`(?:wrists?|throat)\b(?!\s+(?:brace|band|guard|watch|strap|support|splint|cast|wrap|tattoo|rest|bracelet|cuff|sleeve)s?\b)`;
/** Accidents: "on a broken glass", "by accident", "while cooking" (but "with a knife" and "on the bathroom floor" still count). */
const NOT_CUT_ACCIDENT = String.raw`(?![^.!?]{0,40}\b(?:by accident|accidentally)\b)(?!\s+(?:(?:on|against) (?:a|an|the|some|my|his|her)\s+(?:\w+\s+)?(?:glass|glasses|fence|nail|can|knife|edge|corner|window|mirror|wire|metal|branch|rock|counter|door|tool|saw|bottle|plate|dish|jar|lid|shard|piece)|while (?:cooking|cleaning|working|gardening|doing|washing|chopping|cutting|opening|fixing|shaving))\b)`;
/** A gun license / safe / collection is not a weapon in hand. */
const NOT_WEAPON_THING = String.raw`(?!\s+(?:licen[cs]es?|permits?|safes?|cases?|cabinets?|collections?|shows?|ranges?|clubs?|stores?|shops?|racks?|locks?|holsters?|class(?:es)?|courses?)\b)`;
/** "Hurting me" is emotional far more often than not: "…emotionally", "…with his lies", "…by drinking". */
const NOT_FIGURATIVE_HURT = String.raw`(?![^.!?]{0,30}\b(?:emotionally|mentally|feelings|my heart|with (?:his|her|their|the|all) (?:\w+ )?(?:words|lies|drinking|using|addiction|choices|silence|behaviou?r)|by (?:lying|drinking|using))\b)`;
/** How much she took: "todas mis pastillas", "30 pastillas", "como 40 pastillas para dormir", "un montón", "todo el frasco", "toda la caja". */
const PASTILLAS = String.raw`(?:todas (?:mis|las) pastillas|un frasco(?: (?:entero|completo))?(?: de pastillas)?|demasiadas pastillas|(?:como |unas |m[áa]s de |casi )?(?:[1-9]\d{1,2}|diez|doce|quince|veinte|treinta|cuarenta|cincuenta|cien) (?:pastillas|tabletas|p[íi]ldoras|pastis)|muchas pastillas|un mont[óo]n de pastillas|todo el frasco|el frasco (?:entero|completo)|(?:toda la|una) caja(?: entera| completa)?(?: de pastillas)?|todas mis medicinas)`;
/** Her daily meds, not an overdose: "todas mis pastillas de la mañana / del día / como me dijo el doctor". */
const NOT_ROUTINE_ES = String.raw`(?!\s+(?:de (?:hoy|la ma[ñn]ana|la tarde|la noche|la presi[óo]n|la semana)|del d[íi]a|para (?:el dolor|la presi[óo]n|la cabeza|la gripa|la gripe|la tos|el resfriado|la migra[ñn]a)|a (?:tiempo|la hora|su hora)|como (?:me )?(?:dijo|indic[óo]|recet[óo]|mand[óo]|orden[óo]) (?:el|la|mi)))`;

function en(source: string): RegExp {
  return new RegExp(source, 'iu');
}
function es(source: string, negatable = true): RegExp {
  return new RegExp(String.raw`(?:^|[^${L}])${negatable ? NOT_NEGATED_ES : ''}(?:${source})(?![${L}])`, 'iu');
}

const SELF_HARM_PATTERNS = [
  // ---- English ----
  // "I'm only / just hurting myself" is the loved one's classic denial line, not a disclosure.
  en(String.raw`${NOT_NEGATED}(?<!${QUOTE_LEAD}i(?:['’]m|['’]ll|\s+am|\s+will)?(?:\s+\w+){0,3}\s+)(?<!\b(?:make|makes|made|making|drive|drives|driving|drove|push|pushes|pushing|pushed)\s+me\s+(?:want\s+)?(?:to\s+)?)(?<!\b(?:told|tells|tell|telling|said|says|wants|wanted|asked|asks|dared|dares|begged|begs)\s+me\s+to\s+(?:go\s+)?)\b(?:(?:kill|hurt|harm|cut|shoot|hang|poison|drown|stab)|(?<!\b(?:only|just)\s+)(?:killing|hurting|harming|cutting|shooting|hanging|poisoning|drowning|stabbing)) myself\b${NOT_IDIOM}(?!(?<=ing myself)\s+here\b)`),
  // "I can't stop hurting myself" is ongoing self-harm, not a negation.
  en(String.raw`\b(?:can['’]t|cannot|can not|couldn['’]t) stop (?:hurting|cutting|harming|burning|starving) myself\b`),
  // Uncertainty about staying safe.
  en(String.raw`\b(?:can['’]t|cannot) (?:promise|say|swear)(?: that)? i (?:won['’]t|will not|wouldn['’]t) (?:hurt|kill|harm|cut) myself\b`),
  en(String.raw`\b(?:not sure|don['’]t know if|don['’]t know whether) i (?:won['’]t|will not|can keep from) (?:hurt|kill|harm|cut|hurting|killing) myself\b`),
  en(String.raw`\b(?:can['’]t|cannot|can not|don['’]t think i can|not sure i can) keep myself safe\b(?!\s+(?:if|from|when|around|with)\b)`),
  en(String.raw`\b(?:use (?:it|the gun|a gun|them|the pills) on|turn (?:it|the gun) on) myself\b`),
  en(String.raw`${NOT_QUOTED}\bi(?:['’]m|\s+am|['’]ll|\s+will)?${ADVERBS}(?:\s+(?:going to|gonna|want to|wanna|plan to|planning to|thinking (?:of|about)|might|could|should|need to|am going to|ready to|about to|trying to))?(?:\s+just)?\s+(?:end|take|ending|taking) my (?:own )?life\b(?!\s+(?:savings|away|over|back|as i knew))`),
  // "I want to die" at the end of the thought (or going on with because/and/but/so, every day…);
  // never "want to die when I see you like this / of embarrassment / inside".
  en(String.raw`${NOT_QUOTED}\bi${ADVERBS}\s+(?:want|wanna)\s+(?:to\s+)?(?:(?:just|fucking|literally|really|actually|honestly|seriously|freaking|fricking|effing)\s+){0,2}die(?:\s+(?:so bad|so badly|so much|right now|now|tonight|today|already|every (?:day|night|single day)|all the time))?(?:${THOUGHT_END_MORE}|\s+so (?:this|the) pain)`),
  en(String.raw`\bi(?:['’]ve| have) been wanting to die\b`),
  en(String.raw`${NOT_QUOTED}\bi${ADVERBS}\s+(?:want|wanna)\s+(?:to\s+)?(?:just\s+)?be dead(?:\s+(?:so bad|right now|now|already))?${THOUGHT_END_MORE}`),
  en(String.raw`\b(?:nobody|no one|no-one)(?:\s+(?:would|will)|['’]d|['’]ll)?(?:\s+even)?\s+(?:miss me|notice|care)(?:\s+if i (?:died|was gone|were gone|was dead|were dead|disappeared|killed myself|was not here|wasn['’]t here))\b`),
  en(String.raw`\bi(?:\s+just)? feel like (?:dying|killing myself|ending (?:it all|my life))${THOUGHT_END_MORE}`),
  // "I want to commit suicide", "I'm going to commit suicide tonight", "I feel like committing suicide", "I am considering suicide".
  en(String.raw`\bi(?:['’]m|\s+am|['’]ll|\s+will)?${ADVERBS}(?:\s+(?:going to|gonna|want to|wanna|plan to|planning to|about to|ready to|might|could|need to|feel like|am going to))?(?:\s+just)?\s+(?:commit|committing|attempt|attempting)\s+suicide\b`),
  en(String.raw`\bi(?:['’]m|\s+am|['’]ve been|\s+have been)${ADVERBS}\s+(?:considering|contemplating|planning|seriously considering)\s+(?:suicide|committing suicide|killing myself|ending my life)\b|\bsuicide is all i (?:can )?think about\b`),
  en(String.raw`\bthere(?:['’]s| is) (?:no|nothing)(?: (?:reason|point))?(?: left)? (?:for me )?to live(?: for\b|\b(?!\s+(?:with|in|like|here|there|near|under|at)\b))|\bi${ADVERBS}(?:\s+have|['’]ve got|\s+have got|\s+got) (?:no reason|nothing(?: left)?) to live for\b|\bi${ADVERBS}(?:\s+have|['’]ve got|\s+have got|\s+got) (?:no reason|nothing left) to (?:live|go on)(?:\s+(?:anymore|any more))?${THOUGHT_END_MORE}`),
  en(String.raw`\bi wish i could (?:just )?die${CLAUSE_END}`),
  en(String.raw`\bi(?:['’]m| am) ready to die\b(?!\s+(?:for|on (?:this|that) hill)\b)`),
  en(String.raw`\bi(?:['’]d| would) (?:much )?rather (?:just )?be dead${CLAUSE_END}`),
  en(String.raw`${NOT_QUOTED}\bi${ADVERBS}\s+(?:don't|do not|dont|don’t) (?:want to|wanna) (?:live|be alive|exist)(?:\s+(?:anymore|any more))?${THOUGHT_END_MORE}`),
  // "I'm so tired of living", "I'm done living", "life isn't worth living", "what's the point of living", "no reason to live anymore".
  en(String.raw`\bi(?:['’]m|\s+am)${ADVERBS}(?:\s+(?:so|really|just|very))?\s+(?:tired of|sick of|done) (?:living|being alive)${THOUGHT_END_MORE}|\blife (?:isn['’]t|is not|ain['’]t|is no longer) worth living${THOUGHT_END_MORE}|\bwhat['’]?s the point (?:of|in) (?:living|being alive|going on)(?:\s+(?:anymore|any more))?(?:${CLAUSE_END}|\?)|(?:^|[.!?…]\s*)no (?:reason|point) (?:to (?:live|go on)|in (?:living|going on))(?:\s+(?:anymore|any more))?${THOUGHT_END_MORE}|\bthere(?:['’]s| is) no point in (?:living|going on)(?:\s+(?:anymore|any more))?${THOUGHT_END_MORE}`),
  // "I've been cutting again", "I started cutting again", "I'm self harming again", "I relapsed on self harm".
  en(String.raw`\bi(?:['’]ve been|\s+have been|\s+been|['’]m|\s+am|\s+started|\s+keep|['’]m still|\s+am still)\s+cutting(?:\s+myself)?(?:\s+(?:again|lately|every (?:day|night)))?${CLAUSE_END}|\bi(?:['’]m|\s+am|['’]ve been|\s+have been|\s+started|\s+keep|\s+relapsed (?:on|with|into))\s+self[- ]?harm(?:ing)?\b`),
  en(String.raw`\bi (?:wish i could|want to|wanna|just want to|need to) (?:just )?disappear (?:forever|for good)\b|\bthis is (?:my )?(?:final )?goodbye\b(?!\s+(?:to|for)\b)|\bi(?:['’]m| am) done[.!,]?\s+goodbye\b`),
  en(String.raw`\bi(?:['’]ve|\s+have)?(?:\s+been)?\s+(?:saving|stockpiling|hoarding|collecting)(?:\s+up)?\s+(?:all\s+)?(?:my\s+)?${PILLS}\b|\bi(?:['’]m|\s+am)?\s+(?:sitting\s+)?in (?:the|my) (?:garage|car) with the (?:car|engine|motor) running\b`),
  en(String.raw`\bi\s+(?:drank|had (?:a bottle|a lot|too much))\b[^.!?]{0,40}\band (?:then\s+)?(?:took|swallowed|popped)\s+(?:(?:a bunch|a handful|all|a bottle|some|too many)(?: of)?\s+)?(?:(?:my|his|her)\s+)?${PILLS}\b|\bi\s+(?:mixed|combined)\s+(?:my\s+)?${PILLS}\s+(?:and|with)\s+(?:alcohol|booze|wine|vodka|liquor|beer)\b[^.!?]{0,30}\b(?:on purpose|to die|so i (?:would|wouldn['’]t|won['’]t|could))`),
  en(String.raw`\bi(?:['’]m|\s+am)?${ADVERBS}\s+(?:going to|gonna|want to|wanna|about to|trying to)\s+(?:(?:walk|step|run|jump) (?:in|into|out into|in front of) (?:traffic|a (?:car|truck|train|bus)|the (?:highway|freeway|road|train|tracks))|(?:drink|starve) myself to death)\b`),
  // "be here" goes on so often ("…and pretend", "…because I'm scared of you",
  // "…anymore, so I'm moving out") that it only counts at the end of a sentence.
  en(String.raw`\bi${ADVERBS}\s+(?:don't|do not|dont|don’t) (?:want to|wanna) be here(?:\s+(?:anymore|any more))?${SENTENCE_END}`),
  en(String.raw`\bi (?:don['’]t|do not) care (?:if|whether) i live or die\b`),
  en(String.raw`\bi (?:don['’]t|do not|can['’]t) see (?:the|a|any) point in (?:living|life|going on)\b`),
  en(String.raw`\bi (?:can['’]t|cannot) go on (?:anymore|any more|living(?: like this)?)${CLAUSE_END}`),
  en(String.raw`\bi(?:['’]m|\s+am|\s+feel|\s+felt|\s+was|['’]ve been|\s+have been)(?:\s+feeling)?\s+(?:so\s+|really\s+|kind of\s+|very\s+)?suicidal\b`),
  en(String.raw`\bi(?:['’]ve|\s+have|\s+had|['’]m|\s+am|\s+keep|\s+can['’]t stop|\s+sometimes|\s+often)?(?:\s+been)?${ADVERBS}\s+(?:having\s+|getting\s+)?(?:suicidal (?:thoughts|feelings|urges|ideas)|thoughts (?:of|about) (?:suicide|killing myself|ending my life)|(?:thinking|think|thought) (?:about|of) (?:suicide|killing myself|ending my life|ending it all|(?:taking|swallowing) all (?:of )?my (?:pills|meds|medication|tablets)))\b`),
  // Past or perfect, pills or a named drug: "I've taken all my pills", "I swallowed a bottle of Tylenol" —
  // never her daily meds, "I took all my meds today (like the doctor said)".
  en(String.raw`${I_TOOK}\s+${PILL_AMOUNT}\s+${PILLS}\b${NOT_PILLS_AWAY}(?!\s+(?:today|this morning)\b)${NOT_ROUTINE}${NOT_LONG_AGO}`),
  // A count of ten or more at once: "I took 50 Xanax", "I just took 30 pills" — never "2 Tylenol for my headache".
  en(String.raw`${I_TOOK}\s+${MANY}\s+${PILLS}\b${NOT_PILLS_AWAY}${NOT_DOSE_SPAN}${NOT_ROUTINE}${NOT_LONG_AGO}`),
  en(String.raw`\bi(?:['’]m|\s+am)?${ADVERBS}\s+(?:going to|gonna|want to|wanna|plan to|planning to|about to)\s+(?:take|swallow|down)\s+(?:${PILL_AMOUNT}|all (?:of )?the|${MANY})\s+${PILLS}\b${NOT_PILLS_AWAY}${NOT_DOSE_SPAN}`),
  en(String.raw`\bi(?:['’]m|\s+am)?${ADVERBS}\s+(?:going to|gonna|want to|wanna|plan to|planning to|about to)\s+(?:overdose|od)\b(?!\s+on\s+(?:sugar|chocolate|cake|coffee|caffeine|candy))`),
  en(String.raw`\bi(?:\s+have|['’]ve got|\s+have got|\s+got) (?:the|my) pills (?:ready|right here|in my hand|lined up)\b(?![^.!?]{0,60}\b(?:you|your|from (?:his|her|their)|took them (?:from|away|out)|flush|lock)\b)`),
  en(String.raw`\bi (?:overdosed|od['’]?d|o\.d\.['’]?d) on purpose\b|\bi(?:\s+just)?\s+(?:burned|burnt|cut|hurt|hit|starved) myself on purpose\b`),
  // "I attempted suicide last night", "I tried to overdose" — not "…in 2010" / "years ago".
  en(String.raw`\bi(?:\s+just)?\s+(?:attempted|tried) suicide\s+(?:yesterday|last night|today|tonight|this morning|earlier|an hour ago|just now|again)\b|\bi(?:\s+just)?\s+(?:attempted|tried) to (?:kill myself|overdose|od|end my life|end it all)\b${NOT_LONG_AGO}`),
  en(String.raw`\bi(?:\s+just)?\s+(?:drank|drunk|swallowed)\s+(?:some\s+|a (?:bottle|cup|glass|whole bottle) of\s+)?(?:bleach|antifreeze|drain cleaner|rat poison|poison|lye)\b(?![^.!?]{0,30}\b(?:by accident|accidentally|by mistake)\b)`),
  // "I just overdosed", "I think I overdosed", "I just od'd", "I overdosed." — not "…years ago / in college".
  en(String.raw`\bi(?:\s+just|['’]ve just|\s+have just|\s+think i(?:['’]ve|\s+have)?(?:\s+just)?|\s+might have|\s+may have)\s+(?:overdosed|od['’]?d|o\.d\.['’]?d)\b${NOT_LONG_AGO}|\bi(?:['’]ve|\s+have)?\s+(?:overdosed|od['’]?d|o\.d\.['’]?d)(?:\s+(?:again|tonight|today|just now))?${SENTENCE_END}${NOT_LONG_AGO}`),
  en(String.raw`\bi wish i (?:was|were) dead\b|\bi wish i (?:wasn['’]t|weren['’]t|was not|were not) (?:alive|here anymore|born)\b`),
  en(String.raw`\bi(?:['’]m|\s+am)?${ADVERBS}\s+(?:going to|gonna|want to|wanna|about to|planning to|thinking about|thinking of)\s+(?:drive|driving|crash|crashing|run|running)\s+(?:(?:my|the)\s+(?:car|truck|van)\s+)?(?:off|into)\s+(?:a|the)\s+(?:bridge|cliff|wall|tree|river|lake|ocean|pole|overpass|traffic)\b`),
  en(String.raw`\bi wish i(?:\s+had|['’]d)?\s+never (?:been born|woken up)\b`),
  en(String.raw`\bi (?:wish i could|want to|wanna|just want to|would like to|could just|hope i) (?:just )?(?:go to sleep|fall asleep|sleep) and (?:not|never) wake up\b`),
  en(String.raw`\bi (?:wouldn['’]t mind|don['’]t care|would(?:n['’]t)? be (?:fine|okay|ok)) if i (?:didn['’]t|never|don['’]t) wake up\b`),
  en(String.raw`\bi (?:don't|do not|dont|don’t|never|don['’]t ever) (?:ever )?want to wake up(?: (?:tomorrow|again|anymore|ever again))?${THOUGHT_END}`),
  en(String.raw`\bi(?:['’]m| am) done with (?:life|living)${CLAUSE_END}`),
  en(String.raw`\b(?:everyone|everybody|my family|my kids|the kids|the world|people|they|you all|y['’]all|all of you)(?:(?:['’]d| would)(?: all)? be|['’]s| is| are|['’]re)(?: all)? better off (?:without me|if i (?:was|were) (?:gone|dead|not (?:here|around|alive))|if i (?:wasn['’]t|weren['’]t) (?:here|around|alive)|if i died)${CLAUSE_END}`),
  en(String.raw`\bi(?:['’]d|\s+would|['’]m|\s+am)(?:\s+be)?(?:\s+(?:so much|a lot|just|probably|honestly|really))?\s+better off dead\b`),
  en(String.raw`${NOT_QUOTED}\bi${ADVERBS}(?:\s+(?:want|wanna|need)\s+to|['’]ll|\s+will|['’]m\s+going\s+to|['’]m\s+gonna|\s+am\s+going\s+to)\s+(?:just\s+)?end it all(?:\s+(?:now|right now|tonight|today))?${THOUGHT_END_MORE}`),
  en(String.raw`\btonight,?\s+i(?:['’]m|\s+am)\s+(?:going to|gonna)\s+end it${CLAUSE_END}`),
  // "I'm going to end it tonight." — a whole sentence; never "end it with him tonight" or "…tonight — the enabling".
  en(String.raw`\bi(?:['’]m|\s+am)${ADVERBS}\s+(?:going to|gonna|about to|ready to|planning to)\s+(?:just\s+)?end it(?:\s+all)?\s+(?:tonight|today|right now|now)${SENTENCE_END}`),
  // In progress or about to happen: wrists/throat, a weapon on herself, a jump, an overdose.
  en(String.raw`\bi(?:['’]ve|\s+have)?(?:\s+just)?\s+(?:(?:slit|cut|slashed|sliced)\s+my\s+${WRISTS}|opened\s+(?:up\s+)?my\s+wrists\b)${NOT_CUT_ACCIDENT}`),
  en(String.raw`\bi(?:['’]m|\s+am|['’]ve been|\s+have been)${ADVERBS}\s+(?:slitting|cutting|slashing|slicing)\s+(?:open\s+)?my\s+${WRISTS}${NOT_CUT_ACCIDENT}`),
  en(String.raw`\bi(?:['’]m|\s+am)?${ADVERBS}\s+(?:going to|gonna|want to|wanna|about to|planning to|ready to)\s+(?:slit|cut|slash)\s+my\s+${WRISTS}`),
  // "I have a gun and I'm going to use it" — not "…on him", "…if he comes back", "…to protect myself".
  en(String.raw`\bi(?:\s+have|['’]ve got|\s+have got|\s+got|\s+(?:just\s+)?bought|['’]m holding|\s+am holding)\s+(?:a|the|my|his|her)(?:\s+\p{L}+['’]?s)?\s+(?:loaded\s+)?(?:gun|pistol|revolver|rifle|shotgun)\b${NOT_WEAPON_THING}[^.!?]{0,40}\bi(?:(?:['’]m|\s+am)?${ADVERBS}\s+(?:going to|gonna|about to|ready to|planning to|plan to|want to|wanna)|(?:['’]ll|\s+will)${ADVERBS})\s+(?:just\s+)?use it\b(?!\s+(?:on|against)\s+(?!myself\b)|\s+(?:if|to (?:protect|defend)|for (?:protection|self[- ]defen[cs]e|hunting))\b)`),
  en(String.raw`(?<!\b(?:like|as if|as though)\s+)\bi(?:['’]ve got|\s+have got|\s+have|\s+got|\s+hold|\s+held|\s+put|['’]m holding|\s+am holding|['’]m pointing|\s+am pointing|['’]m putting|\s+am putting|['’]m pressing|\s+am pressing)\s+(?:a|the|my)\s+(?:gun|pistol|revolver|knife|blade|razor)\s+(?:to|against|at)\s+my\s+(?:head|temple|throat|neck|chest|wrists?)\b`),
  en(String.raw`\bi(?:['’]m|\s+am)?${ADVERBS}\s+(?:going to|gonna|want to|wanna|about to|ready to|planning to|plan to)\s+jump\s+(?:off|from)\s+(?:a|the|this|that)\s+(?:bridge|building|roof|rooftop|cliff|overpass|balcony|ledge|parking garage|tower)\b(?!\s+if\b)`),
  // Never "on the edge of jumping to conclusions" / "on the edge of my seat".
  en(String.raw`\bi(?:['’]m|\s+am)\s+(?:on|at|standing on|up on|on top of)\s+(?:the|a|this)\s+(?:bridge|roof|rooftop|ledge|edge(?!\s+of\s+(?:\w+ing|my seat|a (?:nervous )?breakdown|tears|my rope)\b)|overpass|balcony|cliff)\b[^.!?]{0,40}\b(?:jump|jumping)\b(?!\s+(?:to conclusions|through hoops|for joy|ship|the gun|on the bandwagon|at (?:every|the (?:chance|opportunity)))\b)`),
  en(String.raw`\bi(?:['’]ve|\s+have)?(?:\s+just)?\s+(?:took|taken)\s+an?\s+overdose\b${NOT_LONG_AGO}`),
  en(String.raw`\bi(?:['’]ve|\s+have)?(?:\s+just)?\s+(?:overdosed|od['’]?d|o\.d\.['’]?d)\s+on\s+(?:(?:all\s+(?:of\s+)?)?(?:my|the|these|those|his|her)\s+)?${PILLS}\b${NOT_LONG_AGO}`),
  // ---- Spanish ----
  // "matarme" is hers only when no one else is the subject ("me amenazó con
  // matarme", "intentó matarme", "dijo que va a matarme" are abuse, below).
  // Someone else's attempt or threat ("intenta / está tratando de / puede matarme" — abuse, below), or a line to him
  // ("me amenazaste con matarme", "ibas a / vas a / quisiste / intentaste matarme") — never hers.
  es(String.raw`(?<!(?:amenaz(?:a|ó|o|aba|ando|aste|as|abas) con|va a|iba a|van a|vaya a|ibas a|vas a|quiere|quer[íi]a|quer[íi]as|quieres|quiso|quisiste|intent[óo]|intenta|intentaba|intentando|intentaste|trat[óo] de|trata de|trataba de|tratando de|trataste de|puede|podr[íi]a|pudo|dijo que (?:va|iba) a)\s+)(?:matarme|suicidarme|ahorcarme|quitarme la vida|hacerme da[ñn]o|cortarme las venas|tirarme (?:de|desde) (?:un|el|este|una|la) (?:puente|edificio|techo|azotea|balc[óo]n|ventana))${NOT_IDIOM_ES}`),
  es(String.raw`${NOT_QUOTED_ES}me (?:quiero|voy a|pienso|podr[íi]a) (?:matar|suicidar|quitar la vida|hacer da[ñn]o|ahorcar|colgar(?!\s+(?:el|del|la|de la) (?:tel[ée]fono|llamada|celular)))${NOT_IDIOM_ES}`),
  es(String.raw`${NOT_QUOTED_ES}(?:quiero|quisiera|voy a|pienso|me gustar[íi]a) (?:acabar|terminar) con mi (?:propia )?vida`),
  es(String.raw`${NOT_QUOTED_ES}(?:me )?(?:quiero|quisiera) morir(?:me)?${THOUGHT_END_ES_MORE}`),
  es(String.raw`${NOT_QUOTED_ES}(?:quiero|quisiera|me gustar[íi]a) estar muert[oa]${THOUGHT_END_ES_MORE}`),
  es(String.raw`ojal[áa] (?:me muriera|me muera|estuviera muert[oa]|no despertara|no hubiera nacido)`),
  es(String.raw`prefiero (?:morir(?:me)?|estar muert[oa])${THOUGHT_END_ES_MORE}`),
  // "Todos estarían mejor sin mí", "mis hijos estarían mejor si yo no estuviera".
  es(String.raw`(?:todos|todo el mundo|el mundo|mi familia|mis hijos|los ni[ñn]os|ustedes)\s+(?:estar[íi]an?|vivir[íi]an?)(?: mucho)? mejor (?:sin m[íi]|si (?:yo )?(?:no estuviera|me muriera|estuviera muert[oa]))${CLAUSE_END}`),
  // First-person, present-tense self-harm — checked before any abuse form.
  // "Solo me hago daño a mí mismo" is the classic denial line, not a disclosure.
  // With an abuser as the subject, a past-time word ("anoche me golpeo", "me lastimo ayer") or "me quemo con un
  // cigarro", it is an accent-dropped preterite — someone else did it (abuse, below),
  // and "me lastimo lo que hiciste / que no vinieras" is an accent-dropped "me lastimó".
  es(String.raw`(?<!(?:solo|s[óo]lo|solamente|nom[áa]s)\s+)(?<!${ABUSER_ES}\s+)(?<!${PAST_TIME_ES}\s+(?=me (?:golpeo|lastimo)(?![\p{L}])))(?!me (?:golpeo|lastimo)\s+${PAST_TIME_ES}(?![\p{L}]))(?!me quemo con (?:un|una|el|la|su)(?![\p{L}]))(?!me (?:lastimo|corto|golpeo|quemo)${BEFORE_WHO_ES})(?!me quemo (?:cada vez que|cuando|siempre que) (?:cocino|plancho|horneo|fr[íi]o|cocinando))(?!me (?:lastimo|corto|golpeo|quemo) (?:la|el|los|las) \p{L}+\s+(?!cuando(?![\p{L}]))\p{L}+(?:ando|iendo)(?![\p{L}]))me (?:lastimo|corto|golpeo|quemo|hago da[ñn]o|estoy lastimando|estoy cortando|estoy haciendo da[ñn]o|he estado (?:cortando|lastimando|haciendo da[ñn]o))${NOT_IDIOM_ES}(?!\s+(?:lo que|que|tu|tus|su|sus|ver(?:te|lo|la|los)|o[íi]r(?:te|lo|la)|saber)(?![${L}]))`),
  es(String.raw`(?:me (?:voy a )?pego|(?:voy a |quiero )?pegarme|me (?:voy a|quiero) pegar) un tiro`),
  es(String.raw`me mato(?=\s*(?:[.!?,;…]|$)|\s+(?:si|y ya|de una vez|hoy|ahora|esta noche)(?![${L}]))`),
  es(String.raw`pensamientos suicidas|ganas de morir(?:me)?|pienso en (?:el suicidio|suicidarme|matarme)`),
  es(String.raw`(?:me voy a tomar|voy a tomarme|me quiero tomar|quiero tomarme) (?:todas (?:mis|las) pastillas|un frasco(?: de pastillas)?|demasiadas pastillas)`),
  // Wrists, veins, arms — never a bare "me corté" ("me corté cocinando") or an accident.
  es(String.raw`me (?:cort[ée]|acabo de cortar|voy a cortar|quiero cortar|estoy cortando|he cortado|volv[íi] a cortar) (?:las venas|(?:los brazos|las mu[ñn]ecas|la mu[ñn]eca)(?!\s+(?:sin querer|por accidente|accidentalmente|con (?:un|una|el|la) (?:vidrio|cristal|lata|papel|hoja)|en (?:la|el) (?:cocina|jard[íi]n|trabajo)|\p{L}+(?:ando|iendo)(?:me)?(?![${L}]))))`),
  // Past: "(me) tomé todas mis pastillas" — but "Hoy tomé todas mis pastillas (de la mañana)" is her daily meds.
  es(String.raw`(?<!(?:^|[^${L}])hoy,?\s+(?:ya\s+)?(?:me\s+)?)(?:me tom[ée]|tomé|(?:yo|ya|anoche) tome|acabo de tomar(?:me)?|me acabo de tragar|me tragu[ée]|tragu[ée]) ${PASTILLAS}${NOT_ROUTINE_ES}|tome (?:un frasco de pastillas|demasiadas pastillas)${NOT_ROUTINE_ES}`),
  // With overdose context the day doesn't matter: "hoy me tomé todas las pastillas de una vez".
  es(String.raw`(?:me tom[ée]|tomé|tome) (?:todas (?:mis|las) pastillas|un frasco(?: de pastillas)?|demasiadas pastillas) (?:de (?:una|un) (?:vez|golpe|jal[óo]n)|juntas|a la vez|para (?:morir(?:me)?|no despertar(?:me)?|matarme|acabar con todo|dormir para siempre))`),
  es(String.raw`me (?:voy a|quiero|pienso|estoy por) (?:tirar|aventar|lanzar) (?:del|(?:de|desde|por) (?:un|el|este|una|la)) (?:puente|edificio|techo|azotea|balc[óo]n|ventana)(?!\s+si(?![${L}]))`),
  // "Voy a saltar del puente", "Estoy en el puente y voy a saltar" — never "…si recaes".
  es(String.raw`(?:voy a|quiero|pienso|estoy por|estoy a punto de) (?:saltar|brincar|tirarme|aventarme|lanzarme) (?:(?:del|de (?:un|el|este|una|la|esta|ese|esa)|desde (?:el|un|este|una|la|esta|ese|esa|lo alto de(?:l| (?:un|una|la|este|esta)))) (?:puente|edificio|techo|azotea|balc[óo]n|ventana|precipicio|acantilado|barranco|terraza)|por (?:la|una|esta) ventana)(?!\s+si(?![${L}]))`),
  es(String.raw`estoy (?:en|sobre|arriba de|parad[ao] en|en la orilla de|en el borde de) (?:el|la|un|una|este|esta) (?:puente|techo|azotea|edificio|balc[óo]n|cornisa|precipicio|acantilado|barranco)[^.!?]{0,40}(?:saltar|brincar|tirarme|aventarme|lanzarme)(?!\s+(?:en paraca[íi]das|la cuerda|de (?:alegr[íi]a|gusto)))`),
  es(String.raw`dormir(?:me)? y no (?:volver a )?despertar(?:me)?|no (?:quiero|quisiera) despertar(?:me)?(?: m[áa]s| ma[ñn]ana)?${THOUGHT_END_ES}`, false),
  new RegExp(String.raw`(?:^|[^${L}])no quiero (?:vivir|seguir viviendo)(?: m[áa]s| anymore| any more)?${THOUGHT_END_ES}`, 'iu'),
  es(String.raw`(?:ya )?no tengo (?:raz[óo]n(?:es)?|motivos?) para vivir|no tengo (?:nada )?por (?:qu[ée]|lo que) vivir|no tengo para qu[ée] vivir`, false),
  es(String.raw`mejor me muero${THOUGHT_END_ES}|(?:estar[íi]a|estoy|estar[íi]amos) mejor muert[oa]s?|estoy (?:muy |tan |bien )?cansad[ao] de vivir${THOUGHT_END_ES}`),
  es(String.raw`me (?:hice|he hecho) da[ñn]o a prop[óo]sito|me (?:cort[ée]|quem[ée]|lastim[ée]|golpe[ée]) a prop[óo]sito|(?:me siento|estoy|ando|me he sentido) (?:muy |bien |algo )?suicidal?`),
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
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+are|['’]re|\s+has|\s+have|\s+was|\s+were)?(?:\s+been)?${ADV}\s+(?:hitting|beating|beatin|choking|strangling|kicking|punching|slapping|stabbing|raping|smacking|biting|hits|beats|chokes|strangles|kicks|punches|slaps|stabs|rapes|smacks|bites|beat(?:ing|in)\s+on)\s+${ME_US}\b${NOT_FIGURATIVE_ONGOING}${NOT_HISTORY}`),
  // "My husband is attacking me", "my son is attacking me with a knife" — not "…for setting a boundary".
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|['’]re|\s+are)${ADV}\s+attacking ${ME_US}(?:\s+(?:right now|again|physically))?(?:${CLAUSE_END}|\s+with\s+(?:a|an|his|her|their|the)\s+(?:\w+\s+)?(?:knife|gun|pistol|bat|hammer|machete|axe|blade|weapon|bottle|pipe|chair)\b)`),
  // "He'll hit me if I say anything" — a threat she lives under.
  en(String.raw`\b${ABUSER}(?:\s+will|['’]ll|\s+would)${ADV}\s+(?:hit|beat|choke|hurt|slap|kill) (?:me|us)(?:\s+again)?\s+if i\b`),
  // "He told me to kill myself", "he tried to make me kill myself" — his words, her abuse.
  en(String.raw`\b${ABUSER}${ADV}\s+(?:told|tells|keeps telling|said|says|keeps saying|screamed|yelled)(?: (?:at|to))? me (?:to|i should) (?:go )?kill myself\b|\b${ABUSER}(?:['’]s|\s+is)?${ADV}\s+(?:tried|trying|tries|keeps trying|wants|wanted) to (?:make|get|push) me (?:to )?kill myself\b`),
  // "He grabbed my throat", "held a pillow over my face", "poured boiling water on me", "pinned me to the bed",
  // "locked me in the bathroom", "my son is violent with me", "he's physically abusive".
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was|\s+has)?${ADV}\s+(?:(?:grabbed|squeezed|choked|grabbing|squeezing) my (?:throat|neck)|(?:held|put|pressed|holding|putting|pressing) (?:a|the) pillow (?:over|on) my face|(?:suffocated|smothered|suffocating|smothering) (?:me|us)|(?:poured|threw) (?:boiling|hot) (?:water|coffee|oil|grease) (?:on|at) (?:me|us)|pinned me (?:to|against|on) (?:the|a|my) (?:bed|floor|wall|ground|couch|car)|sat on (?:me|my chest)|locked me in (?:the|a|my|his|our) (?:bathroom|room|bedroom|closet|basement|house|car|garage|trunk)|grabbed my (?:arm|wrist|hair|face) so hard|put (?:his |her |their )?hands on (?:me|us))\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was|\s+gets|\s+got|\s+has been|\s+can be)${ADV}(?:\s+(?:so|really|very|super))?\s+(?:violent|physical|rough) with (?:me|us)\b${NOT_HISTORY}|\b${ABUSER}(?:['’]s|\s+is|\s+was|\s+has been)${ADV}\s+(?:physically|sexually) (?:abusive|violent)\b${NOT_HISTORY}`),
  en(String.raw`\bi(?:['’]m|\s+am|m)?\s+(?:afraid|scared|terrified) for my life\b|\bi fear for my life\b`),
  // "He hit the kids and me", "my husband hit my daughter and me".
  en(String.raw`\b${ABUSER}${ADV}\s+(?:hit|beat|punched|kicked|slapped|choked|attacked|hurt|shoved|pushed)\s+(?:the (?:kids|children|baby)|my (?:\p{L}+\s+)?(?:daughter|son|kids|children|baby|grandson|granddaughter|sister|mom|mother)|him|her|them)\s+and\s+me\b${NOT_HISTORY}`),
  // "He's drunk and beating me", "my son is high and hitting me".
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|['’]re|\s+are|\s+was|\s+got)\s+(?:drunk|high|wasted|loaded|raging|out of control|using again)\s+and\s+(?:(?:is|was)\s+)?(?:hitting|beating|choking|kicking|punching|slapping|attacking|strangling|hit|beat|choked|punched|kicked|slapped|attacked)\s+me\b${NOT_FIGURATIVE_ONGOING}`),
  // "My son put his hands on me", "my husband got physical with me", "he knocked me out", "he threw a chair at me".
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was|\s+has)?${ADV}\s+(?:got physical with me|put me in (?:a (?:chokehold|choke hold|headlock|sleeper hold)|the (?:hospital|er|icu|emergency room)|(?:the )?hospital)|(?:held|holding|keeps? holding|kept|keeping) me hostage(?:${CLAUSE_END}|\s+(?:in|at)\s+(?:the|our|my|his|her)\s+(?:house|home|room|bedroom|car|apartment|basement|garage))|(?:slammed|smashed|crushed) my (?:hand|fingers?|arm|leg|head) in (?:the|a) (?:car )?door|twisted my (?:arm|wrist) (?:until|till|so hard|behind my back)|put (?:his|her|their) hands on me|laid (?:his|her|their )?hands on me|roughed me up|jumped me|knocked me (?:out|down|unconscious|to the (?:ground|floor))|threw (?:a|the|his|her|their)\s+(?:\w+\s+)?(?:chair|bottle|plate|glass|lamp|knife|phone|bat|hammer|rock|brick|pan|mug|remote|shoe|bowl|vase|table|can)\s+at me)\b(?!\s+a peg)${NOT_HISTORY}`),
  // Passive: "I was beaten by my husband last night", "I got beat up by my son", "I was attacked by my son".
  en(String.raw`\b(?:i(?:\s+was|\s+got|\s+just got|['’]ve been|\s+have been|\s+had been|['’]m being|\s+am being|\s+keep getting)|we(?:\s+were|\s+got|\s+just got|['’]ve been|\s+have been|\s+had been|['’]re being|\s+are being))\s+(?:beaten|beat|hit|punched|kicked|choked|strangled|slapped|attacked|assaulted|stabbed|shot|raped|shoved|pushed|thrown|burned|bitten|smacked|jumped|knocked out|sexually assaulted)(?:\s+up)?\s+by\s+(?:${ABUSER}|him|her|them)\b(?!['’]s\b)(?![^.!?]{0,20}\b(?:at|in) (?:cards|chess|poker|checkers|games?|tennis|golf|pool|scrabble|monopoly|a race|the race)\b)${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}${ADV}\s+(?:keeps?|kept|started|began)(?:\s+on)?\s+(?:hitting|beating|choking|strangling|kicking|punching|slapping)\s+me\b${NOT_FIGURATIVE_ONGOING}`),
  en(String.raw`\b${ABUSER}${ADV}\s+(?:keeps?|kept)(?:\s+on)?\s+(?:shoving|pushing)\s+me\b${NOT_FIGURATIVE_PUSH}`),
  // "He's abusing me" — the contraction has no space before it; "…abusing me emotionally" stays with the model.
  en(String.raw`\b${ABUSER}(?:\s+abuses|\s+is abusing|['’]s abusing|['’]re abusing|\s+are abusing|\s+keeps abusing) me(?:\s+(?:again|right now|physically|sexually))?${CLAUSE_END}|\bi(?:['’]m| am) being (?:abused|beaten|hit|choked|raped)\b(?!\s+(?:with|down|up)\b|\s+by (?:all|this|these|those|the (?:bills?|stress|news|world|system)|bills?|life|stress|everything)\b)`),
  // "My husband is hurting me", "He's hurting me right now" — the abuser as subject (never "it's / his drinking
  // is / you're hurting me"), and a whole clause: never "…by using", "…so much with his drinking", "…and herself".
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|['’]re|\s+are|\s+keeps?)\s+hurting me(?:\s+(?:right now|physically))?${CLAUSE_END}${NOT_FIGURATIVE_HURT}`),
  // "I was raped last night", "I've been raped", "I got raped" — not childhood history or "raped on the price".
  en(String.raw`\bi(?:\s+was|['’]ve been|\s+have been|\s+got|\s+just got|['’]ve just been|\s+was just)\s+(?:raped|sexually assaulted)\b(?!\s+(?:(?:on|by) (?:the )?(?:price|bill|fees?|taxes|insurance|lawyers?|mechanic|landlord|irs)|in (?:court|the divorce|the settlement))\b)${NOT_HISTORY}${NOT_LONG_AGO}`),
  en(String.raw`\b${ABUSER}\s+(?:slammed|smashed|banged|hit) my head (?:into|against|on)\b`),
  // Injuries he caused: "he broke my nose", "my husband broke my ribs", "my son gave me a black eye" — never "I broke my arm".
  en(String.raw`\b${ABUSER}${ADV}\s+(?:broke|fractured|cracked|busted|dislocated|split|bloodied)\s+my\s+(?:nose|arms?|ribs?|jaw|wrists?|fingers?|hands?|cheekbone|eye socket|collarbone|skull|teeth|tooth|lips?)\b(?!-)${NOT_HISTORY}|\b${ABUSER}${ADV}\s+gave me (?:a )?(?:black eye|concussion|bloody nose|split lip|fat lip)\b${NOT_HISTORY}`),
  en(String.raw`(?<!\bremember when\s+)(?!(?<=\bwhen\s+)your\b)\b${ABUSER}(?:['’]s|\s+has|\s+have)?(?:\s+been)?${ADV}\s+(?:hit|beat|beaten|choked|strangled|punched|kicked|slapped|raped|assaulted|attacked|stabbed|shot|smacked|whooped|whupped|bit|molested|sexually (?:assaulted|abused)|abused|backhanded|headbutted|head-butted|kneed|elbowed|tackled|body ?slammed|cut|burned|burnt|stomped on|spit on|spat on|beat on)\s+${ME_US}\b${NOT_FIGURATIVE_PAST}(?![^.!?]{0,40}\b(?:joking|kidding|playing around|horsing around|by accident|accidentally)\b)${NOT_HISTORY}(?![^.!?]{0,40}\bwith (?:that|the|this|his|her|their|those) (?:news|words?|comments?|remarks?|questions?))`),
  en(String.raw`(?<!\bremember when\s+)\b${ABUSER}(?:['’]s|\s+has|\s+have)?(?:\s+been)?${ADV}\s+(?:pushed|shoved)\s+me\b${NOT_FIGURATIVE_PUSH}${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+has)?${ADV}\s+(?:choked|strangled) me out\b`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+has)?${ADV}\s+(?:beat|beats|beaten|beating)\s+${ME_US} up\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}\s+(?:beat|beats|has beaten)\s+(?:the (?:crap|hell|shit|living daylights) out(?:ta| of) me|me (?:black and blue|so (?:bad|badly|hard)))\b`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+has|\s+have|\s+was)?(?:\s+been)?${ADV}\s+(?:keeps\s+)?(?:threatened|threatens|threatening) to (?:kill|hurt|shoot|stab|beat|strangle) ${ME_US}\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}(?:\s+(?:has|have|got|has got|have got)|['’]s got|['’]ve got) (?:a|my|his|her|their|the) (?:gun|knife|weapon|pistol)\b${NOT_WEAPON_THING}[^.!?]{0,40}\b(?:threaten\w*|kill (?:me|us)|shoot (?:me|us)|hurt (?:me|us)|use it on me|coming (?:at|after) me|pointing it at (?:me|my)|aiming it at me|chasing me|swinging it at me)\b`),
  en(String.raw`\b(?:kill|shoot|stab) me\b[^.!?]{0,40}\b${ABUSER}(?:\s+(?:has|have|got|has got|have got)|['’]s got|['’]ve got) a (?:gun|knife|weapon|pistol)\b${NOT_WEAPON_THING}`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was|['’]re|\s+are|\s+were|\s+has|\s+have)?(?:\s+been)?${ADV}\s+(?:threatened|threatens|threatening) me with (?:a|an|his|her|their) (?:knife|gun|pistol|rifle|shotgun|bat|hammer|machete|weapon)\b`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was|['’]re|\s+are)?${ADV}\s+(?:pointing|aiming|pointed|aimed|waving|swinging|swung)\s+(?:a|his|her|their|the)\s+(?:gun|pistol|rifle|shotgun|knife|machete|weapon|bat|hammer|bottle|pipe|axe|crowbar)\s+(?:at|in)\s+(?:me|us|my face)\b`),
  en(String.raw`\b${ABUSER}(?:\s+(?:has|had|got)|['’]s got|\s+has got|(?:['’]s|\s+is|\s+was)\s+(?:holding|putting|pressing))\s+(?:a|his|her|their|the)\s+(?:knife|gun|pistol|blade|razor)\s+(?:to|against|at)\s+my\s+(?:throat|head|neck|chest|temple)\b`),
  en(String.raw`\b${ABUSER}\s+(?:won['’]t|will not|doesn['’]t|does not|wouldn['’]t|would not)\s+let me (?:leave|go|out)\b[^.!?]{0,60}\b(?:gun|knife|weapon|pistol|rifle)\b${NOT_WEAPON_THING}`),
  en(String.raw`\b${ABUSER}(?:\s+(?:has|got|has got)|['’]s got|['’]ve got)\s+a\s+(?:gun|knife|weapon|pistol|rifle)\b${NOT_WEAPON_THING}[^.!?]{0,60}\b(?:won['’]t|will not|doesn['’]t|wouldn['’]t)\s+let me (?:leave|go|out)\b`),
  en(String.raw`\b${ABUSER}\s+(?:pulled|drew) (?:a|the|his|her|their) (?:knife|gun|pistol) on me\b`),
  en(String.raw`\b${ABUSER}\s+(?:held|put|pressed) (?:a|the|his|her|their) (?:knife|gun|pistol) (?:to|against) my (?:throat|head|neck|chest|temple)\b`),
  // Two steps, the most common way it's told: "he got drunk and hit me", "he grabbed me and choked me",
  // "he came home drunk and hit me again" — never "…and hit me up", "…and beat me at cards", "…and shot me a look".
  en(String.raw`(?<!\bremember when\s+)(?!(?<=\bwhen\s+)your\b)\b${ABUSER}\b[^.!?]{0,40}?\b(?:and|then)\s+(?:then\s+)?(?:(?:just|also|again)\s+)?(?:hit|beat|choked|punched|kicked|slapped|stabbed|shot|smacked|strangled|attacked|raped|bit|whooped)\s+me\b${NOT_FIGURATIVE_PAST}${NOT_HISTORY}(?![^.!?]{0,40}\bwith (?:that|the|this|his|her|their|those) (?:news|words?|comments?|remarks?|questions?))`),
  en(String.raw`\b${ABUSER}\b[^.!?]{0,40}?\b(?:and|then)\s+(?:hits|beats|chokes|punches|kicks|slaps|smacks|strangles|attacks)\s+me\b${NOT_FIGURATIVE_ONGOING}${NOT_HISTORY}`),
  // "He won't stop hitting me", "he never stops", "he doesn't stop".
  en(String.raw`\b${ABUSER}\s+(?:won['’]t|will not|doesn['’]t|does not|never|can['’]t|cannot|wouldn['’]t)\s+(?:stop|stops|quit|quits)\s+(?:(?:hitting|beating|choking|kicking|punching|slapping|strangling)\s+me\b${NOT_FIGURATIVE_ONGOING}|hurting me\b${NOT_FIGURATIVE_HURT}(?!\s+(?:with|by)\b)|(?:pushing|shoving)\s+me\b${NOT_FIGURATIVE_PUSH})`),
  // Weapons and other assaults: "he burned me with a cigarette", "he cut me with a knife", "he forced himself on me",
  // "he dragged me by my hair", "he came at me with a knife", "he's chasing me with a knife", "he shot at me".
  en(String.raw`\b${ABUSER}${ADV}\s+(?:burned|burnt|cut|sliced|slashed|scalded)\s+me\s+with\s+(?:(?:a|an|the|his|her|their|hot|boiling|lit|broken)\s+)+(?:cigarette|lighter|iron|knife|blade|razor|glass|bottle|box ?cutter|scissors|water|oil|pan|torch|machete)\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}${ADV}\s+(?:forced (?:himself|herself|themselves) on me|forced me to have sex|made me have sex)\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was)?${ADV}\s+(?:(?:dragged|dragging|pulled|pulling|yanked|yanking|grabbed|grabbing|threw|throwing) me (?:by|across|around) (?:my|the) (?:hair|neck|throat|room|floor|house)|(?:pulled|pulling|yanked|yanking|ripped|ripping) (?:out )?my hair)\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was|['’]re|\s+are)?${ADV}\s+(?:(?:came|coming|comes|charged|charging|lunged|lunging|went|going|ran|running|swung|swinging)\s+(?:at|after)|chas(?:ed|ing|es)|(?:standing|stood|hovering|towering)\s+over)\s+${ME_US}\s+with\s+(?:a|an|the|his|her|their)\s+(?:\w+\s+)?(?:knife|gun|pistol|rifle|shotgun|bat|hammer|machete|axe|blade|weapon|crowbar|bottle|pipe|chair)\b`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was|\s+has)?${ADV}\s+(?:shot|shoots|shooting|fired)\s+at\s+me\b|\b${ABUSER}(?:['’]s|\s+is|\s+was)?${ADV}\s+(?:held|pinned|holds|pins|holding|pinning) me down\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}${ADV}\s+(?:tried to run|ran|almost ran|nearly ran) me over\b|\b${ABUSER}${ADV}\s+(?:tried to hit|hit) me with (?:his|her|their|the) (?:car|truck)\b(?!\s+(?:payments?|bills?|keys|note|insurance|loan))`),
  // "He hurt me bad, I'm bleeding", "…I ended up in the hospital".
  en(String.raw`\b${ABUSER}${ADV}\s+hurt me\b[^.!?]{0,50}\b(?:bleeding|blood|hospital|emergency room|bruises?|black eye|stitches|broken (?:bone|nose|ribs?|arm))\b`),
  // "He locked me in and has a gun"; "he made me take all my pills".
  en(String.raw`\b${ABUSER}${ADV}\s+(?:locked|locks|has locked|is locking) me (?:in|inside|up)\b[^.!?]{0,40}\b(?:gun|knife|weapon|pistol|rifle)\b${NOT_WEAPON_THING}`),
  en(String.raw`\b${ABUSER}${ADV}\s+(?:made|forced) me (?:to )?(?:take|swallow)\s+(?:${PILL_AMOUNT}|all (?:of )?the|${MANY})\s+${PILLS}\b${NOT_HISTORY}`),
  en(String.raw`\b${ABUSER}(?:\s+has)?${ADV}\s+(?:tried|attempted) to (?:kill|choke|strangle|stab|shoot|drown|smother|suffocate) ${ME_US}\b${NOT_HISTORY}`),
  // "My son is trying to kill me", "he's trying to strangle me rn" — not "…with his drinking / with stress".
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|['’]re|\s+are|\s+keeps)?${ADV}\s+(?:trying|tries|try) to (?:(?:kill|choke|strangle|stab|shoot|drown|smother|suffocate) me|run me over|break (?:in|down the door))\b(?!\s+(?:with (?:his|her|their|the|all|this|worry|stress)(?:\s+\w+)?\s*(?:drinking|using|lies|stress|worry|attitude|behaviou?r|drama|nonsense|addiction)?|of (?:worry|stress)|lol)\b)`),
  // "He will kill me", "my son wants to kill me", "he's gonna kill me tonight" — never "he's going to kill me (when he finds out)".
  en(String.raw`\b${ABUSER}(?:\s+will|['’]ll|\s+wants? to)\s+kill ${ME_US}(?:\s+all)?${SENTENCE_END}|\b${ABUSER}(?:\s+will|['’]ll|\s+wants? to|\s+is going to|['’]s going to|\s+is gonna|['’]s gonna)\s+kill ${ME_US}(?:\s+all)?\s+(?:tonight|today|right now|this time)\b`),
  // Explicit threat framing only: "he said he's going to kill me" — never the bare
  // "he's going to kill me (when he finds out)".
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was|\s+keeps)?\s+(?:said|says|saying|told me|tells me|telling me|has said|screamed|screams|screaming|yelled|yells|yelling|texted|texts|texting)(?:(?: (?:at|to))? me)?(?: that)? (?:he|she|they)(?:['’]s| is| was| are|['’]re)? (?:going to|gonna) (?:kill|shoot|stab|strangle|hurt) ${ME_US}(?:\s+all)?\b(?![^.!?]{0,30}\b(?:if|when) (?:he|she|they) (?:finds? out|sees?|hears?|knows?))`),
  en(String.raw`\b${ABUSER}(?:['’]s|\s+is|\s+was|\s+keeps)?\s+(?:said|says|saying|told me|tells me|telling me|has said|screamed|screams|screaming|yelled|yells|yelling|texted|texts|texting)(?:(?: (?:at|to))? me)?(?: that)? (?:he|she|they)(?:['’]d|['’]ll| would| will) (?:kill|shoot|stab|strangle|hurt) ${ME_US}(?:\s+all)?\b(?![^.!?]{0,30}\b(?:if|when) (?:he|she|they) (?:finds? out|sees?|hears?|knows?))`),
  en(String.raw`\b(?:scared|afraid|terrified|worried|know|sure)(?: that)? ${ABUSER}(?:['’]ll| will| is going to| is gonna|['’]s going to|['’]s gonna) (?:kill|hurt|beat|hit|choke|strangle|stab|shoot) me\b(?!\s+with\b)(?![^.!?]{0,30}\b(?:if|when) (?:he|she|they) (?:finds? out|sees?|hears?|knows?))`),
  en(String.raw`\b${ABUSER} (?:grabbed|held|had|pinned) me by the (?:throat|neck)\b`),
  en(String.raw`\b${ABUSER}${ADV}\s+(?:pushed|shoved|threw|slammed|kicked|dragged) ${ME_US} (?:down (?:the )?stairs|into (?:a|the) wall|against (?:a|the) wall|to the (?:ground|floor)|on(?:to)? the (?:ground|floor))\b`),
  en(String.raw`\b${ABUSER} (?:put|wrapped|had) (?:his|her|their) hands? (?:around|on) my (?:neck|throat)\b`),
  // Never the baby kicking or the dog biting; never "una paliza jugando cartas".
  es(String.raw`(?<!(?:perr[oa]|perrit[oa]|gat[oa]|gatit[oa]|beb[ée]|bebit[oa]|mosquito|zancudo|bicho|caballo)\s+)(?:me|nos) (?:est[áa]n?|estaba|estaban) (?:pegando|golpeando|ahorcando|estrangulando|pateando|violando|mordiendo|cacheteando|abofeteando|agrediendo|jalando (?:el|del) (?:pelo|cabello)|dando (?:una )?(?:golpiza|paliza|cachetadas|patadas|golpes))(?![^.!?]{0,30}(?:jugando|juego|partido|cartas|ajedrez|domin[óo]|p[óo]ker|tenis|f[úu]tbol|videojuego|dormid[oa]|en (?:su|mi) sueño))`),
  // "Mi hijo me sigue pegando", "me empezó a pegar", "empezó a golpearme" — not "…me sigue pegando gritos".
  es(String.raw`(?:me|nos) (?:sigue|segu[íi]a|sigui[óo]) (?:pegando|golpeando|ahorcando|pateando|lastimando)${NOT_FIGURATIVE_ES_HIT}|(?:me|nos) (?:empez[óo]|comenz[óo]|empieza|comienza) a (?:pegar|golpear|ahorcar|patear|estrangular)${NOT_FIGURATIVE_ES_HIT}|(?:empez[óo]|comenz[óo]) a (?:pegarme|golpearme|ahorcarme|patearme|estrangularme|pegarnos|golpearnos)`),
  es(String.raw`me (?:est[áa] )?(?:siguiendo|persiguiendo|correteando) con (?:un|una|el|la|su) (?:cuchillo|navaja|pistola|arma|machete|bate)`),
  // Past-habitual: "mi esposo me pegaba" — but "tu papá me pegaba…", told to the child, is history.
  es(String.raw`(?!tu\s)${ABUSER_ES}${ADV_ES} me (?:pegaba|golpeaba|ahorcaba|pateaba)${NOT_FIGURATIVE_ES_HIT_BY}${NOT_HISTORY_ES}`),
  // Who after the verb: "me pegó mi esposo", "me golpeo mi hijo anoche", "me pegó fuerte mi esposo", "me pegó el papá de mis hijos".
  es(String.raw`me (?:peg[óo]|golpe[óo]|ahorc[óo]|pate[óo]|viol[óo]|lastim[óo]|empuj[óo]|quem[óo]|cort[óo]|atac[óo]|agredi[óo]|apu[ñn]al[óo]|dispar[óo]|abofete[óo]|estrangul[óo]|pegaron|golpearon)${BEFORE_WHO_ES}${NOT_FIGURATIVE_ES_HURT}(?!\s+a\s+\p{L}+r(?:le|les|me|te|lo|la|nos)?(?![\p{L}]))`),
  es(String.raw`(?<!(?:la|esa|esta) (?:noticia|vida|realidad|muerte|situaci[óo]n|p[ée]rdida)\s+)me (?:peg[óo]|golpe[óo]|pate[óo]) (?:(?:bien|muy|s[úu]per) )?(?:feo|fuerte|duro)${CLAUSE_END}`),
  es(String.raw`me (?:peg[óo]|golpe[óo]|pate[óo]|abofete[óo]) (?:en (?:el|la) (?:cara|cabeza|boca|est[óo]mago|panza|barriga|espalda|costillas|pecho|pierna|ojo)|con (?:el|un|una|su) (?:cintur[óo]n|pu[ñn]o|palo|botella|zapato|bate))`),
  es(String.raw`tiene (?:una|un) (?:pistola|arma|cuchillo|navaja)[^.!?]{0,30}(?:me amenaza|amenaz\p{L}*|matarme|me va a matar)`),
  // "Mi hijo tiene un cuchillo y no me deja salir" (either order) — a bare "tiene un arma" stays with the model.
  es(String.raw`tiene (?:una|un) (?:pistola|arma|cuchillo|navaja|escopeta|rifle)[^.!?]{0,40}no me (?:deja|quiere dejar|va a dejar) (?:salir|irme|ir)`),
  es(String.raw`no me (?:deja|quiere dejar|va a dejar) (?:salir|irme)[^.!?]{0,40}tiene (?:una|un) (?:pistola|arma|cuchillo|navaja|escopeta|rifle)`),
  es(String.raw`${ABUSER_ES}${ADV_ES} me (?:pega|golpea|maltrata|ahorca|patea|viola|empuja|muerde|cachetea|abofetea|agrede|abusa|peg[óo]|golpe[óo]|ahorc[óo]|pate[óo]|viol[óo]|empuj[óo]|mordi[óo]|cachete[óo]|abofete[óo]|agredi[óo]|forz[óo]|abus[óo]|ha pegado|ha golpeado|ha ahorcado|ha violado|ha empujado)${NOT_FIGURATIVE_ES_HIT_BY}${NOT_HISTORY_ES}(?!\s+a\s+\p{L}+r(?:le|les|me|te|lo|la|nos)?(?![\p{L}]))`),
  es(String.raw`${ABUSER_ES}${ADV_ES} me (?:hit|choked|punched|kicked|slapped|beat|raped|stabbed|is (?:hitting|choking|beating))(?![\p{L}])${NOT_FIGURATIVE_PAST}|${ABUSER_ES}${ADV_ES} me (?:da|daba|dio|est[áa] dando) (?:cachetadas|bofetadas|golpes|patadas|pu[ñn]etazos|palizas|golpizas)|me (?:oblig[óo]|forz[óo]) a tener (?:relaciones|sexo)|${ABUSER_ES}${ADV_ES} (?:abusa|abus[óo]|abusaba|ha abusado) de m[íi](?!\s+(?:confianza|bondad|paciencia|dinero|generosidad))|${ABUSER_ES}${ADV_ES} me va a (?:pegar|golpear|ahorcar)${NOT_FIGURATIVE_KILL_ES}|${ABUSER_ES}${ADV_ES} me (?:encerr[óo]|tiene encerrad[ao]) en (?:el|la|un|una|mi|su) (?:cuarto|ba[ñn]o|rec[áa]mara|habitaci[óo]n|casa|cl[óo]set|s[óo]tano|carro|coche)|${ABUSER_ES}${ADV_ES} me (?:amenaza|amenaz[óo]|est[áa] amenazando)${CLAUSE_END}|temo por mi vida|tengo miedo por mi vida`),
  // "Mi esposo me lastimó." — a whole clause; never "…con sus mentiras / lo que dijo".
  es(String.raw`${ABUSER_ES} me (?:lastim[óo]|ha lastimado)${CLAUSE_END}${NOT_FIGURATIVE_ES_HURT}`),
  // Subjectless only with a time, "again", or "when he drinks" — "me pegó anoche", "me pega cuando bebe".
  es(String.raw`me (?:peg[óo]|golpe[óo]|ahorc[óo]|pate[óo]|viol[óo]|lastim[óo]) (?:anoche|ayer|hoy|esta ma[ñn]ana|esta noche|otra vez|de nuevo)${NOT_FIGURATIVE_ES_HURT}`),
  es(String.raw`me (?:pega|golpea|ahorca) cuando (?:toma|bebe|est[áa] borracho|se emborracha|se droga)`),
  // "(Mi esposo) me volvió a pegar", "me acaba de pegar", "anoche me pegó", "me quiso ahorcar".
  es(String.raw`me (?:volvi[óo]|ha vuelto) a (?:pegar|golpear|ahorcar|patear|empujar)${NOT_FIGURATIVE_ES_HIT}(?!\s+a\s+\p{L}+r(?:le|les|me|te|lo|la|nos)?(?![\p{L}]))`),
  es(String.raw`me acaba de (?:pegar|golpear|ahorcar|patear|empujar)${NOT_FIGURATIVE_ES_HIT}`),
  es(String.raw`(?:anoche|ayer|hoy|esta ma[ñn]ana|esta noche|otra vez) me (?:peg[óo]|golpe[óo]|ahorc[óo]|pate[óo]|viol[óo]|lastim[óo])${NOT_FIGURATIVE_ES_HIT}${NOT_FIGURATIVE_ES_HURT}(?!\s+la confianza)`),
  es(String.raw`me (?:quiso|trat[óo] de|intent[óo]) (?:ahorcar|estrangular|ahogar|matar)(?!\s+(?:de|a)\s)`),
  // A whole sentence that is only "Me pegó." / "Me ahorcó." — the subject is someone else.
  new RegExp(String.raw`(?:^|[.!¡]\s*)me (?:peg[óo]|golpe[óo]|ahorc[óo]|estrangul[óo]|viol[óo]|pate[óo]|pegaron|golpearon|patearon|violaron|pega|golpea)\s*(?:[.!,;…]|$)`, 'iu'),
  // Explicit threats and attempts — every lead-in the self-harm "matarme" form excludes, except
  // the figurative "va a / iba a" ("esta angustia me va a matar"), which is left to the model.
  es(String.raw`(?:me (?:est[áa] )?)?amenaz(?:a|ó|o|aba|ando) con (?:matarme|matarnos|un cuchillo|una pistola|un arma|una navaja|hacerme da[ñn]o|lastimarme|golpearme|pegarme|apu[ñn]alarme|dispararme|ahorcarme)|me (?:est[áa] )?amenaz(?:a|ó|o|aba|ando) de muerte|me tienen? amenazad[ao] (?:de muerte|con (?:matarme|una pistola|un arma|un cuchillo|una navaja|su (?:pistola|arma|cuchillo)))`),
  es(String.raw`(?:intent[óo]|intenta|intentaba|intentando|trat[óo] de|trata de|trataba de|tratando de|quiso) (?:matarme|ahorcarme|estrangularme|ahogarme|apu[ñn]alarme)`),
  // "Mi hijo puede matarme", "tengo miedo de que mi esposo vaya a matarme", "mi esposo me quiere hacer daño".
  es(String.raw`${ABUSER_ES}(?:\s+(?:est[áa]|estaba))?\s+(?:puede|podr[íi]a|vaya a|quiere|intenta|intentando|trata de|tratando de) (?:matarme|ahorcarme|estrangularme|hacerme da[ñn]o|lastimarme|apu[ñn]alarme|dispararme)${NOT_FIGURATIVE_KILL_ES}`),
  es(String.raw`${ABUSER_ES} me (?:est[áa]|estaba) lastimando(?:\s+(?:ahorita|ahora|ahora mismo|f[íi]sicamente))?${CLAUSE_END}`),
  es(String.raw`me (?:lastim[óo]|hiri[óo])(?![\p{L}])[^.!?]{0,30}(?:sangr\p{L}*|hospital|moretones|emergencias|puntadas|hueso)|me quem[óo] con (?:un|una|el|la|su) (?:cigarro|cigarrillo|encendedor|plancha|agua|aceite|sart[ée]n|fierro)|me (?:rompi[óo]|fractur[óo]|quebr[óo]|disloc[óo]) (?:la nariz|el brazo|los brazos|las costillas|una costilla|la mand[íi]bula|la mu[ñn]eca|los dedos|un dedo|la mano|la pierna|los dientes|un diente|la cabeza)`),
  // Passive: "fui golpeada por mi esposo".
  es(String.raw`(?:fui|he sido|estoy siendo|fue) (?:golpead[ao]|agredid[ao]|violad[ao]|apu[ñn]alad[ao]|ahorcad[ao]|estrangulad[ao]|pateado|pateada|baleada|baleado) por ${ABUSER_ES}`),
  es(String.raw`${ABUSER_ES} (?:me |nos )?(?:quiere|quer[íi]a|intent[óo]|trat[óo] de|quiso) (?:matar|ahorcar|estrangular|ahogar|hacer da[ñn]o|lastimar)(?:me|nos)?${NOT_FIGURATIVE_KILL_ES}`),
  es(String.raw`(?:dijo|dice|me dijo|ha dicho|me dice) que (?:me )?(?:va|iba) a (?:matar(?:me)?|ahorcar(?:me)?)`),
  es(String.raw`miedo (?:de )?que (?:${ABUSER_ES}\s+)?me (?:mate|vaya a matar|pegue|golpee|haga da[ñn]o|lastime|ahorque)`),
  es(String.raw`${ABUSER_ES} me (?:empuj[óo]|tir[óo]|avent[óo]|lanz[óo]) (?:por las escaleras|escaleras abajo|contra la pared|al suelo|al piso)`),
  es(String.raw`me (?:agarr[óo]|apret[óo]|tom[óo]) (?:del|el) cuello|me (?:agarr[óo]|apret[óo]) la garganta`),
  // Blows: "me dio una cachetada / patada / un puñetazo / una golpiza" — never "una paliza jugando cartas", "un golpe de suerte".
  es(String.raw`(?<!(?:la vida|la noticia|la realidad|el destino)\s+)me (?:dio|dieron|peg[óo]|solt[óo]|meti[óo]|plant[óo]) (?:una (?:cachetada|bofetada|patada|trompada|golpiza|madriza|paliza|tunda|zarandeada|cachetada)|un (?:pu[ñn]etazo|golpe(?!\s+(?:de|bajo)(?![\p{L}]))|cachetazo|bofet[óo]n|cabezazo|rodillazo|codazo|empuj[óo]n|trancazo|madrazo|guantazo|manotazo|puntapi[ée]))(?![^.!?]{0,30}(?:jugando|juego|partido|cartas|ajedrez|domin[óo]|p[óo]ker|tenis|f[úu]tbol|carrera|examen|videojuego))`),
  es(String.raw`me agarr[óo] a (?:golpes|patadas|pu[ñn]etazos|cachetadas|trancazos|madrazos)`),
  // Weapons, with or without a subject: "me apuñaló", "me acuchilló", "mi esposo me disparó", "me cortó con un cuchillo".
  es(String.raw`me (?:apu[ñn]al[óo]|acuchill[óo]|dispar[óo]|bale[óo]|navaje[óo])(?!\s+(?:una|un|con (?:una|la|sus)) (?:pregunta|preguntas|mirada|indirecta))|me cort[óo] con (?:un|una|el|la|su) (?:cuchillo|navaja|vidrio|botella|machete)`),
  es(String.raw`me (?:puso|pone|coloc[óo]|apret[óo]) (?:un|una|el|la|su) (?:cuchillo|navaja|pistola|arma) (?:en|contra) (?:el|la|mi) (?:cuello|garganta|cabeza|sien|pecho)`),
  // Two steps: "llegó borracho y me pegó", "se enojó y me golpeó", "me agarró y me ahorcó" — not "…y me pegó un susto",
  // "…y me empujó a buscar ayuda".
  es(String.raw`y (?:luego |despu[ée]s )?me (?:peg[óo]|golpe[óo]|ahorc[óo]|pate[óo]|empuj[óo]|abofete[óo]|apu[ñn]al[óo]|acuchill[óo]|dispar[óo]|viol[óo]|estrangul[óo]|cachete[óo])${NOT_FIGURATIVE_ES_HIT}${NOT_HISTORY_ES}(?!\s+(?:la confianza|a\s+\p{L}+r(?:le|les|me|te|lo|la|nos)?(?![\p{L}])))`),
  es(String.raw`me (?:ahorc[óo]|estrangul[óo]|golpe[óo]|peg[óo]) hasta (?:que me desmay[ée]|desmayarme|dejarme inconsciente|sangrar|que sangr[ée])|me dej[óo] (?:un ojo morado|el ojo morado|moretones|moreteada|marcas|sangrando|inconsciente|la cara hinchada)`),
  es(String.raw`me (?:jal[óo]|agarr[óo]|arrastr[óo]|tir[óo]|estir[óo]) (?:del|de los|por el|por los|el|los) (?:pelo|cabello|cabellos|greñas|chongo)`),
  es(String.raw`(?<!(?:la|esa|esta) (?:noticia|vida|realidad|depresi[óo]n|tristeza)\s+)me (?:empuj[óo]|tir[óo]|avent[óo]|lanz[óo]) (?:por las escaleras|escaleras abajo|contra la pared|contra el piso|al suelo|al piso)`),
  // "No para de pegarme", "no deja de golpearme", "sigue pegándome".
  es(String.raw`(?:no (?:para|paraba|deja|dejaba) de|sigue|segu[íi]a) (?:peg[áa]rme|pegarme|golpearme|ahorcarme|patearme|empujarme|peg[áa]ndome|golpe[áa]ndome|pate[áa]ndome)${NOT_FIGURATIVE_ES_HIT}`),
  // "Me quiere matar", "tiene una pistola y me quiere matar" — never "…cuando / si se entera", "…de un susto".
  es(String.raw`me quiere matar${NOT_FIGURATIVE_KILL_ES}`),
  es(String.raw`(?<!(?:si|cuando)\s[^.!?,]{0,30})me va a matar (?:esta noche|hoy|ahora mismo|ahorita)(?![^.!?]{0,30}(?:si|cuando) se ente)`),
  es(String.raw`me (?:encerr[óo]|tiene encerrad[ao])[^.!?]{0,40}(?:pistola|arma|cuchillo|navaja)`),
  es(String.raw`me apunt[óo] con (?:una|un|su) (?:pistola|arma|cuchillo|navaja)`),
];

/** Upper bound on any text screened for a crisis — far above a 3-minute spoken turn. */
export const MAX_SCREEN_CHARS = 10_000;

export type CrisisKind = 'self_harm' | 'abuse';

/** Contractions typed without the apostrophe ("im", "hes", "dont") — English only; none is a Spanish word. */
const CONTRACTIONS: Record<string, string> = {
  im: "i'm", ive: "i've", hes: "he's", shes: "she's", theres: "there's", dont: "don't", wont: "won't", cant: "can't",
  isnt: "isn't", didnt: "didn't", doesnt: "doesn't", wasnt: "wasn't", arent: "aren't", couldnt: "couldn't",
  wouldnt: "wouldn't", shouldnt: "shouldn't", havent: "haven't", hasnt: "hasn't", youre: "you're", thats: "that's",
  imma: "i'm gonna", ima: "i'm gonna", hed: "he'd", theyd: "they'd",
};
const CONTRACTION_RE = new RegExp(String.raw`(?<![\p{L}\p{N}'’])(?:${Object.keys(CONTRACTIONS).join('|')})(?![\p{L}\p{N}'’])`, 'giu');
// "id" / "ill" are words too ("my ID", "I'm ill"), so they fold only before what would follow "I'd" / "I'll" here.
const ID_ILL_RE = /(?<![\p{L}\p{N}'’])(i)(d|ll)(?=\s+(?:just\s+)?(?:rather|be|never|kill|end|take|jump|overdose|od|hurt|cut|slit|use|do it)\b)/giu;
/** "kill my self" — but never "my self-esteem / self worth". */
const MY_SELF_RE = /(?<![\p{L}\p{N}'’])my\s+self(?![\p{L}\p{N}'’])(?![\s-]*(?:esteem|worth|confidence|respect|image|care|control|doubt|love|help|talk))/giu;
/** Slang for killing herself: "kms", "unalive myself", "off myself" — and "kiero" for "quiero", "want to morir". */
const SLANG: ReadonlyArray<[RegExp, string]> = [
  [/(?<![\p{L}\p{N}'’])(?<!\d\s*)kms(?![\p{L}\p{N}'’])/giu, 'kill myself'],
  [/(?<![\p{L}\p{N}'’])unalive(?![\p{L}\p{N}'’])/giu, 'kill'],
  [/(?<=\b(?:to|gonna|wanna|i['’]ll|i will|might|should|just)\s+)off\s+myself(?![\p{L}\p{N}'’])/giu, 'kill myself'],
  [/(?<![\p{L}])k(iero|ieres|iere|ieren|isiera)(?![\p{L}])/giu, 'qu$1'],
  [/(?<=\bwant(?:\s+to)?\s+)morir(?:me)?(?![\p{L}])/giu, 'die'],
  // "he got drunk n hit me", "& / +" for "and"; "jus" for "just"; "nite" for "night"; "quiero die".
  [/(?<=\p{L})\s+(?:n|&|\+)\s+(?=\p{L})/giu, ' and '],
  [/(?<![\p{L}'’])jus(?![\p{L}'’])/giu, 'just'],
  [/(?<![\p{L}'’])nite(?![\p{L}'’])/giu, 'night'],
  [/(?<=\bquiero\s+)die(?![\p{L}])/giu, 'morir'],
  // Dropped g: "hes hittin me", "my husbands beatin me", "hes chokin me".
  [/\b(hitt|chok|punch|kick|beat|slapp|smack|strangl|stabb|attack|hurt|push|shov|grabb|dragg|throw|kill|rap|threaten|chas|com|go|try|gett|bit|hold|point|swing|scream|yell|cutt|burn|tak|drink|us|say|plann)in\b/giu, '$1ing'],
  // The possessive-less "'s": "my sons hitting me", "my husbands been beating me", "my exs drunk and…" — never a
  // plural ("my sons are", "my daughters were", "my sons have").
  [/\b(son|husband|daughter|wife|partner|boyfriend|girlfriend|bf|gf|hubby|ex|dad|father|mom|mother|brother|sister|nephew|niece|grandson|granddaughter|stepson|stepdaughter|fianc[ée]e?)s(?=\s+(?:\p{L}+ing|been|drunk|high|wasted|got|gonna|going|trying|threatening|about)\b)/giu, "$1's"],
  // An age set off by commas or brackets: "my son (22) hit me", "my son, 25, punched me".
  [/(\p{L})\s*[,(]\s*\d{1,2}\s*(?:yo|y\/o|years? old|a[ñn]os)?\s*[,)]/gu, '$1'],
];
/** "i want 2 die". */
const TWO_TO_RE = /(?<=\b(?:want|wanna|going|need|ready|have))\s+(?:2|too)(?=\s+(?:die|live|kill|end|be dead|take|hurt|cut|jump|overdose|od)\b)/giu;
/** Emoticons: ":(", ":'(", ":-/", ";)", ":D", "</3" — each ends the sentence, like an emoji. */
const EMOTICON_RE = /(?<![\p{L}\p{N}])[:;=]['’]?-?(?:[()[\]\/\\|{}<>@*#$]+|[DPpOoSs3](?![\p{L}\p{N}]))|<\/?3+(?![\p{N}])/gu;
/** A run of emoji (with skin tones, joiners, variation selectors, and spaces between them). */
const EMOJI_RUN_RE = /[\p{So}\p{Sk}\p{Co}][\p{So}\p{Sk}\p{Co}\p{Cf}\p{Mn}\s]*/gu;
/** Asides end the clause: a spaced dash, an em/en dash, brackets, asterisks ("- he relapsed", "(seriously)", "*sigh*"). */
const ASIDE_RE = /\s-+\s|[–—]+|[()[\]{}*]+/g;
/** A sentence typed without its subject: "took all my pills", "just want to die", "feeling suicidal tonight" — never a question. */
const DROPPED_I_RE = /(^|[.!?…]\s*)(?=(?:just\s+)?(?:took|swallowed|want|wanna|feel|wish|can['’]t|cannot|don['’]t|overdosed|od['’]?d|cut|slit|got|was|been)\b(?![^.!?]*\?))/giu;
/** Who, bare, at the start of a sentence: "husband hit me", "bf hit me again", "esposo me pegó" (never a vocative "Son, …"). */
const BARE_WHO_RE = /(^|[.!?…]\s*|(?<!\b(?:mom|mommy|mama|dad|daddy|papa|son|honey|sweetheart|sweetie|baby|buddy|mijo|mija|hijo|hija)\s*),\s*)(?=(?:husband|hubby|bf|boyfriend|son|ex|dad|stepdad|stepson|fianc[ée]e?|girlfriend|gf|wife|partner|nephew|grandson)\s+\p{L})/giu;
const BARE_WHO_ES_RE = /(^|[.!?…,]\s*)(?=(?:esposo|marido|novio|hijo|hija|pareja|ex|yerno|sobrino|nieto)\s+(?:me|nos)(?![\p{L}]))/giu;
const DROPPED_IM_RE = /(^|[.!?…]\s*)(?=(?:just\s+|really\s+)?(?:feeling|thinking|going to|gonna|planning|about to|ready to)\b(?![^.!?]*\?))/giu;

/**
 * What the patterns see: contractions with their apostrophe; line breaks,
 * emoticons and emoji as the end of a sentence ("i want to die 😭 he relapsed
 * again"); asides as the end of a clause; other symbols as spaces; a dropped
 * "I" put back at the start of a sentence; whitespace collapsed.
 */
function screenText(text: string): string {
  let screened = text
    .normalize('NFC')
    .replace(CONTRACTION_RE, (word) => CONTRACTIONS[word.toLowerCase()] ?? word)
    .replace(ID_ILL_RE, (_m, i: string, rest: string) => `${i}'${rest}`)
    .replace(MY_SELF_RE, 'myself');
  for (const [re, to] of SLANG) screened = screened.replace(re, to);
  return screened
    .replace(TWO_TO_RE, ' to')
    .replace(EMOTICON_RE, ' . ')
    .replace(/[\r\n\u2028\u2029]+/g, ' . ')
    .replace(EMOJI_RUN_RE, ' . ')
    .replace(ASIDE_RE, ' , ')
    .replace(/[^\p{L}\p{N}\s.,!?;:'’\-…¡¿]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(BARE_WHO_RE, '$1my ')
    .replace(BARE_WHO_ES_RE, '$1mi ')
    .replace(DROPPED_I_RE, '$1i ')
    .replace(DROPPED_IM_RE, "$1i'm ");
}

/** Which crisis, if any, a member's own words disclose. Self-harm wins when both appear. */
export function crisisKind(text: string): CrisisKind | null {
  const bounded = screenText(text.slice(0, MAX_SCREEN_CHARS));
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
 * Self-harm only (violence she is suffering is rehearsal-moderation.ts's job). Intent or
 * instructions count; a bare "self-harm" depiction counts only with some
 * intent signal, so talking about a loved one's past overdose doesn't stop
 * the practice.
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
