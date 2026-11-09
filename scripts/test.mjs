import { build } from "esbuild";
import { readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const openTestStage = process.argv.includes("--opentest");
const files = readdirSync("tests")
  .filter(
    (name) =>
      name.endsWith(".test.ts") &&
      (openTestStage
        ? name.startsWith("opentest")
        : !name.startsWith("opentest")),
  )
  .map((name) => "tests/" + name);
if (!files.length) throw new Error("No tests found");
mkdirSync("codex_artifact/tests", { recursive: true });
await build({
  entryPoints: files,
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "codex_artifact/tests",
  target: "node20",
});
const result = spawnSync(
  process.execPath,
  [
    "--test",
    ...files.map(
      (name) =>
        "codex_artifact/tests/" + name.split("/").pop().replace(/\.ts$/, ".js"),
    ),
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
