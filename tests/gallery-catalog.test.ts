import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import catalog from '../docs/reference-examples.json';
import {version} from '../src/index.js';

test('native gallery inventory preserves all distinct examples and their categories', () => {
  assert.equal(catalog.count, 167);
  assert.equal(catalog.examples.length, 167);
  assert.equal(new Set(catalog.examples.map(item => item.id)).size, 167);
  for (const item of catalog.examples) {
    assert.match(item.id, /^crychart-example-\d{4}-/);
    assert.ok(catalog.officialCategories.includes(item.category));
    assert.ok(item.summary.length > 3);
  }
});

test('gallery identity follows the native package and points to its local entry', () => {
  assert.equal(catalog.identity.name, 'CRYChart');
  assert.equal(catalog.identity.packageVersion, version);
  assert.ok(existsSync(catalog.identity.entry));
  assert.ok(catalog.examples.some(item => item.id === 'crychart-example-0044-multiChannelHTML'));
  assert.ok(catalog.examples.some(item => item.id === 'crychart-example-1720-derivedDataProperties'));
});
