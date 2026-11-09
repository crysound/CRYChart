import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, lstatSync, copyFileSync, renameSync, constants } from "node:fs";
import { resolve, join } from "node:path";
mkdirSync("dist", { recursive: true });
// Local file: package consumers can share these exact inodes through pnpm.
// Replace our directory entries before any compiler truncates a shared file.
const buildRoot = resolve("dist");
function detachSharedOutputs(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name), state = lstatSync(file);
    if (state.isSymbolicLink()) throw new Error(`Build output must not be a symbolic link: ${file}`);
    if (state.isDirectory()) detachSharedOutputs(file);
    else if (state.isFile() && state.nlink > 1) {
      const temporary = `${file}.core-build-${process.pid}`;
      copyFileSync(file, temporary, constants.COPYFILE_EXCL);
      renameSync(temporary, file);
    }
  }
}
if (lstatSync(buildRoot).isSymbolicLink()) throw new Error("Build output directory must not be a symbolic link");
detachSharedOutputs(buildRoot);
for (const [format, outfile, globalName] of [
  ["esm", "dist/crychart.js"],
  ["cjs", "dist/crychart.cjs"],
  ["iife", "dist/crychart.global.js", "CRYChart"],
]) {
  await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format,
    outfile,
    globalName,
    sourcemap: true,
    target: "es2022",
  });
}
if (existsSync("src/themes.ts"))
  await build({
    entryPoints: ["src/themes.ts"],
    bundle: true,
    format: "esm",
    outfile: "dist/themes.js",
    target: "es2022",
  });
if (existsSync("examples/main.ts"))
  await build({
    entryPoints: ["examples/main.ts"],
    bundle: true,
    format: "esm",
    outfile: "dist/gallery.js",
    sourcemap: true,
    target: "es2022",
  });
if (existsSync("examples/official/main.ts"))
  await build({entryPoints:["examples/official/main.ts"],bundle:true,format:"esm",outfile:"dist/official.js",sourcemap:true,target:"es2022"});
for(const lab of ['channel-lab','opentest-lab'])
  if(existsSync(`examples/${lab}/main.ts`))await build({entryPoints:[`examples/${lab}/main.ts`],bundle:true,format:'esm',outfile:`dist/${lab}.js`,sourcemap:true,target:'es2022'});
const result = spawnSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--emitDeclarationOnly"],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
