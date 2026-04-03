import { clamp, getAudienceTrackProfile } from "../../lib/presets.js";
import {
  getAuxiliaryTapCount,
  getLayerBlend,
  getLayerVariation,
  getPanPosition,
  getTrackEffectStrength,
  getTrackVolume,
} from "./effects.js";
import { getAudienceWidthProfile, getCenterImageProfile } from "./layer-utils.js";

export function computeLayerState({
  room,
  audience,
  audienceTrack,
  safe,
  adaptiveWetMix = 1,
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
  const leadClarity = audienceTrack.clarityBoost || 0;
  const widthProfile = getAudienceWidthProfile(audience, layerBlend, distanceBlend);
  const centerImage = getCenterImageProfile(audience, layerBlend, distanceBlend, leadClarity);
  const basePan = clamp(
    (getPanPosition(index, trackCount, room.stereoWidth * audience.stereoWidth * widthProfile.direct) + variation.panOffset) * centerImage.panScale,
    -0.84,
    0.84,
  );
  const adjustedVolume = trackVolume * audienceTrack.volumeScale * variation.gainScale;
  const leadWetProtect = clamp(
    1 -
      leadClarity * (audience.leadWetProtectLeadWeight ?? 0.12) -
      (1 - layerBlend) * (audience.leadWetProtectLayerWeight ?? 0.08) -
      centerImage.anchor * (audience.leadWetProtectAnchorWeight ?? 0.16),
    audience.leadWetProtectMin ?? 0.62,
    1,
  );
  const directFocusBoost = clamp(
    1 +
      leadClarity * (audience.directFocusLeadWeight ?? 0.08) +
      (1 - layerBlend) * (audience.directFocusLayerWeight ?? 0.04) +
      centerImage.anchor * (audience.directFocusAnchorWeight ?? 0.08),
    1,
    audience.directFocusMax ?? 1.22,
  );
  const directMixLevel = audience.directMixTrim * Math.max(0.82, 1 - layerBlend * 0.12) * directFocusBoost;
  const wetMixTrim = audienceTrack.wetMixTrim || 0;
  const airAbsorptionDrive = distanceBlend * (0.9 + room.distanceEq * 0.35) + audience.extraHighCut * 0.42;
  const dynamicWetTrim = clamp(
    1 - (
      (audience.dynamicWetTrimStrength || 0) * (
        distanceBlend * (audience.dynamicWetTrimDistanceScale ?? 0.52) +
        (reverbDrive / 100) * (audience.dynamicWetTrimReverbScale ?? 0.26) +
        clamp(adjustedVolume, 0, 1.5) * (audience.dynamicWetTrimVolumeScale ?? 0.18) +
        layerBlend * (audience.dynamicWetTrimLayerScale ?? 0.08)
      )
    ),
    audience.dynamicWetTrimMin ?? 0.56,
    1,
  );
  const reflectionDensity = reflectionPattern.length / Math.max(1, room.earlyReflections.length);
  const reflectionTapCount = getAuxiliaryTapCount(room.earlyReflections.length, trackCount, layerBlend, 1, complexity.tapDensityScale);
  const wetMix = Math.max(
    0,
    room.wetMix *
      audience.wetMix *
      adaptiveWetMix *
      leadWetProtect *
      dynamicWetTrim *
      (1 + wetMixTrim) *
      (reverbDrive / 100) *
      ((audience.wetMixReverbBase ?? 0.48) + reverbDrive / (audience.wetMixReverbScale ?? 92)) *
      ((audience.wetMixLayerBase ?? 0.42) + layerBlend * (audience.wetMixLayerScale ?? 0.78)),
  );

  return {
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
    leadWetProtect,
    wetMixTrim,
    leadClarity,
    airAbsorptionDrive,
    dynamicWetTrim,
    reflectionDensity,
    reflectionTapCount,
    wetMix,
    adaptiveWetMix,
  };
}

export function computeAdaptiveWetFactors({
  room,
  audience,
  safe,
  trackCount,
  complexity,
  layerState,
}) {
  const {
    layerBlend,
    distanceBlend,
    widthProfile,
    adjustedVolume,
    dynamicWetTrim,
    reflectionDensity,
    reflectionTapCount,
    wetMix,
    adaptiveWetMix,
  } = layerState;
  const reflectionDepthTrim = clamp(
    1 - (audience.reflectionDepthTrimStrength || 0) * Math.pow(layerBlend, 1.15),
    0.42,
    1,
  );
  return {
    earlyWetFactor:
      (wetMix / Math.max(0.0001, adaptiveWetMix)) *
      room.earlyWetMix *
      (audience.earlyTailBase ?? 0.48) *
      audience.tailGainScale *
      Math.max(audience.earlyTailWetTrimFloor ?? 0.72, dynamicWetTrim) *
      Math.max(
        audience.earlyTailDistanceFloor ?? 0.58,
        (audience.earlyTailDistanceBase ?? 0.96) - distanceBlend * (audience.earlyTailDistanceScale ?? 0.16),
      ),
    lateWetFactor:
      (wetMix / Math.max(0.0001, adaptiveWetMix)) *
      room.lateWetMix *
      (audience.lateTailBase ?? 0.58) *
      audience.tailGainScale *
      dynamicWetTrim *
      ((audience.lateTailDistanceBase ?? 0.72) + distanceBlend * (audience.lateTailDistanceScale ?? 0.16)) *
      complexity.lateWetScale,
    reflectionWetFactor:
      adjustedVolume *
      (safe.auxiliaryAmount / 100) *
      Math.max(0.02, 0.18 * reflectionDensity) *
      Math.max(0.18, 1 - distanceBlend * 0.28) *
      (0.7 + layerBlend * 0.45) *
      audience.reflectionBoost *
      dynamicWetTrim *
      reflectionDepthTrim *
      Math.max(0.3, reflectionTapCount / Math.max(1, room.earlyReflections.length)) *
      widthProfile.reflection,
  };
}

export function computeSendValues({
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
    adaptiveWetMix,
  } = layerState;

  const smearDensity = audience.smearTapMs.length
    ? getAuxiliaryTapCount(audience.smearTapMs.length, trackCount, layerBlend, 2, complexity.tapDensityScale) / audience.smearTapMs.length
    : 0;
  const blurDensity = audience.transientBlurTapMs.length
    ? getAuxiliaryTapCount(audience.transientBlurTapMs.length, trackCount, layerBlend, 1, complexity.tapDensityScale) / audience.transientBlurTapMs.length
    : 0;
  const adaptiveWetFactors = computeAdaptiveWetFactors({
    room,
    audience,
    safe,
    trackCount,
    complexity,
    layerState,
  });

  return {
    earlyGainValue: Math.min(
      0.26,
      adaptiveWetFactors.earlyWetFactor * adaptiveWetMix * clamp(0.94 + (adaptiveWetMix - 1) * 0.45, 0.9, 1.04),
    ),
    lateGainValue: Math.min(0.34, adaptiveWetFactors.lateWetFactor * adaptiveWetMix),
    diffusionGainValue: complexity.allowDiffusion
      ? Math.min(
          audience.diffusionGainCap ?? 0.28,
          audience.diffusionMix *
            (safe.diffusionAmount / 100) *
            ((audience.diffusionDriveBase ?? 0.42) + reverbDrive / (audience.diffusionDriveReverbScale ?? 110)) *
            ((audience.diffusionDistanceBase ?? 0.62) + distanceBlend * (audience.diffusionDistanceScale ?? 0.42)) *
            Math.max(audience.diffusionWetTrimFloor ?? 0.7, dynamicWetTrim),
        )
      : 0,
    smearGainValue:
      adjustedVolume *
      (safe.auxiliaryAmount / 100) *
      audience.smearGain *
      Math.max(audience.smearDensityFloor ?? 0.03, (audience.smearDensityScale ?? 0.14) * smearDensity) *
      ((audience.smearLayerBase ?? 0.78) + layerBlend * (audience.smearLayerScale ?? 0.22)),
    blurGainValue:
      adjustedVolume *
      (safe.auxiliaryAmount / 100) *
      audience.transientBlurGain *
      Math.max(audience.blurDensityFloor ?? 0.03, (audience.blurDensityScale ?? 0.11) * blurDensity) *
      ((audience.blurLayerBase ?? 0.82) + layerBlend * (audience.blurLayerScale ?? 0.18)),
    reflectionGainValue:
      adaptiveWetFactors.reflectionWetFactor * clamp(0.92 + (adaptiveWetMix - 1) * 0.6, 0.88, 1.05),
    adaptiveWetFactors,
  };
}

export function buildLayerAdaptiveWetCache({
  room,
  audience,
  safe,
  trackCount,
  complexity,
  reflectionPattern,
  layerCache,
  layerVariationCache,
}) {
  const cache = [];
  for (let index = 0; index < trackCount; index += 1) {
    const audienceTrack = layerCache.audienceTracks[index];
    const layerState = computeLayerState({
      room,
      audience,
      audienceTrack,
      safe,
      adaptiveWetMix: 1,
      trackCount,
      index,
      complexity,
      reflectionPattern,
      layerCache,
      layerVariationCache,
    });
    cache.push(computeAdaptiveWetFactors({
      room,
      audience,
      safe,
      trackCount,
      complexity,
      layerState,
    }));
  }
  return cache;
}

export function buildLayerVariationCache(variationSeedBase, trackCount, roomPreset, audiencePreset) {
  const totalTracks = Math.max(1, trackCount || 1);
  const cache = [];
  for (let index = 0; index < totalTracks; index += 1) {
    cache.push(getLayerVariation(variationSeedBase, index, totalTracks, roomPreset, audiencePreset));
  }
  return cache;
}

export function buildLayerComputationCache(trackCount, baseVolume, volumeDecay, reverbIntensity, peakSuppression, audiencePosition, room = null) {
  const totalTracks = Math.max(1, trackCount || 1);
  const adjustedVolumeDecay = clamp(volumeDecay + (room?.layerDecayBias ?? 0), 0, 100);
  const cache = {
    layerBlends: [],
    trackVolumes: [],
    audienceTracks: [],
    reverbStrengths: [],
    suppressionStrengths: [],
  };

  for (let index = 0; index < totalTracks; index += 1) {
    const layerBlend = getLayerBlend(index, totalTracks);
    const audienceTrack = getAudienceTrackProfile(audiencePosition, index, totalTracks);
    const trackVolume = getTrackVolume(baseVolume, adjustedVolumeDecay, index);
    cache.layerBlends.push(layerBlend);
    cache.trackVolumes.push(trackVolume);
    cache.audienceTracks.push(audienceTrack);
    cache.reverbStrengths.push(clamp(getTrackEffectStrength(reverbIntensity, index) + audienceTrack.reverbExtra, 0, 100));
    cache.suppressionStrengths.push(clamp(getTrackEffectStrength(peakSuppression, index) + audienceTrack.suppressionExtra, 0, 100));
  }

  return cache;
}
