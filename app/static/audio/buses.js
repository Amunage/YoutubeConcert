window.AudioBuses = (() => {
  const { clamp, getConvolverBuffer } = window.AudioEffects;
  const { ensureOutputChainState, connectToOutput } = window.AudioOutput;

  function ensureSharedEffectBus(kind, options = {}, context = audioContext) {
    const state = ensureOutputChainState(context);
    if (!state) {
      return null;
    }

    const roomPreset = options.roomPreset || "hall";
    const audiencePreset = options.audiencePreset || "mid";
    const busKey = kind === "diffusion"
      ? `${kind}:${roomPreset}:${audiencePreset}`
      : `${kind}:${roomPreset}`;
    if (state.effectBuses.has(busKey)) {
      return state.effectBuses.get(busKey);
    }

    const input = context.createGain();
    input.gain.value = 1;

    const returnGain = context.createGain();
    const limiter = context.createDynamicsCompressor();
    let bus;

    if (kind === "diffusion") {
      returnGain.gain.value = 1;
      limiter.threshold.value = -22;
      limiter.knee.value = 18;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.14;

      buildDiffusionNetwork(input, returnGain, {
        timesMs: options.timesMs,
        feedback: options.feedback,
        cutoffHz: options.cutoffHz,
        stereoSpread: options.stereoSpread,
      });

      bus = { input, returnGain, limiter };
    } else {
      const convolver = context.createConvolver();
      convolver.buffer = getConvolverBuffer(roomPreset, kind);

      returnGain.gain.value = kind === "early" ? 1.06 : 1;
      limiter.threshold.value = kind === "early" ? -18 : -20;
      limiter.knee.value = kind === "early" ? 16 : 20;
      limiter.ratio.value = kind === "early" ? 6 : 10;
      limiter.attack.value = kind === "early" ? 0.002 : 0.004;
      limiter.release.value = kind === "early" ? 0.11 : 0.18;

      input.connect(convolver);
      convolver.connect(returnGain);
      bus = { input, convolver, returnGain, limiter };
    }

    returnGain.connect(limiter);
    connectToOutput(limiter, context);

    state.effectBuses.set(busKey, bus);
    return bus;
  }

  function buildDiffusionNetwork(inputNode, targetNode, options = {}) {
    const diffusionTimesMs = options.timesMs || [11, 17, 29, 41];
    const feedbackAmount = clamp(options.feedback ?? 0.42, 0, 0.72);
    const cutoffHz = options.cutoffHz || 4200;
    const spread = options.stereoSpread || 0.12;
    let previousNode = inputNode;

    diffusionTimesMs.forEach((timeMs, index) => {
      const stageDelay = audioContext.createDelay(0.12);
      stageDelay.delayTime.value = Math.max(0.003, timeMs / 1000);

      const stageAllpass = audioContext.createBiquadFilter();
      stageAllpass.type = "allpass";
      stageAllpass.frequency.value = 900 + index * 650;
      stageAllpass.Q.value = 0.7 + index * 0.08;

      const stageTone = audioContext.createBiquadFilter();
      stageTone.type = "lowpass";
      stageTone.frequency.value = Math.max(900, cutoffHz - index * 380);
      stageTone.Q.value = 0.5;

      const stagePanner = audioContext.createStereoPanner();
      stagePanner.pan.value = clamp((index % 2 === 0 ? -1 : 1) * spread * (0.55 + index * 0.14), -0.82, 0.82);

      const stageMixGain = audioContext.createGain();
      stageMixGain.gain.value = Math.max(0.18, 0.44 - index * 0.04);

      const feedbackGain = audioContext.createGain();
      feedbackGain.gain.value = clamp(feedbackAmount * (0.78 - index * 0.09), 0, 0.68);

      previousNode.connect(stageDelay);
      stageDelay.connect(stageAllpass);
      stageAllpass.connect(stageTone);
      stageTone.connect(stageMixGain);
      stageMixGain.connect(stagePanner);
      stagePanner.connect(targetNode);
      stageMixGain.connect(feedbackGain);
      feedbackGain.connect(stageDelay);

      previousNode = stageMixGain;
    });
  }

  return {
    ensureSharedEffectBus,
    buildDiffusionNetwork,
  };
})();
