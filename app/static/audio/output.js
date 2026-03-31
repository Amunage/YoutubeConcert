window.AudioOutput = (() => {
  const { clamp } = window.AudioEffects;
  const outputChainState = new WeakMap();

  function ensureOutputChainState(context) {
    if (!context) {
      return null;
    }

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
        effectBuses: new Map(),
        activeEffectBusKeys: new Map(),
        effectBusCleanupTimers: new Map(),
        mixInput,
        outputGain,
        busCompressor,
        busLimiter,
      });
    }

    return outputChainState.get(context);
  }

  function ensureOutputChain(context) {
    const state = ensureOutputChainState(context);
    return state ? state.mixInput : null;
  }

  function setOutputVolume(level, context = audioContext) {
    const state = ensureOutputChainState(context);
    if (!state) {
      return;
    }

    const safeLevel = clamp(level, 0, 1);
    state.outputGain.gain.cancelScheduledValues(context.currentTime);
    state.outputGain.gain.setTargetAtTime(safeLevel, context.currentTime, 0.02);
  }

  function setMasterBusProfile(options = {}, context = audioContext) {
    const state = ensureOutputChainState(context);
    if (!state) {
      return;
    }

    const suppression = clamp(options.peakSuppression ?? 0, 0, 100) / 100;
    const trackDensity = clamp(((options.trackCount ?? 1) - 1) / 11, 0, 1);
    const isOriginal = Boolean(options.isOriginalMode);
    const now = context.currentTime;

    const mixTrim = isOriginal
      ? 1
      : clamp(1 - suppression * 0.12 - trackDensity * 0.14, 0.72, 1);
    const compressorThreshold = isOriginal
      ? -9
      : -16 - suppression * 8 - trackDensity * 5;
    const compressorKnee = isOriginal
      ? 12
      : 18 + suppression * 10;
    const compressorRatio = isOriginal
      ? 1.35
      : 2.4 + suppression * 4.2 + trackDensity * 1.3;
    const compressorAttack = isOriginal
      ? 0.008
      : Math.max(0.0015, 0.004 - suppression * 0.0018 - trackDensity * 0.0007);
    const compressorRelease = isOriginal
      ? 0.11
      : Math.min(0.28, 0.12 + suppression * 0.08 + trackDensity * 0.05);

    const limiterThreshold = isOriginal
      ? -1.4
      : -4.2 - suppression * 1.6 - trackDensity * 0.7;
    const limiterRatio = isOriginal
      ? 8
      : 18 + suppression * 10;
    const limiterAttack = isOriginal
      ? 0.003
      : Math.max(0.0008, 0.0016 - suppression * 0.0005);
    const limiterRelease = isOriginal
      ? 0.06
      : Math.min(0.16, 0.06 + suppression * 0.05 + trackDensity * 0.02);

    state.mixInput.gain.cancelScheduledValues(now);
    state.mixInput.gain.setTargetAtTime(mixTrim, now, 0.03);

    state.busCompressor.threshold.cancelScheduledValues(now);
    state.busCompressor.threshold.setTargetAtTime(compressorThreshold, now, 0.03);
    state.busCompressor.knee.cancelScheduledValues(now);
    state.busCompressor.knee.setTargetAtTime(compressorKnee, now, 0.03);
    state.busCompressor.ratio.cancelScheduledValues(now);
    state.busCompressor.ratio.setTargetAtTime(compressorRatio, now, 0.03);
    state.busCompressor.attack.cancelScheduledValues(now);
    state.busCompressor.attack.setTargetAtTime(compressorAttack, now, 0.03);
    state.busCompressor.release.cancelScheduledValues(now);
    state.busCompressor.release.setTargetAtTime(compressorRelease, now, 0.03);

    state.busLimiter.threshold.cancelScheduledValues(now);
    state.busLimiter.threshold.setTargetAtTime(limiterThreshold, now, 0.03);
    state.busLimiter.ratio.cancelScheduledValues(now);
    state.busLimiter.ratio.setTargetAtTime(limiterRatio, now, 0.03);
    state.busLimiter.attack.cancelScheduledValues(now);
    state.busLimiter.attack.setTargetAtTime(limiterAttack, now, 0.03);
    state.busLimiter.release.cancelScheduledValues(now);
    state.busLimiter.release.setTargetAtTime(limiterRelease, now, 0.03);
  }

  function connectToOutput(node, context = audioContext) {
    const output = ensureOutputChain(context);
    if (!output) {
      return;
    }
    node.connect(output);
  }

  return {
    ensureOutputChainState,
    ensureOutputChain,
    setOutputVolume,
    setMasterBusProfile,
    connectToOutput,
  };
})();
