import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {connectVisibleChrome,ensureTestServer,showStep} from './visible-browser.mjs';

const focus=process.argv.find(arg=>arg.startsWith('--focus='))?.slice(8);
if(focus&&!['large-font'].includes(focus))throw new Error('Unsupported focused scenario');
const root=resolve(process.cwd()),base='http://127.0.0.1:4178',out=resolve(root,`codex_artifact/xy-axis-theme/${focus?'visible-focused-'+focus:'visible'}`);
await mkdir(out,{recursive:true});
const build=JSON.parse(await readFile(resolve(root,'codex_artifact/xy-axis-theme/build.json'),'utf8'));
const report={createdAt:new Date().toISOString(),browserVisible:true,headless:false,focus:focus??null,stableLibrarySHA256:build.stableLibrarySHA256,candidateSHA256:build.candidateSHA256,themesSHA256:build.themesSHA256,scenarios:[],errors:[],fullParity:false,mainDistChanged:false};
const server=await ensureTestServer(4178);let browser,page;
try{
  const connected=await connectVisibleChrome();browser=connected.browser;
  page=browser.contexts()[0].pages().find(p=>p.url().startsWith(`${base}/tests/xy-axis-theme.html`))??await browser.contexts()[0].newPage();await page.setViewportSize({width:1050,height:800});await page.bringToFront();report.browser=connected.metadata.Browser;
  await page.addInitScript(()=>{
    const contexts=new Map();window.__AXIS_CONTEXTS__=contexts;
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){const context=getContext.call(this,kind,...args);if(context)contexts.set(this,{kind,context});return context;};
    const clear=CanvasRenderingContext2D.prototype.clearRect,fill=CanvasRenderingContext2D.prototype.fillText,measure=CanvasRenderingContext2D.prototype.measureText;
    window.__AXIS_TEXTS__=new WeakMap();window.__AXIS_MEASURES__=new WeakMap();
    CanvasRenderingContext2D.prototype.clearRect=function(...args){window.__AXIS_TEXTS__.set(this,[]);return clear.apply(this,args);};
    CanvasRenderingContext2D.prototype.measureText=function(text){const calls=window.__AXIS_MEASURES__.get(this)??[];if(calls.length<2000)calls.push({text:String(text),font:this.font});window.__AXIS_MEASURES__.set(this,calls);return measure.call(this,text);};
    CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
      const calls=window.__AXIS_TEXTS__.get(this)??[],m=measure.call(this,text),t=this.getTransform();
      if(/^-?\d/.test(String(text)))calls.push({text:String(text),font:this.font,color:String(this.fillStyle),bounds:{left:(x-m.actualBoundingBoxLeft)*t.a+t.e,right:(x+m.actualBoundingBoxRight)*t.a+t.e,top:(y-m.actualBoundingBoxAscent)*t.d+t.f,bottom:(y+m.actualBoundingBoxDescent)*t.d+t.f}});
      window.__AXIS_TEXTS__.set(this,calls);return fill.call(this,text,x,y,...args);
    };
  });
  for(const mode of(focus?['candidate']:['baseline','candidate'])){
    const expected=mode==='baseline'?build.stableLibrarySHA256:build.candidateSHA256;
    const response=await fetch(`${base}/codex_artifact/xy-axis-theme/${mode}.js`),served=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');assert.equal(served,expected);
    await page.goto(`${base}/tests/xy-axis-theme.html?library=${mode}`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__XY_THEME__?.ready,null,{timeout:10000});
    for(const id of (await page.evaluate(()=>window.__XY_THEME__.cases)).filter(id=>!focus||id===focus)){
      const result={mode,id};let pageErrors=[];const onError=error=>pageErrors.push(String(error));page.on('pageerror',onError);
      try{
        await showStep(page,`XY theme · ${mode} · ${id}`,'Checking actual text pixels, theme colors, explicit 12px/empty styles and measured label bounds.');
        const setup=await page.evaluate(id=>window.__XY_THEME__.mount(id),id);
        await page.waitForFunction(()=>window.__XY_THEME__.snapshot().stats.drawCalls>0,null,{timeout:10000});
        if(id==='strategy-reset'){await page.getByRole('button',{name:'Replace tick strategies'}).click();}
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        result.snapshot=await page.evaluate(()=>window.__XY_THEME__.snapshot());
        const explicit=setup.options.explicit&&id!=='strategy-reset',hidden=setup.options.hidden||setup.options.themeHidden;
        const hex=explicit?'#b71e67':setup.colors.text,rgb=hex.match(/[a-f\d]{2}/gi).map(part=>parseInt(part,16)),gridRGB=setup.colors.grid.match(/[a-f\d]{2}/gi).map(part=>parseInt(part,16));
        const size=explicit?12:setup.options.size??14,family=explicit?'sans-serif':setup.options.family??'Arial';
        result.evidence=await page.evaluate(({rgb,gridRGB,size,family,hidden,gridHidden})=>{
          const canvases=[...window.__AXIS_CONTEXTS__.entries()].filter(([canvas])=>canvas.isConnected&&document.querySelector('#host').contains(canvas));
          // Chart layout measures in the overlay context, while XY axes are
          // painted on the underlay. Compare fonts across this chart's layers.
          const measuredCalls=canvases.flatMap(([,entry])=>entry.kind==='2d'?(window.__AXIS_MEASURES__.get(entry.context)??[]):[]);
          const labels=canvases.flatMap(([canvas,{context:ctx,kind}])=>kind!=='2d'?[]:(window.__AXIS_TEXTS__.get(ctx)??[]).map(text=>{
            const b=text.bounds,left=Math.max(0,Math.floor(b.left)),top=Math.max(0,Math.floor(b.top)),right=Math.min(canvas.width,Math.ceil(b.right)),bottom=Math.min(canvas.height,Math.ceil(b.bottom));
            let matched=0;if(right>left&&bottom>top){const pixels=ctx.getImageData(left,top,right-left,bottom-top).data;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>=48&&rgb.every((value,j)=>Math.abs(pixels[i+j]-value)<=3))matched++;}
            const measured=measuredCalls.some(call=>call.text===text.text&&call.font===text.font);
            return{...text,matchedPixels:matched,measuredWithDrawnFont:measured,insideCanvas:b.left>=-1&&b.top>=-1&&b.right<=canvas.width+1&&b.bottom<=canvas.height+1};
          }));
          let gridPixels=0,dataPixels=0;const gl=[];
          const plot=window.__XY_THEME__.snapshot().plot;
          for(const[canvas,{context,kind}]of canvases){
            if(kind==='2d'){
              const sx=canvas.width/760,sy=canvas.height/480,x=Math.ceil((plot.left+3)*sx),y=Math.ceil((plot.top+3)*sy),w=Math.max(1,Math.floor((plot.width-6)*sx)),h=Math.max(1,Math.floor((plot.height-6)*sy));
              const pixels=context.getImageData(x,y,w,h).data;
              for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>20&&gridRGB.every((value,j)=>Math.abs(pixels[i+j]-value)<=3))gridPixels++;
            }else if(kind==='webgl2'){
              const errors=[],g=context,previous=g.getParameter(g.READ_FRAMEBUFFER_BINDING),pixels=new Uint8Array(canvas.width*canvas.height*4);
              g.bindFramebuffer(g.READ_FRAMEBUFFER,null);g.readPixels(0,0,canvas.width,canvas.height,g.RGBA,g.UNSIGNED_BYTE,pixels);g.bindFramebuffer(g.READ_FRAMEBUFFER,previous);
              for(let i=0;i<12;i++){const error=g.getError();if(!error)break;errors.push(error);}
              for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>128&&pixels[i+1]>pixels[i]+50&&pixels[i+2]>pixels[i]+30)dataPixels++;
              gl.push({lost:g.isContextLost(),errors});
            }
          }
          return{labels,expected:{rgb,gridRGB,size,family,hidden,gridHidden},gridPixels,dataPixels,gl,
            fontCorrect:hidden?labels.length===0:labels.length>0&&labels.every(label=>label.font.includes(`${size}px`)&&label.font.includes(family)),
            textPixelsCorrect:hidden?labels.length===0:labels.length>0&&labels.every(label=>label.matchedPixels>3),
            measurementMatches:labels.every(label=>label.measuredWithDrawnFont),
            gridCorrect:gridHidden?gridPixels===0:gridPixels>30,
            boundsCorrect:labels.every(label=>label.insideCanvas)};
        },{rgb,gridRGB,size,family,hidden,gridHidden:!!explicit||!!hidden});
        const e=result.evidence;result.matchesExpected=e.fontCorrect&&e.textPixelsCorrect&&e.gridCorrect&&e.boundsCorrect;
        if(mode==='candidate'){
          assert.equal(e.fontCorrect,true,'Resolved text font must obey explicit > theme > default precedence');
          assert.equal(e.textPixelsCorrect,true,'Actual label ROI pixels must contain the chosen text color');
          assert.equal(e.gridCorrect,true,'Grid pixels must use the theme or explicit hidden style');
          assert.equal(e.boundsCorrect,true,'Measured tick label glyphs must fit the actual canvas');
          if(id==='large-font')assert.equal(e.measurementMatches,true,'Large text must have been measured with its actual drawn font');
        }
        assert.ok(e.dataPixels>50,'The actual data line must render after layout');assert.ok(e.gl.length===1);assert.ok(e.gl.every(item=>!item.lost&&item.errors.length===0));assert.deepEqual(pageErrors,[]);
        await page.screenshot({path:resolve(out,`${mode}-${id}.png`)});result.status=mode==='candidate'?'passed':'baseline-observed';
      }catch(error){result.status='failed';result.error=error.message;report.errors.push({mode,id,message:error.message});}
      finally{page.off('pageerror',onError);}
      report.scenarios.push(result);
    }
  }
  const baseline=report.scenarios.filter(item=>item.mode==='baseline');if(!focus)assert.ok(baseline.filter(item=>!item.matchesExpected).length>=4,'The browser baseline must reproduce the diagnosed theme defect');
  report.passed=report.errors.length===0;await showStep(page,'XY theme checks complete',`${report.scenarios.filter(item=>item.mode==='candidate'&&item.status==='passed').length}/${focus?1:8} candidate cases; baseline failures retained; this is not full CRYChart parity.`);
}catch(error){report.errors.push({fatal:error.message});report.passed=false;}
finally{await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();await server.close();}
console.log(JSON.stringify({passed:report.passed,candidatePassed:report.scenarios.filter(item=>item.mode==='candidate'&&item.status==='passed').length,failures:report.errors.length,path:resolve(out,'report.json')}));
if(!report.passed)process.exitCode=1;
