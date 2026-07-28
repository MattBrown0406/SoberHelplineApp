import { execFileSync } from 'node:child_process';

const acceptedHighAdvisories = new Set([
  // Transitive Expo/React Native build-tool dependency. The vulnerable glob
  // expansion path is not shipped in the iOS JavaScript bundle and upgrading
  // to the first npm-proposed fix currently requires an unsupported React
  // Native major. Re-evaluate whenever Expo SDK is upgraded.
  'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
]);

let stdout = '';
try {
  stdout = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8' });
} catch (error) {
  stdout = error.stdout?.toString() ?? '';
  if (!stdout.trim()) throw error;
}

const report = JSON.parse(stdout);
const vulnerabilities = report.vulnerabilities ?? {};

function advisoriesFor(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const advisories = [];
  for (const via of vulnerabilities[name]?.via ?? []) {
    if (typeof via === 'string') {
      advisories.push(...advisoriesFor(via, seen));
    } else if (via?.url) {
      advisories.push({ url: via.url, severity: via.severity ?? 'unknown' });
    }
  }
  return advisories;
}

const blocked = [];
const accepted = [];
for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (!['high', 'critical'].includes(vulnerability.severity)) continue;
  const advisories = advisoriesFor(name);
  const severe = advisories.filter((item) => ['high', 'critical'].includes(item.severity));
  const isAccepted = severe.length > 0 && severe.every((item) => acceptedHighAdvisories.has(item.url));
  const item = {
    name,
    severity: vulnerability.severity,
    urls: [...new Set(severe.map((entry) => entry.url))],
  };
  (isAccepted ? accepted : blocked).push(item);
}

if (accepted.length) {
  console.warn('Accepted build-tool advisory chain:');
  for (const item of accepted) console.warn(`- ${item.name}: ${item.urls.join(', ')}`);
}

if (blocked.length) {
  console.error('Unaccepted high/critical dependency vulnerabilities:');
  for (const item of blocked) console.error(`- ${item.name} (${item.severity}): ${item.urls.join(', ') || 'no high/critical advisory URL'}`);
  process.exit(1);
}

console.log('Dependency release audit passed: no unaccepted high/critical advisories.');
