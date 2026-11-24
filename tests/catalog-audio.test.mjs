import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalogPlan, activeNotes, scheduleCatalog, chirpMass} from '../src/gw_piano/web/catalog-audio.mjs';
import {massBins} from '../src/gw_piano/web/histogram.mjs';

const notes = [{midi:60,mass:10,frequency:100},{midi:48,mass:20,frequency:50}];
const events = [{name:'one',masses:[10,20]},{name:'two',masses:[15]}];
test('each merger plays once as its chirp-mass-equivalent binary', () => {
  const plan = catalogPlan(events,notes);
  assert.deepEqual(plan.map(part=>part.event),['one','two']);
  assert.ok(Math.abs(chirpMass([plan[0].mass,plan[0].mass])-chirpMass([10,20]))<1e-9);
  assert.equal(plan[1].mass,15);
  for (const part of plan) assert.ok(Math.abs(part.frequency*part.mass-1000)<1e-10);
});
test('a build-time merger peak tunes the event without an equal-mass assumption', () => {
  const [part] = catalogPlan([{name:'unequal',masses:[30,3],peak:60}],notes);
  assert.equal(part.note.midi,48);
  assert.ok(Math.abs(part.frequency-60)<1e-9);
  assert.ok(Math.abs(part.playbackRate-60/50)<1e-12);
  assert.ok(Math.abs(part.mass*part.frequency-1000)<1e-9);
  assert.deepEqual(part.components,[30,3]);
});
test('played and detected bin counts match for the actual bundled catalog', () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/gw_piano/data/catalog.json',import.meta.url)));
  const masses = catalog.events.flatMap(event=>event.masses);
  const plan = catalogPlan(catalog.events,notes);
  const axis = massBins(masses);
  const count = values => {const counts=Array(axis.edges.length-1).fill(0);for(const value of values)counts[axis.index(value)]++;return counts;};
  assert.equal(plan.length,catalog.events.length);
  assert.deepEqual(count(plan.flatMap(part=>part.components)),count(masses));
});
test('chronological events are ordered at distinct offsets', () => {
  const plan=catalogPlan([{name:'GW200101',masses:[10,20]},{name:'GW150914',masses:[10]}],notes,0.1);
  assert.deepEqual(plan.map(part=>[part.event,part.offset]),[['GW150914',0],['GW200101',0.1]]);
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

function audioContextStub() {
  const sources=[];
  const gain={gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};
  return {sources,createGain:()=>gain,createBufferSource(){
    const source={playbackRate:{value:1},connect(){},disconnect(){},start(time){this.startTime=time;},stop(){this.stopped=true;this.onended();}};
    sources.push(source);return source;
  }};
}
test('lookup playback reuses buffers and schedules every component without a mix',()=>{
  const context=audioContextStub(),buffer={duration:0.5};
  const plan=[{offset:0,playbackRate:1,note:notes[0]},{offset:3,playbackRate:2,note:notes[1]}];
  let ended=0;
  scheduleCatalog(context,plan,()=>buffer,{},10,()=>ended++);
  assert.deepEqual(context.sources.map(source=>source.startTime),[10,13]);
  assert.deepEqual(context.sources.map(source=>source.playbackRate.value),[1,2]);
  assert.ok(context.sources.every(source=>source.buffer===buffer));
  assert.deepEqual(plan.map(part=>part.duration),[0.5,0.25]);
  context.sources[0].onended();assert.equal(ended,0);
  context.sources[1].onended();assert.equal(ended,1);
});
test('stopping lookup playback cancels future components without a completion callback',()=>{
  const context=audioContextStub();let ended=0;
  const plan=Array.from({length:40},(_,i)=>({offset:i,playbackRate:1,note:notes[0]}));
  const batch=scheduleCatalog(context,plan,()=>({duration:0.5}),{},10,()=>ended++);
  batch.stop();batch.stop();
  assert.equal(context.sources.length,40);
  assert.ok(context.sources.every(source=>source.stopped));
  assert.equal(ended,0);
});
