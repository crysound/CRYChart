import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { summarizeReferenceFunctional, compareReferenceValues } = await import(
  pathToFileURL(resolve('scripts/summarize-reference-functional.mjs')).href,
);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const root = resolve('codex_artifact/in-memory-reference-contract');
const id = 'crychart-example-9999-reference-test';
const exact = { kind: 'exact', units: 'public-value', rationale: 'Input and returned values are deterministic in this fixture.' };

function fixture() {
  const files = new Map<string, Buffer>();
  const put = (path: string, text: string) => { const bytes = Buffer.from(text); files.set(resolve(root, path), bytes); return hash(bytes); };
  const coreSHA = put('src/core.ts', 'export const publicValue = 12;');
  const fixtureSHA = put('examples/reference.ts', 'export const observations = "both public runtimes";');
  const referenceSHA = put('vendor/reference.js', 'in-memory reference fixture, not vendor code');
  const candidateSHA = hash('frozen original candidate');
  const bundleSHA = hash('frozen public fixture');
  const assertions = ['values', 'lifecycle'].map(name => ({
    id: name, referencePointer: '/reference/result', candidatePointer: '/candidate/result',
    input: { referencePointer: '/reference/input', candidatePointer: '/candidate/input' },
    comparison: exact, attempts: [] as any[],
  }));
  const ledger: any = {
    schemaVersion: 1, kind: 'reference-functional-ledger', sessionId: 'reference-test', scopeId: 'test-scope',
    policy: { pixelEquivalence: { status: 'waived_by_user', functionalVisibilityStillRequired: true } },
    baselines: [{ id: 'baseline', version: '8.2.0', sha256: referenceSHA, scope: 'Public APIs in this fixture only.' }],
    candidateTarget: { version: '1.0.0' }, reports: [],
    examples: [{
      id, coverageReview: { status: 'reviewed', reviewer: 'test-reviewer', scopeStatement: 'Only these explicit operations.', apiSurface: [{ id: 'read', description: 'Read fixture result', requirementIds: ['values'] }], boundaryCases: [{ id: 'empty', description: 'Explicit empty-input case', requirementIds: ['values'] }] },
      requirements: assertions.map((a, i) => ({ id: a.id, description: a.id, required: true, reference: { baselineId: 'baseline', reviewed: true, rationale: 'Independent public return values.', dimensions: i ? ['lifecycle'] : ['results', 'interaction', 'api', 'boundary', 'functionalDisplay'], assertions: [a] } })),
    }],
  };
  const read = async (path: string) => { const value = files.get(path); if (!value) throw new Error('Missing ' + path); return value; };
  const row = (name: string, result: any = { value: 12 }) => ({ id: name, status: 'passed', assertionCount:1, metadata: { exampleIds: [id] }, observation: { reference: { input: { seed: 1, values: [0, 1] }, result }, candidate: { input: { seed: 1, values: [0, 1] }, result: structuredClone(result) } } });
  let sequence = 0;
  const add = (name: string, changes: any = {}, bindNames = ['values', 'lifecycle']) => {
    const directory = 'reports/' + name;
    put(directory + '/candidate.js', 'frozen original candidate'); put(directory + '/fixture.js', 'frozen public fixture');
    const report: any = {
      schemaVersion: 1, suiteId: 'public-test', browserVisible: true, headless: false,
      reference: { version: '8.2.0', path: 'vendor/reference.js', sha256: referenceSHA },
      candidate: { version: '1.0.0', path: directory + '/candidate.js', distributionSHA256: candidateSHA, sourceSHA256: { 'src/core.ts': coreSHA } },
      fixture: { path: 'examples/reference.ts', sha256: fixtureSHA, bundleSHA256: bundleSHA, inputSHA256: { 'examples/reference.ts': fixtureSHA } },
      sourceSHA256: { 'src/core.ts': coreSHA, 'examples/reference.ts': fixtureSHA }, sourceIdentities: { policy: 'Exact compiler input bytes.' },
      sourceChangedAfterFreeze: [], completedAt: new Date(Date.UTC(2026, 0, ++sequence)).toISOString(),
      pixelEquivalence: { status: 'waived_by_user' }, cases: [row('values'), row('lifecycle')], errors: [], ...changes,
    };
    const path = directory + '/report.json', bytes = Buffer.from(JSON.stringify(report)); files.set(resolve(root, path), bytes);
    const descriptor = { id: name, path, sha256: hash(bytes) }; ledger.reports.push(descriptor);
    for (const assertion of assertions) if (bindNames.includes(assertion.id)) assertion.attempts.push({ reportId: name, caseId: assertion.id });
    return { report, descriptor };
  };
  const run = () => summarizeReferenceFunctional(ledger, root, { read });
  return { ledger, assertions, files, row, add, run, referenceSHA };
}

test('local passes and metadata example associations never promote an unreviewed reference requirement', async () => {
  const f = fixture(); f.add('good', {}, []);
  for (const r of f.ledger.examples[0].requirements) { r.reference.reviewed = false; r.reference.assertions = []; }
  const result = await f.run();
  assert.equal(result.counts.referenceFunctionalComplete, 0);
  assert.equal(result.counts.pairedRequirementsPassed, 0);
  assert.equal(result.examples[0].pixelEquivalence.status, 'waived_by_user');
});

test('one checked result cannot certify a missing requirement or an unreviewed API/boundary inventory', async () => {
  const f = fixture(); f.add('partial', {}, ['values']);
  let result = await f.run(); assert.equal(result.counts.pairedRequirementsPassed, 1); assert.equal(result.counts.referenceFunctionalComplete, 0);
  f.add('complete'); f.ledger.examples[0].coverageReview.apiSurface = [];
  result = await f.run(); assert.equal(result.counts.pairedRequirementsPassed, 2); assert.equal(result.counts.referenceFunctionalComplete, 0);
});

test('a fully reviewed finite fixture passes only its explicit scope', async () => {
  const f = fixture(); f.add('complete'); const result = await f.run();
  assert.equal(result.counts.referenceFunctionalComplete, 1);
  assert.equal(result.fullOfficialSiteEquivalence, false);
  assert.equal(result.allPublicLibraryAPIsCovered, false);
});

test('a new required grid-consistency amendment cannot disappear behind already passed local requirements', async () => {
  const f = fixture(); f.add('complete');
  f.ledger.derivedRequirements = [{ id: 'grid-consistency', required: true, reviewed: false, aspects: [{ id: 'major-minor', bindings: [] }] }];
  const result = await f.run();
  assert.equal(result.counts.referenceFunctionalComplete, 1);
  assert.equal(result.counts.derivedRequiredIncomplete, 1);
  assert.equal(result.referenceScopeComplete, false);
});

test('a declared pass with unequal raw observations, unequal inputs, or conflicting failure is rejected', async () => {
  for (const change of ['output', 'input', 'flag']) {
    const f = fixture(), value = f.row('values');
    if (change === 'output') value.observation.candidate.result = { value: 99 };
    else if (change === 'input') value.observation.candidate.input.values = [7, 8];
    else (value as any).passed = false;
    f.add('false-pass', { cases: [value, f.row('lifecycle')] });
    const result = await f.run(); assert.equal(result.examples[0].status, 'failed', change);
  }
});

test('missing observations cannot compare equal and one runtime cannot impersonate both sides', async () => {
  for (const change of ['missing', 'same-side', 'no-input']) {
    const f = fixture(); f.add('good');
    if (change === 'missing') { f.assertions[0].referencePointer = '/reference/absent'; f.assertions[0].candidatePointer = '/candidate/absent'; }
    else if (change === 'same-side') f.assertions[0].candidatePointer = '/reference/result';
    else f.assertions[0].input.candidatePointer = '/candidate/not-recorded';
    const result = await f.run(); assert.equal(result.examples[0].status, 'blocked', change);
  }
});

test('stale core, tampered report, unpinned runtime, or changed fixture bytes block evidence', async () => {
  for (const change of ['core', 'report', 'version', 'fixture']) {
    const f = fixture(), added = f.add('good', change === 'version' ? { reference: { version: '5.2.1', path: 'vendor/reference.js', sha256: f.referenceSHA } } : {});
    if (change === 'core') f.files.set(resolve(root, 'src/core.ts'), Buffer.from('modified'));
    if (change === 'report') added.descriptor.sha256 = hash('wrong');
    if (change === 'fixture') f.files.set(resolve(root, 'examples/reference.ts'), Buffer.from('modified'));
    const result = await f.run(); assert.equal(result.examples[0].status, 'blocked', change);
  }
});

test('headless execution and incomplete freeze metadata cannot certify visible paired behavior', async () => {
  for (const changes of [{ headless: true }, { browserVisible: false }, { sourceChangedAfterFreeze: ['src/core.ts'] }]) {
    const f = fixture(); f.add('invalid', changes); assert.equal((await f.run()).examples[0].status, 'blocked');
  }
});

test('a recorded pass without a finite positive assertion count cannot certify an observation',async()=>{
  for(const count of[undefined,0,-1,.5,Infinity]){
    const f=fixture();f.add('no-assertions',{cases:[{...f.row('values'),assertionCount:count},f.row('lifecycle')]});
    const result=await f.run();assert.equal(result.examples[0].status,'blocked');assert.equal(result.referenceScopeComplete,false);
  }
});

test('an intentional reference bug fix is not promoted by binding only its equal subfields',async()=>{
  const f=fixture(),value=f.row('values');
  (value.metadata as any).equivalence='intentional-difference';
  (value.metadata as any).reason='A separate field safely fixes a reference non-finite result.';
  f.add('accepted-difference-observation',{cases:[value,f.row('lifecycle')]});
  const result=await f.run();assert.equal(result.examples[0].status,'blocked');assert.equal(result.referenceScopeComplete,false);
  assert.equal(result.reports[0].observedScenarioAttempts[0].recordedStatus,'passed');
  assert.equal(result.reports[0].observedScenarioAttempts[0].intentionalDifference,true);
});

test('an observation-only geometry probe cannot be promoted by matching an incidental return value',async()=>{
  const f=fixture(),value=f.row('values');(value.metadata as any).equivalence='observation-only';
  f.add('public-observation',{cases:[value,f.row('lifecycle')]});
  const result=await f.run();assert.equal(result.examples[0].status,'blocked');assert.equal(result.referenceScopeComplete,false);
  assert.equal(result.examples[0].requirements[0].assertions[0].current.comparisonClassification,'observation-only');
});

test('explicit non-equivalence and observation flags cannot be bypassed by equal incidental fields',async()=>{
  for(const metadata of[{strictReferenceEquivalence:false},{observationOnly:true},{strictReferenceEquivalence:true,observationOnly:true}]){
    const f=fixture(),value=f.row('values');Object.assign(value.metadata,metadata);
    f.add('non-equivalent-observation',{cases:[value,f.row('lifecycle')]});
    const result=await f.run();assert.equal(result.examples[0].status,'blocked');assert.equal(result.referenceScopeComplete,false);
    assert.equal(result.reports[0].observedScenarioAttempts[0].recordedStatus,'passed');
    assert.equal(result.reports[0].observedScenarioAttempts[0].excludedFromStrictComparison,true);
  }
});

test('a later registered case failure is retained even if omitted from assertion bindings', async () => {
  const f = fixture(); f.add('first');
  f.add('later-failure', { cases: [{ ...f.row('values'), status: 'failed', error: 'Actual mismatch' }] }, []);
  const result = await f.run(); assert.equal(result.examples[0].status, 'failed');
  assert.equal(result.examples[0].requirements[0].assertions[0].current.automaticallyRetainedFailure, true);
});

test('global failures block old passes and cannot be cleared by a union of focused successes', async () => {
  const f = fixture(); f.add('first'); f.add('fatal', { cases: [], errors: ['Uncaught after prior checks'] }, []);
  assert.equal((await f.run()).examples[0].status, 'failed');
  f.add('focused-values', { cases: [f.row('values')] }, ['values']);
  f.add('focused-life', { cases: [f.row('lifecycle')] }, ['lifecycle']);
  let result = await f.run(); assert.equal(result.examples[0].referenceFunctionalComplete, false); assert.equal(result.examples[0].unresolvedGlobalErrors.length, 1);
  f.add('full-repair'); result = await f.run();
  assert.equal(result.examples[0].referenceFunctionalComplete, true);
  assert.equal(result.examples[0].globalErrorHistory[0].repairedBy, 'full-repair');
});

test('attributed errors only fail the actual case; an unknown error remains blocking', async () => {
  const f = fixture(); f.add('other-error', { errors: [{ caseId: 'unrelated', message: 'Different scenario failed' }] });
  assert.equal((await f.run()).counts.referenceFunctionalComplete, 1);
  f.add('actual-error', { errors: [{ caseId: 'values', message: 'Own runtime failed' }] });
  assert.equal((await f.run()).examples[0].status, 'failed');
});

test('tagged NaN, undefined and negative zero are preserved, not collapsed to null or zero', () => {
  assert.equal(compareReferenceValues({ $number: 'NaN' }, { $number: 'NaN' }, exact).status, 'passed');
  assert.equal(compareReferenceValues({ $number: 'NaN' }, null, exact).status, 'failed');
  assert.equal(compareReferenceValues({ $value: 'undefined' }, null, exact).status, 'failed');
  assert.equal(compareReferenceValues({ $number: '-0' }, 0, exact).status, 'failed');
});

test('numeric tolerance must be explicit, unit-bound, finite, and actually enforced', () => {
  const comparison = { kind: 'number', units: 'seconds', rationale: 'Explicit finite rounding bound.', absolute: 0.001, relative: 0 };
  assert.equal(compareReferenceValues(1, 1.0005, comparison).status, 'passed');
  assert.equal(compareReferenceValues(1, 1.002, comparison).status, 'failed');
  assert.equal(compareReferenceValues(1, 1, { ...comparison, absolute: undefined }).status, 'blocked');
  assert.equal(compareReferenceValues(1, 2, { ...comparison, absolute: Infinity }).status, 'blocked');
  assert.equal(compareReferenceValues({ $number: 'NaN' }, { $number: 'NaN' }, comparison).status, 'blocked');
});

test('an explicit common phase root reads original nested raw values and separately pinned initial input', async () => {
  const f = fixture(), value: any = f.row('values'), sides = value.observation;
  value.observation = { initial: sides, after: { reference: { result: { count: 12 } }, candidate: { result: { count: 12 } } } };
  const assertion: any = f.assertions[0]; assertion.observationRoot = '/after'; assertion.input.observationRoot = '/initial';
  f.add('phase-pair', { cases: [value, f.row('lifecycle')] });
  const result = await f.run(); assert.equal(result.counts.referenceFunctionalComplete, 1);
  assert.deepEqual(result.examples[0].requirements[0].assertions[0].current.comparison.reference, { count: 12 });
});

test('nested phases are never inferred and a missing runtime side cannot masquerade as a pair', async () => {
  for (const mode of ['no-root', 'missing-reference', 'missing-candidate', 'wrong-root', 'array-root']) {
    const f = fixture(), value: any = f.row('values'), sides: any = value.observation;
    value.observation = { after: sides };
    const assertion: any = f.assertions[0]; if (mode !== 'no-root') assertion.observationRoot = mode === 'wrong-root' ? '/absent' : '/after';
    if (mode === 'missing-reference') delete sides.reference;
    if (mode === 'missing-candidate') delete sides.candidate;
    if (mode === 'array-root') value.observation.after = [sides];
    f.add(mode, { cases: [value, f.row('lifecycle')] });
    assert.equal((await f.run()).examples[0].status, 'blocked', mode);
  }
});

test('phase selection keeps actual input mismatch and numeric output tolerances strict', async () => {
  for (const mode of ['input', 'output']) {
    const f = fixture(), value: any = f.row('values'), sides = value.observation;
    value.observation = { after: sides };
    const assertion: any = f.assertions[0]; assertion.observationRoot = '/after';
    if (mode === 'input') sides.candidate.input.values = [8, 9];
    else { sides.reference.result = 1; sides.candidate.result = 1.002; assertion.comparison = { kind: 'number', units: 'seconds', rationale: 'Unchanged finite bound.', absolute: .001, relative: 0 }; }
    f.add(mode, { cases: [value, f.row('lifecycle')] });
    assert.equal((await f.run()).examples[0].status, 'failed', mode);
  }
});

test('a phase root cannot impersonate sides or mix the two runtime phases', async () => {
  for (const mode of ['same-side', 'mixed-output-phase', 'mixed-input-phase', 'nested-output-phase', 'nested-input-phase', 'split-root', 'root-inside-runtime']) {
    const f = fixture(), value: any = f.row('values'), sides = value.observation;
    value.observation = { before: sides, after: structuredClone(sides), reference: { after: sides } };
    const assertion: any = f.assertions[0]; assertion.observationRoot = '/after';
    if (mode === 'same-side') assertion.candidatePointer = '/reference/result';
    if (mode === 'mixed-output-phase') assertion.candidatePointer = '/before/candidate/result';
    if (mode === 'mixed-input-phase') assertion.input.candidatePointer = '/before/candidate/input';
    if (mode === 'nested-output-phase' || mode === 'nested-input-phase') {
      value.observation.after = { reference: { before: sides.reference, after: sides.reference }, candidate: { before: sides.candidate, after: sides.candidate } };
      assertion.referencePointer = '/reference/before/result'; assertion.candidatePointer = '/candidate/before/result';
      assertion.input.referencePointer = '/reference/before/input'; assertion.input.candidatePointer = '/candidate/before/input';
      if (mode === 'nested-output-phase') assertion.candidatePointer = '/candidate/after/result';
      else assertion.input.candidatePointer = '/candidate/after/input';
    }
    if (mode === 'split-root') assertion.observationRoot = { reference: '/before', candidate: '/after' };
    if (mode === 'root-inside-runtime') assertion.observationRoot = '/reference/after';
    f.add(mode, { cases: [value, f.row('lifecycle')] });
    assert.equal((await f.run()).examples[0].status, 'blocked', mode);
  }
});

test('malformed phase or input pointers remain blocked instead of defaulting to root observations', async () => {
  for (const field of ['observationRoot', 'inputRoot']) for (const invalid of ['', 'after', '/after~2', '/missing', null, 5, {}]) {
    const f = fixture(), value: any = f.row('values'), assertion: any = f.assertions[0];
    if (field === 'observationRoot') assertion.observationRoot = invalid;
    else assertion.input.observationRoot = invalid;
    f.add(field, { cases: [value, f.row('lifecycle')] });
    assert.equal((await f.run()).examples[0].status, 'blocked', `${field}: ${JSON.stringify(invalid)}`);
  }
});
