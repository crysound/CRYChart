import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';

/** Check maintained text, including tracked version documents; never print matches. */
export async function scanMaintainedNames(root){
  const names=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0');
  const pattern=new RegExp('light'+'ning'+'\\s*chart','i');
  const binary=new Set(['.tgz','.png','.jpg','.jpeg','.gif','.webp','.pdf','.woff','.woff2','.ico','.pyc','.zip','.wasm']);
  const matches=[];let scanned=0;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  for(const path of [...new Set(names)].filter(Boolean).sort()){
    if(binary.has(extname(path).toLowerCase()))continue;
    let content;try{content=decoder.decode(await readFile(resolve(root,path)));}catch(error){if(error.code==='ENOENT'||error instanceof TypeError)continue;throw error;}
    scanned++;const lines=content.split(/\r?\n/).flatMap((line,i)=>pattern.test(line)?[i+1]:[]);
    if(lines.length)matches.push({path,lines});
  }
  return{status:matches.length?'failed':'passed',scannedFiles:scanned,matches,scope:'Git维护的文本及当前未忽略的新文件；不扫描依赖、Git历史、运行缓存或二进制归档。'};
}
