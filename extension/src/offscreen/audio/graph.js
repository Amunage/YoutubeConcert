import { clamp, getAudiencePresetConfig, getRoomPresetConfig, withDefaults } from "../../lib/presets.js";
import { ensureSharedEffectBus, syncSharedEffectBusUsage } from "./buses.js";
import { createDisconnectCleanup, getAuxiliaryTapCount, getComplexityProfile, shrinkPattern } from "./effects.js";
import { buildLayerChain, buildLayerComputationCache, buildLayerVariationCache, updateLayerChain } from "./layers.js";
import { configureMasterOutput, updateMasterOutput } from "./output.js";

function createDetachedSendTarget(context, nodes) {
  const input = context.createGain();
  nodes.push(input);
  return { input };
}

function buildAudienceSettings(safe) {
  const audienceBase = getAudiencePresetConfig(safe.audiencePreset);
  return {
    ...audienceBase,
    directMixTrim: audienceBase.directMixTrim * clamp(safe.directMixTrim, 0, 200) / 100,
    preDelayScale: audienceBase.preDelayScale * clamp(safe.preDelayScale, 0, 200) / 100,
    tailGainScale: audienceBase.tailGainScale * clamp(safe.tailGainScale, 0, 200) / 100,
    reflectionSpacing: audienceBase.reflectionSpacing * clamp(safe.reflectionSpacing, 0, 200) / 100,
    dynamicWetTrimStrength: audienceBase.dynamicWetTrimStrength * clamp(safe.dynamicWetTrimStrength, 0, 200) / 100,
  };
}

const PARTIAL_UPDATE_KEYS = [
  "ensembleVolume",
  "volumeDecay",
  "delayMs",
  "reverbIntensity",
  "peakSuppression",
  "directMixTrim",
  "preDelayScale",
  "tailGainScale",
  "dynamicWetTrimStrength",
];

export function canUpdateLiveConcertGraphInPlace(graph, previousSettings, nextSettings) {
  const prev = withDefaults(previousSettings);
  const next = withDefaults(nextSettings);
  const partialKeys = new Set(PARTIAL_UPDATE_KEYS);
  const canReuseDiffusionBus = Boolean(graph?.hasDiffusionBus);
  const canReuseAuxiliaryBuses = Boolean(graph?.hasSmearBus || graph?.hasBlurBus || graph?.hasReflectionBus);
  if ((prev.diffusionAmount !== next.diffusionAmount) && (next.diffusionAmount === 0 || canReuseDiffusionBus)) {
    partialKeys.add("diffusionAmount");
  }
  if ((prev.auxiliaryAmount !== next.auxiliaryAmount) && (next.auxiliaryAmount === 0 || canReuseAuxiliaryBuses)) {
    partialKeys.add("auxiliaryAmount");
  }
  const keysToCompare = Object.keys(next).filter((key) => !partialKeys.has(key));
  return keysToCompare.every((key) => prev[key] === next[key]);
}

export function createLiveConcertGraph(context, settings) {
  const safe = withDefaults(settings);
  const room = getRoomPresetConfig(safe.roomPreset);
  const audience = buildAudienceSettings(safe);
  const trackCount = clamp(safe.cloneCount, 1, 8);
  const outputLevel = 0.78;
  const originalMix = 0.18;
  const complexity = getComplexityProfile(trackCount, safe.roomPreset, safe.audiencePreset, safe.reverbIntensity);
  const localNodes = [];
  const layerCache = buildLayerComputationCache(
    trackCount,
    safe.ensembleVolume,
    safe.volumeDecay,
    safe.reverbIntensity,
    safe.peakSuppression,
    safe.audiencePreset,
  );
  const layerVariationCache = buildLayerVariationCache("live", trackCount, safe.roomPreset, safe.audiencePreset);

  const input = context.createGain();
  const originalGain = context.createGain();
  const processedInput = context.createGain();
  const mix = context.createGain();
  localNodes.push(input, originalGain, processedInput, mix);

  originalGain.gain.value = originalMix;
  input.connect(originalGain);
  originalGain.connect(mix);
  input.connect(processedInput);

  const diffusionPattern = shrinkPattern(
    audience.diffusionTimesMs,
    getAuxiliaryTapCount(audience.diffusionTimesMs.length, trackCount, 0.5, 2, complexity.tapDensityScale),
  );
  const smearPattern = shrinkPattern(
    audience.smearTapMs,
    getAuxiliaryTapCount(audience.smearTapMs.length, trackCount, 0.5, 2, complexity.tapDensityScale),
  );
  const blurPattern = shrinkPattern(
    audience.transientBlurTapMs,
    getAuxiliaryTapCount(audience.transientBlurTapMs.length, trackCount, 0.5, 1, complexity.tapDensityScale),
  );
  const reflectionPattern = shrinkPattern(
    room.earlyReflections,
    getAuxiliaryTapCount(room.earlyReflections.length, trackCount, 0.5, 1, complexity.tapDensityScale),
  );

  const activeKinds = ["early", "late"];
  const earlyBus = ensureSharedEffectBus("early", { preset: room, roomPreset: safe.roomPreset }, context);
  const lateBus = ensureSharedEffectBus("late", { preset: room, roomPreset: safe.roomPreset }, context);

  let diffusionBus = null;
  if (complexity.allowDiffusion && safe.diffusionAmount > 0 && diffusionPattern.length) {
    activeKinds.push("diffusion");
    diffusionBus = ensureSharedEffectBus("diffusion", {
      roomPreset: safe.roomPreset,
      audiencePreset: safe.audiencePreset,
      timesMs: diffusionPattern,
      feedback: audience.diffusionFeedback,
      cutoffHz: audience.diffusionCutHz,
      stereoSpread: audience.stereoWidth * 0.12,
    }, context);
  }

  let smearBus = null;
  let blurBus = null;
  let reflectionBus = null;
  if (safe.auxiliaryAmount > 0) {
    if (smearPattern.length) {
      activeKinds.push("smear");
      smearBus = ensureSharedEffectBus("smear", {
        roomPreset: safe.roomPreset,
        audiencePreset: safe.audiencePreset,
        tapTimesMs: smearPattern,
        cutHz: audience.smearCutHz,
        stereoWidth: audience.stereoWidth,
      }, context);
    }
    if (blurPattern.length) {
      activeKinds.push("blur");
      blurBus = ensureSharedEffectBus("blur", {
        roomPreset: safe.roomPreset,
        audiencePreset: safe.audiencePreset,
        tapTimesMs: blurPattern,
        directCutHz: audience.directCutHz,
      }, context);
    }
    if (reflectionPattern.length) {
      activeKinds.push("reflection");
      reflectionBus = ensureSharedEffectBus("reflection", {
        roomPreset: safe.roomPreset,
        audiencePreset: safe.audiencePreset,
        reflections: reflectionPattern,
        spacing: audience.reflectionSpacing,
        stereoWidth: room.reflectionWidth,
        reflectionBoost: audience.reflectionBoost,
      }, context);
    }
  }

  syncSharedEffectBusUsage(activeKinds, context);

  const earlyInput = earlyBus?.input ?? createDetachedSendTarget(context, localNodes).input;
  const lateInput = lateBus?.input ?? createDetachedSendTarget(context, localNodes).input;
  const diffusionInput = diffusionBus?.input ?? createDetachedSendTarget(context, localNodes).input;
  const smearInput = smearBus?.input ?? createDetachedSendTarget(context, localNodes).input;
  const blurInput = blurBus?.input ?? createDetachedSendTarget(context, localNodes).input;
  const reflectionInput = reflectionBus?.input ?? createDetachedSendTarget(context, localNodes).input;

  const layerNodes = [];
  for (let index = 0; index < trackCount; index += 1) {
    const layer = buildLayerChain({
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
      audienceTrack: layerCache.audienceTracks[index],
      safe,
      trackCount,
      index,
      complexity,
      reflectionPattern,
      layerCache,
      layerVariationCache,
    });
    layerNodes.push(layer);
    localNodes.push(...(layer.cleanupNodes || []));
  }

  configureMasterOutput({ mix, outputLevel, peakSuppression: safe.peakSuppression, trackCount, context });

  return {
    input,
    mix,
    originalGain,
    trackCount,
    layerNodes,
    room,
    audience,
    complexity,
    reflectionPattern,
    layerCache,
    layerVariationCache,
    settings: safe,
    hasDiffusionBus: Boolean(diffusionBus),
    hasSmearBus: Boolean(smearBus),
    hasBlurBus: Boolean(blurBus),
    hasReflectionBus: Boolean(reflectionBus),
    cleanup: createDisconnectCleanup(localNodes),
  };
}

export function updateLiveConcertGraph(context, graph, settings) {
  const safe = withDefaults(settings);
  const room = getRoomPresetConfig(safe.roomPreset);
  const audience = buildAudienceSettings(safe);
  const trackCount = clamp(safe.cloneCount, 1, 8);
  const complexity = getComplexityProfile(trackCount, safe.roomPreset, safe.audiencePreset, safe.reverbIntensity);
  const layerCache = buildLayerComputationCache(
    trackCount,
    safe.ensembleVolume,
    safe.volumeDecay,
    safe.reverbIntensity,
    safe.peakSuppression,
    safe.audiencePreset,
  );

  graph.layerNodes.forEach((layer, index) => {
    updateLayerChain({
      context,
      layer,
      room,
      audience,
      audienceTrack: layerCache.audienceTracks[index],
      safe,
      trackCount,
      complexity,
      reflectionPattern: graph.reflectionPattern,
      layerCache,
      layerVariationCache: graph.layerVariationCache,
    });
  });

  updateMasterOutput({
    outputLevel: 0.78,
    peakSuppression: safe.peakSuppression,
    trackCount,
    context,
  });

  graph.room = room;
  graph.audience = audience;
  graph.complexity = complexity;
  graph.layerCache = layerCache;
  graph.settings = safe;
  graph.trackCount = trackCount;
}
