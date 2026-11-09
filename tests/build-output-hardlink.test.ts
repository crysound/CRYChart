import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,linkSync,symlinkSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('actual build detaches pnpm-style JS and declaration hardlinks before overwriting outputs',()=>{
  const artifact=resolve('codex_artifact/perf-20261109/root');mkdirSync(artifact,{recursive:true});
  const sandbox=mkdtempSync(join(artifact,'build-safety-'));
  for(const dir of ['src','dist/types','consumer'])mkdirSync(join(sandbox,dir),{recursive:true});
  symlinkSync(resolve('node_modules'),join(sandbox,'node_modules'),'junction');
  writeFileSync(join(sandbox,'src/index.ts'),'export const currentBuild = 123;\n');
  writeFileSync(join(sandbox,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',declaration:true,outDir:'dist/types',rootDir:'src',types:[],skipLibCheck:true},include:['src/**/*.ts']}));
  const originalJS='original installed package bytes\n',originalTypes='export declare const original: string;\n';
  writeFileSync(join(sandbox,'dist/crychart.js'),originalJS);linkSync(join(sandbox,'dist/crychart.js'),join(sandbox,'consumer/crychart.js'));
  writeFileSync(join(sandbox,'dist/types/index.d.ts'),originalTypes);linkSync(join(sandbox,'dist/types/index.d.ts'),join(sandbox,'consumer/index.d.ts'));
  const result=spawnSync(process.execPath,[resolve('scripts/build.mjs')],{cwd:sandbox,encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(readFileSync(join(sandbox,'consumer/crychart.js'),'utf8'),originalJS);
  assert.equal(readFileSync(join(sandbox,'consumer/index.d.ts'),'utf8'),originalTypes);
  assert.match(readFileSync(join(sandbox,'dist/crychart.js'),'utf8'),/currentBuild/);
  assert.match(readFileSync(join(sandbox,'dist/types/index.d.ts'),'utf8'),/currentBuild/);
  assert.equal(statSync(join(sandbox,'dist/crychart.js')).nlink,1);
  assert.equal(statSync(join(sandbox,'consumer/crychart.js')).nlink,1);
});
