import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalogPlan, mixCatalog, activeNotes} from '../src/gw_piano/web/catalog-audio.mjs';
import {massBins} from '../src/gw_piano/web/histogram.mjs';

const notes = [{midi:60,mass:10,frequency:100},{midi:48,mass:20,frequency:50}];
const events = [{name:'one',masses:[10,20]},{name:'two',masses:[15]}];
test('every catalog component is retained without rounding or duplication', () => {
  const plan = catalogPlan(events,notes);
  assert.deepEqual(plan.map(part=>part.mass),[10,20,15]);
  assert.ok(Math.abs(plan[2].frequency-1000/15)<1e-10);
  assert.ok(Math.abs(plan[2].frequency*plan[2].mass-1000)<1e-10);
});
test('played and detected bin counts match for the actual bundled catalog', () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/gw_piano/data/catalog.json',import.meta.url)));
  const masses = catalog.events.flatMap(event=>event.masses);
  const plan = catalogPlan(catalog.events,notes);
  const axis = massBins(masses);
  const count = values => {const counts=Array(axis.edges.length-1).fill(0);for(const value of values)counts[axis.index(value)]++;return counts;};
  assert.equal(plan.length,masses.length);
  assert.deepEqual(count(plan.map(part=>part.mass)),count(masses));
});
test('ensemble mixes more than 24 components and preserves source audio', async () => {
  const rate=8000, samples=new Float32Array(800);
  for(let i=0;i<samples.length;i++)samples[i]=Math.sin(2*Math.PI*100*i/rate)*0.5;
  const original=samples.slice();
  const plan=catalogPlan(Array.from({length:40},(_,i)=>({name:String(i),masses:[10]})),notes);
  let calls=0;
  const output=await mixCatalog(plan,()=>{calls++;return {samples,sampleRate:rate};},rate);
  assert.equal(calls,80);
  assert.equal(output.length,800);
  assert.ok(output.some(value=>Math.abs(value)>0.1));
  assert.ok(Math.max(...output)<=0.900001);
  assert.deepEqual(samples,original);
});
test('musical mode mixes mass-specific tones with finite, bounded samples', async () => {
  const samples=Float32Array.from({length:800},(_,i)=>Math.sin(i/5)*0.5);
  const output=await mixCatalog(catalogPlan(events,notes),()=>({samples,sampleRate:8000}),8000,true);
  assert.ok(output.every(Number.isFinite));
  assert.ok(output.length>=2800);
  assert.ok(Math.max(...output.map(Math.abs))<=0.900001);
});
test('ensemble preparation can be cancelled at a yield point', async () => {
  const plan=catalogPlan(Array.from({length:20},()=>events[0]),notes);
  await assert.rejects(mixCatalog(plan,()=>({samples:new Float32Array(10),sampleRate:8000}),8000,false,async()=>{throw new Error('cancel');}),/cancel/);
});
test('chronological events keep components together at distinct offsets', async () => {
  const plan=catalogPlan([{name:'GW200101',masses:[10,20]},{name:'GW150914',masses:[10]}],notes,0.1);
  assert.deepEqual(plan.map(part=>[part.event,part.offset]),[['GW150914',0],['GW200101',0.1],['GW200101',0.1]]);
  const output=await mixCatalog(plan,()=>({samples:Float32Array.of(1,0),sampleRate:100}),100);
  assert.equal(output.length,12);
  assert.ok(output[0]>0);
  assert.ok(output[10]>0);
  assert.equal(output[5],0);
});

test('highlights expire at sound end while overlapping notes remain lit', () => {
  const plan=[{offset:0,duration:0.4,note:{midi:60}},
    {offset:0.3,duration:0.5,note:{midi:60}},
    {offset:0,duration:0.2,note:{midi:62}}];
  assert.deepEqual([...activeNotes(plan,-0.1)],[]);
  assert.deepEqual([...activeNotes(plan,0)],[60,62]);
  assert.deepEqual([...activeNotes(plan,0.2)],[60]);
  assert.deepEqual([...activeNotes(plan,0.5)],[60]);
  assert.deepEqual([...activeNotes(plan,0.8)],[]);
});
