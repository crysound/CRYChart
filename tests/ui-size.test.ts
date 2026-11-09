import test from 'node:test';
import assert from 'node:assert/strict';
import {UIElement} from '../src/ui.js';
import {UIElementBuilders} from '../src/core/styles.js';

function measuredCanvas(fail=false){
 const stack:any[]=[],boxes:number[][]=[];
 const context:any={font:'9px monospace',textAlign:'right',textBaseline:'middle',fillStyle:'orange',strokeStyle:'navy',lineWidth:7,
  save(){stack.push({font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth});},
  restore(){Object.assign(this,stack.pop());},measureText(text:string){if(fail)throw Error('measure failure');const size=Number(this.font.match(/([\d.]+)px/)[1]),widths:Record<string,number>={W:1.2,w:1.1,i:.2,d:.6,e:.5};return{width:[...text].reduce((sum,c)=>sum+(widths[c]??.7),0)*size};},
  fillRect(...args:number[]){boxes.push(args);},strokeRect(){},fillText(){},setLineDash(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
 };
 return{context:context as CanvasRenderingContext2D,host:{overlay:{getContext:()=>context} as unknown as HTMLCanvasElement},stack,boxes};
}
const rect={left:0,top:0,width:600,height:400};

test('public text size is measured before first paint and includes multiline padding and margin without changing Canvas state',()=>{
 const drawing=measuredCanvas(),ui=new UIElement(drawing.host).setText('Wi\nwide').setTextFont(f=>f.setSize(20)).setPadding(4).setMargin(3);
 assert.equal(ui.bounds.width,0);
 const size=ui.getSize();assert.deepEqual(size,{x:62,y:68});
 assert.equal(drawing.context.font,'9px monospace');assert.equal(drawing.context.textAlign,'right');assert.equal(drawing.context.textBaseline,'middle');assert.equal(drawing.stack.length,0);
 size.x=-1;assert.deepEqual(ui.getSize(),{x:62,y:68},'caller cannot mutate the next measured result');
 ui.draw(drawing.context,rect);
 assert.equal(ui.bounds.width,56);assert.equal(ui.bounds.height,62);
 assert.deepEqual(ui.getSize(),{x:ui.bounds.width+6,y:ui.bounds.height+6},'actual background bounds plus transparent margins');
 assert.deepEqual(drawing.boxes[0].slice(2),[56,62]);
});

test('size follows actual text, font and padding changes immediately after a previous draw',()=>{
 const drawing=measuredCanvas(),ui=new UIElement(drawing.host).setText('Wi').setTextFont(f=>f.setSize(20)).setPadding(4).setMargin(3);
 ui.draw(drawing.context,rect);ui.setText('WWW');assert.deepEqual(ui.getSize(),{x:86,y:41});
 ui.setPadding({left:1,right:3,top:2,bottom:5}).setTextFont(f=>f.setSize(10));
 assert.deepEqual(ui.getSize(),{x:52,y:29.5});
 ui.draw(drawing.context,rect);assert.equal(ui.bounds.width,46);assert.equal(ui.bounds.height,23.5);
 assert.deepEqual(ui.getSize(0),{x:36,y:13.5});
 assert.deepEqual(ui.getSize(1),{x:46,y:23.5});
 assert.deepEqual(ui.getSize(2),{x:46,y:23.5});
});

test('checkbox public size includes the actually painted control and failed measurement restores state',()=>{
 const drawing=measuredCanvas(),ui=new UIElement(drawing.host,UIElementBuilders.CheckBox).setText('i').setTextFont(f=>f.setSize(10)).setPadding(2).setMargin(1);
 assert.deepEqual(ui.getSize(),{x:21.5,y:19.5});assert.deepEqual(ui.getSize(0),{x:15.5,y:13.5});
 ui.draw(drawing.context,rect);assert.equal(ui.bounds.width,19.5);assert.equal(ui.bounds.height,17.5);
 const failing=measuredCanvas(true),label=new UIElement(failing.host).setText('W').setTextFont(f=>f.setSize(30));
 assert.throws(()=>label.getSize(),/measure failure/);assert.equal(failing.context.font,'9px monospace');assert.equal(failing.stack.length,0);
});

test('headless UI reuses a real prior draw context and does not invent text metrics before any Canvas exists',()=>{
 const drawing=measuredCanvas(),ui=new UIElement().setText('W').setTextFont(f=>f.setSize(10)).setPadding(0);
 assert.throws(()=>ui.getSize(),/Canvas2D/);
 ui.draw(drawing.context,rect);assert.deepEqual(ui.getSize(),{x:12,y:13.5});
 ui.setText('WW');assert.deepEqual(ui.getSize(),{x:24,y:13.5});
});
