import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isStale, keepPracticingFrom, leavesConversation, stageAfterSafetyBreak } from '../src/lib/practiceSafety';

type M = { role: 'user' | 'partner'; text: string };
const convo: M[] = [
  { role: 'user', text: 'I love you and I need you to hear me.' },
  { role: 'partner', text: 'Here we go again.' },
  { role: 'user', text: "Honestly, this is killing me." },
  { role: 'partner', text: "Let's pause the practice…" },
];

test("I'm safe — keep practicing: the flagged line and the pause message leave the conversation", () => {
  const kept = keepPracticingFrom(convo, 2);
  assert.deepEqual(kept, convo.slice(0, 2));
  // What goes to the server next no longer contains the flagged line.
  assert.ok(!kept!.some((m) => m.text.includes('killing me')));
});

test('keep-practicing is not offered without a member line behind the pause', () => {
  assert.equal(keepPracticingFrom(convo, null), null, "an incoming call's opening");
  assert.equal(keepPracticingFrom(convo, 1), null, 'not her line');
  assert.equal(keepPracticingFrom(convo, 9), null, 'out of range');
  assert.equal(keepPracticingFrom(convo, -1), null);
  assert.equal(keepPracticingFrom(convo, 1.5), null);
});

test('requests from before a pause (or a keep-practicing) never land afterward', () => {
  assert.equal(isStale(3, 3), false);
  assert.equal(isStale(3, 4), true);
});

test('the hook wires it: epochs on every async path, break line recorded, all guards reset', () => {
  const hook = readFileSync('src/hooks/useRehearsalPartner.ts', 'utf8');
  // Every async request checks its epoch after the await.
  assert.equal((hook.match(/const epoch = epochRef\.current;/g) ?? []).length, 4, 'send, transcribe, open, debrief');
  assert.equal((hook.match(/isStale\(epoch, epochRef\.current\)/g) ?? []).length, 4);
  // A pause from her line records which line; an opening or coaching-time pause doesn't.
  assert.match(hook, /if \(result\.breakCharacter\) markSafetyBreak\(result\.crisisKind, lineIndex\);/);
  assert.match(hook, /markSafetyBreak\(result\.crisisKind, lineIndex\);\n\s+return null;/);
  assert.match(hook, /setMessages\(\[\{ role: 'partner', text: result\.text, audio \}\]\);\n\s+if \(result\.breakCharacter\) markSafetyBreak\(result\.crisisKind\);/);
  // keepPracticing resets every guard the pause set, and starts a new epoch.
  const keep = hook.slice(hook.indexOf('const keepPracticing = useCallback'), hook.indexOf('}, [messages]);', hook.indexOf('const keepPracticing')));
  for (const reset of ['epochRef.current += 1', 'safetyBreakRef.current = false', 'breakLineRef.current = null', 'setBreakLine(null)', 'setSafetyBreak(false)', 'setMessages(kept)']) {
    assert.ok(keep.includes(reset), reset);
  }
  assert.doesNotMatch(keep, /invokeRehearsal/, 'no server call: no quota spent');
  assert.match(hook, /canKeepPracticing: safetyBreak && breakLine !== null/);
  for (const file of ['app/rehearsal-live.tsx', 'app/rehearsal-incoming.tsx']) {
    const screen = readFileSync(file, 'utf8');
    assert.match(screen, /onKeepPracticing=\{canKeepPracticing \? handleKeepPracticing : undefined\}/, file);
    assert.match(screen, /lastSpokenIndex\.current = kept - 1;/, file);
    assert.match(screen, /hadSafetyBreak && !safetyBreak && \(/, file);
  }
  for (const lang of ['en', 'es']) {
    const copy = JSON.parse(readFileSync(`src/locales/${lang}/rehearsalLive.json`, 'utf8'));
    for (const key of ['keepPracticing', 'keepPracticingHint', 'getHelpNow']) assert.ok(copy.chat[key], `${lang} chat.${key}`);
  }
});

test('leaving the conversation discards the mic; a late pause brings the crisis card back over coaching', () => {
  assert.equal(leavesConversation('chat', 'chat'), false);
  assert.equal(leavesConversation('debrief', 'chat'), true);
  assert.equal(leavesConversation('ring', 'call'), true);
  assert.equal(stageAfterSafetyBreak('debrief', true, 'debrief', 'chat'), 'chat');
  assert.equal(stageAfterSafetyBreak('debrief', false, 'debrief', 'chat'), 'debrief');
  assert.equal(stageAfterSafetyBreak('chat', true, 'debrief', 'chat'), 'chat');
  assert.equal(stageAfterSafetyBreak('debrief', true, 'debrief', 'call'), 'call');
});

test('both screens lock input while coaching loads, cancel capture off-stage, and return to the card', () => {
  for (const [file, conversation] of [['app/rehearsal-live.tsx', 'chat'], ['app/rehearsal-incoming.tsx', 'call']] as const) {
    const screen = readFileSync(file, 'utf8');
    assert.match(screen, /const inputLocked = sending \|\| turnsLeft === 0 \|\| safetyBreak \|\| debriefLoading;/, file);
    assert.match(screen, new RegExp(`if \\(!leavesConversation\\(stage, '${conversation}'\\)\\) return;\\n\\s+void capture\\.cancel\\(\\);`), file);
    assert.match(screen, new RegExp(`stageAfterSafetyBreak\\(stage, safetyBreak, 'debrief', '${conversation}'\\)`), file);
  }
  const hook = readFileSync('src/hooks/useRehearsalPartner.ts', 'utf8');
  // A pause drops any coaching already on screen.
  assert.match(hook, /\/\/ Coaching never stands in front of the crisis card\.\n\s+setDebrief\(null\);/);
  const capture = readFileSync('src/components/rehearsal/useSpeechCapture.ts', 'utf8');
  // cancel() starts a new generation; an in-flight stop() then returns nothing.
  assert.match(capture, /const cancel = useCallback\(async \(\): Promise<void> => \{\n\s+generationRef\.current \+= 1;\n\s+pressActiveRef\.current = false;/);
  assert.match(capture, /const discarded = \(\) => !mountedRef\.current \|\| generation !== generationRef\.current;/);
  assert.equal((capture.match(/discarded\(\)/g) ?? []).length >= 4, true);
  assert.match(capture, /return \{ recording: recording !== null, nearLimit, start, stop, cancel \};/);
});
