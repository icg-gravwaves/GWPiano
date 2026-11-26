import {catalogPlan, chirpMass, equivalentMass} from './catalog-audio.mjs';

export {chirpMass, equivalentMass};

/** Notable detections shown below the instrument, with the reason each one matters.
 * `name` matches the catalog event; `label`, when given, is the shorter public name to display. */
export const landmarks = [
  {name: 'GW150914', title: 'The dawn of gravitational-wave astronomy',
    text: 'The first gravitational wave ever measured: two black holes, each about 30 times the mass of the Sun. It opened a new way to study the Universe and led to the 2017 Nobel Prize in Physics.'},
  {name: 'GW170817', title: 'Heard in gravity, seen in light',
    text: 'Seen in light as well as gravitational waves, in a kilonova that made heavy elements like gold. It showed gravity travels at the speed of light, testing Einstein\'s theories, and gave a new way to measure the Universe\'s expansion.'},
  {name: 'GW170814', title: 'Virgo joins the chorus',
    text: 'The first signal seen by Virgo as well as both LIGO detectors, which let astronomers locate it far more precisely.'},
  {name: 'GW231123_135430', label: 'GW231123', title: 'The bass note of the Universe',
    text: 'The heaviest black-hole merger yet measured: about 137 and 101 times the mass of the Sun, spinning rapidly and merging into a black hole of roughly 225 solar masses. It plays the deepest note of any detection on the piano.'},
  {name: 'GW190814', title: 'Too heavy, too light',
    text: 'A 23 solar-mass black hole with a 2.6 solar-mass partner: too heavy for a known neutron star, too light for a known black hole.'},
  {name: 'GW200115_042309', label: 'GW200115', title: 'Black hole meets neutron star',
    text: 'One of the first confident detections of a black hole swallowing a neutron star.'},
  {name: 'GW250114_082203', label: 'GW250114', title: 'GW150914\'s louder twin',
    text: 'Almost a twin of GW150914, but far clearer, because the detectors are now much more sensitive. Hearing it so clearly let scientists check Hawking\'s ideas about black holes.'},
  {name: 'GW230529_181500', label: 'GW230529', title: 'Picked out by Portsmouth',
    text: 'Seen by just one detector, and found within 15 seconds by the single-detector search in PyCBC Live, developed at the University of Portsmouth. A neutron star merged with a 3.6 solar-mass companion.'},
];

/** Pair each landmark with the nearest piano note to its merger frequency (see catalogPlan). */
export function landmarkNotes(events, notes) {
  return landmarks.flatMap(landmark => {
    const event = events.find(candidate => candidate.name === landmark.name);
    if (!event || event.masses.length !== 2) return [];
    const part = {...catalogPlan([event], notes)[0], offset: 0};
    return [{...landmark, label: landmark.label ?? landmark.name, event, chirp: chirpMass(event.masses), mass: part.mass, note: part.note,
      cents: 1200 * Math.log2(part.playbackRate), part}];
  });
}
