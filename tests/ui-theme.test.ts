import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY,Polar} from '../src/chart.js';
import {Cursor,ResultTable,UIElement} from '../src/ui.js';
import {makeCustomTheme} from '../src/themes.js';
import {ColorHEX,FontSettings,SolidFill,SolidLine,Themes,UIElementBuilders,emptyFill,emptyLine,transparentFill} from '../src/core/styles.js';

function canvasOracle(){
  const fills:string[]=[],strokes:string[]=[],texts:Array<{text:string;color:string;font:string;align:string}>=[],saved:any[]=[];
  const value:any={fillStyle:'orange',strokeStyle:'green',font:'18px serif',textAlign:'center',textBaseline:'middle',lineWidth:3,
    save(){saved.push({fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,lineWidth:this.lineWidth});},
    restore(){Object.assign(this,saved.pop());},
    measureText(text:string){return{width:text.length*7};},
    setLineDash(){},fillRect(){fills.push(this.fillStyle);},strokeRect(){strokes.push(this.strokeStyle);},
    fillText(text:string){texts.push({text,color:this.fillStyle,font:this.font,align:this.textAlign});},
  };
  return{ctx:value as CanvasRenderingContext2D,fills,strokes,texts};
}
const rect={left:0,top:0,width:500,height:300};
for(const dark of [false,true])test(`native ${dark?'dark':'light'} cursor result table paints theme background, border, text and font`,()=>{
  const colors={background:ColorHEX(dark?'#202833':'#ffffff'),border:ColorHEX(dark?'#64758a':'#cbd5e1'),text:ColorHEX(dark?'#e0e0e0':'#334155')};
  const theme=makeCustomTheme({isDark:dark,backgroundColor:transparentFill,uiBackgroundColor:colors.background,uiBorderColor:colors.border,textColor:colors.text,fontFamily:'Arial',fontSize:{other:14}});
  for(const Chart of [ChartXY,Polar]){
    const chart=new Chart({theme}),cursor=chart.getAutoCursor() as Cursor,table=cursor.getResultTable().setContent([['Angle','','90 deg'],['Amplitude','','-12.346 dB']]);
    assert.equal(table.getBackground().getFillStyle(),theme.uiBackgroundFillStyle);
    assert.equal(table.getBackground().getStrokeStyle(),theme.uiBorderStrokeStyle);
    assert.equal(table.getTextFont(),theme.font);
    const draw=canvasOracle();table.draw(draw.ctx,rect,()=>({x:180,y:80}));
    assert.deepEqual(draw.fills,[colors.background.toCSS()]);assert.deepEqual(draw.strokes,[colors.border.toCSS()]);
    assert.equal(draw.texts.length,2);assert.ok(draw.texts.every(call=>call.color===colors.text.toCSS()&&call.font.includes('14px Arial')&&call.align==='left'));
    assert.equal(draw.ctx.fillStyle,'orange');assert.equal(draw.ctx.textAlign,'center');
    assert.equal(chart.addCursor().getResultTable().getBackground().getFillStyle(),theme.uiBackgroundFillStyle);
    chart.dispose();
  }
});

test('builder and explicit result table overrides remain authoritative and do not mutate the shared theme',()=>{
  const theme=makeCustomTheme({isDark:false,uiBackgroundColor:ColorHEX('#ffffff'),uiBorderColor:ColorHEX('#334155'),textColor:ColorHEX('#123456')}),owner={theme};
  const font=new FontSettings({size:19,family:'monospace'}),fill=new SolidFill({color:ColorHEX('#b00080')}),background=new SolidFill({color:ColorHEX('#123400')});
  const label=new UIElement(owner,UIElementBuilders.TextBox.setFont(font).setTextFillStyle(fill).setBackground(background));
  assert.equal(label.getTextFont(),font);assert.equal(label.getTextFillStyle(),fill);assert.equal(label.getBackground().getFillStyle(),background);
  const first=new ResultTable(owner).setContent([['Explicit']]),second=new ResultTable(owner).setContent([['Theme']]);
  first.setTextFont(font).setTextFillStyle(fill).setBackground(value=>value.setFillStyle(background).setStrokeStyle(emptyLine));
  const draw=canvasOracle();first.draw(draw.ctx,rect);first.draw(draw.ctx,rect);
  assert.deepEqual(draw.fills,[background.color.toCSS(),background.color.toCSS()]);assert.deepEqual(draw.strokes,[]);assert.ok(draw.texts.every(call=>call.color===fill.color.toCSS()&&call.font.includes('19px monospace')));
  assert.notEqual(first.getBackground(),second.getBackground());assert.equal(second.getBackground().getFillStyle(),theme.uiBackgroundFillStyle);assert.equal(theme.uiBackgroundFillStyle.getColor().toCSS(),ColorHEX('#ffffff').toCSS());
  first.setBackground(value=>value.setFillStyle(emptyFill));const empty=canvasOracle();first.draw(empty.ctx,rect);assert.deepEqual(empty.fills,[]);
});

test('built-in light themes supply UI defaults and unthemed UI keeps its established defaults',()=>{
  const light=new ResultTable({theme:Themes.light}),plain=new ResultTable();
  assert.equal(light.getBackground().getFillStyle(),Themes.light.panelBackgroundFillStyle);
  assert.equal(light.getTextFillStyle().getColor?.(),Themes.light.textColor);
  assert.equal(light.getBackground().getStrokeStyle(),Themes.light.axisStrokeStyle);
  assert.equal(plain.getTextFont().size,12);assert.notEqual(plain.getBackground().getFillStyle(),light.getBackground().getFillStyle());
  const partial=new ResultTable({theme:{uiBorderStrokeStyle:new SolidLine({thickness:3}),font:new FontSettings({size:17})}});
  assert.equal(partial.getBackground().getStrokeStyle().getThickness?.(),3);assert.equal(partial.getTextFont().size,17);
});
