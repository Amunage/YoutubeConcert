import { clamp } from "./effects.js";

const outputChainState = new WeakMap();

function setSmoothedParam(param, value, context, timeConstant = 0.03) {
  if (!param || typeof value !== "number") return;
  if (Math.abs((param.value ?? 0) - value) < 1e-4) return;
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, timeConstant);
}

export function ensureOutputChainState(context) {
  if (!context) return null;
  if (!outputChainState.has(context)) {
    const mixInput = context.createGain();
    mixInput.gain.value = 1;
    const busCompressor = context.createDynamicsCompressor();
    busCompressor.threshold.value = -16;
    busCompressor.knee.value = 20;
    busCompressor.ratio.value = 2.4;
    busCompressor.attack.value = 0.003;
    busCompressor.release.value = 0.17;
    const busLimiter = context.createDynamicsCompressor();
    busLimiter.threshold.value = -4;
    busLimiter.knee.value = 0;
    busLimiter.ratio.value = 20;
    busLimiter.attack.value = 0.001;
    busLimiter.release.value = 0.08;
    const outputGain = context.createGain();
    outputGain.gain.value = 0.7;
    mixInput.connect(busCompressor);
    busCompressor.connect(busLimiter);
    busLimiter.connect(outputGain);
    outputGain.connect(context.destination);
    outputChainState.set(context, {
      mixInput,
      outputGain,
      busCompressor,
      busLimiter,
      effectBuses: new Map(),
      activeEffectBusKeys: new Map(),
      effectBusCleanupTimers: new Map(),
    });
  }
  return outputChainState.get(context);
}

export function ensureOutputChain(context) {
  const state = ensureOutputChainState(context);
  return state ? state.mixInput : null;
}

export function connectToOutput(node, context) {
  const output = ensureOutputChain(context);
  if (output) node.connect(output);
}

export function setOutputVolume(level, context) {
  const state = ensureOutputChainState(context);
  if (!state) return;
  const safeLevel = clamp(level, 0, 1);
  setSmoothedParam(state.outputGain.gain, safeLevel, context, 0.02);
}

export function setMasterBusProfile(options = {}, context) {
  const state = ensureOutputChainState(context);
  if (!state) return;
  const suppression = clamp(options.peakSuppression ?? 0, 0, 100) / 100;
  const trackDensity = clamp(((options.trackCount ?? 1) - 1) / 11, 0, 1);
  const mixTrim = clamp(1 - suppression * 0.12 - trackDensity * 0.14, 0.72, 1);
  setSmoothedParam(state.mixInput.gain, mixTrim, context, 0.03);
  setSmoothedParam(state.busCompressor.threshold, -16 - suppression * 8 - trackDensity * 5, context, 0.03);
  setSmoothedParam(state.busCompressor.knee, 18 + suppression * 10, context, 0.03);
  setSmoothedParam(state.busCompressor.ratio, 2.4 + suppression * 4.2 + trackDensity * 1.3, context, 0.03);
  setSmoothedParam(state.busCompressor.attack, Math.max(0.0015, 0.004 - suppression * 0.0018 - trackDensity * 0.0007), context, 0.03);
  setSmoothedParam(state.busCompressor.release, Math.min(0.28, 0.12 + suppression * 0.08 + trackDensity * 0.05), context, 0.03);
  setSmoothedParam(state.busLimiter.threshold, -4.2 - suppression * 1.6 - trackDensity * 0.7, context, 0.03);
  setSmoothedParam(state.busLimiter.ratio, 18 + suppression * 10, context, 0.03);
  setSmoothedParam(state.busLimiter.attack, Math.max(0.0008, 0.0016 - suppression * 0.0005), context, 0.03);
  setSmoothedParam(state.busLimiter.release, Math.min(0.16, 0.06 + suppression * 0.05 + trackDensity * 0.02), context, 0.03);
}

export function configureMasterOutput({ mix, outputLevel, peakSuppression, trackCount, context }) {
  setMasterBusProfile({ peakSuppression, trackCount }, context);
  setOutputVolume(outputLevel, context);
  connectToOutput(mix, context);
}

export function updateMasterOutput({ outputLevel, peakSuppression, trackCount, context }) {
  setMasterBusProfile({ peakSuppression, trackCount }, context);
  if (typeof outputLevel === "number") {
    setOutputVolume(outputLevel, context);
  }
}
