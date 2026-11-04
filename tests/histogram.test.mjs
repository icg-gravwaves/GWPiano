import test from 'node:test';
import assert from 'node:assert/strict';
import {massBins} from '../src/gw_piano/web/histogram.mjs';

test('small linear bins cover the full piano mass range', () => {
  const axis = massBins([1.89,3,60.56,288.07]);
  assert.equal(axis.edges[0],0);
  assert.equal(axis.edges.at(-1),300);
  assert.equal(axis.edges.length,151);
  for (let i=1;i<axis.edges.length;i++) assert.equal(axis.edges[i]-axis.edges[i-1],2);
});
test('note marker distances are proportional to component mass', () => {
  const axis = massBins([1.89,288.07]);
  assert.equal(axis.position(20)-axis.position(10),axis.position(10)-axis.position(0));
  assert.equal(axis.position(150),0.5);
  assert.equal(axis.position(300),1);
});
test('bin boundaries retain every component, including the upper endpoint', () => {
  const axis = massBins([1,2,4,8]);
  assert.deepEqual([1,1.5,2,3,4,8,20].map(axis.index),[0,0,1,1,2,4,9]);
  const masses = Array.from({length:88}, (_,i)=>288.07*2**(-i/12));
  const counts = Array(axis.edges.length-1).fill(0);
  for (const mass of masses) counts[axis.index(mass)]++;
  assert.equal(counts.reduce((a,b)=>a+b,0),88);
});
test('invalid masses and bin widths are rejected', () => {
  for (const masses of [[],[0],[-1],[NaN]]) assert.throws(()=>massBins(masses),RangeError);
  for (const width of [0,-1,NaN]) assert.throws(()=>massBins([1],width),RangeError);
});
test('displayed range can end at 150 without changing linear bin widths',()=>{
 const axis=massBins([137],2,150);
 assert.equal(axis.edges.at(-1),150);
 assert.equal(axis.edges.length,76);
 assert.equal(axis.index(150),74);
 assert.equal(axis.position(75),0.5);
});
