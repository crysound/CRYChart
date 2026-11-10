import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, relative} from 'node:path';
import {spawn} from 'node:child_process';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// These are the maintained complete family checks, not historical report paths.
export const specializedJobs = [
  ['completion14', 'test-completion-visible.mjs'],
  ['xy-data11', 'test-existing-xy-data-visible.mjs'],
  ['precision5', 'test-existing-precision-visible.mjs'],
  ['dashboards24', 'test-dashboards-functional.mjs', 'shared', 'output'],
  ['dashboard-radio10', 'test-dashboard-radio-visible.mjs', 'shared', 'output'],
  ['spatial-parallel8', 'test-existing-spatial-parallel-visible.mjs', 'shared', 'output'],
  ['images4', 'test-annotation-images-visible.mjs'],
  ['heat-interactions4', 'test-existing-heat-interactions-visible.mjs'],
  ['heat-map-stat16', 'test-existing-heat-map-stat-data-visible.mjs'],
  ['native3d16', 'test-existing-3d-data-visible.mjs', 'native3d', 'output'],
  ['surfaces8', 'test-additional-surfaces-visible.mjs', 'shared', 'out'],
  ['business12', 'test-existing-business-data-visible.mjs'],
  ['parallel-data7', 'test-existing-parallel-data-visible.mjs', 'shared', 'out'],
  ['treemap1', 'test-existing-treemap-visible.mjs', 'shared', 'out'],
];

export async function runSpecialized({root, directory, baseURL, sessionId}) {
  const stage = resolve(directory, 'specialized');
  await mkdir(stage); // Never reuse a previous cohort.
  const descriptors = [], execution = [];
  async function child(name, script, args, output) {
    const logPath = resolve(stage, name + '.log'), log = createWriteStream(logPath);
    const command = [resolve(root, 'examples/official', script), ...args];
    const startedAt = new Date().toISOString();
    console.log('功能专项：' + name);
    const result = await new Promise((done, reject) => {
      const proc = spawn(process.execPath, command, {cwd:root, windowsHide:true,
        env:{...process.env, CRYCHART_BASE_URL:baseURL, CRYCHART_SPECIALIZED_OUT:output, CRYCHART_FUNCTIONAL_SESSION_ID:sessionId}, stdio:['ignore','pipe','pipe']});
      proc.stdout.pipe(log, {end:false}); proc.stderr.pipe(log, {end:false});
      let timedOut = false;
      const timer = setTimeout(() => {timedOut=true; proc.kill();}, 600_000);
      proc.once('error', error => {clearTimeout(timer); log.end(); reject(error);});
      proc.once('close', (code, signal) => {clearTimeout(timer); log.end(); done({code,signal,timedOut});});
    });
    execution.push({name, command, startedAt, finishedAt:new Date().toISOString(), ...result, logPath});
    await writeFile(resolve(stage, 'execution.json'), JSON.stringify({sessionId,execution},null,2)+'\n');
    return result;
  }
  const builds = {};
  for (const [key, script, flag] of [
    ['shared','test-existing-parallel-data-visible.mjs','out'],
    ['native3d','test-existing-3d-data-visible.mjs','output'],
  ]) {
    const output=resolve(stage,key+'-build');
    const result=await child(key+'-build',script,['--build-only',`--${flag}=${output}`,`--base-url=${baseURL}`],output);
    assert.equal(result.code,0,`${key} 专项构建失败，见 ${stage}`);
    const manifestPath=resolve(output,'build.json'), manifestBytes=await readFile(manifestPath), manifest=JSON.parse(manifestBytes);
    const bundlePath=resolve(output,'official.js'), bundleSHA256=sha(await readFile(bundlePath));
    assert.equal(bundleSHA256,manifest.bundleSHA256??manifest.sha256);
    builds[key]={bundlePath,bundleSHA256,manifestPath,manifestSHA256:sha(manifestBytes)};
  }
  for (const [name, script, key, flag] of specializedJobs) {
    const output=resolve(stage,name), args=[], build=builds[key];
    if(build) args.push(`--base-url=${baseURL}`,`--bundle=${build.bundlePath}`,`--expected-sha=${build.bundleSHA256}`,`--source-manifest=${build.manifestPath}`,`--${flag}=${output}`);
    if(name==='heat-map-stat16') args.push('--base',baseURL,'--audio-normalization','browser-signed-f32');
    const result=await child(name,script,args,output);
    const path=resolve(output,'report.json');
    let bytes;
    try {bytes=await readFile(path);} catch {throw new Error(`${name} 未生成本轮报告（exit=${result.code}），见 ${stage}`);}
    const report=JSON.parse(bytes), descriptor={path:relative(root,path).replaceAll('\\','/'),sha256:sha(bytes),bundleSHA256:report.bundleSHA256};
    assert.equal(report.sessionId,sessionId,`${name} 报告会话不匹配`);
    if(build) assert.equal(report.bundleSHA256,build.bundleSHA256,`${name} 执行构建与计划不一致`);
    if(build) descriptor.sourceManifest={path:relative(root,build.manifestPath).replaceAll('\\','/'),sha256:build.manifestSHA256};
    else if(report.buildInputsManifest) {
      const manifestPath=resolve(output,report.buildInputsManifest.path);
      descriptor.sourceManifest={path:relative(root,manifestPath).replaceAll('\\','/'),sha256:sha(await readFile(manifestPath))};
      assert.equal(descriptor.sourceManifest.sha256,report.buildInputsManifest.sha256);
    }
    // Preserve functional failures for the final case-level report. A crash or
    // timeout cannot be converted to a successful set of earlier check rows.
    if(result.timedOut || (result.code!==0 && !(report.errors?.length || report.checks?.some(c=>c.status==='failed'||c.passed===false))))
      throw new Error(`${name} 执行未完成（exit=${result.code}），见 ${stage}`);
    descriptors.push(descriptor);
    await writeFile(resolve(stage,'reports.json'),JSON.stringify({sessionId,reports:descriptors},null,2)+'\n');
  }
  return descriptors;
}
