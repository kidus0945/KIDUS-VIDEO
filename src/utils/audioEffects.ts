import type { AudioEffectSettings } from "../types/mediaStudio";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function getEffectAtTime(
  timeSec: number,
  settings: AudioEffectSettings
): { speed: number; pitchSemitones: number } {
  for (let i = settings.segments.length - 1; i >= 0; i--) {
    const seg = settings.segments[i];
    if (timeSec >= seg.startSec && timeSec < seg.endSec) {
      return {
        speed: clamp(seg.speed, 0.5, 2.2),
        pitchSemitones: clamp(seg.pitchSemitones, -12, 12),
      };
    }
  }
  return {
    speed: clamp(settings.baseSpeed, 0.5, 2.2),
    pitchSemitones: clamp(settings.basePitchSemitones, -12, 12),
  };
}

/**
 * Applies independent speed (time-stretch) and pitch (semitones) across the whole
 * track and/or specific time segments using Hann-windowed WSOLA overlap-add.
 */
export function processAudioWithEffects(
  source: AudioBuffer,
  settings: AudioEffectSettings
): AudioBuffer {
  const isNeutral =
    Math.abs(settings.baseSpeed - 1) < 0.01 &&
    Math.abs(settings.basePitchSemitones) < 0.05 &&
    settings.segments.length === 0;

  if (isNeutral) {
    return source;
  }

  const sampleRate = source.sampleRate;
  const numChannels = source.numberOfChannels;
  const srcLen = source.length;
  if (srcLen === 0) return source;

  const srcChannels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    srcChannels.push(source.getChannelData(c));
  }

  const winSize = 2048;
  const synHop = 512;
  const searchRadius = 96;

  // Build Hann window
  const hann = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / winSize));
  }

  // Estimate max output buffer length conservatively
  const minSpeed = Math.min(
    settings.baseSpeed,
    ...settings.segments.map((s) => s.speed),
    0.5
  );
  const maxOutLen = Math.ceil(srcLen / Math.max(0.45, minSpeed)) + winSize * 4;

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    outChannels.push(new Float32Array(maxOutLen));
  }
  const normBuf = new Float32Array(maxOutLen);

  let srcPos = 0;
  let outPos = 0;
  let prevNaturalPos = 0;

  const readSample = (ch: Float32Array, idx: number): number => {
    if (idx < 0 || idx >= srcLen - 1) return 0;
    const i0 = Math.floor(idx);
    const frac = idx - i0;
    return ch[i0] * (1 - frac) + ch[i0 + 1] * frac;
  };

  while (srcPos < srcLen - 16 && outPos + winSize < maxOutLen) {
    const timeSec = srcPos / sampleRate;
    const { speed, pitchSemitones } = getEffectAtTime(timeSec, settings);
    const pitchFactor = Math.pow(2, pitchSemitones / 12);

    // Phase-aligned candidate offset using channel 0 around ideal srcPos
    let bestOffset = 0;
    if (outPos > 0) {
      let bestScore = -Infinity;
      const refCh = srcChannels[0];
      for (let off = -searchRadius; off <= searchRadius; off += 4) {
        const candStart = srcPos + off;
        if (candStart < 0 || candStart + winSize * pitchFactor >= srcLen) continue;
        let score = 0;
        for (let k = 0; k < 256; k += 4) {
          const sA = readSample(refCh, prevNaturalPos + k * pitchFactor);
          const sB = readSample(refCh, candStart + k * pitchFactor);
          score += sA * sB;
        }
        if (score > bestScore) {
          bestScore = score;
          bestOffset = off;
        }
      }
    }

    const alignedStart = Math.max(0, srcPos + bestOffset);

    for (let c = 0; c < numChannels; c++) {
      const sCh = srcChannels[c];
      const oCh = outChannels[c];
      for (let i = 0; i < winSize; i++) {
        const sample = readSample(sCh, alignedStart + i * pitchFactor);
        oCh[outPos + i] += sample * hann[i];
      }
    }

    for (let i = 0; i < winSize; i++) {
      normBuf[outPos + i] += hann[i];
    }

    prevNaturalPos = alignedStart + synHop * pitchFactor;
    srcPos += synHop * speed;
    outPos += synHop;
  }

  const finalLen = Math.max(1, Math.min(maxOutLen, outPos + synHop));
  const outBuffer = new AudioBuffer({
    length: finalLen,
    numberOfChannels: numChannels,
    sampleRate,
  });

  for (let c = 0; c < numChannels; c++) {
    const oCh = outChannels[c];
    const target = outBuffer.getChannelData(c);
    for (let i = 0; i < finalLen; i++) {
      const n = normBuf[i] > 1e-4 ? oCh[i] / normBuf[i] : oCh[i];
      target[i] = clamp(n, -1, 1);
    }
  }

  return outBuffer;
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const dataSize = length * numChannels * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = clamp(channels[c][i], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}
