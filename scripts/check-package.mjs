import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(manifest.name, '@crysound/crychart');
assert.equal(manifest.publishConfig.access, 'public');
assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/');
const entries = [manifest.exports['.'].import, manifest.exports['.'].require,
  manifest.exports['.'].types, manifest.exports['./themes'].import,
  manifest.exports['./themes'].types, './dist/crychart.global.js'];
for (const entry of entries) {
  const content = readFileSync(entry, 'utf8');
  assert.ok(content.length > 0, `Empty package entry: ${entry}`);
  assert.ok(!content.includes('sourceMappingURL='), `Unpublished source map referenced by ${entry}`);
}
const esm = await import(pathToFileURL(resolve(manifest.exports['.'].import)).href);
const cjs = createRequire(import.meta.url)(resolve(manifest.exports['.'].require));
assert.equal(esm.version, manifest.version);
assert.equal(cjs.version, manifest.version);
assert.equal(typeof esm.cryChart, 'function');
assert.equal(typeof cjs.cryChart, 'function');
console.log(`Package entries verified: ${manifest.name}@${manifest.version}`);
