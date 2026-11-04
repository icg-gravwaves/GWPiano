/** GWOSC observing-run GPS intervals, including the O3 and O4 subdivisions. */
export const observingRuns = [
  {name:'O1',start:1126051217,end:1137254417,url:'https://gwosc.org/O1/'},
  {name:'O2',start:1164556817,end:1187733618,url:'https://gwosc.org/O2/'},
  {name:'O3a',start:1238166018,end:1253977218,url:'https://gwosc.org/O3/O3a/'},
  {name:'O3b',start:1256655618,end:1269363618,url:'https://gwosc.org/O3/O3b/'},
  {name:'O4a',start:1368975618,end:1389456018,url:'https://gwosc.org/O4/O4a/'},
  {name:'O4b',start:1396796418,end:1422118818,url:'https://gwosc.org/O4/O4b/'}
];
export function eventTimeline(events, condensed = false, span = 30) {
  if (!events.length || events.some(event => !Number.isFinite(event.gps))) throw new RangeError('Event GPS times are required');
  const ordered=[...events].sort((a,b)=>a.gps-b.gps);
  const first=ordered[0].gps, last=ordered.at(-1).gps;
  return ordered.map((event,index)=>({...event,offset:condensed && last>first ? (event.gps-first)/(last-first)*span : index*0.1}));
}
