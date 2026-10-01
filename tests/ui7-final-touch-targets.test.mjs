import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual JSX/control styles, not a second hand-maintained style fixture.
function control(file, marker, globals) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let jsx, styles;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'TouchableOpacity' && node.getText(ast).includes(marker)) jsx = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'styles') styles = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(jsx); assert.ok(styles);
  const context = vm.createContext({ React: { createElement: (type, props, ...children) => ({ type, props, children }) }, TouchableOpacity: 'button', Text: 'text', StyleSheet: { create: x => x }, colors: {}, ...globals });
  const code = ts.transpileModule(`const styles = ${styles}; result = (${jsx});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(code, context);
  return context.result;
}
function target(button) {
  assert.equal(button.props.accessibilityRole, 'button');
  assert.ok(button.props.style?.minHeight >= 44, 'real height must be >=44; hitSlop does not suffice');
  assert.ok(button.props.style?.minWidth >= 44, 'real width must be >=44');
}

test('scheduling error Retry has a real 44x44 target and calls the existing reload', () => {
  let loads = 0;
  const button = control('src/components/video/PremierVideoSchedulingCard.tsx', "k('retry')", { k: k => k, controller: { load: () => { loads++; } } });
  target(button);
  button.props.onPress();
  assert.equal(loads, 1);
});

test('family Remove retains its accessible name and functional draft update with a real 44x44 target', () => {
  const untouched = { name: 'Keep draft', relationship: 'parent' };
  let drafts = [{ name: 'Remove draft' }, untouched];
  const button = control('app/rehearsal-live.tsx', "t('family.remove')", {
    t: (key, values) => values?.name ? `${key}: ${values.name}` : key,
    speaker: drafts[0], index: 0,
    setSpeakerDrafts: update => { drafts = update(drafts); },
    removeSpeaker: (list, index) => list.filter((_, i) => i !== index),
  });
  target(button);
  assert.equal(button.props.accessibilityLabel, 'family.removeLabel: Remove draft');
  button.props.onPress();
  assert.deepEqual(drafts, [untouched]);
  assert.equal(drafts[0], untouched);
});

test('expanded practice Back also meets the all-controls DOM scan without relying on hitSlop', () => {
  let backs = 0;
  const button = control('app/rehearsal-live.tsx', "router.back()", { router: { back: () => { backs++; } }, t: k => k });
  target(button);
  button.props.onPress();
  assert.equal(backs, 1);
});
