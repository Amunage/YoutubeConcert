window.AudioEffects = (() => {
  const reverbBufferCache = new Map();
  const { getRoomPresetConfig } = window.AudioPresets;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function createDisconnectCleanup(nodes = []) {
    let cleanedUp = false;
    return () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      nodes.forEach((node) => {
        if (!node || typeof node.disconnect !== "function") {
          return;
        }
        try {
          node.disconnect();
        } catch (error) {
        }
      });
    };
  }

  function hashStringSeed(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createSeededRandom(seedValue) {
    let seed = seedValue >>> 0;
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function getComplexityProfile(trackCount, roomPreset, audiencePreset, reverbDrive) {
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

  function getAuxiliaryTapCount(totalCount, trackCount, layerBlend, minimum = 2, densityScale = 1) {
    if (!totalCount) {
      return 0;
    }

    const density = trackCount >= 10 ? 0.45 : trackCount >= 7 ? 0.62 : trackCount >= 5 ? 0.8 : 1;
    const requestedCount = Math.round(totalCount * density * densityScale * (1 - layerBlend * 0.28));
    return clamp(requestedCount, Math.min(totalCount, minimum), totalCount);
  }

  function limitTapPattern(pattern, count) {
    if (!Array.isArray(pattern) || pattern.length === 0 || count <= 0) {
      return [];
    }
    if (pattern.length <= count) {
      return pattern;
    }

    const limitedPattern = [];
    for (let index = 0; index < count; index += 1) {
      const patternIndex = Math.round((index * (pattern.length - 1)) / Math.max(1, count - 1));
      const value = pattern[patternIndex];
      if (limitedPattern[limitedPattern.length - 1] !== value) {
        limitedPattern.push(value);
      }
    }
    return limitedPattern;
  }

  function getConvolverBuffer(presetName, stage = "late") {
    const preset = getRoomPresetConfig(presetName);
    const cacheKey = `${presetName}:${stage}:${audioContext.sampleRate}`;
    if (reverbBufferCache.has(cacheKey)) {
      return reverbBufferCache.get(cacheKey);
    }

    const sampleRate = audioContext.sampleRate;
    const reverbSeconds = stage === "early" ? preset.earlyReverbSeconds : preset.lateReverbSeconds;
    const decayPower = stage === "early" ? preset.earlyDecayPower : preset.lateDecayPower;
    const length = Math.max(1, Math.floor(sampleRate * reverbSeconds));
    const impulse = audioContext.createBuffer(2, length, sampleRate);
    const seededRandom = createSeededRandom(hashStringSeed(cacheKey));

    for (let channel = 0; channel < 2; channel += 1) {
      const channelData = impulse.getChannelData(channel);

      if (stage === "early") {
        const tapPattern = Array.isArray(preset.earlyReflectionsMs) && preset.earlyReflectionsMs.length
          ? preset.earlyReflectionsMs
          : [8, 15, 24];
        const stereoOffsetScale = Math.max(0.2, preset.reflectionWidth * 2.1);

        for (let tapIndex = 0; tapIndex < tapPattern.length; tapIndex += 1) {
          const baseMs = tapPattern[tapIndex];
          const stereoOffsetMs = (channel === 0 ? -1 : 1) * stereoOffsetScale * (0.6 + tapIndex * 0.22);
          const tapSample = Math.max(0, Math.min(length - 1, Math.floor(((baseMs + stereoOffsetMs) / 1000) * sampleRate)));
          const tapGain = Math.max(0.08, 0.68 - tapIndex * 0.09) * (0.9 + seededRandom() * 0.18);
          channelData[tapSample] += tapGain;

          const smearLength = Math.max(10, Math.floor(sampleRate * (0.0028 + tapIndex * 0.0008)));
          for (let smearIndex = 1; smearIndex < smearLength && tapSample + smearIndex < length; smearIndex += 1) {
            const smearDecay = Math.pow(1 - smearIndex / smearLength, 1.8 + tapIndex * 0.16);
            const smearGrain = (seededRandom() * 2 - 1) * 0.34;
            channelData[tapSample + smearIndex] += smearGrain * tapGain * smearDecay;
          }
        }

        for (let index = 0; index < length; index += 1) {
          const washDecay = Math.pow(1 - index / length, Math.max(1.5, decayPower - 0.5));
          const wash = (seededRandom() * 2 - 1) * 0.045 * washDecay;
          channelData[index] += wash;
        }
      } else {
        const fadeInSamples = Math.max(1, Math.floor(sampleRate * Math.min(0.05, reverbSeconds * 0.08)));
        for (let index = 0; index < length; index += 1) {
          const decay = Math.pow(1 - index / length, decayPower);
          const shimmer = channel === 0 ? 1 - index / length : Math.pow(1 - index / length, 0.92);
          const onset = index < fadeInSamples ? index / fadeInSamples : 1;
          const grain = (seededRandom() * 2 - 1) * 0.82 + (seededRandom() * 2 - 1) * 0.18;
          channelData[index] = grain * decay * shimmer * onset;
        }
      }
    }

    reverbBufferCache.set(cacheKey, impulse);
    return impulse;
  }

  return {
    clamp,
    createDisconnectCleanup,
    hashStringSeed,
    createSeededRandom,
    getComplexityProfile,
    getAuxiliaryTapCount,
    limitTapPattern,
    getConvolverBuffer,
  };
})();
