import { clamp } from "../../lib/presets.js";
import { getReflectionPan } from "./effects.js";
import {
  buildLayerAdaptiveWetCache,
  buildLayerComputationCache,
  buildLayerVariationCache,
  computeLayerState,
  computeSendValues,
} from "./layer-math.js";
import {
  getEarlyPreDelaySeconds,
  getLatePreDelaySeconds,
  getLayerDelaySeconds,
  setAudioParam,
} from "./layer-utils.js";

function collectNodes(list, ...nodes) {
  nodes.flat().forEach((node) => {
    if (node && typeof node.disconnect === "function") {
      list.push(node);
    }
  });
}

function makeSendChain(context, source, target, config, cleanupNodes) {
  if (config.enabled === false) {
    return {
      gain: null,
      preDelay: null,
      highpass: null,
      lowpass: null,
      bandpass: null,
      lowShelf: null,
      panner: null,
      nodes: [],
    };
  }

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

export { buildLayerAdaptiveWetCache, buildLayerComputationCache, buildLayerVariationCache };

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
  adaptiveWetMix = 1,
}) {
  const cleanupNodes = [];
  const safeLayerCache = layerCache || buildLayerComputationCache(trackCount, safe.ensembleVolume, safe.volumeDecay, safe.reverbIntensity, safe.peakSuppression, safe.audiencePosition, room);
  const safeVariationCache = layerVariationCache || buildLayerVariationCache("live", trackCount, safe.roomPreset, safe.audiencePreset);
  const layerState = computeLayerState({
    room,
    audience,
    audienceTrack,
    safe,
    adaptiveWetMix,
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
    widthProfile,
    centerImage,
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
  layerDelay.delayTime.value = getLayerDelaySeconds(safe, audience, room, index);

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
    -(
      airAbsorptionDrive * (
        (audience.airPresenceAbsorptionScale ?? 2.6) +
        audience.extraHighCut * (audience.airPresenceExtraHighCutScale ?? 1.8)
      ) +
      audience.articulationCutHz / (audience.airPresenceArticulationScale ?? 2600)
    ) +
    leadClarity * (audience.airPresenceLeadScale ?? 0.28);

  const airBrillianceShelf = context.createBiquadFilter();
  airBrillianceShelf.type = "highshelf";
  airBrillianceShelf.frequency.value = 7600;
  airBrillianceShelf.gain.value =
    -(
      airAbsorptionDrive * (
        (audience.airBrillianceAbsorptionScale ?? 5.4) +
        room.distanceEq * (audience.airBrillianceRoomEqScale ?? 1.8) +
        audience.extraHighCut * (audience.airBrillianceExtraHighCutScale ?? 3.4)
      ) +
      audience.directCutHz / (audience.airBrillianceDirectCutScale ?? 1200)
    ) +
    leadClarity * (audience.airBrillianceLeadScale ?? 0.18);

  const presenceDip = context.createBiquadFilter();
  presenceDip.type = "peaking";
  presenceDip.frequency.value = Math.max(
    1000,
    (audience.presenceFrequencyBase ?? 2900) -
      audience.articulationCutHz * (audience.presenceArticulationScale ?? 0.24) +
      variation.articulationOffsetHz * (audience.presenceVariationScale ?? 0.34),
  );
  presenceDip.Q.value = 0.82;
  presenceDip.gain.value =
    audience.presenceDipDb * (0.72 + layerBlend * (audience.presenceLayerScale ?? 0.42)) +
    leadClarity * (audience.presenceLeadScale ?? 0.55);

  const transientDip = context.createBiquadFilter();
  transientDip.type = "peaking";
  transientDip.frequency.value = Math.max(
    1800,
    (audience.transientFrequencyBase ?? 3400) +
      layerBlend * (audience.transientLayerFrequencyScale ?? 560) +
      variation.articulationOffsetHz * (audience.transientVariationScale ?? 1),
  );
  transientDip.Q.value = 1.28;
  transientDip.gain.value =
    audience.transientDipDb * (0.96 + layerBlend * (audience.transientLayerScale ?? 0.28)) +
    leadClarity * (audience.transientLeadScale ?? 0.72);

  const lowShelf = context.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 210;
  lowShelf.gain.value = -distanceBlend * (3.8 + audience.directCutHz * 0.0012);

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value =
    (audience.compressorThresholdBase ?? -15) -
    suppressionDrive * (audience.compressorThresholdSuppressionScale ?? 0.085) -
    layerBlend * (audience.compressorThresholdLayerScale ?? 8.5);
  compressor.knee.value =
    (audience.compressorKneeBase ?? 18) +
    reverbDrive * (audience.compressorKneeReverbScale ?? 0.17);
  compressor.ratio.value = Math.min(
    audience.compressorRatioMax ?? 18,
    (audience.compressorRatioBase ?? 1.8) +
      suppressionDrive * (audience.compressorRatioSuppressionScale ?? 0.07) +
      layerBlend * (audience.compressorRatioLayerScale ?? 4.6),
  );
  compressor.attack.value = Math.max(
    audience.compressorAttackMin ?? 0.0015,
    (audience.compressorAttackBase ?? 0.017) -
      suppressionDrive * (audience.compressorAttackSuppressionScale ?? 0.00008) -
      layerBlend * (audience.compressorAttackLayerScale ?? 0.006),
  );
  compressor.release.value = Math.min(
    audience.compressorReleaseMax ?? 0.9,
    (audience.compressorReleaseBase ?? 0.16) +
      layerBlend * (audience.compressorReleaseLayerScale ?? 0.22) +
      suppressionDrive * (audience.compressorReleaseSuppressionScale ?? 0.003) +
      reverbDrive * (audience.compressorReleaseReverbScale ?? 0.0015),
  );

  const dryGain = context.createGain();
  dryGain.gain.value = adjustedVolume * Math.max(0.06, 1 - distanceBlend * 0.22) * audience.dryGain * directMixLevel;

  const dryTrimGain = context.createGain();
  dryTrimGain.gain.value = 1;

  const centerAnchorGain = context.createGain();
  centerAnchorGain.gain.value = centerImage.anchor;

  const panner = context.createStereoPanner();
  panner.pan.value = basePan;

  const stereoAnchorGain = context.createGain();
  stereoAnchorGain.gain.value = 1 - centerImage.anchor;

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
    centerAnchorGain,
    panner,
    stereoAnchorGain,
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
  dryTrimGain.connect(centerAnchorGain);
  centerAnchorGain.connect(mix);
  dryTrimGain.connect(panner);
  panner.connect(stereoAnchorGain);
  stereoAnchorGain.connect(mix);

  const earlySend = makeSendChain(context, compressor, earlyInput, {
    enabled: true,
    gainValue: sendValues.earlyGainValue,
    preDelaySeconds: getEarlyPreDelaySeconds({ room, audience, layerBlend, distanceBlend }),
    highpassHz: Math.max(110, 170 + distanceBlend * 125 + audience.directCutHz * 0.022 + (audience.wetHighpassBoostHz || 0) * 0.35 + room.wetToneCut * 0.03),
    lowpassHz: Math.max(1400, 10400 - distanceBlend * 1800 - audience.wetLowpassCut * 0.42 - room.earlyToneCut),
    lowShelfGainDb: (audience.wetLowShelfCutDb || 0) - Math.min(1.2, room.wetToneCut / 900),
    lowShelfFrequencyHz: 240,
    panValue: clamp(basePan * widthProfile.wet * (0.34 + distanceBlend * 0.08), -0.68, 0.68),
  }, cleanupNodes);

  const lateSend = makeSendChain(context, compressor, lateInput, {
    enabled: true,
    gainValue: sendValues.lateGainValue,
    preDelaySeconds: getLatePreDelaySeconds({ room, audience, layerBlend, distanceBlend }),
    lowpassHz: Math.max(220, 7600 - distanceBlend * 2500 - audience.wetLowpassCut - room.lateToneCut),
    highpassHz: Math.max(140, 200 + distanceBlend * 150 + audience.directCutHz * 0.04 + (audience.wetHighpassBoostHz || 0) * 0.82 + room.wetToneCut * 0.03),
    highpassQ: 0.62,
    lowShelfGainDb: (audience.wetLowShelfCutDb || 0) - Math.min(2.2, room.wetToneCut / 520),
    lowShelfFrequencyHz: 260,
    panValue: clamp(basePan * widthProfile.wet * (0.18 + distanceBlend * 0.18), -0.54, 0.54),
  }, cleanupNodes);

  const diffusionSend = makeSendChain(context, compressor, diffusionInput, {
    enabled: complexity.allowDiffusion && safe.diffusionAmount > 0,
    gainValue: sendValues.diffusionGainValue,
    lowpassHz: Math.max(700, audience.diffusionCutHz - distanceBlend * (audience.diffusionCutDistanceScale ?? 420) - layerBlend * (audience.diffusionCutLayerScale ?? 320)),
    highpassHz: Math.max(
      130,
      (audience.diffusionHighpassBaseHz ?? 170) +
        distanceBlend * (audience.diffusionHighpassDistanceScale ?? 85) +
        audience.directCutHz * (audience.diffusionHighpassDirectScale ?? 0.028) +
        (audience.wetHighpassBoostHz || 0) * (audience.diffusionHighpassWetBoostScale ?? 0.6),
    ),
    lowShelfGainDb: (audience.wetLowShelfCutDb || 0) * 0.85,
    panValue: clamp(
      basePan * widthProfile.wet * ((audience.diffusionPanBase ?? 0.22) + distanceBlend * (audience.diffusionPanDistanceScale ?? 0.12)),
      -0.62,
      0.62,
    ),
  }, cleanupNodes);

  const smearSend = makeSendChain(context, compressor, smearInput, {
    enabled: safe.auxiliaryAmount > 0,
    gainValue: sendValues.smearGainValue,
    preDelaySeconds: Math.max(
      0,
      (layerBlend * (audience.smearPreDelayLayerMs ?? 10) +
        safe.delayMs * audience.delayScale * (room.layerDelayScale ?? 1) * (audience.smearPreDelayDelayScale ?? 0.012)) / 1000,
    ),
    lowpassHz: Math.max(420, (audience.smearLowpassBaseHz ?? 6900) - audience.smearCutHz - layerBlend * (audience.smearLowpassLayerScale ?? 900)),
    highpassHz: Math.max(
      120,
      (audience.smearHighpassBaseHz ?? 150) +
        distanceBlend * (audience.smearHighpassDistanceScale ?? 78) +
        audience.directCutHz * (audience.smearHighpassDirectScale ?? 0.024),
    ),
    highpassQ: 0.54,
    panValue: clamp(
      basePan * widthProfile.wet * ((audience.smearPanBase ?? 0.32) + distanceBlend * (audience.smearPanDistanceScale ?? 0.08)),
      -0.84,
      0.84,
    ),
  }, cleanupNodes);

  const blurSend = makeSendChain(context, compressor, blurInput, {
    enabled: safe.auxiliaryAmount > 0,
    gainValue: sendValues.blurGainValue,
    preDelaySeconds: Math.max(0, layerBlend * (audience.blurPreDelayLayerMs ?? 4.5) / 1000),
    bandpassHz: (audience.blurBandpassBaseHz ?? 2200) + layerBlend * (audience.blurBandpassLayerScale ?? 360),
    bandpassQ: 0.72,
    lowpassHz: Math.max(1400, (audience.blurLowpassBaseHz ?? 5600) - audience.directCutHz * (audience.blurLowpassDirectScale ?? 0.5)),
    panValue: clamp(basePan * widthProfile.wet * (audience.blurPanScale ?? 0.2), -0.72, 0.72),
  }, cleanupNodes);

  const reflectionSend = makeSendChain(context, compressor, reflectionInput, {
    enabled: safe.auxiliaryAmount > 0,
    gainValue: sendValues.reflectionGainValue,
    preDelaySeconds: Math.max(0, (layerBlend * 12 + index * 2.5 + safe.delayMs * audience.delayScale * (room.layerDelayScale ?? 1) * 0.02) / 1000),
    lowpassHz: Math.max(1200, 9000 - layerBlend * 1200),
    highpassHz: Math.max(170, 220 + distanceBlend * 155 + audience.directCutHz * 0.04 + (audience.wetHighpassBoostHz || 0) * 0.9),
    highpassQ: 0.6,
    lowShelfGainDb: (audience.wetLowShelfCutDb || 0) * 1.1,
    panValue: getReflectionPan(basePan, index, room.reflectionWidth * widthProfile.reflection),
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
    centerAnchorGain,
    panner,
    stereoAnchorGain,
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
  adaptiveWetMix = 1,
}) {
  const index = layer.index;
  const layerState = computeLayerState({
    room,
    audience,
    audienceTrack,
    safe,
    adaptiveWetMix,
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
    widthProfile,
    centerImage,
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

  setAudioParam(layer.delay.delayTime, getLayerDelaySeconds(safe, audience, room, index), context);
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
  setAudioParam(
    layer.airPresenceShelf.gain,
    -(
      airAbsorptionDrive * (
        (audience.airPresenceAbsorptionScale ?? 2.6) +
        audience.extraHighCut * (audience.airPresenceExtraHighCutScale ?? 1.8)
      ) +
      audience.articulationCutHz / (audience.airPresenceArticulationScale ?? 2600)
    ) +
      leadClarity * (audience.airPresenceLeadScale ?? 0.28),
    context,
  );
  setAudioParam(
    layer.airBrillianceShelf.gain,
    -(
      airAbsorptionDrive * (
        (audience.airBrillianceAbsorptionScale ?? 5.4) +
        room.distanceEq * (audience.airBrillianceRoomEqScale ?? 1.8) +
        audience.extraHighCut * (audience.airBrillianceExtraHighCutScale ?? 3.4)
      ) +
      audience.directCutHz / (audience.airBrillianceDirectCutScale ?? 1200)
    ) +
      leadClarity * (audience.airBrillianceLeadScale ?? 0.18),
    context,
  );
  setAudioParam(
    layer.presenceDip.gain,
    audience.presenceDipDb * (0.72 + layerBlend * (audience.presenceLayerScale ?? 0.42)) +
      leadClarity * (audience.presenceLeadScale ?? 0.55),
    context,
  );
  setAudioParam(
    layer.transientDip.gain,
    audience.transientDipDb * (0.96 + layerBlend * (audience.transientLayerScale ?? 0.28)) +
      leadClarity * (audience.transientLeadScale ?? 0.72),
    context,
  );
  setAudioParam(layer.lowShelf.gain, -distanceBlend * (3.8 + audience.directCutHz * 0.0012), context);
  setAudioParam(
    layer.compressor.threshold,
    (audience.compressorThresholdBase ?? -15) -
      suppressionDrive * (audience.compressorThresholdSuppressionScale ?? 0.085) -
      layerBlend * (audience.compressorThresholdLayerScale ?? 8.5),
    context,
  );
  setAudioParam(
    layer.compressor.knee,
    (audience.compressorKneeBase ?? 18) +
      reverbDrive * (audience.compressorKneeReverbScale ?? 0.17),
    context,
  );
  setAudioParam(
    layer.compressor.ratio,
    Math.min(
      audience.compressorRatioMax ?? 18,
      (audience.compressorRatioBase ?? 1.8) +
        suppressionDrive * (audience.compressorRatioSuppressionScale ?? 0.07) +
        layerBlend * (audience.compressorRatioLayerScale ?? 4.6),
    ),
    context,
  );
  setAudioParam(
    layer.compressor.attack,
    Math.max(
      audience.compressorAttackMin ?? 0.0015,
      (audience.compressorAttackBase ?? 0.017) -
        suppressionDrive * (audience.compressorAttackSuppressionScale ?? 0.00008) -
        layerBlend * (audience.compressorAttackLayerScale ?? 0.006),
    ),
    context,
  );
  setAudioParam(
    layer.compressor.release,
    Math.min(
      audience.compressorReleaseMax ?? 0.9,
      (audience.compressorReleaseBase ?? 0.16) +
        layerBlend * (audience.compressorReleaseLayerScale ?? 0.22) +
        suppressionDrive * (audience.compressorReleaseSuppressionScale ?? 0.003) +
        reverbDrive * (audience.compressorReleaseReverbScale ?? 0.0015),
    ),
    context,
  );
  setAudioParam(layer.dryGain.gain, adjustedVolume * Math.max(0.06, 1 - distanceBlend * 0.22) * audience.dryGain * directMixLevel, context);
  setAudioParam(layer.centerAnchorGain.gain, centerImage.anchor, context);
  setAudioParam(layer.panner.pan, basePan, context);
  setAudioParam(layer.stereoAnchorGain.gain, 1 - centerImage.anchor, context);

  setAudioParam(layer.earlySend.gain.gain, sendValues.earlyGainValue, context);
  setAudioParam(
    layer.earlySend.preDelay?.delayTime,
    getEarlyPreDelaySeconds({ room, audience, layerBlend, distanceBlend }),
    context,
  );
  setAudioParam(layer.earlySend.highpass?.frequency, Math.max(110, 170 + distanceBlend * 125 + audience.directCutHz * 0.022 + (audience.wetHighpassBoostHz || 0) * 0.35 + room.wetToneCut * 0.03), context);
  setAudioParam(layer.earlySend.lowpass?.frequency, Math.max(1400, 10400 - distanceBlend * 1800 - audience.wetLowpassCut * 0.42 - room.earlyToneCut), context);
  setAudioParam(layer.earlySend.lowShelf?.gain, (audience.wetLowShelfCutDb || 0) - Math.min(1.2, room.wetToneCut / 900), context);
  setAudioParam(layer.earlySend.panner?.pan, clamp(basePan * widthProfile.wet * (0.34 + distanceBlend * 0.08), -0.68, 0.68), context);

  setAudioParam(layer.lateSend.gain.gain, sendValues.lateGainValue, context);
  setAudioParam(
    layer.lateSend.preDelay?.delayTime,
    getLatePreDelaySeconds({ room, audience, layerBlend, distanceBlend }),
    context,
  );
  setAudioParam(layer.lateSend.lowpass?.frequency, Math.max(220, 7600 - distanceBlend * 2500 - audience.wetLowpassCut - room.lateToneCut), context);
  setAudioParam(layer.lateSend.highpass?.frequency, Math.max(140, 200 + distanceBlend * 150 + audience.directCutHz * 0.04 + (audience.wetHighpassBoostHz || 0) * 0.82 + room.wetToneCut * 0.03), context);
  setAudioParam(layer.lateSend.lowShelf?.gain, (audience.wetLowShelfCutDb || 0) - Math.min(2.2, room.wetToneCut / 520), context);
  setAudioParam(layer.lateSend.panner?.pan, clamp(basePan * widthProfile.wet * (0.18 + distanceBlend * 0.18), -0.54, 0.54), context);

  setAudioParam(layer.diffusionSend.gain?.gain, sendValues.diffusionGainValue, context);
  setAudioParam(
    layer.diffusionSend.lowpass?.frequency,
    Math.max(700, audience.diffusionCutHz - distanceBlend * (audience.diffusionCutDistanceScale ?? 420) - layerBlend * (audience.diffusionCutLayerScale ?? 320)),
    context,
  );
  setAudioParam(
    layer.diffusionSend.highpass?.frequency,
    Math.max(
      130,
      (audience.diffusionHighpassBaseHz ?? 170) +
        distanceBlend * (audience.diffusionHighpassDistanceScale ?? 85) +
        audience.directCutHz * (audience.diffusionHighpassDirectScale ?? 0.028) +
        (audience.wetHighpassBoostHz || 0) * (audience.diffusionHighpassWetBoostScale ?? 0.6),
    ),
    context,
  );
  setAudioParam(layer.diffusionSend.lowShelf?.gain, (audience.wetLowShelfCutDb || 0) * 0.85, context);
  setAudioParam(
    layer.diffusionSend.panner?.pan,
    clamp(
      basePan * widthProfile.wet * ((audience.diffusionPanBase ?? 0.22) + distanceBlend * (audience.diffusionPanDistanceScale ?? 0.12)),
      -0.62,
      0.62,
    ),
    context,
  );

  setAudioParam(layer.smearSend.gain?.gain, sendValues.smearGainValue, context);
  setAudioParam(
    layer.smearSend.preDelay?.delayTime,
    Math.max(
      0,
      (layerBlend * (audience.smearPreDelayLayerMs ?? 10) +
        safe.delayMs * audience.delayScale * (room.layerDelayScale ?? 1) * (audience.smearPreDelayDelayScale ?? 0.012)) / 1000,
    ),
    context,
  );
  setAudioParam(
    layer.smearSend.panner?.pan,
    clamp(
      basePan * widthProfile.wet * ((audience.smearPanBase ?? 0.32) + distanceBlend * (audience.smearPanDistanceScale ?? 0.08)),
      -0.84,
      0.84,
    ),
    context,
  );

  setAudioParam(layer.blurSend.gain?.gain, sendValues.blurGainValue, context);
  setAudioParam(
    layer.blurSend.panner?.pan,
    clamp(basePan * widthProfile.wet * (audience.blurPanScale ?? 0.2), -0.72, 0.72),
    context,
  );

  setAudioParam(layer.reflectionSend.gain?.gain, sendValues.reflectionGainValue, context);
  setAudioParam(layer.reflectionSend.preDelay?.delayTime, Math.max(0, (layerBlend * 12 + index * 2.5 + safe.delayMs * audience.delayScale * (room.layerDelayScale ?? 1) * 0.02) / 1000), context);
  setAudioParam(layer.reflectionSend.panner?.pan, getReflectionPan(basePan, index, room.reflectionWidth * widthProfile.reflection), context);
}

export function updateLayerAdaptiveWetness({
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
  adaptiveWetCacheEntry = null,
  adaptiveWetMix = 1,
}) {
  let earlyGainValue = 0;
  let lateGainValue = 0;
  let reflectionGainValue = 0;

  if (adaptiveWetCacheEntry) {
    earlyGainValue = Math.min(
      0.26,
      adaptiveWetCacheEntry.earlyWetFactor * adaptiveWetMix * clamp(0.94 + (adaptiveWetMix - 1) * 0.45, 0.9, 1.04),
    );
    lateGainValue = Math.min(0.34, adaptiveWetCacheEntry.lateWetFactor * adaptiveWetMix);
    reflectionGainValue =
      adaptiveWetCacheEntry.reflectionWetFactor * clamp(0.92 + (adaptiveWetMix - 1) * 0.6, 0.88, 1.05);
  } else {
    const index = layer.index;
    const layerState = computeLayerState({
      room,
      audience,
      audienceTrack,
      safe,
      adaptiveWetMix,
      trackCount,
      index,
      complexity,
      reflectionPattern,
      layerCache,
      layerVariationCache,
    });
    const sendValues = computeSendValues({
      room,
      audience,
      safe,
      trackCount,
      index,
      complexity,
      layerState,
    });
    earlyGainValue = sendValues.earlyGainValue;
    lateGainValue = sendValues.lateGainValue;
    reflectionGainValue = sendValues.reflectionGainValue;
  }

  setAudioParam(layer.earlySend.gain.gain, earlyGainValue, context);
  setAudioParam(layer.lateSend.gain.gain, lateGainValue, context);
  setAudioParam(layer.reflectionSend.gain?.gain, reflectionGainValue, context);
}
