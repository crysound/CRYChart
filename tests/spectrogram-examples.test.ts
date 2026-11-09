import test from 'node:test';
import assert from 'node:assert/strict';
import {shortTimeSpectrum,matrixProjection} from '../examples/official/spectrogram-data';

test('STFT recovers known tone level in every overlapping window and maps physical time/frequency',()=>{
  const signal=Float64Array.from({length:2048},(_,i)=>.01*Math.sin(2*Math.PI*64*i/1024));
  const result=shortTimeSpectrum(signal,1024,1024,256);
  assert.equal(result.columns,5);assert.equal(result.rows,513);assert.equal(result.timeStep,.25);assert.equal(result.frequencyStep,1);
  for(let col=0;col<result.columns;col++)assert.ok(Math.abs(result.values[64*5+col]+40)<.001);
  assert.ok(result.values[200*5]<-99);assert.throws(()=>shortTimeSpectrum(signal,1024,1000),RangeError);
});

test('spectrogram row and column projections use the same source cell, including missing values',()=>{
  const values=new Float32Array([1,2,3,4,NaN,6]),snapshot=values.slice(),result=matrixProjection(values,3,2,1,1);
  assert.deepEqual([...result.horizontal],[4,NaN,6]);assert.deepEqual([...result.vertical],[2,NaN]);assert.ok(Number.isNaN(result.value));assert.deepEqual(values,snapshot);
  assert.throws(()=>matrixProjection(values,3,2,3,0),RangeError);
});
