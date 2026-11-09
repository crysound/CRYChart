import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartXY} from '../src/chart';
import {DataSetXY} from '../src/core/data';
import {DashedLine,SolidLine,SolidFill,ColorRGBA} from '../src/core/styles';

test('explicit block preparation releases whole-history projection, preserves every source row and advances only the tail',()=>{
 const chart=new ChartXY(),data=new DataSetXY({schema:{x:{storage:Float64Array,auto:true},y:{storage:Float64Array}}}).setMaxSampleCount(100_000),line=chart.addLineSeries({dataSet:data});
 data.appendSamples({y:Float64Array.from({length:100_000},(_,i)=>Math.sin(i*.01))},{start:0,step:1});chart.getDefaultAxisX().setInterval({start:75_000,end:99_999});chart.getDefaultAxisY().setInterval({start:-2,end:2});chart.renderNow();
 const denseBytes=line.getXYProjectionStorageBytes();assert.ok(denseBytes>=800_000);const packets=line.drawLinePackets(chart.getSeriesScreenRect(line));assert.ok(packets.length>0&&packets.length<5);assert.ok(packets.every(p=>p.id<=-(2**40)));assert.ok(line.getXYProjectionStorageBytes()<denseBytes);assert.equal(data.getSampleCount(),100_000);assert.equal(data.getColumnRuns('x').kind,'affine');
 const previous=line.getLineBlockStats()!;assert.ok(previous.requestedSegments>=24_999);data.appendSamples({y:new Float64Array(1000)},{step:1});chart.getDefaultAxisX().setInterval({start:76_000,end:100_999});line.drawLinePackets(chart.getSeriesScreenRect(line));assert.ok(line.getLineBlockStats()!.projectedSamplesThisUpdate<=1004);assert.equal(data.getSampleCount(),100_000);assert.equal(line.findNearestX(100_500)!.x,100_500);
 line.dispose();assert.equal(line.getXYProjectionStorageBytes(),0);assert.equal(data.isDisposed(),false);chart.dispose();data.dispose();
});

test('experimental series blocks fall back for unsupported styles and cannot trust hidden invalid X',()=>{
 const chart=new ChartXY(),line=chart.addLineSeries();line.addArraysXY(Float64Array.from({length:5000},(_,i)=>i),new Float64Array(5000));chart.getDefaultAxisX().setInterval({start:4000,end:4999});chart.getDefaultAxisY().setInterval({start:-1,end:1});chart.renderNow();
 line.setStrokeStyle(new DashedLine({pattern:[2,3],fillStyle:new SolidFill({color:ColorRGBA(1,2,3)})}));let packets=line.drawLinePackets(chart.getSeriesScreenRect(line));assert.equal(packets.length,1);assert.equal(packets[0].id,line.id);assert.equal(line.getLineBlockStats(),undefined);
 line.setStrokeStyle(new SolidLine());line.drawLinePackets(chart.getSeriesScreenRect(line));assert.ok(line.getLineBlockStats());
 line.clear();const x=Float64Array.from({length:5000},(_,i)=>i);x[0]=NaN;line.addArraysXY(x,new Float64Array(5000));packets=line.drawLinePackets(chart.getSeriesScreenRect(line));assert.equal(packets[0].id,line.id);assert.equal(packets[0].count,5000);assert.equal(line.getSampleCount(),5000);assert.equal(line.getLineBlockStats(),undefined);chart.dispose();
});
