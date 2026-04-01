import { clamp, getAudienceTrackProfile } from "../../lib/presets.js";
import {
  getAuxiliaryTapCount,
  getLayerBlend,
  getLayerVariation,
  getPanPosition,
  getReflectionPan,
  getTrackEffectStrength,
  getTrackVolume,
} from "./effects.js";

function collectNodes(list, ...nodes) {
  nodes.flat().forEach((node) => {
    if (node && typeof node.disconnect === "function") {
      list.push(node);
    }
  });
}

function makeSendChain(context, source, target, config, cleanupNodes) {
  const gain = context.createGain();
  gain.gain.value = config.gainValue;
  const nodes = [gain];
  let current = gain;
  let preDelay = null;
  let highpass = null;
  let lowpass = null;
  let bandpass = null;
  let lowShelf = null;

  source.connect(gain);

  if (typeof config.preDelaySeconds === "number") {
    preDelay = context.createDelay(Math.max(0.12, config.preDelaySeconds + 0.05));
    preDelay.delayTime.value = config.preDelaySeconds;
    current.connect(preDelay);
    current = preDelay;
    nodes.push(preDelay);
  }

  if (typeof config.highpassHz === "number") {
    highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = config.highpassHz;
    highpass.Q.value = config.highpassQ ?? 0.56;
    current.connect(highpass);
    current = highpass;
    nodes.push(highpass);
  }

  if (typeof config.lowpassHz === "number") {
    lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = config.lowpassHz;
    lowpass.Q.value = config.lowpassQ ?? 0.56;
    current.connect(lowpass);
    current = lowpass;
    nodes.push(lowpass);
  }

  if (typeof config.bandpassHz === "number") {
    bandpass = context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = config.bandpassHz;
    bandpass.Q.value = config.bandpassQ ?? 0.72;
    current.connect(bandpass);
    current = bandpass;
    nodes.push(bandpass);
  }

  if (typeof config.lowShelfGainDb === "number" && config.lowShelfGainDb !== 0) {
    lowShelf = context.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = config.lowShelfFrequencyHz ?? 250;
    lowShelf.gain.value = config.lowShelfGainDb;
    current.connect(lowShelf);
    current = lowShelf;
    nodes.push(lowShelf);
  }

  const panner = context.createStereoPanner();
  panner.pan.value = config.panValue;
  current.connect(panner);
  panner.connect(target);
  nodes.push(panner);

  collectNodes(cleanupNodes, nodes);
  return { gain, preDelay, highpass, lowpass, bandpass, lowShelf, panner, nodes };
}

function setAudioParam(param, value, context, timeConstant = 0.03) {
  if (!param || typeof value !== "number") {
    return;
  }
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, timeConstant);
}

function computeLayerState({
  room,
  audience,
  audienceTrack,
  safe,
  trackCount,
  index,
  complexity,
  reflectionPattern,
  layerCache,
  layerVariationCache,
}) {
  const layerBlend = layerCache.layerBlends[index];
  const variation = layerVariationCache[index];
  const trackVolume = layerCache.trackVolumes[index] / 100;
  const reverbDrive = layerCache.reverbStrengths[index];
  const suppressionDrive = layerCache.suppressionStrengths[index];
  const distanceBlend = clamp(layerBlend * (0.42 + room.distanceEq) + audience.distanceOffset, 0, 1.25);
  const basePan = clamp(
    getPanPosition(index, trackCount, room.stereoWidth * audience.stereoWidth) + variation.panOffset,
    -0.84,
    0.84,
  );
  const adjustedVolume = trackVolume * audienceTrack.volumeScale * variation.gainScale;
  const directMixLevel = audience.directMixTrim * Math.max(0.82, 1 - layerBlend * 0.12);
  const wetMixTrim = audienceTrack.wetMixTrim || 0;
  const leadClarity = audienceTrack.clarityBoost || 0;
  const airAbsorptionDrive = distanceBlend * (0.9 + room.distanceEq * 0.35) + audience.extraHighCut * 0.42;
  const dynamicWetTrim = clamp(
    1 - (
      (audience.dynamicWetTrimStrength || 0) * (
        distanceBlend * 0.52 +
        (reverbDrive / 100) * 0.26 +
        clamp(adjustedVolume, 0, 1.5) * 0.18 +
        layerBlend * 0.08
      )
    ),
    0.56,
    1,
  );
  const reflectionDensity = reflectionPattern.length / Math.max(1, room.earlyReflections.length);
  const reflectionTapCount = getAuxiliaryTapCount(room.earlyReflections.length, trackCount, layerBlend, 1, complexity.tapDensityScale);
  const wetMix = Math.max(
    0,
    room.wetMix *
      audience.wetMix *
      dynamicWetTrim *
      (1 + wetMixTrim) *
      (reverbDrive / 100) *
      (0.48 + reverbDrive / 92) *
      (0.42 + layerBlend * 0.78),
  );

  return {
    layerBlend,
    variation,
    reverbDrive,
    suppressionDrive,
    distanceBlend,
    basePan,
    adjustedVolume,
    directMixLevel,
    wetMixTrim,
    leadClarity,
    airAbsorptionDrive,
    dynamicWetTrim,
    reflectionDensity,
    reflectionTapCount,
    wetMix,
  };
}

function computeSendValues({
  room,
  audience,
  safe,
  trackCount,
  index,
  complexity,
  layerState,
}) {
  const {
    layerBlend,
    distanceBlend,
    reverbDrive,
    adjustedVolume,
    dynamicWetTrim,
    reflectionDensity,
    reflectionTapCount,
    wetMix,
  } = layerState;

  const smearDensity = audience.smearTapMs.length
    ? getAuxiliaryTapCount(audience.smearTapMs.length, trackCount, layerBlend, 2, complexity.tapDensityScale) / audience.smearTapMs.length
    : 0;
  const blurDensity = audience.transientBlurTapMs.length
    ? getAuxiliaryTapCount(audience.transientBlurTapMs.length, trackCount, layerBlend, 1, complexity.tapDensityScale) / audience.transientBlurTapMs.length
    : 0;
  const reflectionDepthTrim = clamp(
    1 - (audience.reflectionDepthTrimStrength || 0) * Math.pow(layerBlend, 1.15),
    0.42,
    1,
  );

  return {
    earlyGainValue: Math.min(
      0.26,
      wetMix * room.earlyWetMix * 0.48 * audience.tailGainScale * Math.max(0.72, dynamicWetTrim) * Math.max(0.58, 0.96 - distanceBlend * 0.16),
    ),
    lateGainValue: Math.min(
      0.34,
      wetMix * room.lateWetMix * 0.58 * audience.tailGainScale * dynamicWetTrim * (0.72 + distanceBlend * 0.16) * complexity.lateWetScale,
    ),
    diffusionGainValue: complexity.allowDiffusion
      ? Math.min(
          0.28,
          audience.diffusionMix * (safe.diffusionAmount / 100) * (0.42 + reverbDrive / 110) * (0.62 + distanceBlend * 0.42) * Math.max(0.7, dynamicWetTrim),
        )
      : 0,
    smearGainValue:
      adjustedVolume *
      (safe.auxiliaryAmount / 100) *
      audience.smearGain *
      Math.max(0.03, 0.14 * smearDensity) *
      (0.78 + layerBlend * 0.22),
    blurGainValue:
      adjustedVolume *
      (safe.auxiliaryAmount / 100) *
      audience.transientBlurGain *
      Math.max(0.03, 0.11 * blurDensity) *
      (0.82 + layerBlend * 0.18),
    reflectionGainValue:
      adjustedVolume *
      (safe.auxiliaryAmount / 100) *
      Math.max(0.02, 0.18 * reflectionDensity) *
      Math.max(0.18, 1 - distanceBlend * 0.28) *
      (0.7 + layerBlend * 0.45) *
      audience.reflectionBoost *
      dynamicWetTrim *
      reflectionDepthTrim *
      Math.max(0.3, reflectionTapCount / Math.max(1, room.earlyReflections.length)),
  };
}

export function buildLayerVariationCache(variationSeedBase, trackCount, roomPreset, audiencePreset) {
  const totalTracks = Math.max(1, trackCount || 1);
  const cache = [];
  for (let index = 0; index < totalTracks; index += 1) {
    cache.push(getLayerVariation(variationSeedBase, index, totalTracks, roomPreset, audiencePreset));
  }
  return cache;
}

export function buildLayerComputationCache(trackCount, baseVolume, volumeDecay, reverbIntensity, peakSuppression, audiencePreset) {
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

export function buildLayerChain({
  context,
  processedInput,
  mix,
  earlyInput,
  lateInput,
  diffusionInput,
  smearInput,
  blurInput,
  reflectionInput,
  room,
  audience,
  audienceTrack,
  safe,
  trackCount,
  index,
  complexity,
  reflectionPattern,
  layerCache = null,
  layerVariationCache = null,
}) {
  const cleanupNodes = [];
  const safeLayerCache = layerCache || buildLayerComputationCache(trackCount, safe.ensembleVolume, safe.volumeDecay, safe.reverbIntensity, safe.peakSuppression, safe.audiencePreset);
  const safeVariationCache = layerVariationCache || buildLayerVariationCache("live", trackCount, safe.roomPreset, safe.audiencePreset);
  const layerState = computeLayerState({
    room,
    audience,
    audienceTrack,
    safe,
    trackCount,
    index,
    complexity,
    reflectionPattern,
    layerCache: safeLayerCache,
    layerVariationCache: safeVariationCache,
  });
  const {
    layerBlend,
    variation,
    reverbDrive,
    suppressionDrive,
    distanceBlend,
    basePan,
    adjustedVolume,
    directMixLevel,
    leadClarity,
    airAbsorptionDrive,
  } = layerState;
  const sendValues = computeSendValues({
    room,
    audience,
    safe,
    trackCount,
    index,
    complexity,
    layerState,
  });

  const layerDelay = context.createDelay(0.8);
  layerDelay.delayTime.value = Math.max(0, (safe.delayMs * audience.delayScale * index) / 1000);

  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = Math.max(
    220,
    13600 -
      distanceBlend * (2600 + reverbDrive * 14) -
      audience.directCutHz * 0.42 +
      room.directToneLift * 220 +
      variation.lowpassOffsetHz,
  );
  lowpass.Q.value = 0.58;

  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = Math.max(26, 32 + distanceBlend * 42 + audience.directCutHz * 0.03);
  highpass.Q.value = 0.58;

  const highShelf = context.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = 3200;
  highShelf.gain.value =
    room.directToneLift -
    distanceBlend * (3.2 + room.distanceEq * 2.6 + audience.extraHighCut * 2.8) +
    leadClarity +
    variation.highShelfOffsetDb;

  const airPresenceShelf = context.createBiquadFilter();
  airPresenceShelf.type = "highshelf";
  airPresenceShelf.frequency.value = Math.max(1800, 2200 - audience.articulationCutHz * 0.08);
  airPresenceShelf.gain.value =
    -(airAbsorptionDrive * (2.6 + audience.extraHighCut * 1.8) + audience.articulationCutHz / 2600) +
    leadClarity * 0.28;

  const airBrillianceShelf = context.createBiquadFilter();
  airBrillianceShelf.type = "highshelf";
  airBrillianceShelf.frequency.value = 7600;
  airBrillianceShelf.gain.value =
    -(airAbsorptionDrive * (5.4 + room.distanceEq * 1.8 + audience.extraHighCut * 3.4) + audience.directCutHz / 1200) +
    leadClarity * 0.18;

  const presenceDip = context.createBiquadFilter();
  presenceDip.type = "peaking";
  presenceDip.frequency.value = Math.max(
    1000,
    2900 - audience.articulationCutHz * 0.24 + variation.articulationOffsetHz * 0.34,
  );
  presenceDip.Q.value = 0.82;
  presenceDip.gain.value = audience.presenceDipDb * (0.72 + layerBlend * 0.42) + leadClarity * 0.55;

  const transientDip = context.createBiquadFilter();
  transientDip.type = "peaking";
  transientDip.frequency.value = Math.max(1800, 3400 + layerBlend * 560 + variation.articulationOffsetHz);
  transientDip.Q.value = 1.28;
  transientDip.gain.value = audience.transientDipDb * (0.96 + layerBlend * 0.28) + leadClarity * 0.72;

  const lowShelf = context.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 210;
  lowShelf.gain.value = -distanceBlend * (3.8 + audience.directCutHz * 0.0012);

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -15 - suppressionDrive * 0.085 - layerBlend * 8.5;
  compressor.knee.value = 18 + reverbDrive * 0.17;
  compressor.ratio.value = Math.min(18, 1.8 + suppressionDrive * 0.07 + layerBlend * 4.6);
  compressor.attack.value = Math.max(0.0015, 0.017 - suppressionDrive * 0.00008 - layerBlend * 0.006);
  compressor.release.value = Math.min(0.9, 0.16 + layerBlend * 0.22 + suppressionDrive * 0.003 + reverbDrive * 0.0015);

  const dryGain = context.createGain();
  dryGain.gain.value = adjustedVolume * Math.max(0.06, 1 - distanceBlend * 0.22) * audience.dryGain * directMixLevel;

  const dryTrimGain = context.createGain();
  dryTrimGain.gain.value = 1;

  const panner = context.createStereoPanner();
  panner.pan.value = basePan;

  collectNodes(
    cleanupNodes,
    layerDelay,
    lowpass,
    highpass,
    highShelf,
    airPresenceShelf,
    airBrillianceShelf,
    presenceDip,
    transientDip,
    lowShelf,
    compressor,
    dryGain,
    dryTrimGain,
    panner,
  );

  processedInput.connect(layerDelay);
  layerDelay.connect(lowpass);
  lowpass.connect(highpass);
  highpass.connect(highShelf);
  highShelf.connect(airPresenceShelf);
  airPresenceShelf.connect(airBrillianceShelf);
  airBrillianceShelf.connect(presenceDip);
  presenceDip.connect(transientDip);
  transientDip.connect(lowShelf);
  lowShelf.connect(compressor);
  compressor.connect(dryGain);
  dryGain.connect(dryTrimGain);
  dryTrimGain.connect(panner);
  panner.connect(mix);

  const earlySend = makeSendChain(context, compressor, earlyInput, {
    gainValue: sendValues.earlyGainValue,
    preDelaySeconds: Math.max(0, (room.earlyPreDelayMs + audience.preDelayMs * 0.24 + layerBlend * 8) * audience.preDelayScale / 1000),
    highpassHz: Math.max(110, 170 + distanceBlend * 125 + audience.directCutHz * 0.022 + (audience.wetHighpassBoostHz || 0) * 0.35),
    lowpassHz: Math.max(1400, 10400 - distanceBlend * 1800 - audience.wetLowpassCut * 0.42 - room.earlyToneCut),
    lowShelfGainDb: audience.wetLowShelfCutDb || 0,
    lowShelfFrequencyHz: 240,
    panValue: clamp(basePan * (0.34 + distanceBlend * 0.08), -0.52, 0.52),
  }, cleanupNodes);

  const lateSend = makeSendChain(context, compressor, lateInput, {
    gainValue: sendValues.lateGainValue,
    preDelaySeconds: Math.max(0, (room.latePreDelayMs + audience.preDelayMs + layerBlend * 18) * audience.preDelayScale / 1000),
    lowpassHz: Math.max(220, 7600 - distanceBlend * 2500 - audience.wetLowpassCut - room.lateToneCut),
    highpassHz: Math.max(150, 210 + distanceBlend * 170 + audience.directCutHz * 0.045 + (audience.wetHighpassBoostHz || 0)),
    highpassQ: 0.62,
    lowShelfGainDb: audience.wetLowShelfCutDb || 0,
    lowShelfFrequencyHz: 260,
    panValue: clamp(basePan * (0.18 + distanceBlend * 0.18), -0.38, 0.38),
  }, cleanupNodes);

  const diffusionSend = makeSendChain(context, compressor, diffusionInput, {
    gainValue: sendValues.diffusionGainValue,
    lowpassHz: Math.max(700, audience.diffusionCutHz - distanceBlend * 420 - layerBlend * 320),
    highpassHz: Math.max(130, 170 + distanceBlend * 85 + audience.directCutHz * 0.028 + (audience.wetHighpassBoostHz || 0) * 0.6),
    lowShelfGainDb: (audience.wetLowShelfCutDb || 0) * 0.85,
    panValue: clamp(basePan * (0.22 + distanceBlend * 0.12), -0.48, 0.48),
  }, cleanupNodes);

  const smearSend = makeSendChain(context, compressor, smearInput, {
    gainValue: sendValues.smearGainValue,
    preDelaySeconds: Math.max(0, (layerBlend * 10 + safe.delayMs * audience.delayScale * 0.012) / 1000),
    lowpassHz: Math.max(420, 6900 - audience.smearCutHz - layerBlend * 900),
    highpassHz: Math.max(120, 150 + distanceBlend * 78 + audience.directCutHz * 0.024),
    highpassQ: 0.54,
    panValue: clamp(basePan * (0.32 + distanceBlend * 0.08), -0.78, 0.78),
  }, cleanupNodes);

  const blurSend = makeSendChain(context, compressor, blurInput, {
    gainValue: sendValues.blurGainValue,
    preDelaySeconds: Math.max(0, layerBlend * 4.5 / 1000),
    bandpassHz: 2200 + layerBlend * 360,
    bandpassQ: 0.72,
    lowpassHz: Math.max(1400, 5600 - audience.directCutHz * 0.5),
    panValue: clamp(basePan * 0.2, -0.66, 0.66),
  }, cleanupNodes);

  const reflectionSend = makeSendChain(context, compressor, reflectionInput, {
    gainValue: sendValues.reflectionGainValue,
    preDelaySeconds: Math.max(0, (layerBlend * 12 + index * 2.5 + safe.delayMs * audience.delayScale * 0.02) / 1000),
    lowpassHz: Math.max(1200, 9000 - layerBlend * 1200),
    highpassHz: Math.max(170, 220 + distanceBlend * 155 + audience.directCutHz * 0.04 + (audience.wetHighpassBoostHz || 0) * 0.9),
    highpassQ: 0.6,
    lowShelfGainDb: (audience.wetLowShelfCutDb || 0) * 1.1,
    panValue: getReflectionPan(basePan, index, room.reflectionWidth),
  }, cleanupNodes);

  return {
    index,
    delay: layerDelay,
    lowpass,
    highpass,
    highShelf,
    airPresenceShelf,
    airBrillianceShelf,
    presenceDip,
    transientDip,
    lowShelf,
    compressor,
    dryGain,
    dryTrimGain,
    panner,
    earlySend,
    lateSend,
    diffusionSend,
    smearSend,
    blurSend,
    reflectionSend,
    cleanupNodes,
  };
}

export function updateLayerChain({
  context,
  layer,
  room,
  audience,
  audienceTrack,
  safe,
  trackCount,
  complexity,
  reflectionPattern,
  layerCache,
  layerVariationCache,
}) {
  const index = layer.index;
  const layerState = computeLayerState({
    room,
    audience,
    audienceTrack,
    safe,
    trackCount,
    index,
    complexity,
    reflectionPattern,
    layerCache,
    layerVariationCache,
  });
  const {
    layerBlend,
    variation,
    reverbDrive,
    suppressionDrive,
    distanceBlend,
    adjustedVolume,
    directMixLevel,
    leadClarity,
    airAbsorptionDrive,
  } = layerState;
  const sendValues = computeSendValues({
    room,
    audience,
    safe,
    trackCount,
    index,
    complexity,
    layerState,
  });

  setAudioParam(layer.delay.delayTime, Math.max(0, (safe.delayMs * audience.delayScale * index) / 1000), context);
  setAudioParam(
    layer.lowpass.frequency,
    Math.max(220, 13600 - distanceBlend * (2600 + reverbDrive * 14) - audience.directCutHz * 0.42 + room.directToneLift * 220 + variation.lowpassOffsetHz),
    context,
  );
  setAudioParam(layer.highpass.frequency, Math.max(26, 32 + distanceBlend * 42 + audience.directCutHz * 0.03), context);
  setAudioParam(
    layer.highShelf.gain,
    room.directToneLift - distanceBlend * (3.2 + room.distanceEq * 2.6 + audience.extraHighCut * 2.8) + leadClarity + variation.highShelfOffsetDb,
    context,
  );
  setAudioParam(layer.airPresenceShelf.gain, -(airAbsorptionDrive * (2.6 + audience.extraHighCut * 1.8) + audience.articulationCutHz / 2600) + leadClarity * 0.28, context);
  setAudioParam(layer.airBrillianceShelf.gain, -(airAbsorptionDrive * (5.4 + room.distanceEq * 1.8 + audience.extraHighCut * 3.4) + audience.directCutHz / 1200) + leadClarity * 0.18, context);
  setAudioParam(layer.presenceDip.gain, audience.presenceDipDb * (0.72 + layerBlend * 0.42) + leadClarity * 0.55, context);
  setAudioParam(layer.transientDip.gain, audience.transientDipDb * (0.96 + layerBlend * 0.28) + leadClarity * 0.72, context);
  setAudioParam(layer.lowShelf.gain, -distanceBlend * (3.8 + audience.directCutHz * 0.0012), context);
  setAudioParam(layer.compressor.threshold, -15 - suppressionDrive * 0.085 - layerBlend * 8.5, context);
  setAudioParam(layer.compressor.knee, 18 + reverbDrive * 0.17, context);
  setAudioParam(layer.compressor.ratio, Math.min(18, 1.8 + suppressionDrive * 0.07 + layerBlend * 4.6), context);
  setAudioParam(layer.compressor.attack, Math.max(0.0015, 0.017 - suppressionDrive * 0.00008 - layerBlend * 0.006), context);
  setAudioParam(layer.compressor.release, Math.min(0.9, 0.16 + layerBlend * 0.22 + suppressionDrive * 0.003 + reverbDrive * 0.0015), context);
  setAudioParam(layer.dryGain.gain, adjustedVolume * Math.max(0.06, 1 - distanceBlend * 0.22) * audience.dryGain * directMixLevel, context);

  setAudioParam(
    layer.earlySend.gain.gain,
    sendValues.earlyGainValue,
    context,
  );
  setAudioParam(
    layer.earlySend.preDelay?.delayTime,
    Math.max(0, (room.earlyPreDelayMs + audience.preDelayMs * 0.24 + layerBlend * 8) * audience.preDelayScale / 1000),
    context,
  );
  setAudioParam(layer.earlySend.highpass?.frequency, Math.max(110, 170 + distanceBlend * 125 + audience.directCutHz * 0.022 + (audience.wetHighpassBoostHz || 0) * 0.35), context);
  setAudioParam(layer.earlySend.lowpass?.frequency, Math.max(1400, 10400 - distanceBlend * 1800 - audience.wetLowpassCut * 0.42 - room.earlyToneCut), context);
  setAudioParam(layer.earlySend.lowShelf?.gain, audience.wetLowShelfCutDb || 0, context);

  setAudioParam(
    layer.lateSend.gain.gain,
    sendValues.lateGainValue,
    context,
  );
  setAudioParam(
    layer.lateSend.preDelay?.delayTime,
    Math.max(0, (room.latePreDelayMs + audience.preDelayMs + layerBlend * 18) * audience.preDelayScale / 1000),
    context,
  );
  setAudioParam(layer.lateSend.lowpass?.frequency, Math.max(220, 7600 - distanceBlend * 2500 - audience.wetLowpassCut - room.lateToneCut), context);
  setAudioParam(layer.lateSend.highpass?.frequency, Math.max(150, 210 + distanceBlend * 170 + audience.directCutHz * 0.045 + (audience.wetHighpassBoostHz || 0)), context);
  setAudioParam(layer.lateSend.lowShelf?.gain, audience.wetLowShelfCutDb || 0, context);

  setAudioParam(
    layer.diffusionSend.gain.gain,
    sendValues.diffusionGainValue,
    context,
  );
  setAudioParam(layer.diffusionSend.lowpass?.frequency, Math.max(700, audience.diffusionCutHz - distanceBlend * 420 - layerBlend * 320), context);
  setAudioParam(layer.diffusionSend.highpass?.frequency, Math.max(130, 170 + distanceBlend * 85 + audience.directCutHz * 0.028 + (audience.wetHighpassBoostHz || 0) * 0.6), context);
  setAudioParam(layer.diffusionSend.lowShelf?.gain, (audience.wetLowShelfCutDb || 0) * 0.85, context);

  setAudioParam(
    layer.smearSend.gain.gain,
    sendValues.smearGainValue,
    context,
  );
  setAudioParam(layer.smearSend.preDelay?.delayTime, Math.max(0, (layerBlend * 10 + safe.delayMs * audience.delayScale * 0.012) / 1000), context);

  setAudioParam(
    layer.blurSend.gain.gain,
    sendValues.blurGainValue,
    context,
  );
  setAudioParam(
    layer.reflectionSend.gain.gain,
    sendValues.reflectionGainValue,
    context,
  );
  setAudioParam(layer.reflectionSend.preDelay?.delayTime, Math.max(0, (layerBlend * 12 + index * 2.5 + safe.delayMs * audience.delayScale * 0.02) / 1000), context);
}
