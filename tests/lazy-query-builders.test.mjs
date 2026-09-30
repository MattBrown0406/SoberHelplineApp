import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Supabase postgrest builders (from()/rpc()) are lazy: the HTTP request only
// fires inside .then(). A `void supabase.from(...).insert(...)` statement
// builds the query and silently discards it. This guard fails if any member or
// admin screen reintroduces a fire-and-forget builder statement.

const ROOTS = ['app', 'src'];
const START = /^\s*(void\s+)?(\w+\.)?(supabase|client|db)\s*\.\s*(from|rpc)\s*\(/;
const CONTINUES_EXPRESSION = /(=|\(|,|\[|return|await|=>|\?|:|&&|\|\|)\s*$/;

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function statementFrom(lines, index) {
  const text = lines.slice(index, index + 30).join('\n');
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ';' && depth === 0) return text.slice(0, i);
  }
  return text;
}

test('no supabase query builder is used as a fire-and-forget statement', () => {
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(new URL(`../${root}`, import.meta.url).pathname)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!START.test(line)) return;
        let j = i - 1;
        while (j >= 0 && /^\s*(\/\/.*|\/?\*.*)?$/.test(lines[j])) j--;
        const previous = j >= 0 ? lines[j].trim() : '';
        if (CONTINUES_EXPRESSION.test(previous)) return;
        const statement = statementFrom(lines, i);
        if (statement.includes('.then(')) return;
        offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(offenders, [], `Unexecuted Supabase queries (await them or chain .then()):\n${offenders.join('\n')}`);
});
