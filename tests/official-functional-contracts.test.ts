import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Load the actual acceptance script at runtime, including its installed parser.
// The normal test bundler must not inline TypeScript's Node module loader.
const { loadSpecializedEvidence, resolveCaseEvidence, summarize } = await import(
  pathToFileURL(resolve('scripts/summarize-official-functional.mjs')).href
);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const root = resolve('codex_artifact/in-memory-acceptance-fixture');
const id = 'crychart-example-9999-fixture';

function fixture() {
  const source = Buffer.from('export const live = 7;\n');
  const mesh = Buffer.from('export function unused(x: number) { return x + 1; }\nexport const stable = 8;\n');
  const files = new Map<string, Buffer>([[resolve(root, 'src/main.ts'), source], [resolve(root, 'src/mesh3d.ts'), mesh]]);
  const bundle = hash('executed-bundle');
  const contract: any = {
    id, contractReviewed: true, interactionsRequired: false,
    requirements: [{ id: 'values', required: true, checkNames: ['values'] }],
    validationDimensions: { mount: ['values'], data: ['values'], lifecycle: ['dispose'] },
    specializedSourcePrefixes: ['src/'], specializedEvidence: [],
  };
  const add = (path: string, at: string, changes: any = {}) => {
    const report = {
      visibleChrome: true, bundleSHA256: bundle, finishedAt: at,
      sourceHashes: { 'src/main.ts': hash(source), 'src/mesh3d.ts': hash(mesh) }, errors: [],
      checks: [{ id, name: 'values', status: 'passed' }, { id, name: 'dispose', status: 'passed' }], ...changes,
    };
    const bytes = Buffer.from(JSON.stringify(report)); files.set(resolve(root, path), bytes);
    const descriptor: any = { path, sha256: hash(bytes), bundleSHA256: report.bundleSHA256 };
    contract.specializedEvidence.push(descriptor); return { report, descriptor };
  };
  const read = async (path: string) => { const value = files.get(path); if (!value) throw new Error('Missing fixture path ' + path); return value; };
  const load = async () => (await loadSpecializedEvidence([contract], root, { read })).get(id);
  const result = (evidence: any) => resolveCaseEvidence({ id, errors: [] }, contract, {}, evidence);
  return { source, mesh, files, bundle, contract, add, read, load, result };
}

test('recorded headed Chrome remains eligible on separately allocated loopback CDP ports', async () => {
  for (const endpoint of ['ws://127.0.0.1:9223/devtools/browser/a', 'ws://127.0.0.1:9224/devtools/browser/b', 'ws://localhost:19225/devtools/browser/c', 'ws://[::1]:9226/devtools/browser/d']) {
    const f = fixture();
    f.add('headed.json', '2026-11-04', { visibleChrome: undefined, browser: {
      Browser: 'Chrome/142.0.0.0', 'User-Agent': 'Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36', webSocketDebuggerUrl: endpoint,
    } });
    const evidence = await f.load();
    assert.equal(evidence.diagnostics[0].browserBasis, 'recorded-headed-Chrome-CDP-metadata');
    assert.equal(f.result(evidence).functionalComplete, true);
  }
});

test('CDP metadata rejects remote, credentialed, malformed and non-browser endpoints', async () => {
  for (const endpoint of ['ws://example.com:9224/devtools/browser/a', 'ws://127.0.0.1.example.com:9224/devtools/browser/a', 'ws://user@127.0.0.1:9224/devtools/browser/a', 'https://127.0.0.1:9224/devtools/browser/a', 'ws://127.0.0.1:9224/devtools/page/a', 'ws://127.0.0.1:9224/devtools/browser/a?x=1', 'ws://127.0.0.1:0/devtools/browser/a', 'not-a-url']) {
    const f = fixture();
    f.add('invalid.json', '2026-11-04', { visibleChrome: undefined, browser: {
      Browser: 'Chrome/142.0.0.0', 'User-Agent': 'Chrome/142.0.0.0', webSocketDebuggerUrl: endpoint,
    } });
    const evidence = await f.load();
    assert.ok(evidence.diagnostics[0].reasons.includes('visible-browser-evidence-not-established'), endpoint);
    assert.equal(f.result(evidence).functionalComplete, false);
  }
});

test('headless Chrome metadata and explicit nonvisible flags override a claimed visible pass', async () => {
  const browser = { Browser: 'Chrome/142.0.0.0', 'User-Agent': 'Chrome/142.0.0.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9224/devtools/browser/a' };
  for (const changes of [{ browser: { ...browser, Browser: 'HeadlessChrome/142.0.0.0' } }, { browser: { ...browser, 'User-Agent': 'HeadlessChrome/142.0.0.0' } }, { browser, headless: true }, { browser, browserVisible: false }, { browser, visibleChrome: false }]) {
    const f = fixture(); f.add('contradiction.json', '2026-11-04', changes);
    assert.equal(f.result(await f.load()).functionalComplete, false);
  }
});

test('unassigned report errors block all success rows and remain inspectable', async () => {
  const f = fixture(); f.add('fatal.json', '2026-01-01', { errors: ['Uncaught render error after final check'] });
  const evidence = await f.load(); assert.equal(evidence.checks.length, 0);
  assert.ok(evidence.diagnostics[0].reasons.includes('unassigned-report-errors'));
  assert.equal(evidence.diagnostics[0].unassignedErrors.length, 1);
  assert.equal(f.result(evidence).functionalComplete, false);
});

test('case-attributed errors do not contaminate another case and focused repair preserves failure history', async () => {
  const f = fixture(); f.add('other.json', '2026-01-01', { errors: [{ id: '8888', name: 'values', error: 'Other case failed' }] });
  assert.equal(f.result(await f.load()).functionalComplete, true);
  f.add('failure.json', '2026-01-02', { errors: [{ id: '9999', name: 'values', error: 'Actual current failure' }] });
  assert.equal(f.result(await f.load()).status, 'failed');
  f.add('focused.json', '2026-01-03', { checks: [{ id, name: 'values', passed: true }] });
  const evidence = await f.load(); assert.equal(f.result(evidence).functionalComplete, true);
  assert.ok(evidence.attempts.some((x: any) => x.name === 'values' && x.status === 'failed'));
});

test('a case-only unhandled error blocks that case report', async () => {
  const f = fixture(); f.add('unhandled.json', '2026-01-01', { errors: [{ id, error: 'Uncaught between checks' }] });
  const evidence = await f.load(); assert.ok(evidence.diagnostics[0].reasons.includes('case-error-without-check'));
  assert.equal(f.result(evidence).functionalComplete, false);
});

test('a later unassigned or case-only error blocks prior passes until one complete same-bundle rerun', async () => {
  for (const errors of [['Uncaught after the prior full run'], [{ id, error: 'Uncaught outside a named check' }]]) {
    const f = fixture(); f.add('old-pass.json', '2026-01-01');
    f.add('late-error.json', '2026-01-02', { errors, checks: [] });
    let evidence = await f.load();
    assert.equal(f.result(evidence).status, 'failed');
    assert.equal(evidence.unresolvedBlockingErrors.length, 1);
    assert.equal(evidence.attempts.filter((x: any) => x.reportPath === 'old-pass.json').length, 2);
    f.add('focused-values.json', '2026-01-03', { checks: [{ id, name: 'values', status: 'passed' }] });
    f.add('focused-dispose.json', '2026-01-04', { checks: [{ id, name: 'dispose', status: 'passed' }] });
    evidence = await f.load();
    assert.equal(f.result(evidence).functionalComplete, false, 'Separate focused passes cannot clear an error of unknown scope');
    f.add('full-repair.json', '2026-01-05');
    evidence = await f.load();
    assert.equal(f.result(evidence).functionalComplete, true);
    assert.equal(evidence.unresolvedBlockingErrors.length, 0);
    assert.equal(evidence.blockingErrors[0].repairedBy.reportPath, 'full-repair.json');
    assert.equal(evidence.blockingErrors[0].errors.length, 1, 'The repaired fatal attempt remains in history');
  }
});

test('fatal current-bundle evidence cannot fall back to an older bundle and named errors need no check row', async () => {
  const f = fixture(); f.add('old-pass.json', '2026-01-01');
  const currentBundle = hash('new-current-bundle');
  f.add('new-fatal.json', '2026-01-02', { bundleSHA256: currentBundle, errors: ['Unassigned current failure'], checks: [] });
  const evidence = await f.load();
  assert.equal(evidence.cohortBundleSHA256, currentBundle);
  assert.equal(evidence.checks.length, 0);
  assert.equal(f.result(evidence).status, 'failed');
  const named = fixture(); named.add('old-pass.json', '2026-01-01');
  named.add('named-only.json', '2026-01-02', { errors: [{ id, name: 'values', error: 'Failure before a row was recorded' }], checks: [] });
  assert.equal(named.result(await named.load()).status, 'failed');
});

test('an unbound fatal report is not allowed to block otherwise valid current evidence', async () => {
  const f = fixture(); f.add('current.json', '2026-01-01');
  f.add('stale.json', '2026-01-02', { sourceHashes: { 'src/main.ts': hash('stale') }, errors: ['Unbound failure'], checks: [] });
  const evidence = await f.load();
  assert.equal(evidence.unresolvedBlockingErrors.length, 0);
  assert.equal(f.result(evidence).functionalComplete, true);
  assert.ok(evidence.diagnostics[1].reasons.includes('source-binding-stale-or-missing'));
});

test('contradictory status and boolean fields always fail in either direction', async () => {
  for (const row of [{ status: 'passed', passed: false }, { status: 'failed', passed: true }]) {
    const f = fixture(); f.add('conflict.json', '2026-01-01', { checks: [{ id, name: 'values', ...row }] });
    const evidence = await f.load(); assert.equal(evidence.checks[0].status, 'failed');
    assert.equal(f.result(evidence).functionalComplete, false);
  }
});

test('mesh whole-file exclusion cannot hide arbitrary top-level changes', async () => {
  const f = fixture(); f.add('full.json', '2026-01-01');
  f.contract.specializedSourceExclusions = [{ path: 'src/mesh3d.ts', reason: 'Unused triangulation' }];
  f.files.set(resolve(root, 'src/mesh3d.ts'), Buffer.from('throw new Error("new top-level failure");\n'));
  const evidence = await f.load(); assert.equal(evidence.checks.length, 0);
  assert.equal(evidence.diagnostics[0].ignoredSourceExclusions.length, 1);
  assert.equal(evidence.diagnostics[0].sourceDifferences[0].path, 'src/mesh3d.ts');
});

test('unused-function proof requires frozen full files and identical bytes outside the function', async () => {
  const f = fixture(); f.add('full.json', '2026-01-01');
  const after = Buffer.from(f.mesh.toString().replace('x + 1', 'x + 2'));
  f.files.set(resolve(root, 'before.ts'), f.mesh); f.files.set(resolve(root, 'src/mesh3d.ts'), after);
  const binding = { path: 'src/mesh3d.ts', beforePath: 'before.ts', beforeSHA256: hash(f.mesh), afterSHA256: hash(after), functionName: 'unused', caseDoesNotCallFunction: true, reviewedReason: 'Fixture reads stable, never unused.' };
  f.contract.specializedSourceEquivalence = [binding];
  f.contract.specializedSourceExclusions = [{ path: 'src/mesh3d.ts', reason: 'This must not bypass the proof' }];
  let evidence = await f.load(); assert.equal(f.result(evidence).functionalComplete, true);
  assert.equal(evidence.diagnostics[0].sourceEquivalences.length, 1);
  const outside = Buffer.from(after.toString().replace('stable = 8', 'stable = 9'));
  f.files.set(resolve(root, 'src/mesh3d.ts'), outside); binding.afterSHA256 = hash(outside);
  evidence = await f.load(); assert.equal(evidence.checks.length, 0);
  assert.ok(evidence.diagnostics[0].reasons.includes('source-binding-stale-or-missing'));
});

test('different-bundle focused checks cannot inherit unexecuted lifecycle checks', async () => {
  const f = fixture(); f.add('full.json', '2026-01-01');
  f.add('different.json', '2026-01-02', { bundleSHA256: hash('another bundle'), checks: [{ id, name: 'values', status: 'passed' }] });
  const evidence = await f.load(); assert.deepEqual(evidence.checks.map((x: any) => x.name), ['values']);
  assert.equal(f.result(evidence).functionalComplete, false);
});

test('input-only manifest needs the executed report hash and explicit directory binding', async () => {
  const f = fixture(), manifest = Buffer.from(JSON.stringify({ inputs: { 'src/main.ts': { sha256: hash(f.source) }, 'src/mesh3d.ts': { sha256: hash(f.mesh) } } }));
  f.files.set(resolve(root, 'build/inputs.json'), manifest);
  const value = f.add('build/visible/report.json', '2026-01-01', { sourceHashes: {}, buildDirectory: 'build', buildInputsManifest: { path: 'inputs.json', sha256: hash(manifest) } });
  value.descriptor.sourceManifest = { path: 'build/inputs.json', sha256: hash(manifest) };
  assert.equal(f.result(await f.load()).functionalComplete, true);
  value.descriptor.sourceManifest.sha256 = hash('tampered manifest');
  const evidence = await f.load(); assert.equal(evidence.checks.length, 0);
});

function summaryFixture(): any {
  const identity: any = { sessionId: 'permanent-test' };
  for (const field of ['coreSHA256', 'bundleSHA256', 'contractsSHA256', 'legacyHarnessSHA256', 'driverSHA256', 'adapterSHA256']) identity[field] = hash(field);
  return { kind: 'official-functional-visible', finishedAt: '2026-01-01', identity, errors: [], cases: [{ id, status: 'passed', functionalComplete: true, requirements: [], dimensions: { data: { status: 'passed' } } }] };
}

test('summary rejects missing or partial source identity and unresolved fatal errors', () => {
  const valid = summaryFixture(); assert.equal(summarize([{ path: 'valid.json', report: valid }]).functionallyComplete, 1);
  for (const field of ['sessionId', 'coreSHA256', 'bundleSHA256', 'contractsSHA256', 'legacyHarnessSHA256', 'driverSHA256', 'adapterSHA256']) {
    const report = structuredClone(valid); delete report.identity[field];
    assert.throws(() => summarize([{ path: 'missing-' + field, report }]), /identity is required/);
  }
  const fatal = structuredClone(valid); fatal.errors = ['uncaught'];
  assert.throws(() => summarize([{ path: 'fatal', report: fatal }]), /unresolved top-level errors/);
});

test('summary cannot merge different adapters or sessions even when bundle and driver match', () => {
  const first = summaryFixture();
  for (const field of ['adapterSHA256', 'sessionId']) {
    const second = structuredClone(first);
    second.identity[field] = field === 'sessionId' ? 'another-session' : hash('another adapter');
    assert.throws(() => summarize([{ path: 'first', report: first }, { path: 'second', report: second }]), /Do not combine/);
  }
});
