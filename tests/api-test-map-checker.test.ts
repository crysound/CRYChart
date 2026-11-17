import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The checker is exercised as infrastructure, not as part of the public chart API.
import {
  analyzeApiTests,
  serializeAnalysis,
} from "../scripts/api-test-map.mjs";
import {
  makeManifest,
  validateManifest,
  uncoveredUpdateApis,
  renderReport,
} from "../scripts/api-test-validation.mjs";
import { testFingerprint } from "../scripts/test-fingerprint.mjs";
import testCaseReporter from "../scripts/test-case-reporter.mjs";

const fixture = mkdtempSync(join(tmpdir(), "crychart-api-map-"));
mkdirSync(join(fixture, "src"));
mkdirSync(join(fixture, "tests"));
writeFileSync(
  join(fixture, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      types: [],
    },
    include: ["src/**/*.ts"],
  }),
);
writeFileSync(
  join(fixture, "src/themes.ts"),
  'export const theme = {name: "test"};',
);
const source = `export interface Range {start:number;end:number;}
export class Axis {
  range = {start:0,end:1};
  private hidden(){return 1;}
  protected helper(){return 2;}
  setInterval(start:number,end:number){this.range={start,end};return this;}
  getInterval(){return {...this.range};}
  setPadding(_value:number){return this;}
}
export class Child extends Axis {}
export function factory(){return {axis:()=>new Axis()};}
`;
writeFileSync(join(fixture, "src/index.ts"), source);
const spec = `import test from 'node:test';import assert from 'node:assert/strict';import {Axis} from '../src/index.js';
function verify(axis:Axis){assert.deepEqual(axis.getInterval(),{start:2,end:8});}
test('ranges retain endpoints',()=>{const axis=new Axis();axis.setInterval(2,8);verify(axis);});
test('no assertion is not evidence',()=>{new Axis().setInterval(2,8);});
test('skipped tests are not evidence',{skip:true},()=>{assert.equal(new Axis().getInterval().start,0);});
`;
writeFileSync(join(fixture, "tests/axis.test.ts"), spec);
const discovery = serializeAnalysis(analyzeApiTests(fixture));
const policy = {
  requiredOwners: ["Axis"],
  requiredApis: [],
  placeholders: { "Axis.setPadding": "Compatibility placeholder" },
  limitations: {},
};
const manifest = makeManifest(discovery, policy);
const result = {
  status: "passed",
  name: "ranges retain endpoints",
  file: join(fixture, "tests/axis.test.ts"),
};
const run = { complete: true, fingerprint: "same" };
function check(
  current = discovery,
  saved = manifest,
  execution = run,
  results: any[] = [result],
) {
  return validateManifest(current, saved, policy, execution, results, "same")
    .errors;
}

test("public inventory includes inherited paths and factory methods while excluding private and protected members", () => {
  const interval = discovery.entries.find((e) => e.id === "Axis.setInterval")!;
  assert.deepEqual(interval.paths, ["Axis.setInterval", "Child.setInterval"]);
  assert.ok(discovery.entries.some((e) => e.id === "factory().axis"));
  assert.ok(discovery.entries.some((e) => e.id === "type:Range"));
  assert.ok(
    !discovery.entries.some(
      (e) => e.id.endsWith(".hidden") || e.id.endsWith(".helper"),
    ),
  );
  assert.equal(
    discovery.entries.find((e) => e.id === "Axis.setPadding")!.placeholder,
    true,
  );
  assert.equal(
    discovery.entries.find((e) => e.id === "Axis.constructor")!.placeholder,
    false,
  );
});

test("assertions in called test helpers are traced but unasserted and skipped cases are excluded", () => {
  assert.equal(discovery.scenarios.length, 1);
  const scenario = discovery.scenarios[0]!;
  assert.equal(scenario.name, "ranges retain endpoints");
  assert.ok(scenario.apis.includes("Axis.setInterval"));
  assert.ok(scenario.apis.includes("Axis.getInterval"));
  assert.equal(
    scenario.assertions[0]!.expression,
    "assert.deepEqual(axis.getInterval(),{start:2,end:8})",
  );
  assert.deepEqual(check(), []);
});

test("new public methods and changed signatures cannot silently enter the reviewed API baseline", () => {
  const added = structuredClone(discovery);
  added.entries.push({
    ...added.entries[0]!,
    id: "Axis.newMethod",
    kind: "method",
  });
  assert.ok(
    check(added).some((e) =>
      e.includes("Unregistered public API: Axis.newMethod"),
    ),
  );
  const changed = structuredClone(discovery);
  changed.entries.find((e) => e.id === "Axis.setInterval")!.signature +=
    ", options?: unknown";
  assert.ok(
    check(changed).some((e) =>
      e.includes("Changed API declaration: Axis.setInterval"),
    ),
  );
});

test("deleted methods, assertion changes and removed API-to-scenario links fail the coverage gate", () => {
  const deleted = structuredClone(discovery);
  deleted.entries = deleted.entries.filter((e) => e.id !== "Axis.getInterval");
  assert.ok(
    check(deleted).some((e) =>
      e.includes("Removed public API: Axis.getInterval"),
    ),
  );
  const noAssertion = structuredClone(discovery);
  noAssertion.scenarios[0]!.assertions = [];
  assert.ok(
    check(noAssertion).some((e) => e.includes("Removed/changed assertion")),
  );
  const unlinked = structuredClone(discovery);
  unlinked.entries.find((e) => e.id === "Axis.getInterval")!.scenarios = [];
  assert.ok(
    check(unlinked).some((e) => e.includes("lost its assertion mapping")),
  );
});

test("unknown placeholders and duplicate IDs require explicit review", () => {
  const changed = structuredClone(discovery);
  const entry = changed.entries.find((e) => e.id === "Axis.getInterval")!;
  entry.placeholder = true;
  assert.ok(check(changed).some((e) => e.includes("Unreviewed placeholder")));
  const duplicate = structuredClone(manifest);
  duplicate.entries.push(duplicate.entries[0]!);
  assert.ok(
    check(discovery, duplicate).some((e) => e.includes("Duplicate API IDs")),
  );
});

test("stale failed skipped and missing test executions cannot satisfy assertion mappings", () => {
  assert.ok(
    check(discovery, manifest, { ...run, complete: false }).some((e) =>
      e.includes("Missing, failed or stale"),
    ),
  );
  assert.ok(
    check(discovery, manifest, { ...run, fingerprint: "old" }).some((e) =>
      e.includes("Missing, failed or stale"),
    ),
  );
  for (const results of [
    [],
    [{ ...result, status: "failed" }],
    [{ ...result, skipped: true }],
    [{ ...result, todo: true }],
  ]) {
    assert.ok(
      check(discovery, manifest, run, results).some((e) =>
        e.includes("Scenario did not pass"),
      ),
    );
  }
});

test("a different file with the same test title does not satisfy an ordinary mapped scenario", () => {
  assert.ok(
    check(discovery, manifest, run, [
      { ...result, file: join(fixture, "tests/other.test.ts") },
    ]).some((e) => e.includes("Scenario did not pass")),
  );
  assert.ok(
    check(discovery, manifest, run, [
      { ...result, file: join(fixture, "tests/helpers/api-test.ts") },
    ]).some((e) => e.includes("Scenario did not pass")),
  );
});

test("dynamic case titles accept passed parameterized variants and preserve regex metacharacters", () => {
  const saved = structuredClone(manifest),
    id = Object.keys(saved.scenarios)[0]!;
  saved.scenarios[id]!.name = "ranges [${kind}] retain endpoints";
  saved.scenarios[id]!.dynamic = true;
  assert.ok(
    !check(discovery, saved, run, [
      { ...result, name: "ranges [linear] retain endpoints" },
    ]).some((e) => e.includes("Scenario did not pass")),
  );
  assert.ok(
    check(discovery, saved, run, [
      { ...result, name: "ranges linear retain endpoints" },
    ]).some((e) => e.includes("Scenario did not pass")),
  );
});

test("commented API calls and a user-defined assert object cannot masquerade as functional assertions", () => {
  const file = join(fixture, "tests/fake.test.ts");
  writeFileSync(
    file,
    `import test from 'node:test';import {Axis} from '../src/index.js';
const assert={equal(){}};test('fake assertions',()=>{new Axis().getInterval();assert.equal(1,1);});`,
  );
  const fresh = serializeAnalysis(analyzeApiTests(fixture));
  assert.ok(!fresh.scenarios.some((s) => s.name === "fake assertions"));
  assert.equal(readFileSync(join(fixture, "src/index.ts"), "utf8"), source);
});

test("constructor argument changes are detected and protected constructors are not public entrypoints", () => {
  const file = join(fixture, "src/index.ts");
  try {
    writeFileSync(
      file,
      source.replace(
        "export class Axis {",
        "export class Axis { constructor(seed:number=0){this.range.start=seed;}",
      ) +
        "\nexport class Protected { protected constructor() {} }\nexport abstract class Contract { abstract getValue():number; }\n",
    );
    const fresh = serializeAnalysis(analyzeApiTests(fixture));
    assert.notEqual(
      fresh.entries.find((e) => e.id === "Axis.constructor")!.signature,
      discovery.entries.find((e) => e.id === "Axis.constructor")!.signature,
    );
    assert.ok(!fresh.entries.some((e) => e.id === "Protected.constructor"));
    assert.equal(
      fresh.entries.find((e) => e.id === "Contract.getValue")!.kind,
      "abstract",
    );
  } finally {
    writeFileSync(file, source);
  }
});

test("test fingerprints track test dependencies while generated API inventories remain independent", () => {
  for (const file of ["package.json", "package-lock.json", ".c8rc.json"])
    writeFileSync(join(fixture, file), "{}");
  mkdirSync(join(fixture, "docs"));
  mkdirSync(join(fixture, "scripts"));
  const file = join(fixture, "tests/axis.test.ts"),
    original = readFileSync(file, "utf8");
  const before = testFingerprint(fixture);
  writeFileSync(join(fixture, "docs/api-test-map.json"), '{"generated":true}');
  assert.equal(testFingerprint(fixture), before);
  writeFileSync(file, original + "\n// changed test dependency\n");
  assert.notEqual(testFingerprint(fixture), before);
  writeFileSync(file, original);
  assert.equal(testFingerprint(fixture), before);
  writeFileSync(join(fixture, "scripts/build.mjs"), "export const value=2;");
  assert.notEqual(testFingerprint(fixture), before);
});

test("machine-readable reporter retains failure and skip state instead of turning them into passing API evidence", async () => {
  async function* events() {
    yield { type: "test:diagnostic", data: { message: "not a test" } };
    yield { type: "test:pass", data: { name: "ok", file: "case.ts", line: 1 } };
    yield {
      type: "test:pass",
      data: { name: "skipped", file: "case.ts", skip: true },
    };
    yield {
      type: "test:fail",
      data: { name: "failed", file: "case.ts", todo: true },
    };
  }
  const rows: any[] = [];
  for await (const line of testCaseReporter(events()))
    rows.push(JSON.parse(line));
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => [row.name, row.status, row.skipped, row.todo]),
    [
      ["ok", "passed", false, false],
      ["skipped", "passed", true, false],
      ["failed", "failed", false, true],
    ],
  );
});

test("updating the map cannot bless a new API or erase previously mapped functional coverage", () => {
  const current = structuredClone(manifest);
  current.entries.find((e) => e.id === "Axis.getInterval")!.status = "missing";
  current.entries.push({
    ...current.entries[0]!,
    id: "Axis.newPublicMethod",
    kind: "method",
    status: "missing",
  });
  assert.deepEqual(uncoveredUpdateApis(manifest, current).sort(), [
    "Axis.getInterval",
    "Axis.newPublicMethod",
  ]);
  const placeholder = structuredClone(manifest);
  placeholder.entries.find((e) => e.id === "Axis.setPadding")!.status =
    "missing";
  assert.deepEqual(uncoveredUpdateApis(manifest, placeholder), [
    "Axis.setPadding",
  ]);
  const gap = {
    ...manifest.entries[0]!,
    id: "Legacy.unmapped",
    kind: "method",
    status: "missing",
  };
  const before = { ...manifest, entries: [...manifest.entries, gap] },
    after = structuredClone(before);
  assert.deepEqual(uncoveredUpdateApis(before, after), []);
});

test("public any engines nested literals and function-reference fields remain inventoried and callable", () => {
  const file = join(fixture, "src/index.ts");
  try {
    writeFileSync(
      file,
      source +
        `\nconst format=(n:number)=>String(n);export class EngineHost { engine:any; formatter=format; constructor(){this.engine={nested:{getValue:()=>3},dispose(){return false;}};} }`,
    );
    const fresh = serializeAnalysis(analyzeApiTests(fixture));
    for (const [id, kind] of [
      ["EngineHost.engine.nested.getValue", "factory-method"],
      ["EngineHost.engine.dispose", "method"],
      ["EngineHost.formatter", "factory-method"],
    ])
      assert.equal(fresh.entries.find((e) => e.id === id)?.kind, kind);
    assert.ok(!fresh.entries.some((e) => e.id === "value:Axis.range.start"));
  } finally {
    writeFileSync(file, source);
  }
});

test("zero gap policy rejects even a recorded legacy callable without an asserted scenario", () => {
  const report = validateManifest(
    discovery,
    manifest,
    { ...policy, requiredOwners: [], requireAllCallable: true },
    run,
    [result],
    "same",
  );
  assert.ok(
    report.errors.some((e) =>
      e.includes("Callable APIs require asserted scenarios"),
    ),
  );
});

test("shared public function aliases retain both API links and artifact reports resolve source links from their own directory", () => {
  const file = join(fixture, "src/index.ts"),
    specFile = join(fixture, "tests/alias.test.ts");
  try {
    writeFileSync(
      file,
      source +
        "\nexport function format(n:number){return String(n);} export const Formatters={Numeric:format};",
    );
    writeFileSync(
      specFile,
      `import test from 'node:test';import assert from 'node:assert/strict';import {Formatters} from '../src/index.js';test('numeric alias formats a number',()=>assert.equal(Formatters.Numeric(5),'5'));`,
    );
    const fresh = serializeAnalysis(analyzeApiTests(fixture)),
      saved = makeManifest(fresh, policy);
    for (const id of ["format", "Formatters.Numeric"])
      assert.ok(
        fresh.entries
          .find((e) => e.id === id)!
          .scenarios.some((id) =>
            id.endsWith("numeric alias formats a number"),
          ),
      );
    const docs = renderReport(fresh, saved, {}),
      artifact = renderReport(fresh, saved, {}, "../..");
    assert.ok(docs.includes("(../src/index.ts#L"));
    assert.ok(artifact.includes("(../../src/index.ts#L"));
    assert.ok(artifact.includes("(../../tests/alias.test.ts#L"));
  } finally {
    writeFileSync(file, source);
    writeFileSync(specFile, "// fixture removed");
  }
});

test("explicit scenarios with duplicate names cannot reuse one helper-file passing result", () => {
  const fresh = structuredClone(discovery),
    scenario = fresh.scenarios[0];
  scenario.explicit = true;
  fresh.scenarios.push({
    ...scenario,
    id: "tests/other.test.ts::" + scenario.name,
    file: "tests/other.test.ts",
  });
  const saved = makeManifest(fresh, policy),
    report = validateManifest(
      fresh,
      saved,
      policy,
      run,
      [{ ...result, file: join(fixture, "tests/helpers/api-test.ts") }],
      "same",
    );
  assert.ok(
    report.errors.some((e) =>
      e.includes("Ambiguous explicitly bound scenario title"),
    ),
  );
});

test("zero gap policy includes public fields and constants even when their legacy missing entries were recorded", () => {
  const report = validateManifest(
    discovery,
    manifest,
    { ...policy, requiredOwners: [], requireAllValues: true },
    run,
    [result],
    "same",
  );
  assert.ok(
    report.errors.some(
      (error) =>
        error.includes(
          "Public fields and constants require asserted scenarios:",
        ) &&
        error.includes("value:Axis.range") &&
        error.includes("value:theme"),
    ),
  );
  assert.ok(report.summary.publicValues > 0);
  assert.ok(report.summary.unassertedValues > 0);
});

test("mapping updates reject new values and erased value coverage while excluding type declarations", () => {
  const before = structuredClone(manifest),
    prior = before.entries.find((entry) => entry.id === "value:Axis.range")!;
  prior.status = "mapped";
  const current = structuredClone(before),
    covered = current.entries.find((entry) => entry.id === prior.id)!;
  covered.status = "missing";
  current.entries.push({
    ...covered,
    id: "value:PublicDefaults.colors",
    kind: "value",
  });
  current.entries.push({ ...covered, id: "type:Configuration", kind: "type" });
  assert.deepEqual(
    uncoveredUpdateApis(before, current).sort(),
    [covered.id, "value:PublicDefaults.colors"].sort(),
  );
});

test("asserted public values lose their passing mapping when field assertions or their scenario links are removed", () => {
  const file = join(fixture, "tests/values.test.ts");
  try {
    writeFileSync(
      file,
      `import test from 'node:test';import assert from 'node:assert/strict';import {Axis} from '../src/index.js';test('public range reflects endpoints',()=>{const axis=new Axis();axis.setInterval(2,8);assert.deepEqual(axis.range,{start:2,end:8});});`,
    );
    const fresh = serializeAnalysis(analyzeApiTests(fixture)),
      saved = makeManifest(fresh, policy),
      entry = saved.entries.find((e) => e.id === "value:Axis.range")!;
    assert.equal(entry.status, "mapped");
    assert.ok(
      entry.scenarios.some((id) =>
        id.endsWith("public range reflects endpoints"),
      ),
    );
    const changed = structuredClone(fresh),
      scenario = changed.scenarios.find(
        (s) => s.name === "public range reflects endpoints",
      )!;
    scenario.assertions = [];
    assert.ok(
      validateManifest(
        changed,
        saved,
        policy,
        run,
        [result],
        "same",
      ).errors.some((error) =>
        error.includes("Removed/changed assertion for value:Axis.range"),
      ),
    );
    changed.entries.find((e) => e.id === "value:Axis.range")!.scenarios = [];
    assert.ok(
      validateManifest(
        changed,
        saved,
        policy,
        run,
        [result],
        "same",
      ).errors.some((error) =>
        error.includes("API lost its assertion mapping: value:Axis.range"),
      ),
    );
  } finally {
    writeFileSync(file, "// fixture removed");
  }
});
