import { clamp, createDisconnectCleanup, dbToGain, getConvolverBuffer } from "./effects.js";
import { connectToOutput, ensureOutputChainState } from "./output.js";

const BUS_TRANSITION_SECONDS = 0.38;
const BUS_CLEANUP_GRACE_SECONDS = 0.7;
const AUDIENCE_SCOPED_BUS_KINDS = new Set(["diffusion", "smear", "blur", "reflection"]);

function clearPendingBusCleanup(state, busKey) {
  if (!state?.effectBusCleanupTimers?.has(busKey)) {
    return;
  }

  const pendingCleanup = state.effectBusCleanupTimers.get(busKey);
  if (typeof pendingCleanup === "function") {
    pendingCleanup();
  } else {
    clearTimeout(pendingCleanup);
  }
  state.effectBusCleanupTimers.delete(busKey);
}

function scheduleContextTimeCleanup(callback, delaySeconds, context) {
  if (!context || typeof callback !== "function") {
    return null;
  }

  if (typeof context.createConstantSource !== "function") {
    const timerId = setTimeout(callback, Math.max(0, Math.ceil(delaySeconds * 1000)));
    return () => clearTimeout(timerId);
  }

  const source = context.createConstantSource();
  const gain = context.createGain();
  gain.gain.value = 0;
  source.offset.value = 0;
  source.connect(gain);
  gain.connect(context.destination);
  source.onended = () => {
    callback();
    try {
      source.disconnect();
    } catch {}
    try {
      gain.disconnect();
    } catch {}
  };
  source.start(context.currentTime);
  source.stop(context.currentTime + Math.max(0.01, delaySeconds));
  return () => {
    source.onended = null;
    try {
      source.stop();
    } catch {}
    try {
      source.disconnect();
    } catch {}
    try {
      gain.disconnect();
    } catch {}
  };
}

function setBusFade(bus, targetValue, now, transitionSeconds = BUS_TRANSITION_SECONDS) {
  if (!bus?.transitionGain?.gain) {
    return;
  }

  const gainParam = bus.transitionGain.gain;
  gainParam.cancelScheduledValues(now);
  gainParam.setValueAtTime(gainParam.value, now);
  gainParam.linearRampToValueAtTime(clamp(targetValue, 0, 1), now + transitionSeconds);
}

function scheduleBusCleanup(state, busKey, context) {
  clearPendingBusCleanup(state, busKey);
  const cancelCleanup = scheduleContextTimeCleanup(() => {
    state.effectBusCleanupTimers.delete(busKey);
    const activeBusKey = state.activeEffectBusKeys?.get(state.effectBuses.get(busKey)?.kind);
    if (activeBusKey === busKey) {
      return;
    }

    const bus = state.effectBuses.get(busKey);
    if (!bus) {
      return;
    }

    createDisconnectCleanup(bus.nodes)();
    state.effectBuses.delete(busKey);
  }, BUS_TRANSITION_SECONDS + BUS_CLEANUP_GRACE_SECONDS, context);

  if (cancelCleanup) {
    state.effectBusCleanupTimers.set(busKey, cancelCleanup);
  }
}

function activateEffectBus(kind, busKey, bus, state, context) {
  clearPendingBusCleanup(state, busKey);
  const previousKey = state.activeEffectBusKeys.get(kind);
  const now = context.currentTime;

  if (!previousKey || previousKey === busKey) {
    state.activeEffectBusKeys.set(kind, busKey);
    setBusFade(bus, 1, now, previousKey === busKey ? 0.08 : 0.02);
    return bus;
  }

  const previousBus = state.effectBuses.get(previousKey);
  state.activeEffectBusKeys.set(kind, busKey);
  setBusFade(bus, 1, now);

  if (previousBus) {
    setBusFade(previousBus, 0, now);
    scheduleBusCleanup(state, previousKey, context);
  }

  return bus;
}

function buildDiffusionNetwork(inputNode, targetNode, options = {}, context) {
  const diffusionTimesMs = options.timesMs || [11, 17, 29, 41];
  const feedbackAmount = clamp(options.feedback ?? 0.42, 0, 0.72);
  const cutoffHz = options.cutoffHz || 4200;
  const spread = options.stereoSpread || 0.12;
  let previousNode = inputNode;
  const nodes = [];

  diffusionTimesMs.forEach((timeMs, index) => {
    const stageDelay = context.createDelay(0.12);
    stageDelay.delayTime.value = Math.max(0.003, timeMs / 1000);

    const stageAllpass = context.createBiquadFilter();
    stageAllpass.type = "allpass";
    stageAllpass.frequency.value = 900 + index * 650;
    stageAllpass.Q.value = 0.7 + index * 0.08;

    const stageTone = context.createBiquadFilter();
    stageTone.type = "lowpass";
    stageTone.frequency.value = Math.max(900, cutoffHz - index * 380);
    stageTone.Q.value = 0.5;

    const stagePanner = context.createStereoPanner();
    stagePanner.pan.value = clamp((index % 2 === 0 ? -1 : 1) * spread * (0.55 + index * 0.14), -0.82, 0.82);

    const stageMixGain = context.createGain();
    stageMixGain.gain.value = Math.max(0.18, 0.44 - index * 0.04);

    const feedbackGain = context.createGain();
    feedbackGain.gain.value = clamp(feedbackAmount * (0.78 - index * 0.09), 0, 0.68);

    previousNode.connect(stageDelay);
    stageDelay.connect(stageAllpass);
    stageAllpass.connect(stageTone);
    stageTone.connect(stageMixGain);
    stageMixGain.connect(stagePanner);
    stagePanner.connect(targetNode);
    stageMixGain.connect(feedbackGain);
    feedbackGain.connect(stageDelay);

    nodes.push(stageDelay, stageAllpass, stageTone, stagePanner, stageMixGain, feedbackGain);
    previousNode = stageMixGain;
  });

  return nodes;
}

function buildSmearNetwork(inputNode, targetNode, options = {}, context) {
  const tapTimesMs = Array.isArray(options.tapTimesMs) && options.tapTimesMs.length ? options.tapTimesMs : [8, 15, 24, 35];
  const cutHz = Math.max(500, options.cutHz || 2400);
  const stereoWidth = clamp(options.stereoWidth ?? 1, 0.6, 1.5);
  const nodes = [];

  tapTimesMs.forEach((timeMs, index) => {
    const tapDelay = context.createDelay(0.28);
    tapDelay.delayTime.value = Math.max(0.003, (timeMs + index * 2.4) / 1000);

    const tapFilter = context.createBiquadFilter();
    tapFilter.type = "lowpass";
    tapFilter.frequency.value = Math.max(320, cutHz + 3800 - index * 460);

    const tapGain = context.createGain();
    tapGain.gain.value = Math.max(0.02, 0.11 - index * 0.013);

    const tapPanner = context.createStereoPanner();
    tapPanner.pan.value = clamp((index % 2 === 0 ? -1 : 1) * (0.08 + index * 0.03) * stereoWidth, -0.84, 0.84);

    inputNode.connect(tapDelay);
    tapDelay.connect(tapFilter);
    tapFilter.connect(tapGain);
    tapGain.connect(tapPanner);
    tapPanner.connect(targetNode);

    nodes.push(tapDelay, tapFilter, tapGain, tapPanner);
  });

  return nodes;
}

function buildBlurNetwork(inputNode, targetNode, options = {}, context) {
  const tapTimesMs = Array.isArray(options.tapTimesMs) && options.tapTimesMs.length ? options.tapTimesMs : [4, 8, 13, 19];
  const directCutHz = Math.max(0, options.directCutHz || 0);
  const nodes = [];

  tapTimesMs.forEach((timeMs, index) => {
    const tapDelay = context.createDelay(0.16);
    tapDelay.delayTime.value = Math.max(0.002, (timeMs + index * 1.6) / 1000);

    const bandFilter = context.createBiquadFilter();
    bandFilter.type = "bandpass";
    bandFilter.frequency.value = 2200 + index * 420;
    bandFilter.Q.value = 0.72;

    const toneFilter = context.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = Math.max(1400, 5600 - index * 420 - directCutHz * 0.4);

    const tapGain = context.createGain();
    tapGain.gain.value = Math.max(0.02, 0.086 - index * 0.012);

    const tapPanner = context.createStereoPanner();
    tapPanner.pan.value = clamp((index % 2 === 0 ? -1 : 1) * (0.06 + index * 0.018), -0.74, 0.74);

    inputNode.connect(tapDelay);
    tapDelay.connect(bandFilter);
    bandFilter.connect(toneFilter);
    toneFilter.connect(tapGain);
    tapGain.connect(tapPanner);
    tapPanner.connect(targetNode);

    nodes.push(tapDelay, bandFilter, toneFilter, tapGain, tapPanner);
  });

  return nodes;
}

function buildReflectionNetwork(inputNode, targetNode, options = {}, context) {
  const reflections = Array.isArray(options.reflections) && options.reflections.length
    ? options.reflections
    : Array.isArray(options.tapTimesMs) && options.tapTimesMs.length
      ? options.tapTimesMs.map((timeMs, index) => ({
          timeMs,
          pan: (index % 2 === 0 ? -1 : 1) * (0.16 + index * 0.08),
          gainDb: -index * 1.4,
          filterHz: Math.max(1000, 9000 - index * 720),
        }))
      : [14, 29, 46, 66].map((timeMs, index) => ({
          timeMs,
          pan: (index % 2 === 0 ? -1 : 1) * (0.16 + index * 0.08),
          gainDb: -index * 1.4,
          filterHz: Math.max(1000, 9000 - index * 720),
        }));
  const spacing = Math.max(0.7, options.spacing || 1);
  const stereoWidth = clamp(options.stereoWidth ?? 0.4, 0.12, 0.9);
  const reflectionBoost = clamp(options.reflectionBoost ?? 1, 0.5, 1.6);
  const nodes = [];

  reflections.forEach((reflection, index) => {
    const timeMs = Math.max(0, Number(reflection?.timeMs) || 0);
    const filterHz = Math.max(1000, Number(reflection?.filterHz) || 9000 - index * 720);
    const pan = clamp((Number(reflection?.pan) || 0) * stereoWidth, -0.9, 0.9);
    const gain = Math.max(0.016, 0.16 - index * 0.025) * dbToGain(reflection?.gainDb) * reflectionBoost;

    const tapDelay = context.createDelay(0.42);
    tapDelay.delayTime.value = Math.max(0.004, (timeMs * spacing + index * 2.6) / 1000);

    const tapFilter = context.createBiquadFilter();
    tapFilter.type = "lowpass";
    tapFilter.frequency.value = filterHz;

    const tapGain = context.createGain();
    tapGain.gain.value = gain;

    const tapPanner = context.createStereoPanner();
    tapPanner.pan.value = pan;

    inputNode.connect(tapDelay);
    tapDelay.connect(tapFilter);
    tapFilter.connect(tapGain);
    tapGain.connect(tapPanner);
    tapPanner.connect(targetNode);

    nodes.push(tapDelay, tapFilter, tapGain, tapPanner);
  });

  return nodes;
}

export function ensureSharedEffectBus(kind, options = {}, context) {
  const state = ensureOutputChainState(context);
  if (!state) {
    return null;
  }

  const roomPreset = options.roomPreset || "hall";
  const audiencePreset = options.audiencePreset || "mid";
  const busKey = AUDIENCE_SCOPED_BUS_KINDS.has(kind)
    ? `${kind}:${roomPreset}:${audiencePreset}`
    : `${kind}:${roomPreset}`;
  if (state.effectBuses.has(busKey)) {
    return activateEffectBus(kind, busKey, state.effectBuses.get(busKey), state, context);
  }

  const input = context.createGain();
  input.gain.value = 1;
  const returnGain = context.createGain();
  const transitionGain = context.createGain();
  const limiter = context.createDynamicsCompressor();
  const nodes = [input, returnGain, transitionGain, limiter];
  let bus = null;

  if (kind === "diffusion") {
    returnGain.gain.value = 1;
    transitionGain.gain.value = 0;
    limiter.threshold.value = -22;
    limiter.knee.value = 18;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.14;
    nodes.push(...buildDiffusionNetwork(input, returnGain, options, context));
    bus = { key: busKey, kind, input, returnGain, transitionGain, limiter, nodes };
  } else if (kind === "smear") {
    returnGain.gain.value = 0.94;
    transitionGain.gain.value = 0;
    limiter.threshold.value = -24;
    limiter.knee.value = 14;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    nodes.push(...buildSmearNetwork(input, returnGain, options, context));
    bus = { key: busKey, kind, input, returnGain, transitionGain, limiter, nodes };
  } else if (kind === "blur") {
    returnGain.gain.value = 0.92;
    transitionGain.gain.value = 0;
    limiter.threshold.value = -24;
    limiter.knee.value = 16;
    limiter.ratio.value = 7;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    nodes.push(...buildBlurNetwork(input, returnGain, options, context));
    bus = { key: busKey, kind, input, returnGain, transitionGain, limiter, nodes };
  } else if (kind === "reflection") {
    returnGain.gain.value = 1;
    transitionGain.gain.value = 0;
    limiter.threshold.value = -22;
    limiter.knee.value = 16;
    limiter.ratio.value = 9;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    nodes.push(...buildReflectionNetwork(input, returnGain, options, context));
    bus = { key: busKey, kind, input, returnGain, transitionGain, limiter, nodes };
  } else if (kind === "early" || kind === "late") {
    const convolver = context.createConvolver();
    convolver.buffer = getConvolverBuffer(context, options.preset, kind);

    returnGain.gain.value = kind === "early" ? 1.06 : 1;
    transitionGain.gain.value = 0;
    limiter.threshold.value = kind === "early" ? -18 : -20;
    limiter.knee.value = kind === "early" ? 16 : 20;
    limiter.ratio.value = kind === "early" ? 6 : 10;
    limiter.attack.value = kind === "early" ? 0.002 : 0.004;
    limiter.release.value = kind === "early" ? 0.11 : 0.18;

    input.connect(convolver);
    convolver.connect(returnGain);
    nodes.push(convolver);
    bus = { key: busKey, kind, input, convolver, returnGain, transitionGain, limiter, nodes };
  }

  if (!bus) {
    return null;
  }

  returnGain.connect(transitionGain);
  transitionGain.connect(limiter);
  connectToOutput(limiter, context);
  state.effectBuses.set(busKey, bus);
  return activateEffectBus(kind, busKey, bus, state, context);
}

export function syncSharedEffectBusUsage(activeKinds = [], context) {
  const state = ensureOutputChainState(context);
  if (!state) {
    return;
  }

  const activeKindSet = new Set(activeKinds || []);
  Array.from(state.activeEffectBusKeys.keys()).forEach((kind) => {
    if (activeKindSet.has(kind)) {
      return;
    }

    const activeKey = state.activeEffectBusKeys.get(kind);
    const activeBus = state.effectBuses.get(activeKey);
    state.activeEffectBusKeys.delete(kind);
    if (!activeBus) {
      return;
    }

    setBusFade(activeBus, 0, context.currentTime);
    scheduleBusCleanup(state, activeKey, context);
  });
}
