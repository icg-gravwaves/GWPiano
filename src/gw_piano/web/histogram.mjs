/** Small equal-width component-mass bins on a linear axis starting at zero. */
export function massBins(masses, binWidth = 2) {
  if (!masses.length || masses.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError('Masses must be finite and positive');
  }
  if (!Number.isFinite(binWidth) || binWidth <= 0) throw new RangeError('Bin width must be positive');
  const count = Math.max(10, Math.ceil(Math.max(...masses) / (binWidth * 10)) * 10);
  const edges = Array.from({length: count + 1}, (_, i) => i * binWidth);
  return {
    edges,
    index: mass => {
      // Compare stored edges so exact boundaries enter the next bin.
      let low = 0, high = count;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (mass >= edges[middle + 1]) low = middle + 1;
        else high = middle;
      }
      return Math.min(count - 1, low);
    },
    position: mass => mass / edges.at(-1),
  };
}
