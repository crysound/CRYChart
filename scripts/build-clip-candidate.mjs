// Independent GPU-clip diagnostic build. Never writes production dist.
import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const baseline=process.argv.includes('--baseline');
const directory='codex_artifact/unified-clip-candidate';
await mkdir(directory,{recursive:true});
const files=['src/chart.ts','src/render.ts','src/render-heatmap.ts','src/render-line-strip.ts','src/render-line-coverage.ts','src/line-coverage-geometry.ts',...(baseline?[]:['src/raster-clip.ts'])];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(baseline){await mkdir(directory+'/before',{recursive:true});for(const file of files)await copyFile(file,directory+'/before/'+file.slice(4));}
const output=directory+'/'+(baseline?'baseline':'candidate')+'.js';
await build({stdin:{contents:"export * from './src/index.ts';export {DataRenderer} from './src/render.ts';export {DataRendererHeatmap} from './src/render-heatmap.ts';export {LineStripRenderer} from './src/render-line-strip.ts';export {LineCoverageRenderer} from './src/render-line-coverage.ts';"+(baseline?'':"export * from './src/raster-clip.ts';"),resolveDir:process.cwd()},bundle:true,format:'esm',outfile:output});
const metadata={createdAt:new Date().toISOString(),baseline,output,sha256:hash(await readFile(output)),productionDistChanged:false,sourceHashes:Object.fromEntries(await Promise.all(files.map(async path=>[path,hash(await readFile(path))])))};
await writeFile(output+'.json',JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({output,sha256:metadata.sha256,baseline}));
