import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const fingerprintMap=report=>{
  const value=report.sourceHashes??report.sourceSHA256??report.sources??report.files??report.inputs??{};
  return Array.isArray(value)?Object.fromEntries(value.map(item=>[item.path,item.sha256])):Object.fromEntries(Object.entries(value).map(([path,item])=>[path,typeof item==='string'?item:item.sha256]));
};
const reportTime=report=>report.finishedAt??report.completedAt??report.createdAt??report.at??report.startedAt??'';
// An explicit failure always wins over a contradictory success flag.
const rowStatus=row=>row.status==='failed'||row.passed===false?'failed':row.status==='passed'||row.passed===true?'passed':'pending';
const caseCode=value=>typeof value==='string'?(value.match(/^crychart-example-(\d{4})-/)?.[1]??(/^\d{4}$/.test(value)?value:undefined)):undefined;
const errorCase=error=>error&&typeof error==='object'?caseCode(error.id??error.example??error.referenceId??error.caseId):undefined;
const visibleBrowserBasis=report=>{
  if(report.headless===true||report.browserVisible===false||report.visibleChrome===false)return undefined;
  const browser=report.browser??{},agent=browser['User-Agent']??'',name=browser.Browser??'';
  if(/Headless/i.test(name+agent))return undefined;
  if(report.visibleChrome===true||report.browserVisible===true)return 'explicit-visible-browser-record';
  // A separately allocated loopback port does not change headed Chrome into a
  // headless browser. Require the actual browser CDP endpoint and both Chrome
  // identity fields, rather than treating one historical port as identity.
  try{
    const endpoint=new URL(browser.webSocketDebuggerUrl??'');
    const loopback=['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname);
    if(/Chrome\//.test(name)&&/Chrome\//.test(agent)&&endpoint.protocol==='ws:'&&loopback&&Number(endpoint.port)>0&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&/^\/devtools\/browser\/[^/]+$/.test(endpoint.pathname))return 'recorded-headed-Chrome-CDP-metadata';
  }catch{}
  return undefined;
};

/** Read only explicitly registered reports. No directory-wide discovery or success inference. */
export async function loadSpecializedEvidence(contracts,root,{read=readFile}={}){
  const reports=new Map(),sourceHashes=new Map(),equivalenceChecks=new Map(),result=new Map();
  const readArtifact=async path=>{if(!reports.has(path)){try{const bytes=await read(resolve(root,path));reports.set(path,{report:JSON.parse(bytes.toString()),sha256:digest(bytes)});}catch(error){reports.set(path,{error:String(error)});}}return reports.get(path);};
  const currentHash=async path=>{if(!sourceHashes.has(path))sourceHashes.set(path,read(resolve(root,path)).then(digest).catch(()=>null));return sourceHashes.get(path);};
  // This is a narrowly reviewed non-call-path exception, not a relaxed hash check.
  // Both entire files must match frozen hashes, and removing exactly one named
  // function declaration must leave byte-identical text. A current change
  // elsewhere fails closed. The per-case non-call assertion stays visible.
  const equivalentSource=async(path,expected,actual,contract)=>{
    const binding=(contract.specializedSourceEquivalence??[]).find(x=>x.path===path&&x.beforeSHA256===expected&&x.afterSHA256===actual);
    if(!binding||binding.caseDoesNotCallFunction!==true||!binding.reviewedReason)return undefined;
    const key=JSON.stringify(binding);
    if(!equivalenceChecks.has(key))equivalenceChecks.set(key,(async()=>{
      try{
        const before=await read(resolve(root,binding.beforePath)),after=await read(resolve(root,path));
        if(digest(before)!==expected||digest(after)!==actual)return undefined;
        const module=await import('typescript'),ts=module.default??module;
        const withoutFunction=bytes=>{
          const text=bytes.toString('utf8'),file=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
          const matches=file.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===binding.functionName);
          if(file.parseDiagnostics.length||matches.length!==1)throw new Error('Expected one parseable named function');
          const node=matches[0];return Buffer.from(text.slice(0,node.getStart(file))+text.slice(node.end),'utf8');
        };
        const left=withoutFunction(before),right=withoutFunction(after);
        if(!left.equals(right))return undefined;
        return{path,beforePath:binding.beforePath,beforeSHA256:expected,afterSHA256:actual,functionName:binding.functionName,unchangedRemainderSHA256:digest(left),caseDoesNotCallFunction:true,reviewedReason:binding.reviewedReason,scope:'Prior executed behavior on the reviewed unchanged call path; not a rerun of the current whole bundle.'};
      }catch{return undefined;}
    })());
    return equivalenceChecks.get(key);
  };
  for(const contract of contracts){
    const history=[],diagnostics=[],batches=[];
    for(const descriptor of contract.specializedEvidence??[]){
      const cached=await readArtifact(descriptor.path);
      const reasons=[];
      if(cached.error){diagnostics.push({path:descriptor.path,eligible:false,reasons:[cached.error]});continue;}
      const report=cached.report,sha=report.bundleSHA256??report.identity?.bundleSHA256;
      let source=fingerprintMap(report),sourceManifest;
      if(!/^[a-f0-9]{64}$/.test(descriptor.sha256??'')||descriptor.sha256!==cached.sha256)reasons.push('report-sha-missing-or-mismatch');
      if(!/^[a-f0-9]{64}$/.test(sha??''))reasons.push('bundle-sha-missing');
      if(descriptor.bundleSHA256&&descriptor.bundleSHA256!==sha)reasons.push('bundle-sha-mismatch');
      const browserBasis=visibleBrowserBasis(report);
      if(!browserBasis)reasons.push('visible-browser-evidence-not-established');
      if(descriptor.sourceManifest){
        const binding=descriptor.sourceManifest,manifest=await readArtifact(binding.path);
        if(manifest.error)reasons.push('source-manifest-unreadable');
        else{
          const manifestBundle=manifest.report.bundleSHA256??manifest.report.sha256;
          if(!/^[a-f0-9]{64}$/.test(binding.sha256??'')||binding.sha256!==manifest.sha256)reasons.push('source-manifest-sha-missing-or-mismatch');
          const linked=report.buildInputsManifest??report.sourceManifest;
          const manifestPaths=[resolve(root,linked?.path??''),resolve(root,dirname(descriptor.path),linked?.path??'')];
          if(report.buildDirectory)manifestPaths.push(resolve(root,report.buildDirectory,linked?.path??''));
          const reportPinsManifest=linked?.sha256===manifest.sha256&&manifestPaths.includes(resolve(root,binding.path));
          // Some onLoad manifests contain only inputs. They are valid only when
          // the SHA-pinned executed report itself names and hashes that file.
          if(manifestBundle?manifestBundle!==sha:!reportPinsManifest)reasons.push('source-manifest-bundle-mismatch');
          const external=fingerprintMap(manifest.report),conflicts=Object.keys(source).filter(path=>external[path]&&external[path]!==source[path]);
          if(conflicts.length)reasons.push('source-manifest-conflicts-with-report');
          source={...external,...source};
          sourceManifest={path:binding.path,sha256:manifest.sha256,bundleSHA256:manifestBundle??sha,binding:manifestBundle?'manifest-declares-bundle':'executed-report-pins-manifest',inputCount:Object.keys(external).length,scope:binding.scope??'Explicit build-time inputs only; missing files are not reconstructed from current sources'};
        }
      }
      // A whole-file exclusion must never bypass a reviewed function boundary.
      // mesh3d is deliberately always checked: unused triangulation is covered
      // only by its frozen before/after function-removal proof.
      const equivalencePaths=new Set((contract.specializedSourceEquivalence??[]).map(x=>x.path));
      const ignoredExclusions=(contract.specializedSourceExclusions??[]).filter(x=>x.path==='src/mesh3d.ts'||equivalencePaths.has(x.path));
      const excluded=new Set((contract.specializedSourceExclusions??[]).filter(x=>!ignoredExclusions.includes(x)).map(x=>x.path));
      const required=[...new Set([...(contract.specializedSourceFiles??[]),...Object.keys(source).filter(p=>(contract.specializedSourcePrefixes??[]).some(prefix=>p.startsWith(prefix))&&!excluded.has(p))])];
      if(!required.length)reasons.push('no-reviewed-source-binding');
      const sourceDifferences=[],sourceEquivalences=[];
      for(const path of required){const actual=await currentHash(path);if(!/^[a-f0-9]{64}$/.test(source[path]??'')||actual!==source[path]){const equivalent=await equivalentSource(path,source[path],actual,contract);if(equivalent)sourceEquivalences.push(equivalent);else sourceDifferences.push({path,expected:source[path]??null,actual});}}
      if(sourceDifferences.length)reasons.push('source-binding-stale-or-missing');
      const sourceEligible=reasons.length===0,reportOrder=batches.length;
      const code=caseCode(contract.id),rows=(report.checks??[]).filter(row=>[contract.id,code].includes(row.id??row.example));
      const reportedErrors=Array.isArray(report.errors)?report.errors:report.errors==null?[]:[report.errors];
      const unassignedErrors=reportedErrors.filter(error=>!errorCase(error)),caseErrors=reportedErrors.filter(error=>errorCase(error)===code);
      const unnamedCaseErrors=caseErrors.filter(error=>typeof error.name!=='string'||!error.name);
      if(unassignedErrors.length)reasons.push('unassigned-report-errors');
      if(unnamedCaseErrors.length)reasons.push('case-error-without-check');
      const namedErrors=new Map(caseErrors.filter(error=>typeof error.name==='string'&&error.name).map(error=>[error.name,error]));
      const effectiveRows=rows.map(row=>namedErrors.has(row.name)?{...row,status:'failed',passed:false,error:row.error??namedErrors.get(row.name).error??namedErrors.get(row.name)}:row);
      for(const [name,error]of namedErrors)if(!rows.some(row=>row.name===name))effectiveRows.push({name,status:'failed',error,scope:'Case-attributed report error without a check row'});
      if(!effectiveRows.length)reasons.push('exact-case-has-no-checks');
      const eligible=reasons.length===0,diagnostic={path:descriptor.path,reportSHA256:cached.sha256,bundleSHA256:sha,finishedAt:reportTime(report),eligible,reasons,browserBasis,sourceManifest,sourceFilesChecked:required.length,sourceExclusions:(contract.specializedSourceExclusions??[]).filter(x=>excluded.has(x.path)),ignoredSourceExclusions:ignoredExclusions,sourceEquivalences,sourceDifferences,unassignedErrors,caseErrors};diagnostics.push(diagnostic);
      const attempts=effectiveRows.map((row,order)=>({id:contract.id,name:row.name,status:rowStatus(row),evidence:row.evidence,error:row.error,dimension:row.dimension,order,reportOrder,reportPath:descriptor.path,reportSHA256:cached.sha256,bundleSHA256:sha,finishedAt:reportTime(report),eligible}));
      history.push(...attempts);
      batches.push({reportPath:descriptor.path,reportSHA256:cached.sha256,bundleSHA256:sha,finishedAt:reportTime(report),reportOrder,eligible,sourceEligible,checks:attempts,blockingErrors:[...unassignedErrors,...unnamedCaseErrors]});
    }
    const chronological=(a,b)=>a.finishedAt.localeCompare(b.finishedAt)||a.reportOrder-b.reportOrder;
    history.sort((a,b)=>chronological(a,b)||a.order-b.order);
    batches.sort(chronological);
    // Only one executed bundle may provide a case's current specialized cohort.
    // A newer fatal attempt participates in cohort selection; filtering it out
    // must not silently revive an older successful report.
    const latest=batches.filter(x=>x.eligible||(x.sourceEligible&&x.blockingErrors.length)).at(-1),cohort=latest?.bundleSHA256,byName=new Map();
    for(const attempt of history)if(attempt.eligible&&attempt.bundleSHA256===cohort)byName.set(attempt.name,attempt);
    const requiredChecks=[...new Set([
      ...(contract.requirements??[]).filter(x=>x.required!==false).flatMap(x=>x.checkNames??[]),
      ...Object.values(contract.validationDimensions??{}).flat(),
      ...(contract.interactionsRequired===false?[]:contract.interactionCheckNames??[]),
    ])];
    const blockers=batches.filter(x=>x.sourceEligible&&x.bundleSHA256===cohort&&x.blockingErrors.length).map(batch=>{
      // Unknown scope requires one subsequent complete case rerun. A union of
      // focused successes cannot establish that an unassigned failure is gone.
      const repair=batches.find(next=>next.eligible&&next.bundleSHA256===cohort&&chronological(next,batch)>0&&requiredChecks.length>0&&requiredChecks.every(name=>next.checks.some(check=>check.name===name&&check.status==='passed'))&&next.checks.every(check=>check.status==='passed'));
      return{reportPath:batch.reportPath,reportSHA256:batch.reportSHA256,bundleSHA256:batch.bundleSHA256,finishedAt:batch.finishedAt,errors:batch.blockingErrors,requiredChecks,repairedBy:repair?{reportPath:repair.reportPath,reportSHA256:repair.reportSHA256,finishedAt:repair.finishedAt}:null};
    });
    result.set(contract.id,{checks:[...byName.values()],attempts:history,diagnostics,cohortBundleSHA256:cohort,blockingErrors:blockers,unresolvedBlockingErrors:blockers.filter(x=>!x.repairedBy),scope:'Exact executed bundle + explicitly reviewed source files; unrelated examples are not certified. Historical failures and stale sources remain listed. Unassigned or case-only errors require a subsequent complete case rerun in the same bundle.'});
  }
  return result;
}

/** Pure resolution shared by the live driver and offline source-evidence reconciliation. */
export function resolveCaseEvidence(record,contract,legacy,specialized={checks:[],attempts:[],diagnostics:[]}){
  const local=(legacy.checks??[]).filter(c=>c.example===record.id||c.id===record.id).map(c=>({...c,status:rowStatus(c),origin:'live-legacy'}));
  // A fresh live check has priority over older specialized evidence, including a live failure.
  const checks=[...specialized.checks.map(c=>({...c,origin:'source-bound-specialized'})),...local],byName=new Map();for(const c of checks)byName.set(c.name,c);
  const resolvedChecks=[...byName.values()],checkState=names=>!names?.length?'pending':names.some(n=>byName.get(n)?.status==='failed')?'failed':names.every(n=>byName.get(n)?.status==='passed')?'passed':'pending';
  const requirements=(contract.requirements??[]).map(r=>({...r,status:checkState(r.checkNames)}));
  const specified=contract.validationDimensions??{},dimension=(name,fallback)=>{const names=specified[name]??[],status=checkState(names);if(fallback?.status==='failed')return fallback;return names.length?{status,checks:names,scope:'Only reviewed check-to-dimension mappings; no pixel-to-interaction inference'}:fallback??{status:'pending'};};
  const mount=(legacy.examples??[]).find(e=>e.id===record.id),expected=contract.legacyChecks??[],missing=expected.filter(name=>!byName.has(name));
  const featureStatus=requirements.length?requirements.some(r=>r.status==='failed')?'failed':requirements.filter(r=>r.required!==false).every(r=>r.status==='passed')?'passed':'pending':'pending';
  const dimensions={mount:dimension('mount',{status:mount?'passed':'pending',scope:'Initialization and visible geometry only'}),features:{status:featureStatus,missingLegacyChecks:missing,checkCount:resolvedChecks.length},interaction:dimension('interaction',{status:checkState(contract.interactionCheckNames),checks:contract.interactionCheckNames??[]}),data:dimension('data',record.data),lifecycle:dimension('lifecycle',record.lifecycle),reference:{status:contract.referenceEvidence?.availability==='unavailable'?'unavailable':'pending',evidence:contract.referenceEvidence,scope:'Independent implementation checks do not establish reference data, interaction or pixel equivalence'},pixelEquivalence:{status:'pending'}};
  const failed=Boolean(record.errors?.length)||Boolean(specialized.unresolvedBlockingErrors?.length)||resolvedChecks.some(c=>c.status==='failed')||Object.values(dimensions).some(d=>d.status==='failed');
  const functionalComplete=!failed&&contract.contractReviewed===true&&requirements.length>0&&requirements.filter(r=>r.required!==false).every(r=>r.status==='passed')&&['mount','features','data','lifecycle'].every(d=>dimensions[d].status==='passed')&&(contract.interactionsRequired===false||dimensions.interaction.status==='passed');
  return{...record,dimensions,requirements,resolvedChecks,legacyChecks:local,legacyMount:mount,specializedEvidence:specialized,contractReviewed:contract.contractReviewed===true,status:failed?'failed':functionalComplete?'passed':'incomplete',functionalComplete,currentImplementationFunctions: functionalComplete?'passed':failed?'failed':'incomplete',fullReferenceEquivalence:false,remainingDifferences:contract.remainingDifferences??[]};
}

export function summarize(reports){
  if(!reports.length)throw new RangeError('At least one functional report is required');
  const hashFields=['coreSHA256','bundleSHA256','contractsSHA256','legacyHarnessSHA256','driverSHA256','adapterSHA256'];
  for(const {path,report}of reports){
    if(report?.kind!=='official-functional-visible'||!Array.isArray(report.cases))throw new TypeError('Malformed functional report: '+path);
    if(hashFields.some(field=>!/^[a-f0-9]{64}$/.test(report.identity?.[field]??''))||typeof report.identity?.sessionId!=='string'||!report.identity.sessionId)throw new TypeError('Complete source/build/driver identity is required: '+path);
    if(report.errors!=null&&(!Array.isArray(report.errors)||report.errors.length))throw new TypeError('Cannot aggregate a report with unresolved top-level errors: '+path);
  }
  const first=reports[0].report,key=r=>JSON.stringify([...hashFields,'sessionId'].map(k=>r.identity[k]));
  if(reports.some(({report})=>report.kind!=='official-functional-visible'||key(report)!==key(first)))throw new TypeError('Do not combine different bundles, contracts, source checks, driver/adapter versions or sessions');
  const attempts=new Map();
  for(const {path,report} of reports)for(const item of report.cases){const list=attempts.get(item.id)??[];list.push({path,finishedAt:report.finishedAt,status:item.status,functionalComplete:item.functionalComplete,item});attempts.set(item.id,list);}
  const cases=[...attempts].sort(([a],[b])=>a.localeCompare(b)).map(([id,history])=>{history.sort((a,b)=>a.finishedAt.localeCompare(b.finishedAt));const current=history.at(-1);return{id,status:current.status,functionalComplete:current.functionalComplete,dimensions:current.item.dimensions,remainingRequirements:current.item.requirements.filter(r=>r.status!=='passed'),remainingDifferences:current.item.remainingDifferences,latestEvidence:current.path,attempts:history.map(({path,finishedAt,status,functionalComplete})=>({path,finishedAt,status,functionalComplete}))};});
  const dimensions={};for(const c of cases)for(const [name,value]of Object.entries(c.dimensions)){dimensions[name]??={};dimensions[name][value.status]=(dimensions[name][value.status]??0)+1;}
  return{schemaVersion:1,kind:'official-functional-summary',createdAt:new Date().toISOString(),identity:first.identity,catalogTotal:167,examplesObserved:cases.length,functionallyComplete:cases.filter(c=>c.functionalComplete===true).length,failed:cases.filter(c=>c.status==='failed').length,incomplete:cases.filter(c=>c.status==='incomplete').length,unobserved:167-cases.length,dimensions,fullReferenceEquivalence:false,performanceAcceptance:false,policy:'Same-build focused runs may replace the current status of a case; all failed and earlier attempts remain linked. A mounted image or one generic check never completes the case.',sourceReports:reports.map(x=>x.path),cases};
}

async function main(){const args=process.argv.slice(2);let output;const paths=[];for(let i=0;i<args.length;i++){if(args[i]==='--out')output=args[++i];else if(args[i].startsWith('--out='))output=args[i].slice(6);else paths.push(args[i]);}const reports=await Promise.all(paths.map(async path=>({path:resolve(path),report:JSON.parse(await readFile(path,'utf8'))}))),result=summarize(reports);if(output)await writeFile(resolve(output),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output:output&&resolve(output),examplesObserved:result.examplesObserved,functionallyComplete:result.functionallyComplete,failed:result.failed,incomplete:result.incomplete,unobserved:result.unobserved,dimensions:result.dimensions}));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
