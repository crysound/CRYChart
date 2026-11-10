import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname} from 'node:path';

export async function runStorage({root,directory,sessionId,profile}){
  const output=resolve(directory,'storage');await mkdir(output,{recursive:true});
  const testPath=resolve(output,'paged-columns.test.mjs');
  const sourceHashes={};
  await build({entryPoints:[resolve(root,'tests/paged-columns.test.ts')],bundle:true,platform:'node',format:'esm',target:'node20',outfile:testPath,
    plugins:[{name:'freeze-actual-storage-inputs',setup(builder){builder.onLoad({filter:/\.[cm]?[jt]s$/},async({path})=>{
      const contents=await readFile(path);sourceHashes[relative(root,path).replaceAll('\\','/')]=createHash('sha256').update(contents).digest('hex');
      return{contents,loader:path.endsWith('.ts')?'ts':'js',resolveDir:dirname(path)};
    });}}]});
  const testBundleSHA256=createHash('sha256').update(await readFile(testPath)).digest('hex');
  const inputManifest={sessionId,sourceHashes,testBundleSHA256};
  await writeFile(resolve(output,'build-inputs.json'),JSON.stringify(inputManifest,null,2)+'\n');
  const command=["--expose-gc","--test",testPath];
  const logPath=resolve(output,'node-tests.log'),log=createWriteStream(logPath);
  const result=await new Promise((done,reject)=>{
    const child=spawn(process.execPath,command,{cwd:root,windowsHide:true,env:{...process.env,CRY_PAGED_PROFILE:'1',CRY_PAGED_BENCH:'1',CRY_PAGED_EVIDENCE:output},stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},15*60_000);
    child.once('error',error=>{clearTimeout(timer);log.end();reject(error);});
    child.once('close',(code,signal)=>{clearTimeout(timer);log.end(()=>done({code,signal,timedOut}));});
  });
  const report={kind:'crychart-storage-performance',sessionId,profile,status:'failed',execution:result,command,logPath,performanceAcceptance:'unconfigured',scope:'Node数值存储计时与数据完整性；不是浏览器GPU、128通道60秒容量或持续实时吞吐。'};
  try{
    assert.equal(result.code,0);assert.equal(result.timedOut,false);
    const profileBytes=await readFile(resolve(output,'profile/summary.json'));
    const benchmarkBytes=await readFile(resolve(output,'report-v3.json'));
    report.profileReport=JSON.parse(profileBytes);report.benchmarkReport=JSON.parse(benchmarkBytes);
    assert.equal(report.benchmarkReport.sourceSha256,sourceHashes['src/core/paged-columns.ts'],'分页计时报告与实际编译输入不符');
    assert.equal(report.benchmarkReport.denseSourceSha256,sourceHashes['src/core/data.ts'],'dense计时报告与实际编译输入不符');
    assert.equal(createHash('sha256').update(await readFile(testPath)).digest('hex'),testBundleSHA256,'执行中的Node测试构建发生变化');
    report.buildInputs=inputManifest;
    report.sourceSHA256=report.benchmarkReport.sourceSha256;
    report.reportSHA256=createHash('sha256').update(benchmarkBytes).digest('hex');
    report.status='passed';
  }catch(error){report.error=String(error.stack??error);}
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
