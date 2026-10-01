import { invitationTextInCrisis, invitationTextsInCrisis } from './invitation-crisis.ts';
import { screenInvitationFields } from './invitation-screen.ts';
import { userInCrisis } from './rehearsal-safety.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const CRISIS_SAMPLES = [
  'you shoved me against the wall Saturday',
  'You hit me last week',
  'he choked me',
  'my son shoved me',
  'you threatened me with a knife',
  'he threatened to kill himself',
  "you said you'd kill yourself if I made you go",
  'you talk about suicide',
  'he pulled a knife on me',
  "he said he'd end it all",
  'he put a gun to his head',
  'he put his hands around my neck',
  'you broke my nose',
  'you threw your phone at me',
  'me empujaste contra la pared',
  'me pegó el sábado',
  'dijiste que te matarías si te obligaba a ir',
  'dijo que se quiere matar',
  'me dijiste que te querías morir',
  'quiere morirse',
  'amenazó con matarse',
  'sacó una pistola',
  'he got drunk and hit me',
  'He held me down and choked me',
  'He came home drunk and started hitting me',
  'He keeps hitting me',
  'My husband tried to choke me',
  'He slammed my head into the wall',
  'He got angry and pushed me down the stairs',
  'He smacked me in the face',
  'Intentó ahorcarme',
  'Trató de ahorcarme',
  'Me estaba pegando',
  'Empezó a pegarme',
  "Says he'll kill himself if we make him go to rehab",
  "Said he'd kill me",
  'He keeps talking about killing himself',
  'He wanted to kill himself last night',
  'He gets violent with me when he drinks',
  'He got physical with me',
  'He sexually assaulted me',
  'He pinned me down last night',
  'Quiere matarse',
  'Me agredió',
  'Fue violento conmigo',
  'Me golpea',
];

const SAFE_SAMPLES = [
  'He hit me up for money again',
  'you hit my car in the driveway',
  'He grabbed my keys and drove off',
  'you pushed me away',
  'you bit my head off',
  'It would kill me to lose you',
  'This is going to kill us',
  "You're going to kill yourself drinking like this",
  "I'm afraid you'll hurt yourself",
  'Me amenazó con irse de la casa',
  'you threatened me with divorce',
  "you've seemed so tired after work",
  "you're killing yourself with this drinking",
  'te he visto muy cansado después del trabajo',
  'He hit me up again for money',
  'my son hit me up asking for $200',
  'He hit me up at 2am',
  'He hit me with the same excuse',
  'He pushed me into paying his rent',
  "I said you're going to kill yourself if you keep drinking",
  'Me pegó un susto',
  'Me pegó la gripe',
  'He grabbed me a coffee',
  'he attacked me verbally',
  'he pulled my leg',
  'Me pega mucho el sol',
];

Deno.test('violence, threats, weapons and self-harm trip the invitation screen (EN + ES)', () => {
  for (const text of CRISIS_SAMPLES) assert(invitationTextInCrisis(text), `should trip: ${text}`);
  // The audit's example is exactly what the first-person check misses.
  assert(!userInCrisis('you shoved me against the wall Saturday'), 'first-person check alone misses it');
});

Deno.test('everyday words and idioms pass', () => {
  for (const text of SAFE_SAMPLES) assert(!invitationTextInCrisis(text), `should pass: ${text}`);
  assert(!invitationTextInCrisis(''), 'empty');
  assert(invitationTextsInCrisis(['fine', null, 'he hit me']), 'any of several');
  assert(!invitationTextsInCrisis([undefined, 'fine']), 'none of several');
});

Deno.test('the coach screens every free-text field and names the one that tripped', () => {
  const check = (text: string) => invitationTextInCrisis(text) || userInCrisis(text);
  assert(screenInvitationFields({ observation: 'you seemed tired', usual_phrases: ["I'd rather be dead than go to rehab"] }, check) === 'usual_phrases', 'usual phrases');
  assert(screenInvitationFields({ usual_phrases: ["I'll kill myself if you make me go"] }, check) === 'usual_phrases', 'first person in phrases');
  assert(screenInvitationFields({ next_step: 'he pulled a knife on me' }, check) === 'next_step', 'next step');
  assert(screenInvitationFields({ use_triggers: ['after he threatened to kill me'] }, check) === 'use_triggers', 'triggers');
  assert(screenInvitationFields({ observation: 'he choked me', recent_incidents: ['he hit me'] }, check) === 'observation', 'observation first');
  assert(screenInvitationFields({ observation: 'you seemed tired', costs_they_feel: ['his job'] }, check) === null, 'clear');
});
