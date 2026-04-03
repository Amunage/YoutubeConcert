import { clamp, createDisconnectCleanup } from "./effects.js";
import { createEffectBus } from "./bus-builders.js";
import { ensureOutputChainState } from "./output.js";

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

function getBusKey(kind, options = {}) {
  const roomPreset = options.roomPreset || "arena";
  const audiencePreset = options.audiencePreset || "mid";
  const baseKey = AUDIENCE_SCOPED_BUS_KINDS.has(kind)
    ? `${kind}:${roomPreset}:${audiencePreset}`
    : `${kind}:${roomPreset}`;
  return options.variantKey ? `${baseKey}:${options.variantKey}` : baseKey;
}

export function ensureSharedEffectBus(kind, options = {}, context) {
  const state = ensureOutputChainState(context);
  if (!state) {
    return null;
  }

  const busKey = getBusKey(kind, options);
  if (state.effectBuses.has(busKey)) {
    return activateEffectBus(kind, busKey, state.effectBuses.get(busKey), state, context);
  }

  const bus = createEffectBus(kind, busKey, options, context);
  if (!bus) {
    return null;
  }

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
