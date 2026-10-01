import { DISFLUENCY_PROMPT, isLikelySilence, stripPromptEcho } from './rehearsal-stt.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test('short real answers are never mistaken for the prompt echo', () => {
  for (const lang of ['en', 'es'] as const) {
    const prompt = DISFLUENCY_PROMPT[lang];
    for (const said of ['No.', 'You.', 'So?', 'Bueno.', 'Sí.', 'I know.', 'Okay, fine.', 'I wanted to talk to you.']) {
      assertEquals(stripPromptEcho(said, prompt), said);
    }
  }
});

Deno.test('a full or leading prompt echo is removed', () => {
  const prompt = DISFLUENCY_PROMPT.en;
  assertEquals(stripPromptEcho(prompt, prompt), '');
  assertEquals(stripPromptEcho('Umm uh like you know I mean', prompt), '');
  assertEquals(stripPromptEcho('Umm, uh, like, you know, I mean, hmm. Please come home.', prompt), 'Please come home.');
  // A few real fillers at the start of real speech are kept.
  assertEquals(stripPromptEcho('Um, you know, I love you.', prompt), 'Um, you know, I love you.');
  assertEquals(stripPromptEcho(DISFLUENCY_PROMPT.es, DISFLUENCY_PROMPT.es), '');
  assertEquals(stripPromptEcho('', prompt), '');
});

Deno.test('silence hallucinations: dropped unless Whisper was confident it heard speech', () => {
  assertEquals(isLikelySilence('Thank you.'), true);
  assertEquals(isLikelySilence('You'), true);
  assertEquals(isLikelySilence('Subtítulos por la comunidad de Amara.org'), true);
  assertEquals(isLikelySilence(''), true);
  assertEquals(isLikelySilence('No.'), false);
  assertEquals(isLikelySilence('Bueno.'), false);
  assertEquals(isLikelySilence('You.', [{ no_speech_prob: 0.02, avg_logprob: -0.2 }]), false);
  assertEquals(isLikelySilence('So?', [{ no_speech_prob: 0.3, avg_logprob: -0.2 }]), true);
  assertEquals(isLikelySilence('You.', [{ no_speech_prob: 0.02, avg_logprob: -1.2 }]), true);
});
