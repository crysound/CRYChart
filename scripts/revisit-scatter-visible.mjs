import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {connectVisibleChrome} from './visible-browser.mjs';
const out='codex_artifact/official-focused-revisit-visible';mkdirSync(out,{recursive:true});
const catalog=JSON.parse(readFileSync('docs/reference-examples.json','utf8'));
const item=catalog.examples.find(row=>row.id.includes('0016-'));
const {browser,metadata}=await connectVisibleChrome(),page=await browser.contexts()[0].newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1360,height:900});await page.bringToFront();
try{
 await page.goto(item.sourceURL,{waitUntil:'domcontentloaded',timeout:45000});
 const reject=page.getByRole('button',{name:'Reject All',exact:true});if(await reject.isVisible().catch(()=>false))await reject.click();
 await page.waitForTimeout(10000);
 const frames=[];for(const frame of page.frames()){
   const canvases=await frame.locator('canvas').count();if(canvases)frames.push({url:frame.url(),canvases,body:await frame.locator('body').innerText().catch(()=>''),buttons:await frame.locator('button').allTextContents()});
 }
 await page.screenshot({path:`${out}/0016-delayed.png`});
 const report={id:item.id,url:item.sourceURL,browser:metadata.Browser,browserMode:'visible-cdp',headless:false,settleMs:10000,frames,errors};
 writeFileSync(`${out}/0016-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
