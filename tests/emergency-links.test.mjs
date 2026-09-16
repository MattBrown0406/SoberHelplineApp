import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

function loadHelper({ openURL }) {
  const alerts = [];
  const output = ts.transpileModule(read('src/lib/emergencyLinks.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, require(id) {
      if (id === 'react-native') return { Linking: { openURL }, Alert: { alert: (...args) => alerts.push(args) } };
      if (id === 'i18next') return { default: { t: (key, options) => `${key}${options?.number ? `:${options.number}` : ''}` } };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  return { ...module.exports, alerts };
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('emergency links that cannot open show the number to dial from another phone', async () => {
  const opened = [];
  const helper = loadHelper({ openURL: async (url) => { opened.push(url); throw new Error('Unable to open URL'); } });
  helper.openEmergencyLink('tel:988');
  helper.openEmergencyLink('sms:988');
  helper.openEmergencyLink('tel:18002221222', '1-800-222-1222');
  await settle();
  assert.deepEqual(opened, ['tel:988', 'sms:988', 'tel:18002221222']);
  assert.deepEqual(helper.alerts.map(([, body]) => body), [
    'crisis:emergency.openErrorBody:988',
    'crisis:emergency.openErrorBody:988',
    'crisis:emergency.openErrorBody:1-800-222-1222',
  ]);
});

test('a successful dial never shows the fallback alert', async () => {
  const helper = loadHelper({ openURL: async () => true });
  helper.openEmergencyLink('tel:911');
  await settle();
  assert.equal(helper.alerts.length, 0);
});

test('no crisis screen dials 911/988 without the fallback helper', () => {
  const screens = [
    'src/components/safety/EmergencyActions.tsx',
    'app/(tabs)/support.tsx',
    'app/community.tsx',
    'app/diy-intervention-planner.tsx',
    'app/homecoming-week.tsx',
    'app/live-room.native.tsx',
  ];
  for (const path of screens) {
    const source = read(path);
    assert.doesNotMatch(source, /Linking\.openURL\((['"`])(tel|sms):/, `${path} bypasses openEmergencyLink`);
    assert.match(source, /openEmergencyLink\(/, `${path} should use openEmergencyLink`);
  }
  for (const lang of ['en', 'es']) {
    const crisis = JSON.parse(read(`src/locales/${lang}/crisis.json`));
    assert.equal(typeof crisis.emergency.openErrorTitle, 'string');
    assert.match(crisis.emergency.openErrorBody, /\{\{number\}\}/);
  }
});
