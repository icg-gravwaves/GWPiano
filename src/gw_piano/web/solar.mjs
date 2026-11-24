/** Render the solar-mass unit "M☉" with the ☉ as a subscript, in HTML and SVG text. */

const SVG_NS = 'http://www.w3.org/2000/svg';
const UNIT = 'M☉';

/** SVG markup string with each M☉ replaced by M and a subscript ☉ tspan. */
export function massMarkup(text) {
  return String(text).replaceAll(UNIT, 'M<tspan baseline-shift="sub" font-size="70%">☉</tspan>');
}

/** Set an element's text, rendering each M☉ with a subscript ☉ (<sub> in HTML, a shifted <tspan> in SVG). */
export function setMassText(element, text) {
  const svg = element.namespaceURI === SVG_NS;
  const parts = String(text).split(UNIT);
  const nodes = parts.flatMap((part, i) => {
    if (i === 0) return [part];
    const sub = svg ? document.createElementNS(SVG_NS, 'tspan') : document.createElement('sub');
    if (svg) { sub.setAttribute('baseline-shift', 'sub'); sub.setAttribute('font-size', '70%'); }
    sub.textContent = '☉';
    return ['M', sub, part];
  });
  element.replaceChildren(...nodes);
}
