// Short isolated source checks, never production build output.
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const directory='codex_artifact/unified-clip-candidate/validation';
await mkdir(directory,{recursive:true});
const run=(args)=>spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:8*1024*1024});
const strict=run(['node_modules/typescript/bin/tsc','--noEmit']);
await writeFile(directory+'/strict.log',strict.stdout+strict.stderr);
if(strict.status!==0){console.log(strict.stdout+strict.stderr);process.exitCode=1;}else{
  const names=['raster-clip','line-coverage','render-heatmap'];
  await build({entryPoints:names.map(name=>'tests/'+name+'.test.ts'),bundle:true,platform:'node',format:'esm',outdir:directory});
  const tests=run(['--test',...names.map(name=>directory+'/'+name+'.test.js')]);
  await writeFile(directory+'/node-tests.log',tests.stdout+tests.stderr);
  const report={createdAt:new Date().toISOString(),strictExit:strict.status,nodeExit:tests.status,files:names.map(name=>'tests/'+name+'.test.ts'),scope:'Node contracts and pure geometry; real GPU pixels are recorded separately.',productionDistChanged:false};
  await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));process.exitCode=tests.status??1;
}
