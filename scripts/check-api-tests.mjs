import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeApiTests, serializeAnalysis } from "./api-test-map.mjs";
import { testFingerprint } from "./test-fingerprint.mjs";
import {
  callable,
  publicValue,
  makeManifest,
  validateManifest,
  renderReport,
  uncoveredUpdateApis,
} from "./api-test-validation.mjs";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const discovery = serializeAnalysis(analyzeApiTests());
  const policy = JSON.parse(
    readFileSync(resolve(root, "docs/api-test-policy.json"), "utf8"),
  );
  const output = resolve(root, "codex_artifact/api-tests");
  mkdirSync(output, { recursive: true });
  const manifestPath = resolve(root, "docs/api-test-map.json");
  if (process.argv.includes("--update")) {
    const manifest = makeManifest(discovery, policy);
    const invalid = manifest.entries.filter(
      (e) => e.status === "placeholder" && e.limitation === "REVIEW REQUIRED",
    );
    if (invalid.length)
      throw new Error(
        `Review placeholders before updating: ${invalid.map((e) => e.id).join(", ")}`,
      );
    if (existsSync(manifestPath)) {
      const previous = JSON.parse(readFileSync(manifestPath, "utf8"));
      const newGaps = uncoveredUpdateApis(previous, manifest);
      if (newGaps.length)
        throw new Error(
          `New or previously covered APIs require asserted tests before updating: ${newGaps.join(", ")}`,
        );
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const summary = {
      publicEntries: manifest.entries.length,
      callable: manifest.entries.filter(callable).length,
      mappedCallable: manifest.entries.filter(
        (e) => callable(e) && e.status === "mapped",
      ).length,
      missingCallable: manifest.entries.filter(
        (e) => callable(e) && e.status === "missing",
      ).length,
      placeholders: manifest.entries.filter((e) => e.status === "placeholder")
        .length,
      publicValues: manifest.entries.filter(publicValue).length,
      mappedValues: manifest.entries.filter(
        (entry) => publicValue(entry) && entry.status === "mapped",
      ).length,
      unassertedValues: manifest.entries.filter(
        (e) => publicValue(e) && e.status === "missing",
      ).length,
    };
    writeFileSync(
      resolve(root, "docs/api-test-map.md"),
      renderReport(discovery, manifest, summary),
    );
    console.log(
      `Updated ${relative(root, manifestPath)}; missing APIs remain marked missing.`,
    );
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    let run,
      results = [];
    try {
      run = JSON.parse(readFileSync(resolve(output, "run.json"), "utf8"));
      results = readFileSync(resolve(output, "results.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {}
    const report = validateManifest(
      discovery,
      manifest,
      policy,
      run,
      results,
      testFingerprint(root),
    );
    writeFileSync(
      resolve(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    writeFileSync(
      resolve(output, "report.md"),
      renderReport(discovery, manifest, report.summary, "../.."),
    );
    console.log(JSON.stringify(report.summary, null, 2));
    if (report.errors.length) {
      for (const error of report.errors.slice(0, 20)) console.error(error);
      if (report.errors.length > 20)
        console.error(
          `... ${report.errors.length - 20} more errors in codex_artifact/api-tests/report.json`,
        );
      process.exitCode = 1;
    }
  }
}
