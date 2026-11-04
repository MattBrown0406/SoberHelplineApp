import type { CurriculumPiece, CurriculumPhase, SituationBandInput } from '../api/types';

/**
 * Versioned family-curriculum content.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Today feed previously rotated focus content with `dayOfYear % 7`, so a
 * family on day 200 saw the same card they saw on day 60. Check-in habit is
 * the win of that design; progression was missing. This library adds an
 * *advancing* weekly teaching arc on top of the daily loop — the family moves
 * through a curriculum instead of looping a pool.
 *
 * SHAPE
 * -----
 * Two parallel libraries (English + Spanish) share ids, phases, week numbers,
 * and colors, exactly like `scripts.ts`. Selection keys off ids, so language
 * switching is seamless and no piece can drift between locales.
 *
 * Each piece carries:
 *  - mechanism: WHY this is happening. Named and normalized, never shamed.
 *  - practice:  one concrete thing to do this week. Small enough to actually do.
 *  - prompt:    one question worth sitting with. Not homework.
 *  - crisisSafe: whether this piece is appropriate to surface while the
 *    family's situation band is `elevated` or `crisis`. Teaching content that
 *    asks for reflection is wrong for someone whose week is on fire — those
 *    families get the support-forward subset only.
 *
 * PHASES
 * ------
 * Phase is derived from weeks-since-join, NOT from the loved one's level of
 * care. The family's arc runs on its own clock: a family whose son is still
 * using and a family whose son is 60 days into residential can both be in
 * week 3 of their own recovery, and they need the same thing in week 3.
 *
 *  orientation      w1–2   Stop the bleeding. You are not crazy, and not alone.
 *  stabilizing      w3–5   Boundaries as protection, not punishment.
 *  family_recovery  w6–8   The pivot: your recovery is not contingent on theirs.
 *  durability       w9+    What holds after month two: relapse, repair, the
 *                          rest of the family, money, hard days, your own life.
 *
 * COVERAGE
 * --------
 * Weeks 1–26 are authored. Past week 26, `selectCurriculumPiece` cycles
 * through the durability pieces (weeks 9–26) by week number, so a long-time
 * member keeps getting a different piece each week instead of the last one
 * forever. The crisis-safe guard still applies to the cycle.
 */

// ─── Phase model ──────────────────────────────────────────────────────────────

/** Inclusive week bounds per phase. `endWeek: null` = open-ended tail. */
export const PHASE_WEEKS: Record<CurriculumPhase, { startWeek: number; endWeek: number | null }> = {
  orientation: { startWeek: 1, endWeek: 2 },
  stabilizing: { startWeek: 3, endWeek: 5 },
  family_recovery: { startWeek: 6, endWeek: 8 },
  durability: { startWeek: 9, endWeek: null },
};

/** Display order — also the progression order. */
export const PHASE_ORDER: CurriculumPhase[] = [
  'orientation',
  'stabilizing',
  'family_recovery',
  'durability',
];

/** i18n keys (namespace `today`) for phase chrome. */
export const PHASE_LABEL_KEY: Record<CurriculumPhase, string> = {
  orientation: 'curriculum.phase.orientation',
  stabilizing: 'curriculum.phase.stabilizing',
  family_recovery: 'curriculum.phase.familyRecovery',
  durability: 'curriculum.phase.durability',
};

// ─── English library ──────────────────────────────────────────────────────────

export const CURRICULUM: CurriculumPiece[] = [
  // ── Phase 1 — Orientation (weeks 1–2) ──
  {
    id: 'cur-w01-not-crazy',
    week: 1,
    phase: 'orientation',
    tag: 'START HERE',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🧭',
    accentColor: '#e8eef6',
    title: "You're not crazy, and you're not imagining it",
    mechanism:
      "By the time a family reaches out, most have spent months being told — sometimes by the person using, sometimes by each other — that they're overreacting. So you've learned to second-guess what you can plainly see. That doubt isn't a character flaw. It's what happens when someone's survival depends on you not trusting your own eyes. Addiction protects itself, and the first thing it goes after is your certainty. If you've been keeping a mental list of things that didn't add up, that list is data, not paranoia.",
    practice:
      'Write down three specific things you have seen with your own eyes in the last month. Not conclusions — observations. "Forty dollars gone from my wallet on the 14th." "Slept until 3pm on a workday, twice." Keep the list where only you can find it.',
    prompt: "What have you stopped saying out loud because of how it went the last time you said it?",
    crisisSafe: true,
  },
  {
    id: 'cur-w02-not-your-fault',
    week: 2,
    phase: 'orientation',
    tag: 'START HERE',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🪨',
    accentColor: '#e8eef6',
    title: "The search for the thing you did wrong",
    mechanism:
      "Nearly every family runs the tape backward looking for the moment it turned — the divorce, the move, the surgery with the pills, the thing you said in 2019. That search feels like responsibility, but it's mostly a way to make something unbearable make sense. If you caused it, then you can fix it, and fixing it is more tolerable than sitting with something you cannot control. Here's the harder and better truth: you didn't cause it, you can't cure it, and you can still change the conditions around it. Those three facts fit together. Most families only ever hear the first two.",
    practice:
      "Say this out loud, once, alone: \"I didn't cause this, and there's still something for me to do.\" Notice which half of that sentence you resist. That's the half worth paying attention to.",
    prompt: 'If you knew for certain none of this was your fault, what would you stop doing this week?',
    crisisSafe: true,
  },

  // ── Phase 2 — Stabilizing (weeks 3–5) ──
  {
    id: 'cur-w03-protection-not-punishment',
    week: 3,
    phase: 'stabilizing',
    tag: 'BOUNDARIES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🛡️',
    accentColor: '#fdf3e3',
    title: 'A boundary is a wall around you, not a punishment for them',
    mechanism:
      "Most families set their first boundary as a consequence — a thing done TO the person, designed to produce a change in them. Those collapse, because when the person doesn't change, the boundary looks like it failed, so you drop it. A boundary that holds is built differently: it protects you and it's true whether or not they ever change. \"I don't give cash\" holds on their worst day and their best day. \"You can't come in when you're using\" protects your house. Neither one requires their cooperation, which is exactly why neither one can be argued with.",
    practice:
      'Take one boundary you have already tried and failed to hold. Rewrite it as a sentence about you, starting with "I." If it still needs them to do something for it to be true, it will break again. Rewrite it once more.',
    prompt: 'Which of your current limits would you have to abandon if they never got sober?',
    crisisSafe: true,
  },
  {
    id: 'cur-w04-help-vs-cushion',
    week: 4,
    phase: 'stabilizing',
    tag: 'BOUNDARIES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '⚖️',
    accentColor: '#fdf3e3',
    title: 'Help protects the person. Cushioning protects the addiction.',
    mechanism:
      "The word \"enabling\" has been used as an accusation for so long that it's nearly useless — it makes people defensive when they most need to be curious. Try a cleaner test instead: does this action protect the person, or does it protect the addiction from its own consequences? Groceries, a ride to a meeting, paying a treatment center directly — those protect the person. Paying the debt, calling their boss, smoothing over what happened at dinner — those absorb an impact that was supposed to land. The action can look identical from the outside. The difference is which one you're shielding. And notice: cushioning almost always comes from love. That's what makes it so hard to see and so hard to stop.",
    practice:
      'Pick the single thing you did last week that you already suspect was cushioning. Just name it to yourself, in one sentence, without arguing your case. Do not change it yet. Seeing it clearly comes first.',
    prompt: 'What would have happened last month if you had not stepped in? Be specific — the real answer, not the catastrophic one.',
    crisisSafe: true,
  },
  {
    id: 'cur-w05-consistency',
    week: 5,
    phase: 'stabilizing',
    tag: 'BOUNDARIES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🧱',
    accentColor: '#fdf3e3',
    title: 'One limit you keep beats ten you announce',
    mechanism:
      "Families in crisis tend to declare a lot of new rules at once, usually after a bad night. Then the week gets long, someone is exhausted, three of the ten quietly lapse — and the person using learns something specific: the limits are weather, not walls. Wait long enough and they pass. This is why consistency matters more than severity. A single small boundary that never moves teaches more than a dramatic one that moves under pressure. It's also why you should set fewer than you want to. Pick the one you can hold on a Tuesday when you're worn out and no one is watching.",
    practice:
      'Choose one limit and hold only that one for seven days. Write it down. If you catch yourself wanting to add a second, resist it — the goal this week is not coverage, it is a limit that proves it does not move.',
    prompt: 'Which of your boundaries would they tell you is negotiable? They usually know before you do.',
    crisisSafe: false,
  },

  // ── Phase 3 — Family recovery (weeks 6–8) ──
  {
    id: 'cur-w06-both-self-medicating',
    week: 6,
    phase: 'family_recovery',
    tag: 'YOUR RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🔄',
    accentColor: '#e9f2ec',
    title: "You've been self-medicating too",
    mechanism:
      "This one lands hard, and it isn't an accusation. They use a substance to manage what they can't tolerate feeling. You've been using control — the monitoring, the phone checks, the mental math about how much is left in the bottle, the constant low-grade scanning. Both are ways to not feel something unbearable. Both work in the short term. Both cost more over time than they return. That's why \"just let go\" never works as advice: you'd be asking someone to drop their coping strategy with nothing to replace it, which is precisely what we don't ask of the person in treatment either. Two people in one house, both medicating, neither one at fault, both in something they can step out of.",
    practice:
      'Notice one time this week when you reached for control the way someone else reaches for a drink — and let that moment pass without acting on it. Once. Not to prove anything. Just to find out that you can.',
    prompt: 'If the monitoring stopped tomorrow, what feeling would show up first?',
    crisisSafe: true,
  },
  {
    id: 'cur-w07-your-own-support',
    week: 7,
    phase: 'family_recovery',
    tag: 'YOUR RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🤝',
    accentColor: '#e9f2ec',
    title: 'They get a treatment team. Who do you get?',
    mechanism:
      "When someone goes to treatment they're handed a counselor, a group, a schedule, and a room full of people who understand. The family gets a visiting day. So the imbalance is structural, not personal — and it's why families so often come apart at exactly the moment things start going right. You've been running on adrenaline; adrenaline holds until the emergency ends, and then it stops holding. Your recovery is not a reward you collect after theirs is secure. Run them in parallel or you will be the one who breaks next.",
    practice:
      'Tell one person outside your household one true sentence about how you are actually doing. Not the update on your loved one — how *you* are. One person, one sentence, this week.',
    prompt: 'Who is the last person who asked how you were and actually waited for the answer?',
    crisisSafe: true,
  },
  {
    id: 'cur-w08-anxiety-when-improving',
    week: 8,
    phase: 'family_recovery',
    tag: 'YOUR RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🌤️',
    accentColor: '#e9f2ec',
    title: 'Why you feel worse when things start going better',
    mechanism:
      "Families expect relief when the person finally gets help. What often arrives instead is a spike in anxiety, and it blindsides them. The mechanism is straightforward: vigilance built over years doesn't stand down because someone got thirty days. Your nervous system learned that dropping your guard is when the disaster hits, so calm now reads as the moment before impact. On top of that, the crisis was doing something for you — it organized your days and told you what mattered. When it lifts, the grief and the exhaustion you postponed finally have room to land. Feeling worse right now is not a sign this is failing. It's frequently the first honest sign that it's working.",
    practice:
      "Say the scared thing out loud to one other adult — not to your loved one. \"I'm afraid this is temporary.\" It doesn't need a solution attached. It needs to stop being carried silently.",
    prompt: 'What are you specifically watching for? Naming it usually shrinks it.',
    crisisSafe: true,
  },

  // ── Phase 4 — Durability (weeks 9–26) ──
  {
    id: 'cur-w09-nothing-changing',
    week: 9,
    phase: 'durability',
    tag: 'STAYING STEADY',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '⛰️',
    accentColor: '#efeaf6',
    title: "When nothing changes, you're not doing it wrong",
    mechanism:
      "Somewhere around the second month, a lot of families hit a quiet kind of despair. You've held a limit, stopped cushioning, said less — and they're still using. So the mind does its math: if this were working, I'd see it by now. But what you've changed is the environment, and environments work slowly. Addiction has had years to learn that pressure passes and rescue comes. A new pattern takes time to become believable, and from the inside, becoming believable looks like nothing happening. The other thing that's changed is you: fewer fights, more sleep, less of your week spent waiting for the phone. That counts, even if it's the only thing that changed. Steady is not the same as stuck.",
    practice:
      "Write one sentence about what's different in your own week compared with two months ago. Not their week — yours. If you can't find anything, write down the one limit you've kept and how many days you've kept it.",
    prompt: 'What would you need to see this month to believe that what you are doing is working?',
    crisisSafe: true,
  },
  {
    id: 'cur-w10-sober-moments',
    week: 10,
    phase: 'durability',
    tag: 'REPAIR',
    tagBackgroundColor: '#e6f2f3',
    tagTextColor: '#24595e',
    icon: '💬',
    accentColor: '#e6f2f3',
    title: 'Talk to the sober moments, not the worst ones',
    mechanism:
      "Most families save their most important conversations for the worst moments, because that's when the problem feels undeniable. But someone who is high, hungover, or cornered can't hear anything except threat. The family approach with the strongest research behind it — it's called CRAFT — points the other way: notice the sober hours and make them warmer than the using ones. Not a speech about how nice it is when they're sober; that's still a speech. Just more of you when they're clear-headed: a meal, a drive, a laugh, a real question about their day. And less of you when they're not: you leave the room, end the call, go to bed. Without a word said about it, the difference teaches. Sober becomes the time when good things happen.",
    practice:
      "Catch one sober moment this week and add something good to it — a coffee, a compliment, ten minutes of your full attention. Don't mention the using. Let the good moment be good.",
    prompt: 'When were they last clear-headed around you, and what did that time get spent on?',
    crisisSafe: false,
  },
  {
    id: 'cur-w11-let-it-land',
    week: 11,
    phase: 'durability',
    tag: 'STAYING STEADY',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '🌧️',
    accentColor: '#efeaf6',
    title: 'Step out of the way and let it land',
    mechanism:
      "Every family has a list of things it quietly fixes: the late rent, the angry landlord, the towed car, the story told to Grandma about why they couldn't come. Each fix makes sense in the moment, because the consequence looks cruel and you can make it go away. But that consequence was the one thing in their life telling the truth about where this is going. When you absorb it, the message never arrives — not because they don't care, but because it never reached them. Letting it land isn't punishment, and it doesn't mean you stop caring. It means you stop standing between them and their own life. Safety is the exception: an overdose, violence, or danger to a child is never a consequence you let land. Everywhere else, you can stay warm while you step aside. \"That sounds hard. What are you going to do?\" is both.",
    practice:
      'The next time a problem caused by their use lands on your doorstep, say "That sounds hard. What are you going to do?" and then stop talking. Don\'t solve it in the first hour.',
    prompt: 'Which consequence do you most dread letting reach them, and what exactly do you picture happening if it does?',
    crisisSafe: false,
  },
  {
    id: 'cur-w12-after-blowup',
    week: 12,
    phase: 'durability',
    tag: 'REPAIR',
    tagBackgroundColor: '#e6f2f3',
    tagTextColor: '#24595e',
    icon: '🩹',
    accentColor: '#e6f2f3',
    title: 'The morning after a blowup',
    mechanism:
      "After a bad fight, two urges arrive together: the urge to fix it fast, and the urge to win it this time. Both reopen the negotiation. The fast fix usually comes with a softened boundary attached — you apologize for the yelling and somehow also for the limit. The second round usually goes worse than the first. Repair is narrower than either. You can own your part — the volume, the thing you said and didn't mean — without taking back the part you did mean. \"I'm sorry I yelled. I'm not changing what I said about money.\" Both sentences can be true in the same breath. Repair lowers the temperature. It doesn't need to settle anything, and it shouldn't try.",
    practice:
      'If there has been a blowup this week, write your repair in two sentences: one that owns your part, one that keeps your limit. Say it once, calmly, and then let the silence be.',
    prompt: 'In your last fight, which part do you regret, and which part do you still stand behind?',
    crisisSafe: true,
  },
  {
    id: 'cur-w13-relapse-information',
    week: 13,
    phase: 'durability',
    tag: 'WHEN THEY RELAPSE',
    tagBackgroundColor: '#fbecea',
    tagTextColor: '#9b3b2f',
    icon: '📍',
    accentColor: '#fbecea',
    title: 'A relapse is information, not a verdict',
    mechanism:
      "A relapse can feel like proof: proof that treatment failed, that you were naive to hope, that it's all starting over. It isn't any of those. Addiction behaves like other chronic illnesses — a return to use is common, especially early, and it tells you something about what wasn't strong enough yet: the aftercare, the living situation, the support around them, the stress they walked back into. Families who treat relapse as the end tend to do one of two things: give up or go back to rescuing. Families who treat it as information ask better questions. What happened right before? What level of care do they need now? What do we need to keep in place? You don't have to like what you're learning. You just have to keep learning from it.",
    practice:
      'Write down now, while things are calm, what your family will do in the first day after a relapse: who calls whom, and what you will not decide that day. A plan made calm beats one made scared.',
    prompt: 'If they relapsed tomorrow, what would you most want to have already decided?',
    crisisSafe: true,
  },
  {
    id: 'cur-w14-first-72-hours',
    week: 14,
    phase: 'durability',
    tag: 'WHEN THEY RELAPSE',
    tagBackgroundColor: '#fbecea',
    tagTextColor: '#9b3b2f',
    icon: '⏱️',
    accentColor: '#fbecea',
    title: 'The first 72 hours after a relapse',
    mechanism:
      "The first three days after a relapse are when families make the decisions they later regret: the room reopened, the car keys handed back, the money for one more fresh start. The fear is real, and it pushes you to do something big immediately. Slow down on everything except safety. After a stretch without using, tolerance drops, so going back to the old amount is when overdose risk is highest — especially with opioids. If opioids are anywhere in the picture, naloxone belongs in the house and everyone should know where it is. Beyond safety, almost nothing needs deciding today. Housing, money, and what happens next can be decided after you've talked with a professional and with each other — not in the doorway at midnight.",
    practice:
      "If opioids could be involved at all, find your naloxone or buy some (many pharmacies sell it over the counter) and tell one other person where it is. Then write down the one decision you won't make in the first 72 hours.",
    prompt: 'Which decision do you most often make in a panic and then spend weeks undoing?',
    crisisSafe: true,
  },
  {
    id: 'cur-w15-when-they-say-yes',
    week: 15,
    phase: 'durability',
    tag: 'TREATMENT',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🚪',
    accentColor: '#e8eef6',
    title: 'When they finally say yes',
    mechanism:
      "Willingness tends to show up at inconvenient moments — after a scare, in the middle of the night, the morning after a disaster — and it rarely lasts long. Families who have spent months hoping for a yes often aren't ready for one: no bed lined up, no insurance call made, no idea which level of care fits. By the time they find out, the window has closed and the person has talked themselves back out of it. You don't need to push for a yes to prepare for one. Knowing the next step ahead of time isn't pressure; it's respect for the moment when it comes. And once they're in, the family's job is simple and hard: back the program, keep your limits, and don't reopen the going-home conversation.",
    practice:
      "Write down the one next step you'd take if they said yes tonight: a phone number, a program, or a person who would help you find one. Put it where you could find it at 2 a.m.",
    prompt: 'If they said "Okay, I\'ll go" right now, what would you do in the next hour?',
    crisisSafe: true,
  },
  {
    id: 'cur-w16-trust-timeline',
    week: 16,
    phase: 'durability',
    tag: 'TREATMENT',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🏡',
    accentColor: '#e8eef6',
    title: 'Trust comes back on a timeline, not a promise',
    mechanism:
      "When someone comes home from treatment, everyone wants the hard part to be over. They want to be trusted again. You want to feel safe again. You're both tempted to skip to the end. But trust after addiction rebuilds the way it broke: slowly, through behavior repeated over time, not through one good conversation or a heartfelt apology. Early recovery is fragile, and the pressure to act normal — to stop asking, hand back the keys, pretend you're not watching — can become its own stress on both of you. It's okay to say, \"I'm glad you're home, and I'm going to need time.\" That isn't punishment. It's honest. Consistency earns trust back; promises only ask for it.",
    practice:
      "Name one specific piece of trust you'd like to give back — the car, a key, a bank card — and write down what you'd need to see, and for how long, before you do. Keep it to yourself for now.",
    prompt: 'What would you need to see for three months, not three days, to feel safe again?',
    crisisSafe: false,
  },
  {
    id: 'cur-w17-quiet-sibling',
    week: 17,
    phase: 'durability',
    tag: 'THE WHOLE FAMILY',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '👥',
    accentColor: '#fdf3e3',
    title: 'The sibling who stopped asking for anything',
    mechanism:
      "If the person using has brothers or sisters, there's often one who learned early that the best way to help was to need nothing. The easy one, the responsible one, the one who's fine. They're usually not fine. They've watched the family's attention, money, and worry flow in one direction for years, and they've decided — often without saying so — that their own problems don't qualify. Some are angry at their sibling. Some are angry at you and feel guilty about it. Many are quietly afraid of getting the same phone call you dread. None of this means you've failed them. It means the illness has been pulling everyone's attention, and they deserve some of it back, on purpose.",
    practice:
      'Spend one hour this week with another family member — a sibling, your other kids, your partner — where the person using does not come up. If it comes up, change the subject.',
    prompt: 'Who in your family has been fine for so long that no one checks anymore?',
    crisisSafe: false,
  },
  {
    id: 'cur-w18-kids-know',
    week: 18,
    phase: 'durability',
    tag: 'THE WHOLE FAMILY',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🧸',
    accentColor: '#fdf3e3',
    title: 'What the kids already know',
    mechanism:
      "Adults tend to believe that if they don't talk about it, the children in the house don't know. Children almost always know something. What they don't know is what it means — and in that gap they write their own explanation, which is usually worse than the truth and often has them in it. Kids don't need details. They need a few true sentences in words their age can hold: someone they love has an illness that changes how they act; it isn't the child's fault; the child can't fix it; and it's okay to talk about it. They also need one steady adult who keeps routines and promises the same even when the house isn't. Predictability protects them more than secrecy does.",
    practice:
      "If there are children in the house or the family, write the two or three sentences you'd say if they asked you about it tomorrow. Use words a child their age would use.",
    prompt: "What do you think the kids have already noticed that no one has explained?",
    crisisSafe: true,
  },
  {
    id: 'cur-w19-not-same-side',
    week: 19,
    phase: 'durability',
    tag: 'THE WHOLE FAMILY',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🔗',
    accentColor: '#fdf3e3',
    title: "When you and your partner aren't on the same side",
    mechanism:
      "Addiction is very good at finding the gap between two parents, two partners, or any two people who love the same person — and then living in it. One of you softens, the other gets tougher to make up for it, and the harder one pushes, the softer the other gets. Before long you're fighting each other more than the problem, and the person using knows exactly which of you to call for what. Neither of you is the problem. Each of you is protecting the person you love in the way that makes sense to you. But a family that sends two messages has sent none. You don't have to agree on everything. You have to agree on a few things and say them the same way, out loud, together.",
    practice:
      "Sit down with the other adult this week and agree on one thing you'll both say no to. Just one. Write it down in the same words for both of you.",
    prompt: 'Which of you do they call when they want a yes, and which when they want a no?',
    crisisSafe: false,
  },
  {
    id: 'cur-w20-money-first-to-break',
    week: 20,
    phase: 'durability',
    tag: 'STAYING STEADY',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '💵',
    accentColor: '#efeaf6',
    title: 'Money is the first boundary to break',
    mechanism:
      "Money is where most limits quietly give way, because there's always a reason this time is different: it's for rent, for the phone, for gas to get to the interview. Each request sounds like help, and some of them would be. The trouble is that money moves. Twenty dollars for food frees up twenty dollars for something else. That's why the cleaner rule is about the form help takes, not the reason given: pay the provider, buy the groceries, pay the phone bill directly, and keep cash out of it. The same thinking applies to the bigger money — the car title, the joint account, what your will says. If you're worried about leaving money to someone in active addiction, an estate attorney can explain options, like a trust, that protect the money from the addiction.",
    practice:
      'Go through the last month of money that went their way — cash, transfers, bills you covered. Mark each one: paid directly, or handed over. Don\'t change anything yet; just see the split.',
    prompt: 'Which request is the hardest for you to turn down, and why that one?',
    crisisSafe: false,
  },
  {
    id: 'cur-w21-hard-days',
    week: 21,
    phase: 'durability',
    tag: 'STAYING STEADY',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '🕯️',
    accentColor: '#efeaf6',
    title: 'The days on the calendar that hit hardest',
    mechanism:
      "Families often get blindsided by certain days: holidays, birthdays, the anniversary of the arrest or the overdose or the night everything came out. Those days carry the weight of every other year — what it used to be like, what it was supposed to be like, what happened last time. Expecting them to feel normal sets you up to be ambushed. It's better to know they're coming and plan them on purpose: who's coming, on what terms, how long you'll stay, who you'll call if it goes wrong, and one part of the day that's just for you. It's also okay to let a hard day be hard. You don't have to manufacture joy. You just don't have to walk into it unprepared.",
    practice:
      "Look at the next two months and circle the one day you're quietly dreading. Write down one decision about it now: who's there, how long you'll stay, or how you'll leave.",
    prompt: 'Which day on the calendar does your body remember before your mind does?',
    crisisSafe: true,
  },
  {
    id: 'cur-w22-grieving-still-here',
    week: 22,
    phase: 'durability',
    tag: 'YOUR RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🍂',
    accentColor: '#e9f2ec',
    title: 'Grieving someone who is still here',
    mechanism:
      "There's a grief that comes with addiction that people rarely name. The person you love is alive, maybe sitting across the table, and you still miss them — the version of them from before, and the future you pictured for them and for your family. Because nobody died, there's no funeral, no casseroles, no permission to mourn. So the grief comes out sideways: as exhaustion, irritability, crying in the car. It has a name — ambiguous loss — and it's normal. Grieving who they were doesn't mean you've given up on who they can still become. You can hold both. Letting yourself grieve often makes it easier to meet the person actually in front of you, instead of the one you keep comparing them to.",
    practice:
      'Write down one thing you miss about who they were and one thing you still love about who they are. Say both out loud to someone you trust, or just to yourself.',
    prompt: "What did you picture for them that you haven't let yourself say you've lost?",
    crisisSafe: true,
  },
  {
    id: 'cur-w23-other-things',
    week: 23,
    phase: 'durability',
    tag: 'YOUR RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🌱',
    accentColor: '#e9f2ec',
    title: 'Your life is allowed to have other things in it',
    mechanism:
      "After months in crisis mode, a lot of families realize their whole life has shrunk to the size of one person's addiction. Friends stopped calling because you kept canceling. The things you used to love feel frivolous, even disloyal — how can you go to dinner when they might be in danger? But your joy is not a betrayal, and your suffering doesn't protect them. A life with room for other things makes you steadier, harder to move with guilt, and better company when they do reach for help. It also shows them, without a single lecture, what a life worth getting sober for can look like. Getting your life back doesn't happen all at once. It happens one ordinary thing at a time.",
    practice:
      'Put one thing on your calendar this week that is just for you — lunch with a friend, a class, a walk you used to take — and keep it, even if the week gets hard.',
    prompt: 'What did you used to love doing that you quietly stopped?',
    crisisSafe: true,
  },
  {
    id: 'cur-w24-crisis-returns',
    week: 24,
    phase: 'durability',
    tag: 'WHEN THEY RELAPSE',
    tagBackgroundColor: '#fbecea',
    tagTextColor: '#9b3b2f',
    icon: '🌊',
    accentColor: '#fbecea',
    title: 'When the crisis comes back',
    mechanism:
      "Sometimes the bad stretch returns after months of calm, and every old reflex comes with it: the scanning, the late-night phone checks, the urge to fix it by morning. It can feel like you're back at the very beginning. You're not. You know things now that you didn't in the first weeks: what cushioning looks like, which limits you can actually hold, who you can call, that you can survive a hard night. The crisis may look the same, but you're not the same person meeting it. The work now is to use what you've built instead of reverting to panic. Go back to the basics: safety first, one decision at a time, one limit that doesn't move, and someone else in your corner.",
    practice:
      "Write a short list of what you know now that you didn't know when this started. Keep it where you'll see it on a bad night.",
    prompt: 'What is one thing you would tell yourself from the first week, if you could?',
    crisisSafe: true,
  },
  {
    id: 'cur-w25-body-on-duty',
    week: 25,
    phase: 'durability',
    tag: 'YOUR RECOVERY',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🛌',
    accentColor: '#e9f2ec',
    title: 'Your body has been on duty for months',
    mechanism:
      "Living with someone else's addiction is a form of chronic stress, and the body keeps its own record: broken sleep, headaches, a stomach that's always tight, meals skipped or eaten standing up, a cold that never quite leaves. Many family members put off their own doctor's appointments for years because there's always a more urgent crisis. But a nervous system that never gets to stand down eventually stops working well for you. Rest isn't a reward for when things are better. It's what makes it possible to keep going while they aren't. You don't need a wellness overhaul. You need one physical thing that tells your body the emergency doesn't own every hour.",
    practice:
      "Pick one: a set bedtime five nights this week, one real meal a day sitting down, or booking the doctor's appointment you've been putting off. Just one.",
    prompt: 'When did you last sleep through the night without checking your phone?',
    crisisSafe: true,
  },
  {
    id: 'cur-w26-long-haul',
    week: 26,
    phase: 'durability',
    tag: 'STAYING STEADY',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '🌄',
    accentColor: '#efeaf6',
    title: 'This is a long illness. Pace yourself like it.',
    mechanism:
      "Families often run the first months like a sprint, as if enough effort and urgency could end this by a certain date. But addiction is usually a long illness, with stretches of progress, setbacks, and plateaus where it's hard to tell which one you're in. A pace you can only keep up in an emergency will run out before the illness does. Durability is a different skill from urgency. It looks like fewer, steadier limits; support you keep even in the good months; a life that doesn't stop every time their situation changes; and patience with yourself when you slip back into old habits, because you will. However long you've been at this, you're not at the end of anything. You're someone who is learning how to stay.",
    practice:
      "Look back at where you were when this started and write down three things that are different now — in you, not them. Then pick the one support you'll keep even when things are good.",
    prompt: 'What would it look like to go at a pace you could keep for a year?',
    crisisSafe: true,
  },
];

// ─── Spanish library ──────────────────────────────────────────────────────────
// Same ids, weeks, phases, and colors. Selection keys off ids only.

export const CURRICULUM_ES: CurriculumPiece[] = [
  {
    id: 'cur-w01-not-crazy',
    week: 1,
    phase: 'orientation',
    tag: 'EMPIEZA AQUÍ',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🧭',
    accentColor: '#e8eef6',
    title: 'No estás loca, y no te lo estás imaginando',
    mechanism:
      'Cuando una familia por fin pide ayuda, casi siempre lleva meses escuchando —a veces de la persona que consume, a veces entre ustedes mismos— que está exagerando. Así que aprendiste a dudar de lo que ves con claridad. Esa duda no es un defecto tuyo. Es lo que pasa cuando la supervivencia de alguien depende de que no confíes en tus propios ojos. La adicción se protege, y lo primero que ataca es tu certeza. Si has llevado una lista mental de cosas que no cuadraban, esa lista es información, no paranoia.',
    practice:
      'Escribe tres cosas concretas que hayas visto con tus propios ojos en el último mes. No conclusiones: observaciones. "Faltaban cuarenta dólares de mi cartera el día 14." "Durmió hasta las 3 de la tarde en día laboral, dos veces." Guarda la lista donde solo tú puedas encontrarla.',
    prompt: '¿Qué dejaste de decir en voz alta por cómo terminó la última vez que lo dijiste?',
    crisisSafe: true,
  },
  {
    id: 'cur-w02-not-your-fault',
    week: 2,
    phase: 'orientation',
    tag: 'EMPIEZA AQUÍ',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🪨',
    accentColor: '#e8eef6',
    title: 'La búsqueda de lo que hiciste mal',
    mechanism:
      'Casi toda familia rebobina la cinta buscando el momento en que todo cambió: el divorcio, la mudanza, la cirugía con las pastillas, algo que dijiste en 2019. Esa búsqueda se siente como responsabilidad, pero sobre todo es una manera de darle sentido a algo insoportable. Si tú lo causaste, entonces puedes arreglarlo, y arreglarlo es más tolerable que aceptar algo que no controlas. La verdad más difícil y más útil es esta: no lo causaste, no puedes curarlo, y aun así puedes cambiar las condiciones a su alrededor. Las tres cosas son compatibles. A la mayoría de las familias solo les dicen las dos primeras.',
    practice:
      'Di esto en voz alta, una vez, a solas: "No causé esto, y todavía hay algo que me toca hacer." Fíjate cuál mitad de la frase rechazas. Esa es la mitad que vale la pena mirar.',
    prompt: 'Si supieras con certeza que nada de esto es culpa tuya, ¿qué dejarías de hacer esta semana?',
    crisisSafe: true,
  },
  {
    id: 'cur-w03-protection-not-punishment',
    week: 3,
    phase: 'stabilizing',
    tag: 'LÍMITES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🛡️',
    accentColor: '#fdf3e3',
    title: 'Un límite es un muro alrededor de ti, no un castigo para ellos',
    mechanism:
      'Casi todas las familias ponen su primer límite como consecuencia: algo que se le hace A la persona para provocar un cambio en ella. Esos límites se derrumban, porque cuando la persona no cambia, el límite parece haber fallado y entonces lo abandonas. Un límite que se sostiene está construido de otra forma: te protege a ti y es verdad aunque la otra persona nunca cambie. "No doy dinero en efectivo" se sostiene en su peor día y en su mejor día. "No puedes entrar si estás consumiendo" protege tu casa. Ninguno de los dos requiere su cooperación, y por eso mismo ninguno se puede discutir.',
    practice:
      'Toma un límite que ya intentaste sostener y no pudiste. Reescríbelo como una frase sobre ti, empezando con "Yo". Si todavía necesita que ellos hagan algo para ser verdad, se va a volver a romper. Reescríbelo otra vez.',
    prompt: '¿Cuál de tus límites actuales tendrías que abandonar si esa persona nunca lograra la sobriedad?',
    crisisSafe: true,
  },
  {
    id: 'cur-w04-help-vs-cushion',
    week: 4,
    phase: 'stabilizing',
    tag: 'LÍMITES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '⚖️',
    accentColor: '#fdf3e3',
    title: 'Ayudar protege a la persona. Amortiguar protege a la adicción.',
    mechanism:
      'La palabra "facilitar" se ha usado como acusación durante tanto tiempo que ya casi no sirve: pone a la gente a la defensiva justo cuando más necesita tener curiosidad. Prueba una pregunta más limpia: ¿esta acción protege a la persona, o protege a la adicción de sus propias consecuencias? Comida, llevarla a una reunión, pagarle directamente al centro de tratamiento: eso protege a la persona. Pagar la deuda, llamar a su jefe, disimular lo que pasó en la cena: eso absorbe un golpe que debía aterrizar. Por fuera la acción puede verse idéntica. La diferencia es a quién estás protegiendo. Y ojo: amortiguar casi siempre nace del amor. Por eso cuesta tanto verlo y cuesta tanto dejarlo.',
    practice:
      'Elige la única cosa que hiciste la semana pasada que ya sospechas que fue amortiguar. Solo nómbrala para ti, en una frase, sin defenderte. No la cambies todavía. Primero hay que verla con claridad.',
    prompt: '¿Qué habría pasado el mes pasado si no hubieras intervenido? Sé específica: la respuesta real, no la catastrófica.',
    crisisSafe: true,
  },
  {
    id: 'cur-w05-consistency',
    week: 5,
    phase: 'stabilizing',
    tag: 'LÍMITES',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🧱',
    accentColor: '#fdf3e3',
    title: 'Un límite que cumples vale más que diez que anuncias',
    mechanism:
      'Las familias en crisis suelen declarar muchas reglas nuevas de golpe, casi siempre después de una mala noche. Después la semana se hace larga, alguien está agotado, tres de las diez se caen en silencio, y la persona que consume aprende algo muy concreto: los límites son clima, no muros. Si espera lo suficiente, pasan. Por eso la constancia importa más que la severidad. Un límite pequeño que nunca se mueve enseña más que uno dramático que cede bajo presión. Y por eso conviene poner menos de los que quisieras. Elige el que puedas sostener un martes, cansada, cuando nadie te está mirando.',
    practice:
      'Elige un solo límite y sostén únicamente ese durante siete días. Escríbelo. Si te descubres queriendo agregar un segundo, resístelo: la meta de esta semana no es cubrir todo, es un límite que demuestre que no se mueve.',
    prompt: '¿Cuál de tus límites te diría esa persona que es negociable? Casi siempre lo saben antes que tú.',
    crisisSafe: false,
  },
  {
    id: 'cur-w06-both-self-medicating',
    week: 6,
    phase: 'family_recovery',
    tag: 'TU RECUPERACIÓN',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🔄',
    accentColor: '#e9f2ec',
    title: 'Tú también te has estado automedicando',
    mechanism:
      'Esta cuesta escucharla, y no es una acusación. La otra persona usa una sustancia para manejar lo que no tolera sentir. Tú has usado el control: la vigilancia, revisar el teléfono, calcular mentalmente cuánto queda en la botella, ese escaneo constante de fondo. Las dos cosas sirven para no sentir algo insoportable. Las dos funcionan a corto plazo. Las dos cuestan con el tiempo más de lo que devuelven. Por eso "suéltalo" nunca funciona como consejo: le estarías pidiendo a alguien que abandone su estrategia para sobrevivir sin nada que la reemplace, que es justo lo que tampoco le pedimos a quien está en tratamiento. Dos personas en una casa, ambas automedicándose, ninguna culpable, ambas en algo de lo que se puede salir.',
    practice:
      'Nota una vez esta semana en que buscaste el control como otra persona busca un trago, y deja pasar ese momento sin actuar. Una vez. No para demostrar nada. Solo para descubrir que puedes.',
    prompt: 'Si la vigilancia se detuviera mañana, ¿qué sentimiento aparecería primero?',
    crisisSafe: true,
  },
  {
    id: 'cur-w07-your-own-support',
    week: 7,
    phase: 'family_recovery',
    tag: 'TU RECUPERACIÓN',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🤝',
    accentColor: '#e9f2ec',
    title: 'Ellos reciben un equipo de tratamiento. ¿Quién te toca a ti?',
    mechanism:
      'Cuando alguien entra a tratamiento le asignan un consejero, un grupo, un horario y una sala llena de gente que entiende. A la familia le dan un día de visita. El desequilibrio es estructural, no personal, y explica por qué tantas familias se quiebran justo cuando las cosas empiezan a ir bien. Has estado funcionando con adrenalina; la adrenalina aguanta hasta que termina la emergencia, y entonces deja de aguantar. Tu recuperación no es un premio que recoges cuando la de ellos ya esté asegurada. Va en paralelo, o la próxima en romperse vas a ser tú.',
    practice:
      'Dile a una persona fuera de tu casa una frase verdadera sobre cómo estás realmente. No el reporte sobre tu ser querido: cómo estás *tú*. Una persona, una frase, esta semana.',
    prompt: '¿Quién fue la última persona que te preguntó cómo estabas y de verdad esperó la respuesta?',
    crisisSafe: true,
  },
  {
    id: 'cur-w08-anxiety-when-improving',
    week: 8,
    phase: 'family_recovery',
    tag: 'TU RECUPERACIÓN',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🌤️',
    accentColor: '#e9f2ec',
    title: 'Por qué te sientes peor cuando las cosas empiezan a mejorar',
    mechanism:
      'Las familias esperan alivio cuando la persona finalmente recibe ayuda. Lo que suele llegar es un aumento de la ansiedad, y las toma por sorpresa. El mecanismo es sencillo: una vigilancia construida durante años no se desactiva porque alguien cumpla treinta días. Tu sistema nervioso aprendió que bajar la guardia es justo cuando golpea el desastre, así que ahora la calma se lee como el momento antes del impacto. Además, la crisis cumplía una función: organizaba tus días y te decía qué importaba. Cuando se levanta, el duelo y el agotamiento que postergaste por fin tienen espacio para aterrizar. Sentirte peor ahora no es señal de que esto está fracasando. Muchas veces es la primera señal honesta de que está funcionando.',
    practice:
      'Di el miedo en voz alta a otro adulto, no a tu ser querido. "Tengo miedo de que esto sea temporal." No necesita solución. Necesita dejar de cargarse en silencio.',
    prompt: '¿Qué estás vigilando exactamente? Nombrarlo casi siempre lo encoge.',
    crisisSafe: true,
  },
  {
    id: 'cur-w09-nothing-changing',
    week: 9,
    phase: 'durability',
    tag: 'MANTENERTE FIRME',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '⛰️',
    accentColor: '#efeaf6',
    title: 'Cuando nada cambia, no lo estás haciendo mal',
    mechanism:
      'Alrededor del segundo mes, muchas familias llegan a una desesperanza silenciosa. Sostuviste un límite, dejaste de amortiguar, hablaste menos, y tu ser querido sigue consumiendo. Entonces la mente saca cuentas: si esto funcionara, ya lo vería. Pero lo que cambiaste es el entorno, y los entornos actúan despacio. La adicción tuvo años para aprender que la presión pasa y que el rescate llega. Un patrón nuevo tarda en volverse creíble, y desde adentro, volverse creíble se parece a que no está pasando nada. Lo otro que cambió eres tú: menos peleas, más sueño, menos horas de tu semana esperando que suene el teléfono. Eso cuenta, aunque sea lo único que cambió. Estar firme no es lo mismo que estar estancada.',
    practice:
      'Escribe una frase sobre qué es distinto en tu propia semana comparada con hace dos meses. No la semana de esa persona: la tuya. Si no encuentras nada, escribe el único límite que has sostenido y cuántos días llevas sosteniéndolo.',
    prompt: '¿Qué tendrías que ver este mes para creer que lo que estás haciendo sí funciona?',
    crisisSafe: true,
  },
  {
    id: 'cur-w10-sober-moments',
    week: 10,
    phase: 'durability',
    tag: 'REPARAR',
    tagBackgroundColor: '#e6f2f3',
    tagTextColor: '#24595e',
    icon: '💬',
    accentColor: '#e6f2f3',
    title: 'Habla en los momentos sobrios, no en los peores',
    mechanism:
      'Casi todas las familias guardan sus conversaciones más importantes para los peores momentos, porque es cuando el problema parece innegable. Pero alguien que está drogado, con resaca o acorralado no puede escuchar nada que no suene a amenaza. El enfoque familiar con más investigación detrás (se llama CRAFT) apunta al revés: fíjate en las horas sobrias y hazlas más cálidas que las de consumo. No un discurso sobre lo bien que se siente cuando no consume: eso sigue siendo un discurso. Simplemente más de ti cuando tiene la mente clara: una comida, un paseo en auto, una risa, una pregunta de verdad sobre su día. Y menos de ti cuando no: sales de la habitación, terminas la llamada, te vas a dormir. Sin decir una palabra, la diferencia enseña. Lo sobrio se vuelve el tiempo en que pasan cosas buenas.',
    practice:
      'Atrapa un momento sobrio esta semana y agrégale algo bueno: un café, un cumplido, diez minutos de tu atención completa. No menciones el consumo. Deja que el momento bueno sea bueno.',
    prompt: '¿Cuándo fue la última vez que estuvo con la mente clara cerca de ti, y en qué se fue ese tiempo?',
    crisisSafe: false,
  },
  {
    id: 'cur-w11-let-it-land',
    week: 11,
    phase: 'durability',
    tag: 'MANTENERTE FIRME',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '🌧️',
    accentColor: '#efeaf6',
    title: 'Hazte a un lado y deja que la consecuencia llegue',
    mechanism:
      'Cada familia tiene una lista de cosas que arregla en silencio: la renta atrasada, el casero enojado, el auto que se llevó la grúa, la historia que le contaron a la abuela sobre por qué no pudo venir. Cada arreglo tiene sentido en el momento, porque la consecuencia se ve cruel y tú puedes hacerla desaparecer. Pero esa consecuencia era lo único en su vida que decía la verdad sobre hacia dónde va esto. Cuando tú la absorbes, el mensaje nunca llega: no porque no le importe, sino porque nunca le alcanzó. Dejar que llegue no es castigo, ni significa que dejes de querer. Significa que dejas de pararte entre esa persona y su propia vida. La seguridad es la excepción: una sobredosis, la violencia o el peligro para un niño nunca son consecuencias que se dejan llegar. En todo lo demás, puedes seguir siendo cálida mientras te haces a un lado. "Suena difícil. ¿Qué vas a hacer?" es las dos cosas.',
    practice:
      'La próxima vez que un problema causado por su consumo llegue a tu puerta, di "Suena difícil. ¿Qué vas a hacer?" y luego deja de hablar. No lo resuelvas en la primera hora.',
    prompt: '¿Qué consecuencia te da más miedo dejar que le llegue, y qué te imaginas exactamente que pasaría si llega?',
    crisisSafe: false,
  },
  {
    id: 'cur-w12-after-blowup',
    week: 12,
    phase: 'durability',
    tag: 'REPARAR',
    tagBackgroundColor: '#e6f2f3',
    tagTextColor: '#24595e',
    icon: '🩹',
    accentColor: '#e6f2f3',
    title: 'La mañana después de una gran pelea',
    mechanism:
      'Después de una mala pelea llegan dos impulsos juntos: arreglarlo rápido, y ganarla esta vez. Los dos reabren la negociación. El arreglo rápido casi siempre trae un límite ablandado: pides perdón por los gritos y, de alguna forma, también por el límite. La segunda ronda casi siempre sale peor que la primera. Reparar es más estrecho que cualquiera de las dos cosas. Puedes hacerte cargo de tu parte (el volumen, lo que dijiste sin sentirlo) sin retirar lo que sí sentías. "Perdón por gritar. No voy a cambiar lo que dije sobre el dinero." Las dos frases pueden ser verdad en el mismo aliento. Reparar baja la temperatura. No necesita resolver nada, y no debería intentarlo.',
    practice:
      'Si hubo una pelea esta semana, escribe tu reparación en dos frases: una que reconozca tu parte y otra que mantenga tu límite. Dila una vez, con calma, y deja que el silencio haga lo suyo.',
    prompt: 'En tu última pelea, ¿de qué parte te arrepientes y qué parte todavía sostienes?',
    crisisSafe: true,
  },
  {
    id: 'cur-w13-relapse-information',
    week: 13,
    phase: 'durability',
    tag: 'SI HAY RECAÍDA',
    tagBackgroundColor: '#fbecea',
    tagTextColor: '#9b3b2f',
    icon: '📍',
    accentColor: '#fbecea',
    title: 'Una recaída es información, no un veredicto',
    mechanism:
      'Una recaída puede sentirse como una prueba: prueba de que el tratamiento falló, de que fuiste ingenua al tener esperanza, de que todo vuelve a empezar. No es nada de eso. La adicción se comporta como otras enfermedades crónicas: volver a consumir es común, sobre todo al principio, y dice algo sobre lo que todavía no era lo bastante fuerte: el seguimiento después del tratamiento, el lugar donde vive, el apoyo a su alrededor, el estrés al que regresó. Las familias que tratan la recaída como el final suelen hacer una de dos cosas: rendirse o volver a rescatar. Las que la tratan como información hacen mejores preguntas. ¿Qué pasó justo antes? ¿Qué nivel de atención necesita ahora? ¿Qué tenemos que mantener en pie? No tiene que gustarte lo que estás aprendiendo. Solo tienes que seguir aprendiendo de ello.',
    practice:
      'Escribe ahora, mientras hay calma, qué hará tu familia el primer día después de una recaída: quién llama a quién y qué no van a decidir ese día. Un plan hecho con calma vale más que uno hecho con miedo.',
    prompt: 'Si mañana recayera, ¿qué te gustaría tener ya decidido?',
    crisisSafe: true,
  },
  {
    id: 'cur-w14-first-72-hours',
    week: 14,
    phase: 'durability',
    tag: 'SI HAY RECAÍDA',
    tagBackgroundColor: '#fbecea',
    tagTextColor: '#9b3b2f',
    icon: '⏱️',
    accentColor: '#fbecea',
    title: 'Las primeras 72 horas después de una recaída',
    mechanism:
      'Los primeros tres días después de una recaída son cuando las familias toman las decisiones de las que luego se arrepienten: el cuarto que se vuelve a abrir, las llaves del auto devueltas, el dinero para un nuevo comienzo más. El miedo es real y empuja a hacer algo grande de inmediato. Ve despacio en todo, menos en la seguridad. Después de un tiempo sin consumir, la tolerancia baja, así que volver a la cantidad de antes es cuando el riesgo de sobredosis es más alto, sobre todo con opioides. Si los opioides están en el panorama, la naloxona debe estar en casa y todos deben saber dónde está. Fuera de la seguridad, casi nada necesita decidirse hoy. La vivienda, el dinero y lo que sigue se pueden decidir después de hablar con un profesional y entre ustedes, no en la puerta a medianoche.',
    practice:
      'Si los opioides pueden estar involucrados, busca tu naloxona o compra una (muchas farmacias la venden sin receta) y dile a otra persona dónde está. Luego escribe la única decisión que no vas a tomar en las primeras 72 horas.',
    prompt: '¿Qué decisión tomas casi siempre con pánico y luego pasas semanas deshaciendo?',
    crisisSafe: true,
  },
  {
    id: 'cur-w15-when-they-say-yes',
    week: 15,
    phase: 'durability',
    tag: 'TRATAMIENTO',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🚪',
    accentColor: '#e8eef6',
    title: 'Cuando por fin dice que sí',
    mechanism:
      'La disposición suele aparecer en momentos inoportunos (después de un susto, en medio de la noche, la mañana después de un desastre) y casi nunca dura mucho. Las familias que llevan meses esperando un sí muchas veces no están listas para recibirlo: no hay cama reservada, no se ha llamado al seguro, no saben qué nivel de atención corresponde. Para cuando lo averiguan, la ventana se cerró y la persona ya se convenció de no ir. No necesitas presionar por un sí para prepararte para él. Saber el siguiente paso de antemano no es presión; es respeto por ese momento cuando llegue. Y una vez que entra, el trabajo de la familia es sencillo y difícil: respaldar el programa, sostener tus límites y no reabrir la conversación de volver a casa.',
    practice:
      'Escribe el único siguiente paso que darías si esta noche dijera que sí: un número de teléfono, un programa o una persona que te ayudaría a encontrarlo. Guárdalo donde puedas encontrarlo a las 2 de la mañana.',
    prompt: 'Si ahora mismo te dijera "Está bien, voy a ir", ¿qué harías en la siguiente hora?',
    crisisSafe: true,
  },
  {
    id: 'cur-w16-trust-timeline',
    week: 16,
    phase: 'durability',
    tag: 'TRATAMIENTO',
    tagBackgroundColor: '#e8eef6',
    tagTextColor: '#1a365d',
    icon: '🏡',
    accentColor: '#e8eef6',
    title: 'La confianza vuelve con el tiempo, no con una promesa',
    mechanism:
      'Cuando alguien regresa a casa después del tratamiento, todos quieren que lo difícil ya haya pasado. Esa persona quiere que vuelvan a confiar en ella. Tú quieres volver a sentirte segura. Las dos partes tienen la tentación de saltar al final. Pero la confianza después de la adicción se reconstruye igual que se rompió: despacio, con conductas repetidas en el tiempo, no con una buena conversación ni con una disculpa sentida. La recuperación temprana es frágil, y la presión de actuar como si todo fuera normal (dejar de preguntar, devolver las llaves, fingir que no estás pendiente) puede volverse un estrés más para las dos partes. Está bien decir: "Me alegra que estés en casa, y voy a necesitar tiempo." No es un castigo. Es honestidad. La constancia recupera la confianza; las promesas solo la piden.',
    practice:
      'Nombra una pieza concreta de confianza que te gustaría devolver (el auto, una llave, una tarjeta) y escribe qué necesitarías ver, y durante cuánto tiempo, antes de hacerlo. Por ahora, guárdalo para ti.',
    prompt: '¿Qué necesitarías ver durante tres meses, no tres días, para volver a sentirte segura?',
    crisisSafe: false,
  },
  {
    id: 'cur-w17-quiet-sibling',
    week: 17,
    phase: 'durability',
    tag: 'TODA LA FAMILIA',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '👥',
    accentColor: '#fdf3e3',
    title: 'Los hermanos que ya no piden nada',
    mechanism:
      'Si la persona que consume tiene hermanos, muchas veces hay uno que aprendió temprano que la mejor manera de ayudar era no necesitar nada. El fácil, el responsable, el que está bien. Casi nunca está bien. Lleva años viendo cómo la atención, el dinero y la preocupación de la familia fluyen en una sola dirección, y decidió, muchas veces sin decirlo, que sus propios problemas no cuentan. Algunos están enojados con su hermano o hermana. Otros están enojados contigo y se sienten culpables por eso. Muchos tienen miedo, en silencio, de recibir la misma llamada que tú temes. Nada de esto significa que les fallaste. Significa que la enfermedad ha estado jalando la atención de todos, y ellos merecen recuperar una parte, a propósito.',
    practice:
      'Pasa una hora esta semana con otro familiar (un hermano, tus otros hijos, tu pareja) en la que no se hable de la persona que consume. Si sale el tema, cámbialo.',
    prompt: '¿Quién en tu familia ha estado bien por tanto tiempo que ya nadie le pregunta?',
    crisisSafe: false,
  },
  {
    id: 'cur-w18-kids-know',
    week: 18,
    phase: 'durability',
    tag: 'TODA LA FAMILIA',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🧸',
    accentColor: '#fdf3e3',
    title: 'Lo que los niños ya saben',
    mechanism:
      'Los adultos suelen creer que si no hablan del tema, los niños de la casa no se enteran. Los niños casi siempre saben algo. Lo que no saben es qué significa, y en ese hueco escriben su propia explicación, que suele ser peor que la verdad y muchas veces los incluye a ellos. Los niños no necesitan detalles. Necesitan unas pocas frases verdaderas, en palabras que su edad pueda sostener: alguien que quieren tiene una enfermedad que cambia cómo se comporta; no es culpa del niño; el niño no lo puede arreglar; y está bien hablar de eso. También necesitan un adulto estable que mantenga sus rutinas y sus promesas iguales aunque la casa no lo esté. Mantener las cosas predecibles los protege más que guardar secretos.',
    practice:
      'Si hay niños en la casa o en la familia, escribe las dos o tres frases que dirías si mañana te preguntaran. Usa las palabras que usaría un niño de su edad.',
    prompt: '¿Qué crees que los niños ya notaron y nadie les ha explicado?',
    crisisSafe: true,
  },
  {
    id: 'cur-w19-not-same-side',
    week: 19,
    phase: 'durability',
    tag: 'TODA LA FAMILIA',
    tagBackgroundColor: '#fdf3e3',
    tagTextColor: '#9a6717',
    icon: '🔗',
    accentColor: '#fdf3e3',
    title: 'Cuando tú y tu pareja no están del mismo lado',
    mechanism:
      'La adicción es muy buena para encontrar la grieta entre dos padres, dos parejas o dos personas que quieren a la misma persona, y para instalarse ahí. Uno se ablanda, el otro se endurece para compensar, y mientras más empuja uno, más se ablanda el otro. Al poco tiempo pelean más entre ustedes que contra el problema, y la persona que consume sabe exactamente a quién llamar para qué. Ninguno de los dos es el problema. Cada uno está protegiendo a quien ama de la manera que le parece lógica. Pero una familia que manda dos mensajes no manda ninguno. No tienen que estar de acuerdo en todo. Tienen que estar de acuerdo en unas pocas cosas y decirlas igual, en voz alta, juntos.',
    practice:
      'Siéntate esta semana con el otro adulto y acuerden una sola cosa a la que los dos le van a decir que no. Solo una. Escríbanla con las mismas palabras para los dos.',
    prompt: '¿A cuál de ustedes llama cuando quiere un sí, y a cuál cuando quiere un no?',
    crisisSafe: false,
  },
  {
    id: 'cur-w20-money-first-to-break',
    week: 20,
    phase: 'durability',
    tag: 'MANTENERTE FIRME',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '💵',
    accentColor: '#efeaf6',
    title: 'El dinero es el primer límite que se rompe',
    mechanism:
      'El dinero es donde la mayoría de los límites ceden en silencio, porque siempre hay una razón por la que esta vez es distinta: es para la renta, para el teléfono, para la gasolina de la entrevista de trabajo. Cada pedido suena a ayuda, y algunos lo serían. El problema es que el dinero se mueve. Veinte dólares para comida liberan veinte dólares para otra cosa. Por eso la regla más limpia es sobre la forma de la ayuda, no sobre la razón que te dan: paga al proveedor, compra la comida, paga la cuenta del teléfono directamente, y deja el efectivo fuera. Lo mismo aplica al dinero grande: el título del auto, la cuenta compartida, lo que dice tu testamento. Si te preocupa dejarle dinero a alguien en adicción activa, un abogado de herencias puede explicarte opciones, como un fideicomiso, que protegen ese dinero de la adicción.',
    practice:
      'Repasa el último mes de dinero que fue hacia esa persona: efectivo, transferencias, cuentas que cubriste. Marca cada uno: pagado directamente o entregado en mano. No cambies nada todavía; solo mira cómo se reparte.',
    prompt: '¿Qué pedido te cuesta más rechazar, y por qué justamente ese?',
    crisisSafe: false,
  },
  {
    id: 'cur-w21-hard-days',
    week: 21,
    phase: 'durability',
    tag: 'MANTENERTE FIRME',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '🕯️',
    accentColor: '#efeaf6',
    title: 'Los días del calendario que más duelen',
    mechanism:
      'A las familias suelen tomarlas por sorpresa ciertos días: las fiestas, los cumpleaños, el aniversario del arresto, de la sobredosis o de la noche en que todo salió a la luz. Esos días cargan el peso de todos los años anteriores: cómo era antes, cómo se suponía que iba a ser, lo que pasó la última vez. Esperar que se sientan normales te deja expuesta a una emboscada. Es mejor saber que vienen y planearlos a propósito: quién viene, con qué condiciones, cuánto tiempo te vas a quedar, a quién llamarás si sale mal, y una parte del día que sea solo para ti. También está bien dejar que un día difícil sea difícil. No tienes que fabricar alegría. Solo no tienes que entrar a él sin preparación.',
    practice:
      'Mira los próximos dos meses y marca el día que en silencio estás temiendo. Escribe ahora una decisión sobre ese día: quién estará, cuánto tiempo te quedas o cómo te vas a ir.',
    prompt: '¿Qué día del calendario recuerda tu cuerpo antes que tu mente?',
    crisisSafe: true,
  },
  {
    id: 'cur-w22-grieving-still-here',
    week: 22,
    phase: 'durability',
    tag: 'TU RECUPERACIÓN',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🍂',
    accentColor: '#e9f2ec',
    title: 'El duelo por alguien que sigue aquí',
    mechanism:
      'Hay un duelo que viene con la adicción y que casi nadie nombra. La persona que amas está viva, quizá sentada frente a ti en la mesa, y aun así la extrañas: la versión de antes, y el futuro que imaginabas para ella y para tu familia. Como nadie murió, no hay funeral, ni visitas con comida, ni permiso para llorar. Entonces el duelo sale de lado: como agotamiento, irritabilidad, llanto en el auto. Tiene nombre, pérdida ambigua, y es normal. Llorar a quien era no significa que te rendiste con quien todavía puede llegar a ser. Puedes sostener las dos cosas. Permitirte el duelo muchas veces hace más fácil encontrarte con la persona real que tienes enfrente, en vez de con la que sigues comparándola.',
    practice:
      'Escribe una cosa que extrañas de quien era y una cosa que todavía amas de quien es. Di las dos en voz alta a alguien de confianza, o solo a ti misma.',
    prompt: '¿Qué imaginabas para esa persona que no te has permitido decir que perdiste?',
    crisisSafe: true,
  },
  {
    id: 'cur-w23-other-things',
    week: 23,
    phase: 'durability',
    tag: 'TU RECUPERACIÓN',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🌱',
    accentColor: '#e9f2ec',
    title: 'Tu vida puede tener otras cosas',
    mechanism:
      'Después de meses en modo crisis, muchas familias se dan cuenta de que su vida entera se encogió al tamaño de la adicción de una persona. Las amigas dejaron de llamar porque siempre cancelabas. Lo que antes te gustaba ahora se siente frívolo, o hasta desleal: ¿cómo vas a salir a cenar si esa persona podría estar en peligro? Pero tu alegría no es una traición, y tu sufrimiento no la protege. Una vida con espacio para otras cosas te hace más estable, más difícil de mover con culpa y mejor compañía cuando por fin busque ayuda. Y le muestra, sin un solo sermón, cómo se ve una vida por la que vale la pena dejar de consumir. Recuperar tu vida no pasa de golpe. Pasa una cosa ordinaria a la vez.',
    practice:
      'Pon en tu calendario esta semana una cosa que sea solo para ti (un almuerzo con una amiga, una clase, una caminata que solías hacer) y cúmplela, aunque la semana se ponga difícil.',
    prompt: '¿Qué te gustaba hacer y dejaste de hacer sin darte cuenta?',
    crisisSafe: true,
  },
  {
    id: 'cur-w24-crisis-returns',
    week: 24,
    phase: 'durability',
    tag: 'SI HAY RECAÍDA',
    tagBackgroundColor: '#fbecea',
    tagTextColor: '#9b3b2f',
    icon: '🌊',
    accentColor: '#fbecea',
    title: 'Cuando la crisis regresa',
    mechanism:
      'A veces la mala racha vuelve después de meses de calma, y con ella todos los reflejos de antes: la vigilancia, revisar el teléfono de madrugada, la urgencia de arreglarlo para mañana. Puede sentirse como volver al principio. No lo es. Ahora sabes cosas que no sabías en las primeras semanas: cómo se ve amortiguar, qué límites puedes sostener de verdad, a quién puedes llamar, que puedes sobrevivir a una mala noche. La crisis puede verse igual, pero tú no eres la misma persona que la enfrenta. El trabajo ahora es usar lo que construiste en vez de volver al pánico. Regresa a lo básico: primero la seguridad, una decisión a la vez, un límite que no se mueve, y alguien más de tu lado.',
    practice:
      'Escribe una lista corta de lo que sabes ahora y no sabías cuando esto empezó. Guárdala donde la veas en una mala noche.',
    prompt: 'Si pudieras, ¿qué le dirías a la tú de la primera semana?',
    crisisSafe: true,
  },
  {
    id: 'cur-w25-body-on-duty',
    week: 25,
    phase: 'durability',
    tag: 'TU RECUPERACIÓN',
    tagBackgroundColor: '#e9f2ec',
    tagTextColor: '#2c5f4a',
    icon: '🛌',
    accentColor: '#e9f2ec',
    title: 'Tu cuerpo lleva meses de guardia',
    mechanism:
      'Vivir con la adicción de otra persona es una forma de estrés crónico, y el cuerpo lleva la cuenta a su manera: sueño interrumpido, dolores de cabeza, un estómago siempre apretado, comidas que te saltas o que comes de pie, un resfriado que nunca termina de irse. Muchas personas en tu lugar posponen sus propias citas médicas durante años porque siempre hay una crisis más urgente. Pero un sistema nervioso que nunca puede descansar termina por dejar de funcionar bien para ti. El descanso no es un premio para cuando las cosas mejoren. Es lo que te permite seguir mientras no mejoran. No necesitas transformar tu vida. Necesitas una cosa física que le diga a tu cuerpo que la emergencia no es dueña de cada hora.',
    practice:
      'Elige una: una hora fija para dormir cinco noches esta semana, una comida de verdad al día sentada, o pedir la cita médica que has estado posponiendo. Solo una.',
    prompt: '¿Cuándo fue la última vez que dormiste toda la noche sin revisar el teléfono?',
    crisisSafe: true,
  },
  {
    id: 'cur-w26-long-haul',
    week: 26,
    phase: 'durability',
    tag: 'MANTENERTE FIRME',
    tagBackgroundColor: '#efeaf6',
    tagTextColor: '#4b3a75',
    icon: '🌄',
    accentColor: '#efeaf6',
    title: 'Es una enfermedad larga. Ve a un ritmo que aguante.',
    mechanism:
      'Las familias suelen vivir los primeros meses como una carrera corta, como si suficiente esfuerzo y urgencia pudieran terminar con esto para cierta fecha. Pero la adicción suele ser una enfermedad larga, con temporadas de avance, retrocesos y mesetas en las que cuesta saber en cuál estás. Un ritmo que solo aguantas en una emergencia se agota antes que la enfermedad. Durar es una habilidad distinta a la urgencia. Se ve así: menos límites, pero más firmes; un apoyo que mantienes incluso en los meses buenos; una vida que no se detiene cada vez que cambia la situación de tu ser querido; y paciencia contigo misma cuando vuelvas a viejos hábitos, porque vas a volver. Lleves el tiempo que lleves en esto, no estás al final de nada. Eres alguien que está aprendiendo a quedarse.',
    practice:
      'Mira hacia atrás, a cuando esto empezó, y escribe tres cosas que son distintas ahora, en ti, no en esa persona. Luego elige el único apoyo que vas a mantener aunque las cosas vayan bien.',
    prompt: '¿Cómo se vería ir a un ritmo que pudieras sostener durante un año?',
    crisisSafe: true,
  },
];

// ─── Selection ────────────────────────────────────────────────────────────────

function libraryFor(language?: string): CurriculumPiece[] {
  return language?.startsWith('es') ? CURRICULUM_ES : CURRICULUM;
}

/** Full library for the active language (browse / admin preview). */
export function getCurriculum(language?: string): CurriculumPiece[] {
  return libraryFor(language);
}

/**
 * Week number since the family joined, 1-based.
 * Week 1 = days 1–7. Returns 1 for a null/unparseable joinedAt so a brand-new
 * or partially-synced account still gets week 1 rather than nothing.
 */
export function curriculumWeek(joinedAt: string | null, now: Date = new Date()): number {
  if (!joinedAt) return 1;
  const start = new Date(joinedAt);
  if (Number.isNaN(start.getTime())) return 1;
  const days = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

/** Phase for a given week number. */
export function phaseForWeek(week: number): CurriculumPhase {
  for (const phase of PHASE_ORDER) {
    const { startWeek, endWeek } = PHASE_WEEKS[phase];
    if (week >= startWeek && (endWeek === null || week <= endWeek)) return phase;
  }
  return 'orientation';
}

/**
 * The piece to surface for a family this week.
 *
 * Rules, in order:
 *  1. Exact week match wins — the arc is the point.
 *  2. Past the authored range, hold at the highest authored week rather than
 *     returning null. A partial library must never produce an empty card.
 *  3. When the situation band is `elevated` or `crisis`, only `crisisSafe`
 *     pieces are eligible. A family whose week is on fire should not be handed
 *     a reflection exercise; if nothing safe is available we return null and
 *     the caller falls back to the support-forward surface.
 *
 * Returns null only when the library has no eligible piece at all.
 */
export function selectCurriculumPiece(
  week: number,
  band: SituationBandInput,
  language?: string,
): CurriculumPiece | null {
  const library = libraryFor(language);
  if (library.length === 0) return null;

  const guarded = band === 'elevated' || band === 'crisis';
  const eligible = guarded ? library.filter((piece) => piece.crisisSafe) : library;
  if (eligible.length === 0) return null;

  const exact = eligible.find((piece) => piece.week === week);
  if (exact) return exact;

  // Before the first authored week (defensive — week is always >= 1).
  const earliest = eligible.reduce((a, b) => (a.week <= b.week ? a : b));
  if (week < earliest.week) return earliest;

  // Past the authored range: cycle through the eligible durability pieces so
  // a family in month seven does not see the same card every week.
  const maxWeek = library.reduce((max, piece) => Math.max(max, piece.week), 0);
  if (week > maxWeek) {
    const cycle = eligible
      .filter((piece) => piece.phase === 'durability')
      .sort((a, b) => a.week - b.week);
    if (cycle.length > 0) return cycle[(week - maxWeek - 1) % cycle.length];
  }

  // Inside the range with no eligible exact match (a guarded family on an
  // unsafe week): hold at the latest eligible piece at or below the requested
  // week, else the latest overall.
  const atOrBelow = eligible.filter((piece) => piece.week <= week);
  if (atOrBelow.length > 0) {
    return atOrBelow.reduce((a, b) => (a.week >= b.week ? a : b));
  }
  return eligible.reduce((a, b) => (a.week >= b.week ? a : b));
}

/** True once the family has passed the last authored week (content backlog signal). */
export function isBeyondAuthoredCurriculum(week: number, language?: string): boolean {
  const library = libraryFor(language);
  if (library.length === 0) return true;
  const maxWeek = library.reduce((max, piece) => Math.max(max, piece.week), 0);
  return week > maxWeek;
}
