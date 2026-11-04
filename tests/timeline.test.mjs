import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eventTimeline,observingRuns} from '../src/gw_piano/web/timeline.mjs';
import {catalogPlan} from '../src/gw_piano/web/catalog-audio.mjs';
test('calendar condensation preserves relative time gaps and both event components',()=>{
 const events=[{name:'GW200103',gps:130,masses:[10,20]},{name:'GW200101',gps:100,masses:[10]},{name:'GW200102',gps:110,masses:[10]}];
 const timed=eventTimeline(events,true,60);
 assert.deepEqual(timed.map(e=>e.offset),[0,20,60]);
 const plan=catalogPlan(timed,[{midi:60,mass:10,frequency:100}]);
 assert.deepEqual(plan.map(p=>p.offset),[0,20,60,60]);
 assert.deepEqual(eventTimeline(events).map(e=>e.offset),[0,0.1,0.2]);
});
test('snapshot events have GPS dates and include every observing run represented',()=>{
 const c=JSON.parse(readFileSync(new URL('../src/gw_piano/data/catalog.json',import.meta.url)));
 const timed=eventTimeline(c.events,true);
 assert.equal(timed[0].offset,0);assert.equal(timed.at(-1).offset,30);
 assert.ok(c.events.every(e=>Number.isFinite(Date.parse(e.utc))));
 for(const run of observingRuns) assert.ok(c.events.some(e=>e.gps>=run.start&&e.gps<=run.end),run.name);
 assert.equal(timed.reduce((n,e)=>n+e.masses.length,0),c.events.reduce((n,e)=>n+e.masses.length,0));
});
