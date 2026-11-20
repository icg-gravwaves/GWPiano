import {catalogPlan, chirpMass, equivalentMass} from './catalog-audio.mjs';

export {chirpMass, equivalentMass};

/** Notable detections shown below the instrument, with the reason each one matters. */
export const landmarks = [
  {name: 'GW150914', title: 'The first detection',
    text: 'The first gravitational wave ever measured, on 14 September 2015: two black holes about 30 times the mass of the Sun.'},
  {name: 'GW170817', title: 'Two neutron stars',
    text: 'Seen in light as well as gravitational waves: a kilonova that made heavy elements like gold. The lightest pair, so the highest note, above the top of the piano.'},
  {name: 'GW170814', title: 'Three detectors',
    text: 'The first signal seen by Virgo as well as both LIGO detectors, which let astronomers locate it far more precisely.'},
  {name: 'GW190521', title: 'The heaviest pair',
    text: 'Among the heaviest black holes yet measured, merging into one of the first known intermediate-mass black holes: a deep note low on the piano.'},
  {name: 'GW190814', title: 'A mystery object',
    text: 'A 23 solar-mass black hole with a 2.6 solar-mass partner: too heavy for a known neutron star, too light for a known black hole.'},
  {name: 'GW200115_042309', title: 'A black hole meets a neutron star',
    text: 'One of the first confident detections of a black hole swallowing a neutron star.'},
];

/** Pair each landmark with its chirp-mass-equivalent binary and the nearest piano note. */
export function landmarkNotes(events, notes) {
  return landmarks.flatMap(landmark => {
    const event = events.find(candidate => candidate.name === landmark.name);
    if (!event || event.masses.length !== 2) return [];
    const part = {...catalogPlan([event], notes)[0], offset: 0};
    return [{...landmark, event, chirp: chirpMass(event.masses), mass: part.mass, note: part.note,
      cents: 1200 * Math.log2(part.playbackRate), part}];
  });
}
