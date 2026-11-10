import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseOptions,run} from './test-official-functional-visible.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const code=id=>id.match(/^crychart-example-(\d{4})-/)?.[1]??id;

/** Bind only reports explicitly produced by this invocation, never discover old passes. */
export async function bindCurrentReports(input,descriptors,{sessionId,startedAt,read=readFile,metadata=stat}){
  const contracts=structuredClone(input);
  contracts.currentRun=true;contracts.sessionId=sessionId;
  for(const item of contracts.examples){
    item.specializedEvidence=[];item.specializedSourceExclusions=[];item.specializedSourceEquivalence=[];
  }
  for(const descriptor of descriptors){
    const path=resolve(root,descriptor.path),bytes=await read(path),report=JSON.parse(bytes.toString());
    assert.equal(report.sessionId,sessionId,'专项报告必须绑定本轮执行会话');
    assert.ok((await metadata(path)).mtimeMs>=startedAt,'专项报告必须由本轮执行生成：'+descriptor.path);
    assert.equal(descriptor.sha256,hash(bytes),'专项报告指纹不匹配：'+descriptor.path);
    assert.equal(descriptor.bundleSHA256,report.bundleSHA256??report.identity?.bundleSHA256,'专项构建指纹不匹配');
    const ids=new Set((report.checks??[]).map(row=>code(row.id??row.example??'')));
    for(const item of contracts.examples)if(ids.has(code(item.id)))item.specializedEvidence.push(descriptor);
  }
  return contracts;
}

export async function main(argv=process.argv.slice(2)){
  const options=parseOptions(argv);
  assert.equal(options.fresh,true,'统一功能验证只接受本轮新证据；历史对账请使用独立driver');
  assert.equal(options.evidenceOnly,false,'统一功能验证必须实际运行，不能仅离线对账');
  const sessionId=options.sessionId??randomUUID(),startedAt=Date.now();
  const directory=resolve(options.out??join(root,'codex_artifact/functional-current',new Date().toISOString().replace(/[:.]/g,'-')));
  if(options.dryRun)return run({...options,sessionId,out:join(directory,'live')});
  const base=new URL(options.baseURL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname),'功能验证仅访问本机CRYChart示例');
  const {ensureTestServer,connectVisibleChrome}=await import('./visible-browser.mjs');
  await mkdir(directory,{recursive:true});
  const server=await ensureTestServer(Number(base.port||80));
  const execution={sessionId,startedAt:new Date(startedAt).toISOString(),baseURL:options.baseURL,status:'running',reports:[]};
  try{
    // Some family runners connect directly to CDP. Initialize that shared
    // browser even when this command is run without the basic browser suite.
    // Closing a connectOverCDP connection disconnects this client only.
    const connection=await connectVisibleChrome();
    await connection.browser.close();
    const {runSpecialized}=await import('./functional-specialized-plan.mjs');
    const descriptors=await runSpecialized({root,directory,baseURL:options.baseURL,sessionId,ids:options.ids});
    assert.ok(Array.isArray(descriptors),'专项执行器必须返回本轮报告清单');
    execution.reports=descriptors;
    const input=JSON.parse(await readFile(join(root,'examples/official/functional-contracts.json'),'utf8'));
    const contracts=await bindCurrentReports(input,descriptors,{sessionId,startedAt});
    const contractPath=join(directory,'contracts.json');
    await writeFile(contractPath,JSON.stringify(contracts,null,2)+'\n');
    const report=await run({...options,contracts:contractPath,sessionId,out:join(directory,'live')});
    execution.status=report.status;execution.summary=report.summary;
    const {writeFunctionalReport}=await import('./write-functional-report.mjs');
    await writeFunctionalReport(report,{reportPath:join(directory,'live','report.json')});
    return report;
  }catch(error){
    execution.status='failed';execution.error={name:error.name,message:error.message};
    throw error;
  }finally{
    execution.finishedAt=new Date().toISOString();
    try{await writeFile(join(directory,'execution.json'),JSON.stringify(execution,null,2)+'\n');}
    finally{await server.close();}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
