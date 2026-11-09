import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {connectVisibleChrome,chromeEndpoint} from './visible-browser.mjs';

// Recovery is restricted to this project's dedicated visible browser profile.
// Do not terminate arbitrary Chrome processes or delete any browser profile.
if(chromeEndpoint!=='http://127.0.0.1:9223')throw new Error('Recovery only supports the dedicated local port 9223');
const profile=resolve('.cache/visible-chrome').replaceAll("'","''");
const probe=`$taskMatches=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*--remote-debugging-port=9223*' -and $_.CommandLine -like '*${profile}*' }); @{ verified=($taskMatches.Count -gt 0); count=$taskMatches.Count } | ConvertTo-Json -Compress`;
const verified=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',probe],{encoding:'utf8',windowsHide:true}));
if(!verified.verified)throw new Error('The listening Chrome process could not be verified against this dedicated profile');
const targets=await(await fetch(`${chromeEndpoint}/json/list`)).json();
for(const target of targets.filter(target=>target.type==='page')){
  if(target.url!=='about:blank'&&!/^http:\/\/127\.0\.0\.1:4178\//.test(target.url))throw new Error('Dedicated profile contains a page outside the local test server; automatic close aborted');
}
const old=await chromium.connectOverCDP(chromeEndpoint),session=await old.newBrowserCDPSession();
await session.send('Browser.close').catch(()=>{});
for(let i=0;i<50;i++){
  try{await fetch(`${chromeEndpoint}/json/version`);}catch{break;}
  await new Promise(resolve=>setTimeout(resolve,100));
}
const {browser,page,metadata}=await connectVisibleChrome();
await page.goto('http://127.0.0.1:4178/');
const health=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
  const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true});if(!gl)return{webgl2:false};
  gl.clearColor(.25,.5,.75,1);gl.clear(gl.COLOR_BUFFER_BIT);const rgba=new Uint8Array(4);gl.readPixels(4,4,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  const result={webgl2:true,lost:gl.isContextLost(),error:gl.getError(),rgba:[...rgba]};gl.getExtension('WEBGL_lose_context')?.loseContext();return result;
});
console.log(JSON.stringify({restartedDedicatedVisibleProfile:true,browser:metadata.Browser,health}));
await browser.close();
if(!health.webgl2||health.lost||health.error||health.rgba[3]!==255)process.exitCode=1;
