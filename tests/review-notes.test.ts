import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the App Review notes paste block fits App Store Connect (4,000 characters)', () => {
  const doc = readFileSync('docs/appstore-review-notes.md', 'utf8');
  const start = doc.indexOf('Thank you for reviewing');
  const end = doc.indexOf('---', start);
  assert.ok(start > 0 && end > start, 'paste block found');
  const block = doc.slice(start, end).trimEnd();
  assert.ok(block.length < 4000, `paste block is ${block.length} characters`);
});
