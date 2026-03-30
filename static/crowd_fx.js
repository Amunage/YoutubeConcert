window.CrowdFx = (() => {
  const SAMPLE_FILES = {
    applause: [
      "applause_001.mp3",
      "applause_002.mp3",
    ],
    clap: [
      "clapping_001.mp3",
      "clapping_002.mp3",
      "clapping_003.mp3",
      "clapping_004.mp3",
      "clapping_005.mp3",
      "clapping_006.mp3",
      "clapping_007.mp3",
      "clapping_008.mp3",
      "clapping_009.mp3",
      "clapping_010.mp3",
    ],
  };

  const decodedSampleCache = new WeakMap();
  const analysisCache = new WeakMap();
  const DEFAULT_END_TAIL_SECONDS = 4.8;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function getSampleMap(context) {
    if (!decodedSampleCache.has(context)) {
      decodedSampleCache.set(context, new Map());
    }
    return decodedSampleCache.get(context);
  }

  async function loadSample(context, filename) {
    const sampleMap = getSampleMap(context);
    if (sampleMap.has(filename)) {
      return sampleMap.get(filename);
    }

    const loadingPromise = fetch(`/datas/${encodeURIComponent(filename)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`crowd sample missing: ${filename}`);
        }
        return response.arrayBuffer();
      })
      .then((payload) => context.decodeAudioData(payload.slice(0)))
      .then((decodedBuffer) => {
        sampleMap.set(filename, decodedBuffer);
        return decodedBuffer;
      });

    sampleMap.set(filename, loadingPromise);
    return loadingPromise;
  }

  async function ensureReady(context) {
    if (!context) {
      return null;
    }

    await Promise.all(
      [...SAMPLE_FILES.applause, ...SAMPLE_FILES.clap].map((filename) => loadSample(context, filename))
    );
    return getSampleMap(context);
  }

  async function getLoadedSamples(context) {
    await ensureReady(context);
    const sampleMap = getSampleMap(context);

    return {
      applause: await Promise.all(SAMPLE_FILES.applause.map((filename) => sampleMap.get(filename))),
      clap: await Promise.all(SAMPLE_FILES.clap.map((filename) => sampleMap.get(filename))),
    };
  }

  function getEndTailSeconds(context) {
    if (!context || !decodedSampleCache.has(context)) {
      return DEFAULT_END_TAIL_SECONDS;
    }

    const sampleMap = decodedSampleCache.get(context);
    const applauseDurations = SAMPLE_FILES.applause
      .map((filename) => sampleMap.get(filename))
      .filter((value) => value && typeof value.then !== "function")
      .map((buffer) => buffer.duration || 0);

    if (!applauseDurations.length) {
      return DEFAULT_END_TAIL_SECONDS;
    }

    return clamp(Math.max(...applauseDurations) + 0.9, 3.2, 6.8);
  }

  function buildAnalysis(buffer) {
    if (!buffer) {
      return {
        duration: 0,
        frameSeconds: 0.12,
        beatSeconds: 0.56,
        phaseSeconds: 0,
        energy: [],
        brightness: [],
        events: [],
      };
    }

    if (analysisCache.has(buffer)) {
      return analysisCache.get(buffer);
    }

    const channelData = [];
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      channelData.push(buffer.getChannelData(channel));
    }

    const sampleRate = buffer.sampleRate;
    const frameSize = Math.max(1024, Math.floor(sampleRate * 0.12));
    const frameSeconds = frameSize / sampleRate;
    const frameCount = Math.max(1, Math.ceil(buffer.length / frameSize));
    const energy = new Array(frameCount).fill(0);
    const brightness = new Array(frameCount).fill(0);
    const flux = new Array(frameCount).fill(0);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const start = frameIndex * frameSize;
      const end = Math.min(buffer.length, start + frameSize);
      let sumSquares = 0;
      let diffSum = 0;
      let zeroCross = 0;
      let previousMixed = 0;

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        let mixed = 0;
        for (let channel = 0; channel < channelData.length; channel += 1) {
          mixed += channelData[channel][sampleIndex] || 0;
        }
        mixed /= Math.max(1, channelData.length);
        sumSquares += mixed * mixed;
        diffSum += Math.abs(mixed - previousMixed);
        if ((mixed >= 0) !== (previousMixed >= 0)) {
          zeroCross += 1;
        }
        previousMixed = mixed;
      }

      const frameLength = Math.max(1, end - start);
      energy[frameIndex] = Math.sqrt(sumSquares / frameLength);
      brightness[frameIndex] = diffSum / frameLength + zeroCross / frameLength;
      if (frameIndex > 0) {
        flux[frameIndex] = Math.max(0, energy[frameIndex] - energy[frameIndex - 1]);
      }
    }

    const normalize = (values) => {
      const maxValue = values.reduce((current, value) => Math.max(current, value), 0) || 1;
      return values.map((value) => value / maxValue);
    };

    const normalizedEnergy = normalize(energy);
    const normalizedBrightness = normalize(brightness);
    const normalizedFlux = normalize(flux);

    const minBeatFrames = Math.max(2, Math.round(0.38 / frameSeconds));
    const maxBeatFrames = Math.max(minBeatFrames + 1, Math.round(0.82 / frameSeconds));
    let bestLag = Math.round(0.56 / frameSeconds);
    let bestScore = -Infinity;
    for (let lag = minBeatFrames; lag <= maxBeatFrames; lag += 1) {
      let score = 0;
      for (let index = lag; index < normalizedFlux.length; index += 1) {
        score += normalizedFlux[index] * normalizedFlux[index - lag];
      }
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }

    let bestPhaseFrame = 0;
    let bestPhaseScore = -Infinity;
    for (let phase = 0; phase < bestLag; phase += 1) {
      let score = 0;
      for (let index = phase; index < normalizedFlux.length; index += bestLag) {
        score += normalizedFlux[index] * 0.72 + normalizedEnergy[index] * 0.28;
      }
      if (score > bestPhaseScore) {
        bestPhaseScore = score;
        bestPhaseFrame = phase;
      }
    }

    const beatSeconds = bestLag * frameSeconds;
    const phaseSeconds = bestPhaseFrame * frameSeconds;
    const events = [];
    const duration = buffer.duration;
    const introHold = 2.1;
    const outroHold = 3.2;
    for (let time = phaseSeconds; time < duration; time += beatSeconds) {
      if (time < introHold || time > duration - outroHold) {
        continue;
      }
      const frameIndex = clamp(Math.round(time / frameSeconds), 0, normalizedEnergy.length - 1);
      const localEnergy = normalizedEnergy[frameIndex];
      const localBrightness = normalizedBrightness[frameIndex];
      const localFlux = normalizedFlux[frameIndex];
      const restScore = clamp(1 - localEnergy * 0.72 - localBrightness * 0.2 - localFlux * 0.36, 0, 1);
      if (restScore < 0.34) {
        continue;
      }

      events.push({
        time,
        restScore,
        energy: localEnergy,
        brightness: localBrightness,
      });
    }

    const analysis = {
      duration,
      frameSeconds,
      beatSeconds,
      phaseSeconds,
      energy: normalizedEnergy,
      brightness: normalizedBrightness,
      events,
    };
    analysisCache.set(buffer, analysis);
    return analysis;
  }

  function pickSample(samples, seededRandom) {
    return samples[Math.floor(seededRandom() * samples.length) % samples.length] || null;
  }

  function scheduleReactiveClaps(samples, analysis, options = {}) {
    const seededRandom = createSeededRandom(hashStringSeed(options.seed || "crowd"));
    const scheduled = [];
    const baseStartTime = options.startTime || 0;
    const offsetSeconds = Math.max(0, options.offsetSeconds || 0);
    const remainingDuration = Math.max(0, analysis.duration - offsetSeconds);
    const eventLimit = Math.max(8, Math.round(remainingDuration / Math.max(0.45, analysis.beatSeconds)));
    let acceptedCount = 0;

    for (let eventIndex = 0; eventIndex < analysis.events.length; eventIndex += 1) {
      if (acceptedCount >= eventLimit) {
        break;
      }

      const event = analysis.events[eventIndex];
      if (event.time <= offsetSeconds + 0.18) {
        continue;
      }

      const probability = clamp(event.restScore * 0.9 + 0.08, 0, 0.92);
      if (seededRandom() > probability) {
        continue;
      }

      const clusterSize = event.restScore > 0.72 ? 3 : event.restScore > 0.5 ? 2 : 1;
      for (let clapIndex = 0; clapIndex < clusterSize; clapIndex += 1) {
        const sample = pickSample(samples, seededRandom);
        if (!sample) {
          continue;
        }

        const localOffset = (event.time - offsetSeconds) + (seededRandom() * 2 - 1) * 0.022 + clapIndex * 0.036;
        if (localOffset <= 0 || localOffset >= remainingDuration - 1.6) {
          continue;
        }

        scheduled.push({
          buffer: sample,
          startTime: baseStartTime + localOffset,
          gain: clamp(0.032 + event.restScore * 0.09 - event.energy * 0.028, 0.018, 0.14),
          pan: clamp((seededRandom() * 2 - 1) * 0.72, -0.82, 0.82),
          playbackRate: clamp(0.95 + seededRandom() * 0.12, 0.9, 1.08),
          lowpassHz: 6400 + seededRandom() * 1800,
          highpassHz: 220 + seededRandom() * 180,
          kind: "clap",
          reverbBlend: 0.78 + event.restScore * 0.16,
          diffusionBlend: 0.82 + event.restScore * 0.12,
        });
      }

      acceptedCount += 1;
    }

    return scheduled;
  }

  async function schedulePerformance(context, buffer, options = {}) {
    if (!context || !buffer || !window.AudioEngine?.scheduleCrowdSample) {
      return [];
    }

    const samples = await getLoadedSamples(context);
    const analysis = buildAnalysis(buffer);
    const seededRandom = createSeededRandom(hashStringSeed(options.seed || "crowd"));
    const scheduled = [];
    const offsetSeconds = Math.max(0, options.offsetSeconds || 0);
    const duration = buffer.duration;

    if (offsetSeconds < 1.4) {
      const introApplause = pickSample(samples.applause, seededRandom);
      if (introApplause) {
        scheduled.push({
          buffer: introApplause,
          startTime: (options.startTime || 0) + 0.06,
          gain: 0.13,
          pan: (seededRandom() * 2 - 1) * 0.18,
          playbackRate: clamp(0.95 + seededRandom() * 0.08, 0.9, 1.04),
          lowpassHz: 5800,
          highpassHz: 160,
          kind: "applause",
          reverbBlend: 1,
          diffusionBlend: 1,
        });
      }
    }

    const clapEvents = scheduleReactiveClaps(samples.clap, analysis, {
      startTime: options.startTime,
      offsetSeconds,
      seed: `${options.seed || "crowd"}|reactive`,
    });
    scheduled.push(...clapEvents);

    const remainingDuration = Math.max(0, duration - offsetSeconds);
    if (remainingDuration > 2.4) {
      const outroApplause = pickSample(samples.applause, seededRandom);
      if (outroApplause) {
        const applauseLead = clamp(0.16, 0.12, 0.24);
        scheduled.push({
          buffer: outroApplause,
          startTime: (options.startTime || 0) + Math.max(0.08, remainingDuration - applauseLead),
          gain: 0.16,
          pan: (seededRandom() * 2 - 1) * 0.16,
          playbackRate: clamp(0.96 + seededRandom() * 0.06, 0.92, 1.04),
          lowpassHz: 5600,
          highpassHz: 140,
          kind: "applause",
          reverbBlend: 1.08,
          diffusionBlend: 1.06,
        });
      }
    }

    const settings = options.settings || {};
    scheduled.forEach((event) => {
      window.AudioEngine.scheduleCrowdSample(event.buffer, event.startTime, {
        roomPreset: settings.roomPreset,
        audiencePreset: settings.audiencePreset,
        reverbAmount: settings.reverbIntensity,
        diffusionAmount: settings.diffusionAmount,
        gain: event.gain,
        pan: event.pan,
        playbackRate: event.playbackRate,
        lowpassHz: event.lowpassHz,
        highpassHz: event.highpassHz,
        kind: event.kind,
        reverbBlend: event.reverbBlend,
        diffusionBlend: event.diffusionBlend,
      });
    });

    return scheduled;
  }

  return {
    ensureReady,
    primeAnalysis: buildAnalysis,
    schedulePerformance,
    getEndTailSeconds,
  };
})();
