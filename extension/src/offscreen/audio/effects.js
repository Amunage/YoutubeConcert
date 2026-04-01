import { clamp } from "../../lib/presets.js";

export { clamp };

const reverbBufferCache = new WeakMap();

export function createDisconnectCleanup(nodes = []) {
  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    const uniqueNodes = new Set();
    nodes.forEach((node) => {
      if (node && typeof node.disconnect === "function") {
        uniqueNodes.add(node);
      }
    });
    uniqueNodes.forEach((node) => {
      if (!node || typeof node.disconnect !== "function") return;
      try {
        node.disconnect();
      } catch (error) {
      }
    });
  };
}

export function hashSeed(value) {
  let hash = 2166136261;
  for (const ch of String(value || "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seeded(seedValue) {
  let seed = seedValue >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function dbToGain(db = 0) {
  return Math.pow(10, (Number(db) || 0) / 20);
}

export function getLayerBlend(index, count) {
  return count <= 1 ? 0 : index / (count - 1);
}

export function getTrackVolume(baseVolume, volumeDecayPercent, layerIndex) {
  let volume = clamp(baseVolume, 0, 100);
  const keepRatio = 1 - clamp(volumeDecayPercent, 0, 100) / 100;
  for (let step = 0; step < layerIndex; step += 1) {
    const depth = layerIndex <= 1 ? 0 : step / Math.max(1, layerIndex - 1);
    volume *= Math.min(0.96, keepRatio + depth * (1 - keepRatio) * 0.16);
  }
  return clamp(Math.max(baseVolume * 0.05, volume), 0, 100);
}

export function getTrackEffectStrength(basePercent, layerIndex) {
  let strength = 0;
  const growth = clamp(basePercent, 0, 100) / 100;
  for (let step = 0; step < layerIndex; step += 1) {
    strength += (100 - strength) * growth;
  }
  return clamp(strength, 0, 100);
}

export function getComplexityProfile(trackCount, roomPreset, audiencePreset, reverbDrive) {
  const roomLoad = roomPreset === "cathedral" ? 0.8 : roomPreset === "hall" ? 0.42 : roomPreset === "stage" ? 0.16 : 0;
  const audienceLoad = audiencePreset === "outside" ? 0.8 : audiencePreset === "rear" ? 0.36 : audiencePreset === "mid" ? 0.18 : 0;
  const cloneLoad = Math.max(0, trackCount - 1) / 5.5;
  const wetLoad = clamp(reverbDrive, 0, 100) / 100;
  const totalLoad = roomLoad + audienceLoad + cloneLoad + wetLoad * 0.7;
  return {
    totalLoad,
    tapDensityScale: totalLoad >= 2.8 ? 0.35 : totalLoad >= 2.1 ? 0.5 : totalLoad >= 1.5 ? 0.7 : totalLoad >= 1 ? 0.88 : 1,
    allowDiffusion: totalLoad < 2.7,
    lateWetScale: totalLoad >= 2.6 ? 0.82 : totalLoad >= 1.9 ? 0.9 : 1,
  };
}

export function getAuxiliaryTapCount(totalCount, trackCount, layerBlend, minimum = 2, densityScale = 1) {
  if (!totalCount) return 0;
  const density = trackCount >= 10 ? 0.45 : trackCount >= 7 ? 0.62 : trackCount >= 5 ? 0.8 : 1;
  const requestedCount = Math.round(totalCount * density * densityScale * (1 - layerBlend * 0.28));
  return clamp(requestedCount, Math.min(totalCount, minimum), totalCount);
}

export function getPanPosition(layerIndex, trackCount, width) {
  if (trackCount <= 1 || layerIndex === 0) return 0;
  const depth = layerIndex / (trackCount - 1);
  const direction = layerIndex % 2 === 0 ? 1 : -1;
  return clamp(direction * width * (0.42 + depth * 0.58), -0.75, 0.75);
}

export function getReflectionPan(basePan, reflectionIndex, width) {
  const direction = reflectionIndex % 2 === 0 ? -1 : 1;
  return clamp(basePan * 0.5 + direction * width * (0.45 + reflectionIndex * 0.12), -0.92, 0.92);
}

export function getLayerVariation(seedBase, layerIndex, trackCount, roomPreset, audiencePreset) {
  const depth = getLayerBlend(layerIndex, trackCount);
  const random = seeded(hashSeed(`${seedBase}|${roomPreset}|${audiencePreset}|${trackCount}|${layerIndex}`));
  const bipolar = () => random() * 2 - 1;
  return {
    gainScale: clamp(1 + bipolar() * (0.025 + depth * 0.045), 0.9, 1.08),
    panOffset: clamp(bipolar() * (0.018 + depth * 0.09), -0.16, 0.16),
    lowpassOffsetHz: bipolar() * (180 + depth * 820),
    highShelfOffsetDb: bipolar() * (0.7 + depth * 1.9),
    articulationOffsetHz: bipolar() * (120 + depth * 520),
  };
}

export function shrinkPattern(pattern, count) {
  if (!Array.isArray(pattern) || !pattern.length || count <= 0) return [];
  if (pattern.length <= count) return pattern;
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const patternIndex = Math.round((index * (pattern.length - 1)) / Math.max(1, count - 1));
    const value = pattern[patternIndex];
    if (out[out.length - 1] !== value) out.push(value);
  }
  return out;
}

function getContextCache(context) {
  if (!reverbBufferCache.has(context)) {
    reverbBufferCache.set(context, new Map());
  }
  return reverbBufferCache.get(context);
}

export function getConvolverBuffer(context, preset, stage) {
  const cache = getContextCache(context);
  const cacheKey = `${preset.label}:${stage}:${context.sampleRate}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const sampleRate = context.sampleRate;
  const reverbSeconds = stage === "early" ? preset.earlyReverbSeconds : preset.lateReverbSeconds;
  const decayPower = stage === "early" ? preset.earlyDecayPower : preset.lateDecayPower;
  const length = Math.max(1, Math.floor(sampleRate * reverbSeconds));
  const impulse = context.createBuffer(2, length, sampleRate);
  const random = seeded(hashSeed(cacheKey));

  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    if (stage === "early") {
      const tapPattern = preset.earlyReflections || [];
      const stereoOffsetScale = Math.max(0.2, preset.reflectionWidth * 2.1);
      for (let tapIndex = 0; tapIndex < tapPattern.length; tapIndex += 1) {
        const reflection = tapPattern[tapIndex] || {};
        const baseMs = Math.max(0, Number(reflection.timeMs) || 0);
        const pan = Math.max(-1, Math.min(1, Number(reflection.pan) || 0));
        const gainScale = dbToGain(reflection.gainDb);
        const filterHz = Math.max(1200, Number(reflection.filterHz) || 5200);
        const panOffsetMs = pan * stereoOffsetScale * 2.4;
        const stereoOffsetMs = (channel === 0 ? -1 : 1) * stereoOffsetScale * (0.6 + tapIndex * 0.22) - panOffsetMs;
        const tapSample = Math.max(0, Math.min(length - 1, Math.floor(((baseMs + stereoOffsetMs) / 1000) * sampleRate)));
        const channelPanWeight = channel === 0 ? 1 - pan * 0.55 : 1 + pan * 0.55;
        const toneDamp = Math.max(0.35, Math.min(1, filterHz / 8200));
        const tapGain = Math.max(0.08, 0.68 - tapIndex * 0.09) * gainScale * toneDamp * channelPanWeight * (0.9 + random() * 0.18);
        data[tapSample] += tapGain;

        const smearLength = Math.max(10, Math.floor(sampleRate * (0.0024 + tapIndex * 0.0008 + (8200 - filterHz) / 1000000)));
        for (let smearIndex = 1; smearIndex < smearLength && tapSample + smearIndex < length; smearIndex += 1) {
          const smearDecay = Math.pow(1 - smearIndex / smearLength, 1.8 + tapIndex * 0.16);
          const smearGrain = (random() * 2 - 1) * 0.34 * toneDamp;
          data[tapSample + smearIndex] += smearGrain * tapGain * smearDecay;
        }
      }
      for (let index = 0; index < length; index += 1) {
        const washDecay = Math.pow(1 - index / length, Math.max(1.5, decayPower - 0.5));
        data[index] += (random() * 2 - 1) * 0.045 * washDecay;
      }
    } else {
      const fadeInSamples = Math.max(1, Math.floor(sampleRate * Math.min(0.3, Math.max(0.1, reverbSeconds * 0.16))));
      const bloomSamples = Math.max(fadeInSamples + 1, Math.floor(sampleRate * Math.min(0.7, Math.max(0.2, reverbSeconds * 0.34))));
      const sparseTapCount = Math.max(3, Math.min(9, Math.round(reverbSeconds * 3.2)));
      for (let tapIndex = 0; tapIndex < sparseTapCount; tapIndex += 1) {
        const tapProgress = (tapIndex + 1) / (sparseTapCount + 1);
        const tapTimeSeconds = 0.012 + tapProgress * Math.min(0.22, reverbSeconds * 0.18);
        const tapSample = Math.max(0, Math.min(length - 1, Math.floor(tapTimeSeconds * sampleRate)));
        const tapDecay = Math.pow(1 - tapSample / length, Math.max(1.1, decayPower * 0.82));
        const tapGain = (0.24 - tapIndex * 0.018) * tapDecay * (0.88 + random() * 0.2);
        const tapSpread = channel === 0 ? 1 - tapIndex * 0.015 : 0.94 + tapIndex * 0.012;
        data[tapSample] += tapGain * tapSpread;
        const tapSmearLength = Math.max(18, Math.floor(sampleRate * (0.004 + tapIndex * 0.0007)));
        for (let smearIndex = 1; smearIndex < tapSmearLength && tapSample + smearIndex < length; smearIndex += 1) {
          const smearDecay = Math.pow(1 - smearIndex / tapSmearLength, 1.5 + tapIndex * 0.08);
          const smearGain = ((random() * 2 - 1) * 0.12 + 0.04) * tapGain;
          data[tapSample + smearIndex] += smearGain * smearDecay;
        }
      }
      for (let index = 0; index < length; index += 1) {
        const decay = Math.pow(1 - index / length, decayPower);
        const shimmer = channel === 0 ? 1 - index / length : Math.pow(1 - index / length, 0.92);
        const onsetLinear = index < fadeInSamples ? index / fadeInSamples : 1;
        const onset = Math.pow(onsetLinear, 1.85);
        const densityProgress = index < bloomSamples ? index / bloomSamples : 1;
        const density = 0.24 + Math.pow(densityProgress, 1.35) * 0.76;
        const lateGrain = (random() * 2 - 1) * (0.5 + density * 0.28);
        const diffuseGrain = (random() * 2 - 1) * 0.16 * density;
        data[index] += (lateGrain + diffuseGrain) * decay * shimmer * onset * density;
      }
    }
  }

  cache.set(cacheKey, impulse);
  return impulse;
}
