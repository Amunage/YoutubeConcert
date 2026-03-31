window.AudioLayers = (() => {
  const {
    getAudienceTrackProfile,
    getRoomPresetConfig,
    getAudiencePresetConfig,
  } = window.AudioPresets;
  const {
    clamp,
    createDisconnectCleanup,
    hashStringSeed,
    createSeededRandom,
    getComplexityProfile,
    getAuxiliaryTapCount,
    limitTapPattern,
  } = window.AudioEffects;
  const { ensureSharedEffectBus } = window.AudioBuses;
  const { connectToOutput } = window.AudioOutput;

  function getLayerBlend(layerIndex, trackCount) {
    if (trackCount <= 1) {
      return 0;
    }
    return layerIndex / (trackCount - 1);
  }

  function getTrackVolume(baseVolume, volumeDecayPercent, layerIndex) {
    let volume = clamp(baseVolume, 0, 100);
    const keepRatio = 1 - clamp(volumeDecayPercent, 0, 100) / 100;
    const floorRatio = 0.05;

    for (let step = 0; step < layerIndex; step += 1) {
      const depth = layerIndex <= 1 ? 0 : step / Math.max(1, layerIndex - 1);
      const easedKeepRatio = Math.min(0.96, keepRatio + depth * (1 - keepRatio) * 0.16);
      volume *= easedKeepRatio;
    }

    return clamp(Math.max(baseVolume * floorRatio, volume), 0, 100);
  }

  function getTrackEffectStrength(basePercent, layerIndex) {
    let strength = 0;
    const growthRatio = clamp(basePercent, 0, 100) / 100;

    for (let step = 0; step < layerIndex; step += 1) {
      strength += (100 - strength) * growthRatio;
    }

    return clamp(strength, 0, 100);
  }

  function getPanPosition(layerIndex, trackCount, width) {
    if (trackCount <= 1 || layerIndex === 0) {
      return 0;
    }

    const depth = layerIndex / (trackCount - 1);
    const direction = layerIndex % 2 === 0 ? 1 : -1;
    return clamp(direction * width * (0.42 + depth * 0.58), -0.75, 0.75);
  }

  function getReflectionPan(basePan, reflectionIndex, width) {
    const direction = reflectionIndex % 2 === 0 ? -1 : 1;
    return clamp(basePan * 0.5 + direction * width * (0.45 + reflectionIndex * 0.12), -0.92, 0.92);
  }

  function getLayerVariation(variationSeedBase, layerIndex, trackCount, roomPreset, audiencePreset) {
    const depth = getLayerBlend(layerIndex, trackCount);
    const seededRandom = createSeededRandom(
      hashStringSeed(`${variationSeedBase || "default"}|${roomPreset}|${audiencePreset}|${trackCount}|${layerIndex}`)
    );
    const bipolar = () => seededRandom() * 2 - 1;

    return {
      timingJitterMs: bipolar() * (2.5 + depth * 11 + Math.max(0, trackCount - 1) * 0.45),
      playbackRate: clamp(1 + bipolar() * (0.0007 + depth * 0.0026), 0.992, 1.008),
      gainScale: clamp(1 + bipolar() * (0.025 + depth * 0.045), 0.9, 1.08),
      panOffset: clamp(bipolar() * (0.018 + depth * 0.09), -0.16, 0.16),
      lowpassOffsetHz: bipolar() * (180 + depth * 820),
      highShelfOffsetDb: bipolar() * (0.7 + depth * 1.9),
      articulationOffsetHz: bipolar() * (120 + depth * 520),
      fadeScale: clamp(0.92 + seededRandom() * 0.22, 0.9, 1.16),
    };
  }

  function scheduleLayeredTrack(buffer, startTime, offsetSeconds, volume, layerIndex, delayMs, reverbIntensity, peakSuppression, roomPreset, audiencePreset, effectOptions = {}) {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    const variationSeedBase = effectOptions.variationSeedBase || "";
    const reverbAmount = clamp(effectOptions.reverbAmount ?? reverbIntensity, 0, 100) / 100;
    const diffusionAmount = clamp(effectOptions.diffusionAmount ?? 100, 0, 100) / 100;
    const auxiliaryAmount = clamp(effectOptions.auxiliaryAmount ?? 100, 0, 100) / 100;
    const trackCount = playbackSettings?.count || (layerIndex + 1);
    const layerBlend = getLayerBlend(layerIndex, trackCount);
    const layerVariation = getLayerVariation(variationSeedBase, layerIndex, trackCount, roomPreset, audiencePreset);
    const layerStartTime = Math.max(0, startTime + layerVariation.timingJitterMs / 1000);
    const audienceTrack = getAudienceTrackProfile(audiencePreset, layerIndex, trackCount);
    const reverbDrive = clamp(getTrackEffectStrength(reverbIntensity, layerIndex) + audienceTrack.reverbExtra, 0, 100);
    const suppressionDrive = clamp(getTrackEffectStrength(peakSuppression, layerIndex) + audienceTrack.suppressionExtra, 0, 100);
    const preset = getRoomPresetConfig(roomPreset);
    const audience = getAudiencePresetConfig(audiencePreset);
    const complexityProfile = getComplexityProfile(trackCount, roomPreset, audiencePreset, reverbDrive);
    const distanceBlend = clamp(layerBlend * (0.42 + preset.distanceEq) + audience.distanceOffset, 0, 1.25);
    const basePan = clamp(
      getPanPosition(layerIndex, trackCount, preset.stereoWidth * audience.stereoWidth) + layerVariation.panOffset,
      -0.84,
      0.84
    );
    const adjustedVolume = volume * audienceTrack.volumeScale * layerVariation.gainScale;
    const effectiveDelayMs = delayMs * audience.delayScale;
    const directMixLevel = audience.directMixTrim * Math.max(0.82, 1 - layerBlend * 0.12);

    const lowpassNode = audioContext.createBiquadFilter();
    lowpassNode.type = "lowpass";
    lowpassNode.frequency.value = Math.max(
      140,
      13600 -
        distanceBlend * (5000 + reverbDrive * 24) -
        audience.directCutHz * 1.12 +
        preset.directToneLift * 220 +
        layerVariation.lowpassOffsetHz
    );
    lowpassNode.Q.value = 0.64;

    const highShelfNode = audioContext.createBiquadFilter();
    highShelfNode.type = "highshelf";
    highShelfNode.frequency.value = 3200;
    highShelfNode.gain.value =
      preset.directToneLift -
      distanceBlend * (7.4 + preset.distanceEq * 5.9 + audience.extraHighCut * 6.6) +
      layerVariation.highShelfOffsetDb;

    const presenceDipNode = audioContext.createBiquadFilter();
    presenceDipNode.type = "peaking";
    presenceDipNode.frequency.value = Math.max(
      1000,
      2900 - audience.articulationCutHz * 0.24 + layerVariation.articulationOffsetHz * 0.34
    );
    presenceDipNode.Q.value = 0.82;
    presenceDipNode.gain.value = audience.presenceDipDb * (0.72 + layerBlend * 0.42);

    const transientDipNode = audioContext.createBiquadFilter();
    transientDipNode.type = "peaking";
    transientDipNode.frequency.value = Math.max(1800, 3400 + layerBlend * 560 + layerVariation.articulationOffsetHz);
    transientDipNode.Q.value = 1.28;
    transientDipNode.gain.value = audience.transientDipDb * (0.96 + layerBlend * 0.28);

    const lowShelfNode = audioContext.createBiquadFilter();
    lowShelfNode.type = "lowshelf";
    lowShelfNode.frequency.value = 210;
    lowShelfNode.gain.value = -distanceBlend * 2.8;

    const compressorNode = audioContext.createDynamicsCompressor();
    compressorNode.threshold.value = -15 - suppressionDrive * 0.085 - layerBlend * 8.5;
    compressorNode.knee.value = 18 + reverbDrive * 0.17;
    compressorNode.ratio.value = Math.min(18, 1.8 + suppressionDrive * 0.07 + layerBlend * 4.6);
    compressorNode.attack.value = Math.max(0.0015, 0.017 - suppressionDrive * 0.00008 - layerBlend * 0.006);
    compressorNode.release.value = Math.min(0.9, 0.16 + layerBlend * 0.22 + suppressionDrive * 0.003 + reverbDrive * 0.0015);

    const dryGain = audioContext.createGain();
    dryGain.gain.value = adjustedVolume * Math.max(0.06, 1 - distanceBlend * 0.22) * audience.dryGain * directMixLevel;
    const dryTrimGain = audioContext.createGain();
    dryTrimGain.gain.value = 1;

    const pannerNode = audioContext.createStereoPanner();
    pannerNode.pan.value = basePan;
    const layerCleanupNodes = [
      source,
      lowpassNode,
      highShelfNode,
      presenceDipNode,
      transientDipNode,
      lowShelfNode,
      compressorNode,
      dryGain,
      dryTrimGain,
      pannerNode,
    ];
    source.playbackRate.value = layerVariation.playbackRate;

    source.connect(lowpassNode);
    lowpassNode.connect(highShelfNode);
    highShelfNode.connect(presenceDipNode);
    presenceDipNode.connect(transientDipNode);
    transientDipNode.connect(lowShelfNode);
    lowShelfNode.connect(compressorNode);
    compressorNode.connect(dryGain);
    dryGain.connect(dryTrimGain);
    dryTrimGain.connect(pannerNode);
    connectToOutput(pannerNode);

    const wetMix = preset.wetMix * audience.wetMix * reverbAmount * (0.48 + reverbDrive / 92) * (0.42 + layerBlend * 0.78);
    const earlyWetMix = wetMix * preset.earlyWetMix * Math.max(0.58, 0.96 - distanceBlend * 0.16);
    if (earlyWetMix > 0.008) {
      const earlyBus = ensureSharedEffectBus("early", { roomPreset });
      const earlySendGain = audioContext.createGain();
      earlySendGain.gain.value = Math.min(0.26, earlyWetMix * 0.48 * audience.tailGainScale);

      const earlyPreDelay = audioContext.createDelay(0.2);
      earlyPreDelay.delayTime.value = Math.max(
        0,
        (preset.earlyPreDelayMs + audience.preDelayMs * 0.24 + layerBlend * 8) * audience.preDelayScale
      ) / 1000;

      const earlyHighpass = audioContext.createBiquadFilter();
      earlyHighpass.type = "highpass";
      earlyHighpass.frequency.value = Math.max(90, 150 + distanceBlend * 90);

      const earlyLowpass = audioContext.createBiquadFilter();
      earlyLowpass.type = "lowpass";
      earlyLowpass.frequency.value = Math.max(
        1400,
        10400 - distanceBlend * 1800 - audience.wetLowpassCut * 0.42 - preset.earlyToneCut
      );

      const earlyPanner = audioContext.createStereoPanner();
      earlyPanner.pan.value = clamp(basePan * 0.32, -0.45, 0.45);
      layerCleanupNodes.push(earlySendGain, earlyPreDelay, earlyHighpass, earlyLowpass, earlyPanner);

      compressorNode.connect(earlySendGain);
      earlySendGain.connect(earlyPreDelay);
      earlyPreDelay.connect(earlyHighpass);
      earlyHighpass.connect(earlyLowpass);
      earlyLowpass.connect(earlyPanner);
      if (earlyBus) {
        earlyPanner.connect(earlyBus.input);
      }
    }

    const lateWetMix = wetMix * preset.lateWetMix * (0.72 + distanceBlend * 0.16) * complexityProfile.lateWetScale;
    if (lateWetMix > 0.01) {
      const lateBus = ensureSharedEffectBus("late", { roomPreset });
      const lateSendGain = audioContext.createGain();
      lateSendGain.gain.value = Math.min(0.34, lateWetMix * 0.58 * audience.tailGainScale);

      const latePreDelay = audioContext.createDelay(0.35);
      latePreDelay.delayTime.value = Math.max(
        0,
        (preset.latePreDelayMs + audience.preDelayMs + layerBlend * 18) * audience.preDelayScale
      ) / 1000;

      const lateFilter = audioContext.createBiquadFilter();
      lateFilter.type = "lowpass";
      lateFilter.frequency.value = Math.max(
        220,
        7600 - distanceBlend * 2500 - audience.wetLowpassCut - preset.lateToneCut
      );

      const latePanner = audioContext.createStereoPanner();
      latePanner.pan.value = clamp(basePan * 0.12, -0.28, 0.28);
      layerCleanupNodes.push(lateSendGain, latePreDelay, lateFilter, latePanner);

      compressorNode.connect(lateSendGain);
      lateSendGain.connect(latePreDelay);
      latePreDelay.connect(lateFilter);
      lateFilter.connect(latePanner);
      if (lateBus) {
        latePanner.connect(lateBus.input);
      }
    }

    const diffusionMix = audience.diffusionMix * diffusionAmount * (0.42 + reverbDrive / 110) * (0.62 + distanceBlend * 0.42);
    if (diffusionMix > 0.02 && complexityProfile.allowDiffusion) {
      const diffusionBus = ensureSharedEffectBus("diffusion", {
        roomPreset,
        audiencePreset,
        timesMs: audience.diffusionTimesMs,
        feedback: audience.diffusionFeedback,
        cutoffHz: audience.diffusionCutHz,
        stereoSpread: audience.diffusionStereo,
      });
      const diffusionSend = audioContext.createGain();
      diffusionSend.gain.value = Math.min(0.28, diffusionMix);

      const diffusionPreFilter = audioContext.createBiquadFilter();
      diffusionPreFilter.type = "lowpass";
      diffusionPreFilter.frequency.value = Math.max(700, audience.diffusionCutHz - distanceBlend * 420 - layerBlend * 320);

      const diffusionPanner = audioContext.createStereoPanner();
      diffusionPanner.pan.value = clamp(basePan * 0.18, -0.4, 0.4);
      layerCleanupNodes.push(diffusionSend, diffusionPreFilter, diffusionPanner);

      compressorNode.connect(diffusionSend);
      diffusionSend.connect(diffusionPreFilter);
      diffusionPreFilter.connect(diffusionPanner);
      if (diffusionBus) {
        diffusionPanner.connect(diffusionBus.input);
      }
    }

    const dryTargetGain = adjustedVolume * Math.max(0.05, 1 - distanceBlend * 0.32) * audience.dryGain * directMixLevel;
    const fadeSeconds = ((audience.layerFadeMs + layerBlend * 55) * layerVariation.fadeScale) / 1000;
    dryGain.gain.setValueAtTime(0, Math.max(0, layerStartTime - 0.01));
    dryGain.gain.linearRampToValueAtTime(dryTargetGain, layerStartTime + fadeSeconds);

    source.start(layerStartTime, offsetSeconds);
    activeNodes.push({
      source,
      trimNode: dryTrimGain,
      cleanup: createDisconnectCleanup(layerCleanupNodes),
    });

    const smearPattern = auxiliaryAmount > 0
      ? limitTapPattern(
          audience.smearTapMs || [],
          getAuxiliaryTapCount((audience.smearTapMs || []).length, trackCount, layerBlend, 2, complexityProfile.tapDensityScale)
        )
      : [];
    for (let smearIndex = 0; smearIndex < smearPattern.length; smearIndex += 1) {
      const smearTargetGain =
        adjustedVolume *
        auxiliaryAmount *
        audience.smearGain *
        Math.max(0.022, 0.115 - smearIndex * 0.011) *
        (0.78 + layerBlend * 0.22) *
        (smearIndex % 2 === 0 ? 0.94 : 1.06);
      if (smearTargetGain < 0.0035) {
        continue;
      }
      const smearDelay = (
        smearPattern[smearIndex] +
        layerBlend * 10 +
        effectiveDelayMs * 0.012 +
        (smearIndex % 3) * 2.3
      ) / 1000;
      const smearFade = (audience.layerFadeMs * 0.95 + smearIndex * 21) / 1000;

      const smearSource = audioContext.createBufferSource();
      smearSource.buffer = buffer;
      smearSource.playbackRate.value = layerVariation.playbackRate * (1 + ((smearIndex % 3) - 1) * 0.0025);

      const smearFilter = audioContext.createBiquadFilter();
      smearFilter.type = "lowpass";
      smearFilter.frequency.value = Math.max(
        320,
        6900 - audience.smearCutHz - smearIndex * 430 - layerBlend * 900 - (smearIndex % 2 === 0 ? 180 : 0)
      );

      const smearPanner = audioContext.createStereoPanner();
      smearPanner.pan.value = clamp(
        basePan * 0.3 + (smearIndex % 2 === 0 ? -1 : 1) * (0.035 + smearIndex * 0.008) * audience.stereoWidth,
        -0.78,
        0.78
      );

      const smearGain = audioContext.createGain();
      const smearTrimGain = audioContext.createGain();
      smearTrimGain.gain.value = 1;
      smearGain.gain.setValueAtTime(0, Math.max(0, layerStartTime + smearDelay - 0.01));
      smearGain.gain.linearRampToValueAtTime(smearTargetGain, layerStartTime + smearDelay + smearFade);

      smearSource.connect(smearFilter);
      smearFilter.connect(smearGain);
      smearGain.connect(smearTrimGain);
      smearTrimGain.connect(smearPanner);
      connectToOutput(smearPanner);

      smearSource.start(layerStartTime + smearDelay, offsetSeconds);
      activeNodes.push({
        source: smearSource,
        trimNode: smearTrimGain,
        cleanup: createDisconnectCleanup([smearSource, smearFilter, smearGain, smearTrimGain, smearPanner]),
      });
    }

    const transientBlurPattern = auxiliaryAmount > 0
      ? limitTapPattern(
          audience.transientBlurTapMs || [],
          getAuxiliaryTapCount((audience.transientBlurTapMs || []).length, trackCount, layerBlend, 1, complexityProfile.tapDensityScale)
        )
      : [];
    for (let blurIndex = 0; blurIndex < transientBlurPattern.length; blurIndex += 1) {
      const blurTargetGain =
        adjustedVolume *
        auxiliaryAmount *
        audience.transientBlurGain *
        Math.max(0.02, 0.085 - blurIndex * 0.012) *
        (0.82 + layerBlend * 0.18);
      if (blurTargetGain < 0.0035) {
        continue;
      }
      const blurDelay = (transientBlurPattern[blurIndex] + blurIndex * 1.7 + layerBlend * 4.5) / 1000;
      const blurFade = (18 + blurIndex * 14 + audience.layerFadeMs * 0.2) / 1000;

      const blurSource = audioContext.createBufferSource();
      blurSource.buffer = buffer;
      blurSource.playbackRate.value = layerVariation.playbackRate * (1 + ((blurIndex % 2 === 0 ? -1 : 1) * 0.0018));

      const blurFilter = audioContext.createBiquadFilter();
      blurFilter.type = "bandpass";
      blurFilter.frequency.value = 2200 + blurIndex * 460 + layerBlend * 360;
      blurFilter.Q.value = 0.72;

      const blurTone = audioContext.createBiquadFilter();
      blurTone.type = "lowpass";
      blurTone.frequency.value = Math.max(1400, 5600 - blurIndex * 460 - audience.directCutHz * 0.5);

      const blurPanner = audioContext.createStereoPanner();
      blurPanner.pan.value = clamp(basePan * 0.22 + (blurIndex % 2 === 0 ? -1 : 1) * 0.045, -0.7, 0.7);

      const blurGain = audioContext.createGain();
      const blurTrimGain = audioContext.createGain();
      blurTrimGain.gain.value = 1;
      blurGain.gain.setValueAtTime(0, Math.max(0, layerStartTime + blurDelay - 0.01));
      blurGain.gain.linearRampToValueAtTime(blurTargetGain, layerStartTime + blurDelay + blurFade);

      blurSource.connect(blurFilter);
      blurFilter.connect(blurTone);
      blurTone.connect(blurGain);
      blurGain.connect(blurTrimGain);
      blurTrimGain.connect(blurPanner);
      connectToOutput(blurPanner);

      blurSource.start(layerStartTime + blurDelay, offsetSeconds);
      activeNodes.push({
        source: blurSource,
        trimNode: blurTrimGain,
        cleanup: createDisconnectCleanup([blurSource, blurFilter, blurTone, blurGain, blurTrimGain, blurPanner]),
      });
    }

    const reflectionPattern = auxiliaryAmount > 0
      ? limitTapPattern(
          preset.earlyReflectionsMs,
          getAuxiliaryTapCount((preset.earlyReflectionsMs || []).length, trackCount, layerBlend, 1, complexityProfile.tapDensityScale)
        )
      : [];
    for (let reflectionIndex = 0; reflectionIndex < reflectionPattern.length; reflectionIndex += 1) {
      const reflectionDelay = audioContext.createDelay(0.35);
      reflectionDelay.delayTime.value = (
        (reflectionPattern[reflectionIndex] * audience.reflectionSpacing) +
        layerBlend * 12 +
        layerIndex * 2.5 +
        effectiveDelayMs * 0.02
      ) / 1000;

      const reflectionFilter = audioContext.createBiquadFilter();
      reflectionFilter.type = "lowpass";
      reflectionFilter.frequency.value = Math.max(1000, 9000 - reflectionIndex * 600 - layerBlend * 1200);

      const reflectionPanner = audioContext.createStereoPanner();
      reflectionPanner.pan.value = getReflectionPan(basePan, reflectionIndex, preset.reflectionWidth * audience.stereoWidth);

      const reflectionGain = audioContext.createGain();
      const reflectionTrimGain = audioContext.createGain();
      reflectionTrimGain.gain.value = 1;
      reflectionGain.gain.value = adjustedVolume * auxiliaryAmount * Math.max(0.018, 0.17 - reflectionIndex * 0.026) * Math.max(0.18, 1 - distanceBlend * 0.28) * (0.7 + layerBlend * 0.45) * audience.reflectionBoost;

      source.connect(reflectionDelay);
      reflectionDelay.connect(reflectionFilter);
      reflectionFilter.connect(reflectionGain);
      reflectionGain.connect(reflectionTrimGain);
      reflectionTrimGain.connect(reflectionPanner);
      connectToOutput(reflectionPanner);
      activeNodes.push({
        trimNode: reflectionTrimGain,
        cleanup: createDisconnectCleanup([reflectionDelay, reflectionFilter, reflectionGain, reflectionTrimGain, reflectionPanner]),
      });
    }
  }

  return {
    getLayerBlend,
    getTrackVolume,
    getTrackEffectStrength,
    getPanPosition,
    getReflectionPan,
    getLayerVariation,
    scheduleLayeredTrack,
  };
})();
