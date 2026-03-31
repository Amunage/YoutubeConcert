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

  function buildLayerVariationCache(variationSeedBase, trackCount, roomPreset, audiencePreset) {
    const totalTracks = Math.max(1, trackCount || 1);
    const cache = [];

    for (let index = 0; index < totalTracks; index += 1) {
      cache.push(getLayerVariation(variationSeedBase, index, totalTracks, roomPreset, audiencePreset));
    }

    return cache;
  }

  function buildLayerComputationCache(trackCount, baseVolume, volumeDecay, reverbIntensity, peakSuppression, audiencePreset) {
    const totalTracks = Math.max(1, trackCount || 1);
    const cache = {
      layerBlends: [],
      trackVolumes: [],
      shapedVolumes: [],
      audienceTracks: [],
      reverbStrengths: [],
      suppressionStrengths: [],
    };

    for (let index = 0; index < totalTracks; index += 1) {
      const layerBlend = getLayerBlend(index, totalTracks);
      const audienceTrack = getAudienceTrackProfile(audiencePreset, index, totalTracks);
      const trackVolume = getTrackVolume(baseVolume, volumeDecay, index);
      cache.layerBlends.push(layerBlend);
      cache.trackVolumes.push(trackVolume);
      cache.shapedVolumes.push((trackVolume / 100) * Math.max(0.24, 1 - index * 0.08));
      cache.audienceTracks.push(audienceTrack);
      cache.reverbStrengths.push(clamp(getTrackEffectStrength(reverbIntensity, index) + audienceTrack.reverbExtra, 0, 100));
      cache.suppressionStrengths.push(clamp(getTrackEffectStrength(peakSuppression, index) + audienceTrack.suppressionExtra, 0, 100));
    }

    return cache;
  }

  function scheduleLayeredTrack(buffer, startTime, offsetSeconds, volume, layerIndex, delayMs, reverbIntensity, peakSuppression, roomPreset, audiencePreset, effectOptions = {}) {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    const playbackContext = effectOptions.playbackContext || {};
    const variationSeedBase = playbackContext.variationSeedBase ?? effectOptions.variationSeedBase ?? "";
    const reverbAmount = clamp(effectOptions.reverbAmount ?? reverbIntensity, 0, 100) / 100;
    const diffusionAmount = clamp(effectOptions.diffusionAmount ?? 100, 0, 100) / 100;
    const auxiliaryAmount = clamp(effectOptions.auxiliaryAmount ?? 100, 0, 100) / 100;
    const trackCount = playbackContext.trackCount ?? playbackSettings?.count ?? (layerIndex + 1);
    const layerCache = playbackContext.layerCache || null;
    const layerBlend = layerCache?.layerBlends?.[layerIndex] ?? getLayerBlend(layerIndex, trackCount);
    const layerVariation = playbackContext.layerVariationCache?.[layerIndex]
      || getLayerVariation(variationSeedBase, layerIndex, trackCount, roomPreset, audiencePreset);
    const layerStartTime = Math.max(0, startTime + layerVariation.timingJitterMs / 1000);
    const preset = playbackContext.preset || getRoomPresetConfig(roomPreset);
    const audience = playbackContext.audience || getAudiencePresetConfig(audiencePreset);
    const effectiveDelayMs = playbackContext.effectiveDelayMs ?? (delayMs * audience.delayScale);
    const sharedBuses = playbackContext.sharedBuses || null;
    const audienceTrack = layerCache?.audienceTracks?.[layerIndex] || getAudienceTrackProfile(audiencePreset, layerIndex, trackCount);
    const reverbDrive = layerCache?.reverbStrengths?.[layerIndex] ?? clamp(getTrackEffectStrength(reverbIntensity, layerIndex) + audienceTrack.reverbExtra, 0, 100);
    const suppressionDrive = layerCache?.suppressionStrengths?.[layerIndex] ?? clamp(getTrackEffectStrength(peakSuppression, layerIndex) + audienceTrack.suppressionExtra, 0, 100);
    const complexityProfile = getComplexityProfile(trackCount, roomPreset, audiencePreset, reverbDrive);
    const distanceBlend = clamp(layerBlend * (0.42 + preset.distanceEq) + audience.distanceOffset, 0, 1.25);
    const basePan = clamp(
      getPanPosition(layerIndex, trackCount, preset.stereoWidth * audience.stereoWidth) + layerVariation.panOffset,
      -0.84,
      0.84
    );
    const adjustedVolume = volume * audienceTrack.volumeScale * layerVariation.gainScale;
    const directMixLevel = audience.directMixTrim * Math.max(0.82, 1 - layerBlend * 0.12);
    const leadClarity = audienceTrack.clarityBoost || 0;
    const wetMixTrim = audienceTrack.wetMixTrim || 0;
    const airAbsorptionDrive = distanceBlend * (0.9 + preset.distanceEq * 0.35) + audience.extraHighCut * 0.42;
    const dynamicWetTrim = clamp(
      1 - (
        (audience.dynamicWetTrimStrength || 0) *
        (
          distanceBlend * 0.52 +
          (reverbDrive / 100) * 0.26 +
          clamp(adjustedVolume, 0, 1.5) * 0.18 +
          layerBlend * 0.08
        )
      ),
      0.56,
      1
    );

    const lowpassNode = audioContext.createBiquadFilter();
    lowpassNode.type = "lowpass";
    lowpassNode.frequency.value = Math.max(
      220,
      13600 -
        distanceBlend * (2600 + reverbDrive * 14) -
        audience.directCutHz * 0.42 +
        preset.directToneLift * 220 +
        layerVariation.lowpassOffsetHz
    );
    lowpassNode.Q.value = 0.58;

    const directHighpassNode = audioContext.createBiquadFilter();
    directHighpassNode.type = "highpass";
    directHighpassNode.frequency.value = Math.max(
      26,
      32 + distanceBlend * 42 + audience.directCutHz * 0.03
    );
    directHighpassNode.Q.value = 0.58;

    const highShelfNode = audioContext.createBiquadFilter();
    highShelfNode.type = "highshelf";
    highShelfNode.frequency.value = 3200;
    highShelfNode.gain.value =
      preset.directToneLift -
      distanceBlend * (3.2 + preset.distanceEq * 2.6 + audience.extraHighCut * 2.8) +
      leadClarity +
      layerVariation.highShelfOffsetDb;

    const airPresenceShelfNode = audioContext.createBiquadFilter();
    airPresenceShelfNode.type = "highshelf";
    airPresenceShelfNode.frequency.value = Math.max(1800, 2200 - audience.articulationCutHz * 0.08);
    airPresenceShelfNode.gain.value =
      -(airAbsorptionDrive * (2.6 + audience.extraHighCut * 1.8) + audience.articulationCutHz / 2600) +
      leadClarity * 0.28;

    const airBrillianceShelfNode = audioContext.createBiquadFilter();
    airBrillianceShelfNode.type = "highshelf";
    airBrillianceShelfNode.frequency.value = 7600;
    airBrillianceShelfNode.gain.value =
      -(airAbsorptionDrive * (5.4 + preset.distanceEq * 1.8 + audience.extraHighCut * 3.4) + audience.directCutHz / 1200) +
      leadClarity * 0.18;

    const presenceDipNode = audioContext.createBiquadFilter();
    presenceDipNode.type = "peaking";
    presenceDipNode.frequency.value = Math.max(
      1000,
      2900 - audience.articulationCutHz * 0.24 + layerVariation.articulationOffsetHz * 0.34
    );
    presenceDipNode.Q.value = 0.82;
    presenceDipNode.gain.value = audience.presenceDipDb * (0.72 + layerBlend * 0.42) + leadClarity * 0.55;

    const transientDipNode = audioContext.createBiquadFilter();
    transientDipNode.type = "peaking";
    transientDipNode.frequency.value = Math.max(1800, 3400 + layerBlend * 560 + layerVariation.articulationOffsetHz);
    transientDipNode.Q.value = 1.28;
    transientDipNode.gain.value = audience.transientDipDb * (0.96 + layerBlend * 0.28) + leadClarity * 0.72;

    const lowShelfNode = audioContext.createBiquadFilter();
    lowShelfNode.type = "lowshelf";
    lowShelfNode.frequency.value = 210;
    lowShelfNode.gain.value = -distanceBlend * (3.8 + audience.directCutHz * 0.0012);

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
      directHighpassNode,
      highShelfNode,
      airPresenceShelfNode,
      airBrillianceShelfNode,
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
    lowpassNode.connect(directHighpassNode);
    directHighpassNode.connect(highShelfNode);
    highShelfNode.connect(airPresenceShelfNode);
    airPresenceShelfNode.connect(airBrillianceShelfNode);
    airBrillianceShelfNode.connect(presenceDipNode);
    presenceDipNode.connect(transientDipNode);
    transientDipNode.connect(lowShelfNode);
    lowShelfNode.connect(compressorNode);
    compressorNode.connect(dryGain);
    dryGain.connect(dryTrimGain);
    dryTrimGain.connect(pannerNode);
    connectToOutput(pannerNode);

    const wetMix = Math.max(
      0,
      preset.wetMix * audience.wetMix * dynamicWetTrim * (1 + wetMixTrim) * reverbAmount * (0.48 + reverbDrive / 92) * (0.42 + layerBlend * 0.78)
    );
    const earlyWetMix = wetMix * preset.earlyWetMix * Math.max(0.58, 0.96 - distanceBlend * 0.16);
    if (earlyWetMix > 0.008) {
      const earlyBus = sharedBuses?.early || ensureSharedEffectBus("early", { roomPreset });
      const earlySendGain = audioContext.createGain();
      earlySendGain.gain.value = Math.min(0.26, earlyWetMix * 0.48 * audience.tailGainScale * Math.max(0.72, dynamicWetTrim));

      const earlyPreDelay = audioContext.createDelay(0.2);
      earlyPreDelay.delayTime.value = Math.max(
        0,
        (preset.earlyPreDelayMs + audience.preDelayMs * 0.24 + layerBlend * 8) * audience.preDelayScale
      ) / 1000;

      const earlyHighpass = audioContext.createBiquadFilter();
      earlyHighpass.type = "highpass";
      earlyHighpass.frequency.value = Math.max(
        110,
        170 + distanceBlend * 125 + audience.directCutHz * 0.022 + (audience.wetHighpassBoostHz || 0) * 0.35
      );

      const earlyLowpass = audioContext.createBiquadFilter();
      earlyLowpass.type = "lowpass";
      earlyLowpass.frequency.value = Math.max(
        1400,
        10400 - distanceBlend * 1800 - audience.wetLowpassCut * 0.42 - preset.earlyToneCut
      );

      const earlyLowShelf = audioContext.createBiquadFilter();
      earlyLowShelf.type = "lowshelf";
      earlyLowShelf.frequency.value = 240;
      earlyLowShelf.gain.value = audience.wetLowShelfCutDb || 0;

      const earlyPanner = audioContext.createStereoPanner();
      earlyPanner.pan.value = clamp(basePan * (0.34 + distanceBlend * 0.08), -0.52, 0.52);
      layerCleanupNodes.push(earlySendGain, earlyPreDelay, earlyHighpass, earlyLowpass, earlyLowShelf, earlyPanner);

      compressorNode.connect(earlySendGain);
      earlySendGain.connect(earlyPreDelay);
      earlyPreDelay.connect(earlyHighpass);
      earlyHighpass.connect(earlyLowpass);
      earlyLowpass.connect(earlyLowShelf);
      earlyLowShelf.connect(earlyPanner);
      if (earlyBus) {
        earlyPanner.connect(earlyBus.input);
      }
    }

    const lateWetMix = wetMix * preset.lateWetMix * (0.72 + distanceBlend * 0.16) * complexityProfile.lateWetScale;
    if (lateWetMix > 0.01) {
      const lateBus = sharedBuses?.late || ensureSharedEffectBus("late", { roomPreset });
      const lateSendGain = audioContext.createGain();
      lateSendGain.gain.value = Math.min(0.34, lateWetMix * 0.58 * audience.tailGainScale * dynamicWetTrim);

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

      const lateHighpass = audioContext.createBiquadFilter();
      lateHighpass.type = "highpass";
      lateHighpass.frequency.value = Math.max(
        150,
        210 + distanceBlend * 170 + audience.directCutHz * 0.045 + (audience.wetHighpassBoostHz || 0)
      );
      lateHighpass.Q.value = 0.62;

      const lateLowShelf = audioContext.createBiquadFilter();
      lateLowShelf.type = "lowshelf";
      lateLowShelf.frequency.value = 260;
      lateLowShelf.gain.value = audience.wetLowShelfCutDb || 0;

      const latePanner = audioContext.createStereoPanner();
      latePanner.pan.value = clamp(basePan * (0.18 + distanceBlend * 0.18), -0.38, 0.38);
      layerCleanupNodes.push(lateSendGain, latePreDelay, lateFilter, lateHighpass, lateLowShelf, latePanner);

      compressorNode.connect(lateSendGain);
      lateSendGain.connect(latePreDelay);
      latePreDelay.connect(lateFilter);
      lateFilter.connect(lateHighpass);
      lateHighpass.connect(lateLowShelf);
      lateLowShelf.connect(latePanner);
      if (lateBus) {
        latePanner.connect(lateBus.input);
      }
    }

    const diffusionMix = audience.diffusionMix * diffusionAmount * (0.42 + reverbDrive / 110) * (0.62 + distanceBlend * 0.42);
    if (diffusionMix > 0.02 && complexityProfile.allowDiffusion) {
      const diffusionBus = sharedBuses?.diffusion || ensureSharedEffectBus("diffusion", {
        roomPreset,
        audiencePreset,
        timesMs: audience.diffusionTimesMs,
        feedback: audience.diffusionFeedback,
        cutoffHz: audience.diffusionCutHz,
        stereoSpread: audience.diffusionStereo,
      });
      const diffusionSend = audioContext.createGain();
      diffusionSend.gain.value = Math.min(0.28, diffusionMix * Math.max(0.7, dynamicWetTrim));

      const diffusionPreFilter = audioContext.createBiquadFilter();
      diffusionPreFilter.type = "lowpass";
      diffusionPreFilter.frequency.value = Math.max(700, audience.diffusionCutHz - distanceBlend * 420 - layerBlend * 320);

      const diffusionHighpass = audioContext.createBiquadFilter();
      diffusionHighpass.type = "highpass";
      diffusionHighpass.frequency.value = Math.max(
        130,
        170 + distanceBlend * 85 + audience.directCutHz * 0.028 + (audience.wetHighpassBoostHz || 0) * 0.6
      );
      diffusionHighpass.Q.value = 0.56;

      const diffusionLowShelf = audioContext.createBiquadFilter();
      diffusionLowShelf.type = "lowshelf";
      diffusionLowShelf.frequency.value = 250;
      diffusionLowShelf.gain.value = (audience.wetLowShelfCutDb || 0) * 0.85;

      const diffusionPanner = audioContext.createStereoPanner();
      diffusionPanner.pan.value = clamp(basePan * (0.22 + distanceBlend * 0.12), -0.48, 0.48);
      layerCleanupNodes.push(diffusionSend, diffusionPreFilter, diffusionHighpass, diffusionLowShelf, diffusionPanner);

      compressorNode.connect(diffusionSend);
      diffusionSend.connect(diffusionPreFilter);
      diffusionPreFilter.connect(diffusionHighpass);
      diffusionHighpass.connect(diffusionLowShelf);
      diffusionLowShelf.connect(diffusionPanner);
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
      groupId: playbackContext.groupId ?? null,
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
    if (smearPattern.length && sharedBuses?.smear) {
      const smearDensity = smearPattern.length / Math.max(1, (audience.smearTapMs || []).length);
      const smearSend = audioContext.createGain();
      smearSend.gain.value =
        adjustedVolume *
        auxiliaryAmount *
        audience.smearGain *
        Math.max(0.03, 0.14 * smearDensity) *
        (0.78 + layerBlend * 0.22);

      const smearPreDelay = audioContext.createDelay(0.24);
      smearPreDelay.delayTime.value = Math.max(0, (layerBlend * 10 + effectiveDelayMs * 0.012) / 1000);

      const smearFilter = audioContext.createBiquadFilter();
      smearFilter.type = "lowpass";
      smearFilter.frequency.value = Math.max(420, 6900 - audience.smearCutHz - layerBlend * 900);

      const smearHighpass = audioContext.createBiquadFilter();
      smearHighpass.type = "highpass";
      smearHighpass.frequency.value = Math.max(120, 150 + distanceBlend * 78 + audience.directCutHz * 0.024);
      smearHighpass.Q.value = 0.54;

      const smearPanner = audioContext.createStereoPanner();
      smearPanner.pan.value = clamp(basePan * (0.32 + distanceBlend * 0.08), -0.78, 0.78);
      layerCleanupNodes.push(smearSend, smearPreDelay, smearFilter, smearHighpass, smearPanner);

      compressorNode.connect(smearSend);
      smearSend.connect(smearPreDelay);
      smearPreDelay.connect(smearFilter);
      smearFilter.connect(smearHighpass);
      smearHighpass.connect(smearPanner);
      smearPanner.connect(sharedBuses.smear.input);
    }

    const transientBlurPattern = auxiliaryAmount > 0
      ? limitTapPattern(
          audience.transientBlurTapMs || [],
          getAuxiliaryTapCount((audience.transientBlurTapMs || []).length, trackCount, layerBlend, 1, complexityProfile.tapDensityScale)
        )
      : [];
    if (transientBlurPattern.length && sharedBuses?.blur) {
      const blurDensity = transientBlurPattern.length / Math.max(1, (audience.transientBlurTapMs || []).length);
      const blurSend = audioContext.createGain();
      blurSend.gain.value =
        adjustedVolume *
        auxiliaryAmount *
        audience.transientBlurGain *
        Math.max(0.03, 0.11 * blurDensity) *
        (0.82 + layerBlend * 0.18);

      const blurPreDelay = audioContext.createDelay(0.12);
      blurPreDelay.delayTime.value = Math.max(0, layerBlend * 4.5 / 1000);

      const blurFilter = audioContext.createBiquadFilter();
      blurFilter.type = "bandpass";
      blurFilter.frequency.value = 2200 + layerBlend * 360;
      blurFilter.Q.value = 0.72;

      const blurTone = audioContext.createBiquadFilter();
      blurTone.type = "lowpass";
      blurTone.frequency.value = Math.max(1400, 5600 - audience.directCutHz * 0.5);

      const blurPanner = audioContext.createStereoPanner();
      blurPanner.pan.value = clamp(basePan * 0.2, -0.66, 0.66);
      layerCleanupNodes.push(blurSend, blurPreDelay, blurFilter, blurTone, blurPanner);

      compressorNode.connect(blurSend);
      blurSend.connect(blurPreDelay);
      blurPreDelay.connect(blurFilter);
      blurFilter.connect(blurTone);
      blurTone.connect(blurPanner);
      blurPanner.connect(sharedBuses.blur.input);
    }

    const reflectionPattern = auxiliaryAmount > 0
      ? limitTapPattern(
          preset.earlyReflections,
          getAuxiliaryTapCount((preset.earlyReflections || []).length, trackCount, layerBlend, 1, complexityProfile.tapDensityScale)
        )
      : [];
    if (reflectionPattern.length && sharedBuses?.reflection) {
      const reflectionDensity = reflectionPattern.length / Math.max(1, (preset.earlyReflections || []).length);
      const reflectionDepthTrim = clamp(
        1 - (audience.reflectionDepthTrimStrength || 0) * Math.pow(layerBlend, 1.15),
        0.42,
        1
      );
      const reflectionSend = audioContext.createGain();
      reflectionSend.gain.value =
        adjustedVolume *
        auxiliaryAmount *
        Math.max(0.02, 0.18 * reflectionDensity) *
        Math.max(0.18, 1 - distanceBlend * 0.28) *
        (0.7 + layerBlend * 0.45) *
        audience.reflectionBoost *
        dynamicWetTrim *
        reflectionDepthTrim;

      const reflectionPreDelay = audioContext.createDelay(0.2);
      reflectionPreDelay.delayTime.value = Math.max(0, (layerBlend * 12 + layerIndex * 2.5 + effectiveDelayMs * 0.02) / 1000);

      const reflectionFilter = audioContext.createBiquadFilter();
      reflectionFilter.type = "lowpass";
      reflectionFilter.frequency.value = Math.max(1200, 9000 - layerBlend * 1200);

      const reflectionHighpass = audioContext.createBiquadFilter();
      reflectionHighpass.type = "highpass";
      reflectionHighpass.frequency.value = Math.max(
        170,
        220 + distanceBlend * 155 + audience.directCutHz * 0.04 + (audience.wetHighpassBoostHz || 0) * 0.9
      );
      reflectionHighpass.Q.value = 0.6;

      const reflectionLowShelf = audioContext.createBiquadFilter();
      reflectionLowShelf.type = "lowshelf";
      reflectionLowShelf.frequency.value = 250;
      reflectionLowShelf.gain.value = (audience.wetLowShelfCutDb || 0) * 1.1;

      const reflectionPanner = audioContext.createStereoPanner();
      reflectionPanner.pan.value = clamp(basePan * (0.58 + distanceBlend * 0.12), -0.9, 0.9);
      layerCleanupNodes.push(reflectionSend, reflectionPreDelay, reflectionFilter, reflectionHighpass, reflectionLowShelf, reflectionPanner);

      compressorNode.connect(reflectionSend);
      reflectionSend.connect(reflectionPreDelay);
      reflectionPreDelay.connect(reflectionFilter);
      reflectionFilter.connect(reflectionHighpass);
      reflectionHighpass.connect(reflectionLowShelf);
      reflectionLowShelf.connect(reflectionPanner);
      reflectionPanner.connect(sharedBuses.reflection.input);
    }
  }

  return {
    buildLayerComputationCache,
    buildLayerVariationCache,
    getLayerBlend,
    getTrackVolume,
    getTrackEffectStrength,
    getPanPosition,
    getReflectionPan,
    getLayerVariation,
    scheduleLayeredTrack,
  };
})();
