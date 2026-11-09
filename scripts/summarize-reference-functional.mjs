import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const sha = value => createHash('sha256').update(value).digest('hex');
const isSHA = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hashMap = value => object(value) && Object.keys(value).length > 0 && Object.values(value).every(isSHA);
const dimensions = ['results', 'interaction', 'api', 'boundary', 'functionalDisplay', 'lifecycle'];
const comparisonClassification = row => row.metadata?.equivalence ?? (row.metadata?.observationOnly === true ? 'observation-only' : row.metadata?.strictReferenceEquivalence === false ? 'non-equivalent-scope' : 'unspecified');
const strictComparisonExcluded = row => ['intentional-difference','observation-only'].includes(row.metadata?.equivalence) || row.metadata?.observationOnly === true || row.metadata?.strictReferenceEquivalence === false;
const pointer = (value, path) => {
  if (typeof path !== 'string' || !path.startsWith('/')) return { found: false };
  for (const token of path.slice(1).split('/')) {
    if (/~(?![01])/u.test(token)) return { found: false };
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return { found: false };
    value = value[key];
  }
  return { found: true, value };
};

/** Select an explicitly named phase without moving, aliasing or rewriting raw observations. */
const pairedObservation = (observation, root) => {
  let selected = observation;
  if (root !== undefined) {
    if (typeof root !== 'string' || !root.startsWith('/') || /~(?![01])/u.test(root)) return { found: false };
    // A phase root must sit outside either runtime side. It cannot turn one
    // runtime's nested object into an alleged independent pair.
    const tokens = root.slice(1).split('/').map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (tokens.some(x => x === 'reference' || x === 'candidate')) return { found: false };
    const result = pointer(observation, root);
    if (!result.found) return { found: false };
    selected = result.value;
  }
  return object(selected) && Object.hasOwn(selected, 'reference') && Object.hasOwn(selected, 'candidate')
    ? { found: true, value: selected } : { found: false };
};

/** No coercion, wildcard match, percentage default, or inferred tolerance. */
export function compareReferenceValues(reference, candidate, comparison) {
  if (!object(comparison) || !isText(comparison.units) || !isText(comparison.rationale)) {
    return { status: 'blocked', reason: 'Explicit comparison, units and rationale are required.' };
  }
  if (comparison.kind === 'exact') {
    return { status: isDeepStrictEqual(reference, candidate) ? 'passed' : 'failed', reference, candidate };
  }
  if (comparison.kind === 'number') {
    const { absolute, relative } = comparison;
    if (![absolute, relative].every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0)) {
      return { status: 'blocked', reason: 'Numeric absolute and relative tolerances must both be explicit and finite.' };
    }
    if (![reference, candidate].every(x => typeof x === 'number' && Number.isFinite(x))) {
      return { status: 'blocked', reason: 'Numeric tolerance is scalar and finite only; compare tagged special values exactly.' };
    }
    const difference = Math.abs(candidate - reference), allowed = absolute + relative * Math.abs(reference);
    if (!Number.isFinite(difference) || !Number.isFinite(allowed)) return { status: 'blocked', reason: 'Comparison arithmetic overflow.' };
    return { status: difference <= allowed ? 'passed' : 'failed', reference, candidate, difference, allowed, units: comparison.units };
  }
  return { status: 'blocked', reason: 'Unsupported comparison kind; add a reviewed independent comparator before using it.' };
}

function validateLedger(ledger) {
  if (ledger?.schemaVersion !== 1 || ledger.kind !== 'reference-functional-ledger') throw new TypeError('Unsupported reference ledger.');
  if (!isText(ledger.sessionId) || !isText(ledger.scopeId)) throw new TypeError('Session and scope identity are required.');
  if (!Array.isArray(ledger.examples) || !ledger.examples.length) throw new TypeError('Explicit example inventory is required.');
  if (!Array.isArray(ledger.baselines) || !Array.isArray(ledger.reports)) throw new TypeError('Explicit baseline and report registries are required.');
  for (const rows of [ledger.examples, ledger.baselines, ledger.reports]) {
    if (rows.some(x => !isText(x.id)) || new Set(rows.map(x => x.id)).size !== rows.length) throw new TypeError('Registry IDs must be unique and nonempty.');
  }
  for (const baseline of ledger.baselines) {
    if (!isText(baseline.version) || !isSHA(baseline.sha256) || !isText(baseline.scope)) throw new TypeError('A baseline needs an exact runtime version, SHA and scope.');
  }
  for (const example of ledger.examples) {
    if (!Array.isArray(example.requirements) || !example.requirements.length) throw new TypeError('Every example needs explicit requirements.');
    if (new Set(example.requirements.map(x => x.id)).size !== example.requirements.length) throw new TypeError('Requirement IDs must be unique within an example.');
  }
  if (ledger.policy?.pixelEquivalence?.status !== 'waived_by_user') throw new TypeError('This ledger requires the explicit user pixel waiver; never infer a pixel pass.');
}

/** Only registered, SHA-pinned reports are read. Metadata association is not coverage. */
export async function summarizeReferenceFunctional(ledger, root, { read = readFile } = {}) {
  validateLedger(ledger);
  const baselineById = new Map(ledger.baselines.map(x => [x.id, x]));
  const currentHashes = new Map(), reports = new Map();
  const fileHash = path => {
    const absolute = resolve(root, path);
    if (!currentHashes.has(absolute)) currentHashes.set(absolute, read(absolute).then(sha).catch(() => null));
    return currentHashes.get(absolute);
  };
  for (const descriptor of ledger.reports) {
    const issues = [], path = resolve(root, descriptor.path ?? '');
    let report;
    try {
      const bytes = await read(path);
      if (!isSHA(descriptor.sha256) || sha(bytes) !== descriptor.sha256) issues.push('report-sha-missing-or-mismatch');
      report = JSON.parse(bytes.toString('utf8'));
    } catch (error) { issues.push('report-unreadable: ' + String(error)); }
    if (report) {
      if (report.schemaVersion !== 1 || !isText(report.suiteId) || !Array.isArray(report.cases)) issues.push('invalid-report-schema');
      if (report.browserVisible !== true || report.headless !== false) issues.push('visible-browser-not-established');
      if (report.pixelEquivalence?.status !== 'waived_by_user') issues.push('pixel-waiver-missing');
      if (!isText(report.reference?.version) || !isSHA(report.reference?.sha256) || !isText(report.reference?.path)) issues.push('reference-identity-incomplete');
      if (!isText(report.candidate?.version) || !isSHA(report.candidate?.distributionSHA256) || !isText(report.candidate?.path) || !hashMap(report.candidate?.sourceSHA256)) issues.push('candidate-identity-incomplete');
      if (!isText(report.fixture?.path) || !isSHA(report.fixture?.sha256) || !isSHA(report.fixture?.bundleSHA256) || !hashMap(report.fixture?.inputSHA256)) issues.push('fixture-identity-incomplete');
      if (!hashMap(report.sourceSHA256) || !isText(report.sourceIdentities?.policy)) issues.push('compiled-source-identity-incomplete');
      if (!Array.isArray(report.errors)) issues.push('explicit-report-errors-array-required');
      if (!isText(report.completedAt) || !Number.isFinite(Date.parse(report.completedAt))) issues.push('completed-report-required');
      if (!Array.isArray(report.sourceChangedAfterFreeze) || report.sourceChangedAfterFreeze.length) issues.push('source-freeze-not-established');
      if (Array.isArray(report.cases) && (report.cases.some(x => !isText(x.id)) || new Set(report.cases.map(x => x.id)).size !== report.cases.length)) issues.push('case-ids-invalid-or-duplicated');
      if (report.candidate?.version !== ledger.candidateTarget?.version) issues.push('candidate-version-mismatch');
      if (hashMap(report.candidate?.sourceSHA256)) {
        const ownInputs = Object.entries(report.candidate.sourceSHA256);
        if (!ownInputs.some(([path]) => path.startsWith('src/'))) issues.push('candidate-has-no-core-source-inputs');
        for (const [sourcePath, expected] of ownInputs) {
          if (report.sourceSHA256?.[sourcePath] !== expected || await fileHash(sourcePath) !== expected) issues.push('candidate-source-stale: ' + sourcePath);
        }
      }
      if (hashMap(report.fixture?.inputSHA256)) for (const [sourcePath, expected] of Object.entries(report.fixture.inputSHA256)) {
        if (report.sourceSHA256?.[sourcePath] !== expected || await fileHash(sourcePath) !== expected) issues.push('fixture-input-stale: ' + sourcePath);
      }
      for (const [label, file, expected] of [
        ['reference-runtime', report.reference?.path, report.reference?.sha256],
        ['candidate-runtime', report.candidate?.path, report.candidate?.distributionSHA256],
        ['fixture-source', report.fixture?.path, report.fixture?.sha256],
        ['fixture-bundle', resolve(dirname(path), 'fixture.js'), report.fixture?.bundleSHA256],
      ]) if (isText(file) && isSHA(expected) && await fileHash(file) !== expected) issues.push(label + '-file-sha-mismatch');
    }
    reports.set(descriptor.id, { descriptor, report, issues });
  }

  const evaluateAttempt = (binding, assertion, baseline) => {
    const loaded = reports.get(binding.reportId), failures = [];
    if (!loaded) return { reportId: binding.reportId, caseId: binding.caseId, status: 'blocked', reasons: ['Unregistered report.'] };
    const { descriptor, report, issues } = loaded;
    const result = { reportId: binding.reportId, reportPath: descriptor.path, reportSHA256: descriptor.sha256, caseId: binding.caseId, completedAt: report?.completedAt ?? '', status: 'blocked', reasons: [...issues] };
    if (!report) return result;
    if (report.reference?.version !== baseline?.version || report.reference?.sha256 !== baseline?.sha256) result.reasons.push('Requested baseline version/SHA does not match executed reference.');
    const row = report.cases?.find(x => x.id === binding.caseId);
    result.executedStatus = row?.status ?? 'missing';
    const errors = Array.isArray(report.errors) ? report.errors : [];
    const unassigned = errors.filter(x => !object(x) || !isText(x.caseId));
    const attributed = errors.filter(x => object(x) && x.caseId === binding.caseId);
    if (unassigned.length) failures.push(...unassigned);
    if (attributed.length) failures.push(...attributed);
    if (!row) result.reasons.push('Exact executed case is missing.');
    if (row?.status !== 'passed' || row?.passed === false || row?.error || row?.screenshotError || row?.pageErrors?.length) failures.push(row?.error ?? row?.screenshotError ?? 'Case did not pass or contains a conflicting failure.');
    result.runtimeErrors = failures;
    if (result.reasons.length) return result;
    if (failures.length) return { ...result, status: 'failed' };
    if (!Number.isSafeInteger(row.assertionCount) || row.assertionCount < 1) return { ...result, reasons: ['A passed reference scenario must record at least one executed counted assertion.'] };
    if (strictComparisonExcluded(row)) return { ...result, reasons: ['This scenario records an observation or intentional difference, not strict reference equivalence. Record any explicit difference acceptance separately.'], comparisonClassification: comparisonClassification(row) };
    const observation = pairedObservation(row.observation, assertion.observationRoot);
    if (!observation.found) return { ...result, reasons: ['Dual-runtime raw observations are required at the explicit common observation root.'] };
    if (!assertion.referencePointer?.startsWith('/reference/') || !assertion.candidatePointer?.startsWith('/candidate/')) return { ...result, reasons: ['Pointers must select distinct explicit runtime sides.'] };
    if (assertion.observationRoot !== undefined && assertion.referencePointer.slice(11) !== assertion.candidatePointer.slice(11)) return { ...result, reasons: ['An explicit phase requires the same relative result path on both runtime sides.'] };
    const reference = pointer(observation.value, assertion.referencePointer), candidate = pointer(observation.value, assertion.candidatePointer);
    if (!reference.found || !candidate.found) return { ...result, reasons: ['An observation pointer is missing; absent values cannot compare as equal.'] };
    if (!assertion.input?.referencePointer?.startsWith('/reference/') || !assertion.input?.candidatePointer?.startsWith('/candidate/')) return { ...result, reasons: ['Explicit dual-runtime input/configuration observations are required.'] };
    const inputRoot = Object.hasOwn(assertion.input, 'observationRoot') ? assertion.input.observationRoot : assertion.observationRoot;
    const inputObservation = pairedObservation(row.observation, inputRoot);
    if (!inputObservation.found) return { ...result, reasons: ['Explicit dual-runtime input/configuration observations are required at one common input root.'] };
    if (inputRoot !== undefined && assertion.input.referencePointer.slice(11) !== assertion.input.candidatePointer.slice(11)) return { ...result, reasons: ['An explicit input phase requires the same relative configuration path on both runtime sides.'] };
    const referenceInput = pointer(inputObservation.value, assertion.input.referencePointer), candidateInput = pointer(inputObservation.value, assertion.input.candidatePointer);
    if (!referenceInput.found || !candidateInput.found) return { ...result, reasons: ['Input/configuration observation is absent.'] };
    if (!isDeepStrictEqual(referenceInput.value, candidateInput.value)) return { ...result, status: 'failed', reasons: ['Inputs/configuration differ; equal outputs do not establish a paired result.'], input: { reference: referenceInput.value, candidate: candidateInput.value } };
    const comparison = compareReferenceValues(reference.value, candidate.value, assertion.comparison);
    return { ...result, status: comparison.status, comparison, inputComparison: 'exact', actualReference: report.reference, actualCandidate: { version: report.candidate.version, distributionSHA256: report.candidate.distributionSHA256 }, fixture: report.fixture };
  };

  const examples = ledger.examples.map(example => {
    const requirements = example.requirements.map(requirement => {
      const mapping = requirement.reference ?? {}, baseline = baselineById.get(mapping.baselineId);
      const mappingReady = mapping.reviewed === true && isText(mapping.rationale) && baseline && Array.isArray(mapping.assertions) && mapping.assertions.length > 0;
      const assertions = (mapping.assertions ?? []).map(assertion => {
        const bindings = assertion.attempts ?? [];
        const attempts = bindings.map(binding => evaluateAttempt(binding, assertion, baseline));
        // The author must retain chronological attempts. Never filter out a
        // failed, invalid or incomplete latest record to revive an earlier pass.
        const chronologyValid = attempts.every((attempt, index) => !index || !attempt.completedAt || !attempts[index - 1].completedAt || Date.parse(attempt.completedAt) >= Date.parse(attempts[index - 1].completedAt));
        let latest = attempts.at(-1);
        // Registered later failures are barriers even if a reviewer forgot to
        // append that failure to this assertion's list. Only explicitly bound
        // observations can add a pass.
        const origin = reports.get(latest?.reportId)?.report;
        for (const [reportId, loaded] of reports) {
          const next = loaded.report;
          if (!origin || loaded.issues.length || next?.suiteId !== origin.suiteId || next.reference?.sha256 !== origin.reference?.sha256 || next.candidate?.distributionSHA256 !== origin.candidate?.distributionSHA256 || Date.parse(next.completedAt) <= Date.parse(latest?.completedAt ?? '')) continue;
          const row = next.cases.find(x => x.id === latest.caseId);
          const scopedErrors = next.errors.filter(x => !object(x) || !isText(x.caseId) || x.caseId === latest.caseId);
          if (scopedErrors.length || row && (row.status !== 'passed' || row.passed === false || row.error || row.screenshotError || row.pageErrors?.length)) {
            latest = evaluateAttempt({ reportId, caseId: latest.caseId }, assertion, baseline);
            latest.automaticallyRetainedFailure = true;
            attempts.push(latest);
          }
        }
        return { id: assertion.id, status: !chronologyValid ? 'blocked' : latest?.status ?? 'pending', chronologyValid, attempts, current: latest };
      });
      const status = !mappingReady ? 'pending' : assertions.some(x => x.status === 'failed') ? 'failed' : assertions.some(x => x.status === 'blocked') ? 'blocked' : assertions.every(x => x.status === 'passed') ? 'passed' : 'pending';
      return { id: requirement.id, description: requirement.description, required: requirement.required !== false, dimensions: mapping.dimensions ?? [], baselineId: mapping.baselineId ?? null, mappingReviewed: mapping.reviewed === true, status, assertions };
    });
    const coverage = example.coverageReview ?? {};
    const inventory = [...(coverage.apiSurface ?? []), ...(coverage.boundaryCases ?? [])];
    const reviewComplete = coverage.status === 'reviewed' && isText(coverage.reviewer) && isText(coverage.scopeStatement) && (coverage.apiSurface?.length ?? 0) > 0 && (coverage.boundaryCases?.length ?? 0) > 0 && inventory.every(entry => isText(entry.id) && isText(entry.description) && entry.requirementIds?.length > 0 && entry.requirementIds.every(id => requirements.some(r => r.id === id && r.required)));
    const byDimension = Object.fromEntries(dimensions.map(dimension => {
      const rows = requirements.filter(r => r.required && r.dimensions.includes(dimension));
      const status = !rows.length ? 'pending' : rows.some(r => r.status === 'failed') ? 'failed' : rows.some(r => r.status === 'blocked') ? 'blocked' : rows.every(r => r.status === 'passed') ? 'passed' : 'pending';
      return [dimension, { status, requirementIds: rows.map(r => r.id) }];
    }));
    const slots = requirements.filter(x => x.required).flatMap(x => x.assertions);
    const globalErrorHistory = [...reports].flatMap(([reportId, loaded]) => {
      const report = loaded.report;
      if (!report || loaded.issues.length) return [];
      const errors = report.errors.filter(x => !object(x) || !isText(x.caseId));
      if (!errors.length) return [];
      const affected = slots.filter(slot => slot.attempts.some(attempt => {
        const candidate = reports.get(attempt.reportId)?.report;
        return candidate?.suiteId === report.suiteId && candidate.reference?.sha256 === report.reference?.sha256 && candidate.candidate?.distributionSHA256 === report.candidate?.distributionSHA256;
      }));
      if (!affected.length) return [];
      const repairIds = new Set(affected.map(x => x.current?.reportId));
      const repaired = repairIds.size === 1 && affected.every(x => x.status === 'passed' && Date.parse(x.current.completedAt) > Date.parse(report.completedAt));
      return [{ reportId, errors, affectedAssertions: affected.map(x => x.id), repairedBy: repaired ? [...repairIds][0] : null }];
    });
    const unresolvedGlobalErrors = globalErrorHistory.filter(x => !x.repairedBy);
    const failed = requirements.some(x => x.status === 'failed') || unresolvedGlobalErrors.length > 0, blocked = requirements.some(x => x.status === 'blocked');
    const complete = !failed && !blocked && reviewComplete && requirements.filter(x => x.required).every(x => x.status === 'passed') && dimensions.every(key => byDimension[key].status === 'passed');
    return { id: example.id, status: failed ? 'failed' : blocked ? 'blocked' : complete ? 'passed' : 'pending', referenceFunctionalComplete: complete, coverageReviewComplete: Boolean(reviewComplete), dimensions: byDimension, requirements, globalErrorHistory, unresolvedGlobalErrors, pixelEquivalence: ledger.policy.pixelEquivalence, scope: 'Only explicitly reviewed requirement and API/boundary inventory bindings. Official-page data/version parity is a separate baseline.' };
  });
  const derivedRequirements = (ledger.derivedRequirements ?? []).map(item => {
    const aspects = (item.aspects ?? []).map(aspect => {
      const bindings = (aspect.bindings ?? []).map(binding => ({ ...binding, status: examples.find(example => example.id === binding.exampleId)?.requirements.find(requirement => requirement.id === binding.requirementId)?.status ?? 'pending' }));
      return { id: aspect.id, description: aspect.description, bindings, status: !bindings.length ? 'pending' : bindings.some(x => x.status === 'failed') ? 'failed' : bindings.some(x => x.status === 'blocked') ? 'blocked' : bindings.every(x => x.status === 'passed') ? 'passed' : 'pending' };
    });
    const reviewed = item.reviewed === true && isText(item.scopeStatement) && aspects.length > 0;
    return { id: item.id, description: item.description, required: item.required !== false, reviewed, aspects, status: !reviewed ? 'pending' : aspects.some(x => x.status === 'failed') ? 'failed' : aspects.some(x => x.status === 'blocked') ? 'blocked' : aspects.every(x => x.status === 'passed') ? 'passed' : 'pending' };
  });
  return {
    schemaVersion: 1, kind: 'reference-functional-summary', createdAt: new Date().toISOString(), sessionId: ledger.sessionId, scopeId: ledger.scopeId,
    ledgerSHA256: sha(JSON.stringify(ledger)), policy: ledger.policy,
    counts: { examples: examples.length, referenceFunctionalComplete: examples.filter(x => x.referenceFunctionalComplete).length, failed: examples.filter(x => x.status === 'failed').length, blocked: examples.filter(x => x.status === 'blocked').length, pending: examples.filter(x => x.status === 'pending').length, requiredRequirements: examples.reduce((n, x) => n + x.requirements.filter(r => r.required).length, 0), pairedRequirementsPassed: examples.reduce((n, x) => n + x.requirements.filter(r => r.required && r.status === 'passed').length, 0), derivedRequired: derivedRequirements.filter(x => x.required).length, derivedRequiredIncomplete: derivedRequirements.filter(x => x.required && x.status !== 'passed').length },
    reports: [...reports].map(([id, { descriptor, report, issues }]) => ({ id, path: descriptor.path, sha256: descriptor.sha256, suiteId: report?.suiteId, reference: report?.reference, candidate: report && { version: report.candidate?.version, distributionSHA256: report.candidate?.distributionSHA256 }, issues, observedScenarioAttempts: (report?.cases ?? []).map(row => ({ id: row.id, recordedStatus: row.status, error: row.error, assertionCount: row.assertionCount, comparisonClassification: comparisonClassification(row), excludedFromStrictComparison: strictComparisonExcluded(row), intentionalDifference: row.metadata?.equivalence === 'intentional-difference', candidateExampleAssociations: row.metadata?.exampleIds ?? [], scope: 'Recorded scenario result only; not a reviewed requirement or example reference pass.' })) })),
    examples, derivedRequirements, referenceScopeComplete: examples.every(x => x.referenceFunctionalComplete) && derivedRequirements.filter(x => x.required).every(x => x.status === 'passed'), fullOfficialSiteEquivalence: false, allPublicLibraryAPIsCovered: false, performanceAcceptance: false,
  };
}

async function main() {
  const args = process.argv.slice(2), get = name => { const value = args.find(x => x.startsWith(name + '=')), index = args.indexOf(name); return value ? value.slice(name.length + 1) : index >= 0 ? args[index + 1] : undefined; };
  const path = resolve(get('--ledger') ?? 'docs/reference-functional-verification.json');
  const bytes = await readFile(path), result = await summarizeReferenceFunctional(JSON.parse(bytes.toString('utf8')), process.cwd());
  result.ledgerFile = { path, sha256: sha(bytes) };
  const output = get('--out');
  if (output) await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output: output && resolve(output), ...result.counts }));
  if (result.counts.failed || result.counts.blocked) process.exitCode = 1;
  else if (result.counts.pending || result.counts.derivedRequiredIncomplete) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
