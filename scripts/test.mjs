import { build } from "esbuild";
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { testFingerprint } from "./test-fingerprint.mjs";
const openTestStage = process.argv.includes("--opentest");
const coverage = process.argv.includes("--coverage");
const files = readdirSync("tests")
  .filter(
    (name) =>
      name.endsWith(".test.ts") &&
      (coverage ||
        (openTestStage
          ? name.startsWith("opentest")
          : !name.startsWith("opentest"))),
  )
  .map((name) => "tests/" + name);
if (!files.length) throw new Error("No tests found");
const sourceFingerprint = coverage ? testFingerprint() : undefined;
if (coverage) {
  mkdirSync("codex_artifact/api-tests", { recursive: true });
  writeFileSync(
    "codex_artifact/api-tests/run.json",
    JSON.stringify({
      fingerprint: sourceFingerprint,
      node: process.version,
      complete: false,
    }),
  );
}
if (!coverage) {
  mkdirSync("codex_artifact/tests", { recursive: true });
  await build({
    entryPoints: files,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outdir: "codex_artifact/tests",
    target: "node20",
  });
}
const result = spawnSync(
  process.execPath,
  [
    // Execute source modules without bundling or tree shaking for accurate maps
    // and a denominator that includes uncalled functions.
    ...(coverage ? ["--import", "tsx"] : []),
    "--test",
    ...(coverage
      ? [
          "--test-reporter=spec",
          "--test-reporter-destination=stdout",
          "--test-reporter=./scripts/test-case-reporter.mjs",
          "--test-reporter-destination=codex_artifact/api-tests/results.jsonl",
        ]
      : []),
    ...(coverage
      ? files
      : files.map(
          (name) =>
            "codex_artifact/tests/" +
            name.split("/").pop().replace(/\.ts$/, ".js"),
        )),
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
if (coverage) {
  const unchanged = sourceFingerprint === testFingerprint();
  writeFileSync(
    "codex_artifact/api-tests/run.json",
    JSON.stringify(
      {
        fingerprint: sourceFingerprint,
        node: process.version,
        complete: result.status === 0 && unchanged,
      },
      null,
      2,
    ) + "\n",
  );
  if (!unchanged) {
    console.error(
      "Sources changed during the test run; rerun coverage before checking API mappings.",
    );
    process.exitCode = 1;
  }
}
