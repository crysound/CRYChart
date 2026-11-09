import {createHash} from 'node:crypto';
import {copyFile, lstat, mkdir, readFile, readdir, realpath, rename, writeFile} from 'node:fs/promises';
import {dirname, extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

// Explicit local delivery. This never deletes files, modifies Git metadata,
// installs dependencies or includes the unselected development runtime/profile.
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.argv.find(value => value.startsWith('--to='))?.slice(5) ?? 'D:/workspace/CRYChart');
const apply = process.argv.includes('--apply');
const planOption = process.argv.find(value => value.startsWith('--plan='))?.slice(7);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const rootFiles = ['.gitignore', 'README.md', 'SPEC.md', 'package.json', 'package-lock.json', 'tsconfig.json'];
const originalTrees = ['src', 'examples', 'scripts', 'tests', 'docs', 'dist'];
const evidenceTrees = [];
const evidenceFiles = [];
const observationTrees = [];
const safeWithin = (root, candidate) => {
  const path = resolve(root, candidate), local = relative(root, path);
  if (!local || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
    throw new Error(`Path is outside its intended root: ${candidate}`);
  return path;
};
async function exists(path) {try {return await lstat(path);} catch (error) {if (error.code === 'ENOENT') return undefined; throw error;}}
async function walk(path) {
  const result = [];
  for (const item of await readdir(path, {withFileTypes: true})) {
    const child = resolve(path, item.name);
    if (item.isSymbolicLink()) throw new Error(`Delivery excludes links: ${child}`);
    if (item.isDirectory()) result.push(...await walk(child));
    else if (item.isFile()) result.push(child);
    else throw new Error(`Delivery excludes nonregular files: ${child}`);
  }
  return result;
}
async function checkDestinationPath(path) {
  let parent = path;
  while (parent !== destination) {
    const info = await exists(parent);
    if (info?.isSymbolicLink()) throw new Error(`Refusing a linked destination path: ${parent}`);
    parent = dirname(parent);
    if (parent === dirname(parent)) throw new Error('Destination parent escaped its root');
  }
}
if ((await realpath(source)).toLowerCase() === (await realpath(destination)).toLowerCase())
  throw new Error('Source and destination must be different directories');
if ((await lstat(destination)).isSymbolicLink()) throw new Error('Destination root must not be a link');
const gitState = () => {
  const run = (...args) => execFileSync('git', ['-C', destination, ...args], {encoding: 'utf8', windowsHide: true}).trim();
  return {root: run('rev-parse', '--show-toplevel'), head: run('rev-parse', 'HEAD'), branch: run('branch', '--show-current')};
};
const gitBefore = gitState();
const selected = new Map();
const add = (path, category) => {
  const name = relative(source, path).split(sep).join('/');
  if (/(^|\/)(\.git|\.cache|node_modules|reference)(\/|$)/i.test(name) || /(^|\/)\.env(?:\.|$)/i.test(name))
    throw new Error(`Excluded content reached delivery selection: ${name}`);
  selected.set(name, {path, category});
};
for (const name of rootFiles) add(safeWithin(source, name), 'original');
for (const name of originalTrees) for (const path of await walk(safeWithin(source, name))) add(path, 'original');
for (const name of evidenceTrees) {
  const root = safeWithin(source, `codex_artifact/${name}`);
  if (await exists(root)) for (const path of await walk(root)) {
    if (['.json', '.png', '.js', '.mjs', '.html', '.map', '.log', '.txt'].includes(extname(path))) add(path, 'evidence');
  }
}
for (const name of evidenceFiles) {
  const path = safeWithin(source, `codex_artifact/${name}`);
  if (await exists(path)) add(path, 'evidence');
}
for (const name of observationTrees) {
  const root = safeWithin(source, `codex_artifact/${name}`);
  if (await exists(root)) for (const path of await walk(root)) {
    if (['.json', '.png', '.log', '.txt', '.tap'].includes(extname(path))) add(path, 'evidence');
  }
}
// Runtime probes contain public observations only; never include captured code.
for (const name of ['reference-82-runtime-visible', 'reference-axis-probe-visible', 'reference-82-exports-visible']) {
  const root = safeWithin(source, `codex_artifact/${name}`);
  if (await exists(root)) for (const path of await walk(root)) if (extname(path) === '.json') add(path, 'evidence');
}
const manifestPath = safeWithin(destination, 'delivery-manifest.json');
const previous = await exists(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : undefined;
const previousByName = new Map((previous?.files ?? []).map(file => [file.path, file]));
const files = [];
for (const [name, item] of [...selected].sort(([a], [b]) => a.localeCompare(b))) {
  const bytes = await readFile(item.path), sha256 = digest(bytes), target = safeWithin(destination, name);
  await checkDestinationPath(target);
  const info = await exists(target);
  if (info && !info.isFile()) throw new Error(`Destination is not a regular file: ${name}`);
  const oldBytes = info ? await readFile(target) : undefined;
  if (oldBytes && digest(oldBytes) !== sha256 && digest(oldBytes) !== previousByName.get(name)?.sha256 &&
      !(name === 'README.md' && oldBytes.toString('utf8').replaceAll('\r\n', '\n').trim() === '# CRYChart\nCRYChart'))
    throw new Error(`Destination contains a change not owned by the previous delivery: ${name}`);
  files.push({path: name, bytes: bytes.length, sha256, category: item.category});
}
const manifest = {
  schemaVersion: 1, createdAt: new Date().toISOString(), source, destination,
  status: 'development-snapshot', acceptanceComplete: false,
  note: 'File delivery is separate from performance, example scenario coverage and deferred OpenTest integration acceptance. Evidence is bound to each recorded source/bundle hash.',
  excludes: ['credentials', 'browser profile', 'node_modules', 'unselected development artifacts'],
  git: gitBefore, files,
};
let planPath;
if (planOption) {
  planPath = safeWithin(source, planOption);
  const artifactRoot = resolve(source, 'codex_artifact');
  safeWithin(artifactRoot, relative(artifactRoot, planPath));
  await mkdir(dirname(planPath), {recursive: true});
  await writeFile(planPath, JSON.stringify({...manifest, applied: false}, null, 2) + '\n');
}
if (apply) {
  for (const file of files) {
    const input = safeWithin(source, file.path), target = safeWithin(destination, file.path);
    if (digest(await readFile(input)) !== file.sha256) throw new Error(`Source changed during delivery; rerun: ${file.path}`);
    await checkDestinationPath(target);
    await mkdir(dirname(target), {recursive: true});
    const temporary = `${target}.crychart-delivery-${process.pid}`;
    await copyFile(input, temporary);
    if (digest(await readFile(temporary)) !== file.sha256) throw new Error(`Source changed during copy: ${file.path}`);
    await rename(temporary, target);
  }
  for (const file of files) if (digest(await readFile(safeWithin(source, file.path))) !== file.sha256)
    throw new Error(`Source changed before delivery completed; keep writers idle and rerun: ${file.path}`);
  const gitAfter = gitState();
  if (JSON.stringify(gitBefore) !== JSON.stringify(gitAfter)) throw new Error('Git identity changed during delivery');
  await checkDestinationPath(manifestPath);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  for (const file of files) if (digest(await readFile(safeWithin(destination, file.path))) !== file.sha256)
    throw new Error(`Destination verification failed: ${file.path}`);
}
console.log(JSON.stringify({applied: apply, source, destination, files: files.length,
  bytes: files.reduce((sum, file) => sum + file.bytes, 0), gitUnchanged: true,
  acceptanceComplete: false, plan: planPath, manifest: apply ? manifestPath : undefined}, null, 2));
