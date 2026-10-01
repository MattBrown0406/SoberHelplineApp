import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeDelivery,
  clipsForText,
  countFillers,
  countStatements,
  deliveryTips,
  loudnessSpikes,
  readDeliveryReport,
  wordCount,
  type VoiceClip,
} from '../src/lib/practiceDelivery';

function clip(transcript: string, seconds: number, metering?: number[]): VoiceClip {
  return { transcript, durationMs: seconds * 1000, ...(metering ? { metering } : {}) };
}

test('word count treats contractions as one word, in both languages', () => {
  assert.equal(wordCount("I'm not going to argue with you."), 7);
  assert.equal(wordCount('No voy a discutir contigo, ¿sí?'), 6);
  assert.equal(wordCount(''), 0);
});

test('English fillers count only where they are fillers', () => {
  const { count, found } = countFillers('Um, I was, like, worried. Uh, you know? I mean, it was kind of, scary.', 'en');
  assert.deepEqual(found, { um: 1, uh: 1, like: 1, 'you know': 1, 'I mean': 1, 'kind of': 1 });
  assert.equal(count, 6);
  // Ordinary uses don't count.
  assert.equal(countFillers("I'd like you to come with me. You know I love you. I mean it.", 'en').count, 0);
  assert.equal(countFillers('Under the umbrella, the user ate a plum.', 'en').count, 0);
});

test('Spanish fillers count only where they are fillers', () => {
  const { found } = countFillers('Eh, este, o sea, yo quería hablar contigo, ¿sabes? Bueno, mmm, como que me preocupa.', 'es');
  assert.deepEqual(found, { eh: 1, mmm: 1, este: 1, 'o sea': 1, bueno: 1, 'como que': 1, '¿sabes?': 1 });
  assert.equal(countFillers('Este fin de semana quiero que hablemos. ¿Sabes lo que me duele?', 'es').count, 0);
});

test('"I" vs "you" statements are read from how each sentence starts', () => {
  assert.deepEqual(countStatements("I love you. You always do this! And I'm scared. Why won't you talk to me?", 'en'), {
    i: 2,
    you: 1,
    questions: 1,
  });
  assert.deepEqual(countStatements('Um, I feel scared. Your drinking scares me. If you go, I will drive.', 'en'), {
    i: 1,
    you: 1,
    questions: 0,
  });
  assert.deepEqual(countStatements('Te quiero. Siempre haces lo mismo. Me preocupas mucho. ¿Hablamos mañana?', 'es'), {
    i: 2,
    you: 1,
    questions: 1,
  });
});

test('loudness spikes need a sustained jump above the speaker’s own baseline', () => {
  const calm = Array.from({ length: 40 }, (_, i) => -30 + (i % 5));
  assert.deepEqual(loudnessSpikes(calm), { voiced: true, spikes: 0, peakDb: -26 });
  const raised = [...calm.slice(0, 20), -6, -5, -4, -30, -31, -7, -30, -3, -2, ...calm.slice(0, 10)];
  const result = loudnessSpikes(raised);
  assert.equal(result.spikes, 2, 'one-sample blips are not spikes');
  assert.equal(result.peakDb, -2);
  assert.deepEqual(loudnessSpikes([-160, -160, -50]), { voiced: false, spikes: 0, peakDb: null });
  assert.deepEqual(loudnessSpikes(undefined), { voiced: false, spikes: 0, peakDb: null });
});

test('clips stay with the line only while most of their words are still in it', () => {
  const clips = [clip('I love you and I am scared', 3), clip('please come home tonight', 2)];
  assert.deepEqual(clipsForText(clips, 'I love you and I am so scared.'), [clips[0]]);
  assert.deepEqual(clipsForText(clips, 'Totally different typed words.'), []);
  assert.deepEqual(clipsForText(clips, 'I love you and I am scared, please come home tonight').length, 2);
});

test('a fast, filler-heavy, you-heavy spoken session gets work-on tips first', () => {
  const fast = 'Um, you, like, never listen. Uh, you always do this, you know, and, um, you need to stop right now okay';
  const report = analyzeDelivery(
    [
      { text: fast, clips: [clip(fast, 6)] },
      { text: fast, clips: [clip(fast, 6)] },
      { text: fast, clips: [clip(fast, 6)] },
    ],
    'en',
  );
  assert.ok(report);
  assert.equal(report.voiceTurns, 3);
  assert.equal(report.wordsPerMinute, 210);
  assert.equal(report.questions, 0);
  // Three things to work on, then one thing that went right (short turns).
  assert.deepEqual(report.tips.map((tip) => tip.key), ['paceFast', 'fillersHigh', 'youHeavy', 'shortTurns']);
  assert.equal(report.tips[1].vars.examples, 'um, like, uh');
  assert.equal(report.loudness, null);
});

test('a steady session hears what went right', () => {
  const line = 'I love you and I am worried about you. What would help right now?';
  const steadyMeter = Array.from({ length: 30 }, (_, i) => -28 + (i % 3));
  const report = analyzeDelivery(
    [
      { text: line, clips: [clip(line, 5, steadyMeter)] },
      { text: line, clips: [clip(line, 5, steadyMeter)] },
    ],
    'en',
  );
  assert.ok(report);
  assert.equal(report.wordsPerMinute, 168);
  assert.deepEqual(report.loudness, { meteredTurns: 2, spikeTurns: 0, peakDb: -26 });
  assert.deepEqual(report.tips.map((tip) => tip.key), ['paceSteady', 'fillersLow', 'iStrong', 'shortTurns']);
});

test('typed sessions get statement and length feedback but no voice metrics', () => {
  const report = analyzeDelivery([{ text: 'I love you.' }, { text: 'I am not giving you money.' }], 'en');
  assert.ok(report);
  assert.equal(report.voiceTurns, 0);
  assert.equal(report.wordsPerMinute, null);
  assert.equal(report.fillerCount, null);
  assert.equal(report.loudness, null);
  assert.ok(report.tips.some((tip) => tip.key === 'iStrong'));
  assert.equal(analyzeDelivery([], 'en'), null);
  assert.equal(analyzeDelivery([{ text: '   ' }], 'en'), null);
});

test('a delivered letter does not count toward the lecture check', () => {
  const letter = Array.from({ length: 30 }, () => 'I love you and I remember who you are.').join(' ');
  const turns = [{ text: letter }, { text: 'I hear you.' }, { text: 'Will you go today?' }];
  assert.ok(analyzeDelivery(turns, 'en')!.tips.some((tip) => tip.key === 'longTurns'));
  const delivered = analyzeDelivery(turns, 'en', { deliveredFirst: true })!;
  assert.equal(delivered.avgTurnWords, 4);
  assert.ok(!delivered.tips.some((tip) => tip.key === 'longTurns'));
});

test('tips: at most four, and a strength always makes the cut when there is one', () => {
  const tips = deliveryTips(
    {
      userTurns: 4, voiceTurns: 4, wordsPerMinute: 200, fillerCount: 10, topFillers: ['um'],
      iStatements: 0, youStatements: 5, questions: 1, avgTurnWords: 80,
      loudness: { meteredTurns: 3, spikeTurns: 3, peakDb: -1 }, tips: [],
    },
    100,
  );
  assert.equal(tips.length, 4);
  assert.deepEqual(tips.map((tip) => tip.key), ['paceFast', 'fillersHigh', 'youHeavy', 'questionsAsked']);
});

test('stored reports are read back defensively', () => {
  const report = analyzeDelivery([{ text: 'I love you.', clips: [clip('I love you so much, really', 2)] }], 'en')!;
  assert.deepEqual(readDeliveryReport(JSON.parse(JSON.stringify(report))), report);
  assert.equal(readDeliveryReport(null), null);
  assert.equal(readDeliveryReport({ tips: [] }), null);
  const odd = readDeliveryReport({ userTurns: 2, tips: [{ key: 'hack', vars: {} }, { key: 'fillersLow', vars: {} }], loudness: { meteredTurns: 'x' } });
  assert.deepEqual(odd?.tips, [{ key: 'fillersLow', vars: {} }]);
  assert.equal(odd?.loudness, null);
});
