/** Combine a short, model chirp at its original pitch with a synthetic note tail. */
export function musicalSample(samples, sampleRate, frequency) {
  if (!samples.length || !Number.isFinite(frequency) || frequency <= 0 ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 || frequency >= sampleRate / 2) {
    throw new RangeError('Require audio samples, a positive sample rate, and a frequency below Nyquist');
  }
  let peakIndex = 0;
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs(samples[i]) > Math.abs(samples[peakIndex])) peakIndex = i;
  }
  const start = Math.max(0, peakIndex - Math.round(0.12 * sampleRate));
  const end = Math.min(samples.length, peakIndex + Math.round(0.02 * sampleRate));
  const chirpLength = end - start;
  const overlap = Math.min(chirpLength, Math.round(0.02 * sampleRate));
  const toneStart = chirpLength - overlap;
  const toneLength = Math.round(0.35 * sampleRate);
  const output = new Float32Array(toneStart + toneLength);
  const attack = Math.max(1, Math.round(0.005 * sampleRate));
  const release = Math.max(1, Math.round(0.01 * sampleRate));
  let peak = 0;
  for (let i = 0; i < output.length; i++) {
    const crossfade = Math.max(0, Math.min(1, (i - toneStart) / Math.max(1, overlap - 1)));
    const chirp = i < chirpLength ? samples[start + i] * Math.cos(crossfade * Math.PI / 2) : 0;
    const t = (i - toneStart) / sampleRate;
    const tone = t >= 0 ? 0.65 * Math.sin(2 * Math.PI * frequency * t) *
      Math.exp(-t / 0.18) * Math.sin(crossfade * Math.PI / 2) : 0;
    const envelope = Math.min(1, i / attack, (output.length - 1 - i) / release);
    output[i] = (chirp + tone) * envelope;
    peak = Math.max(peak, Math.abs(output[i]));
  }
  if (peak) for (let i = 0; i < output.length; i++) output[i] *= 0.9 / peak;
  return output;
}
