import { ROOM_PRESETS } from "./room-presets.js";
import { AUDIENCE_PRESETS } from "./audience-presets.js";
import {
  clamp,
  getAudiencePresetNameForPosition,
  normalizeAudiencePosition,
  normalizeEarlyReflectionSet,
  normalizeRoomPresetName,
} from "./preset-utils.js";

function interpolateTrackFactorEntry(fromEntry, toEntry, t) {
  const fromBase = fromEntry?.base ?? 0;
  const toBase = toEntry?.base ?? 0;
  const fromFront = fromEntry?.front ?? 0;
  const toFront = toEntry?.front ?? 0;
  const fromRear = fromEntry?.rear ?? 0;
  const toRear = toEntry?.rear ?? 0;
  const fromMin = fromEntry?.min;
  const toMin = toEntry?.min;
  return {
    base: fromBase + (toBase - fromBase) * t,
    front: fromFront + (toFront - fromFront) * t,
    rear: fromRear + (toRear - fromRear) * t,
    min:
      fromMin === null || toMin === null || fromMin === undefined || toMin === undefined
        ? (t < 0.5 ? fromMin : toMin) ?? null
        : fromMin + (toMin - fromMin) * t,
  };
}

function sampleInterpolatedNumberArray(values, indexRatio) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }
  if (values.length === 1) {
    return values[0];
  }
  const scaledIndex = clamp(indexRatio, 0, 1) * (values.length - 1);
  const leftIndex = Math.floor(scaledIndex);
  const rightIndex = Math.min(values.length - 1, leftIndex + 1);
  const blend = scaledIndex - leftIndex;
  const leftValue = Number(values[leftIndex]) || 0;
  const rightValue = Number(values[rightIndex]) || 0;
  return leftValue + (rightValue - leftValue) * blend;
}

function interpolateNumberArrays(fromValues, toValues, t) {
  const fromArray = Array.isArray(fromValues) ? fromValues : [];
  const toArray = Array.isArray(toValues) ? toValues : [];
  if (!fromArray.length && !toArray.length) {
    return [];
  }
  const targetLength = Math.max(
    1,
    Math.round(fromArray.length + ((toArray.length || fromArray.length) - fromArray.length) * t),
  );
  const result = [];
  for (let index = 0; index < targetLength; index += 1) {
    const ratio = targetLength <= 1 ? 0 : index / (targetLength - 1);
    const fromValue = sampleInterpolatedNumberArray(fromArray.length ? fromArray : toArray, ratio);
    const toValue = sampleInterpolatedNumberArray(toArray.length ? toArray : fromArray, ratio);
    result.push(fromValue + (toValue - fromValue) * t);
  }
  return result;
}

function getAudiencePresetConfig(presetName) {
  return AUDIENCE_PRESETS[presetName] || AUDIENCE_PRESETS.mid;
}

function interpolateTrackFactors(position) {
  const safePosition = normalizeAudiencePosition(position);
  const segment =
    safePosition >= 10
      ? { start: 10, end: 10, from: "outside", to: "outside" }
      : safePosition >= 7
        ? { start: 7, end: 10, from: "rear", to: "outside" }
        : safePosition >= 4
          ? { start: 4, end: 7, from: "mid", to: "rear" }
          : { start: 1, end: 4, from: "front", to: "mid" };
  const fromFactors =
    getAudiencePresetConfig(segment.from).trackProfile || getAudiencePresetConfig("mid").trackProfile;
  const toFactors =
    getAudiencePresetConfig(segment.to).trackProfile || getAudiencePresetConfig("mid").trackProfile;
  const t = segment.start === segment.end ? 0 : (safePosition - segment.start) / (segment.end - segment.start);
  return {
    volumeScale: interpolateTrackFactorEntry(fromFactors.volumeScale, toFactors.volumeScale, t),
    reverbExtra: interpolateTrackFactorEntry(fromFactors.reverbExtra, toFactors.reverbExtra, t),
    suppressionExtra: interpolateTrackFactorEntry(fromFactors.suppressionExtra, toFactors.suppressionExtra, t),
    clarityBoost: interpolateTrackFactorEntry(fromFactors.clarityBoost, toFactors.clarityBoost, t),
    wetMixTrim: interpolateTrackFactorEntry(fromFactors.wetMixTrim, toFactors.wetMixTrim, t),
  };
}

export function getRoomPresetConfig(presetName) {
  const normalizedPresetName = normalizeRoomPresetName(presetName);
  const preset = ROOM_PRESETS[normalizedPresetName] || ROOM_PRESETS.arena;
  const earlyReflections = normalizeEarlyReflectionSet(preset.earlyReflections, preset.reflectionWidth);
  return { ...preset, earlyReflections, earlyReflectionsMs: earlyReflections.map((entry) => entry.timeMs) };
}

export function getAudiencePresetConfigForName(presetName) {
  return getAudiencePresetConfig(presetName);
}

export function getAudiencePositionConfig(position) {
  const safePosition = normalizeAudiencePosition(position);
  const segment =
    safePosition >= 10
      ? { start: 10, end: 10, from: "outside", to: "outside" }
      : safePosition >= 7
        ? { start: 7, end: 10, from: "rear", to: "outside" }
        : safePosition >= 4
          ? { start: 4, end: 7, from: "mid", to: "rear" }
          : { start: 1, end: 4, from: "front", to: "mid" };

  const fromPreset = getAudiencePresetConfig(segment.from);
  const toPreset = getAudiencePresetConfig(segment.to);
  const t = segment.start === segment.end ? 0 : (safePosition - segment.start) / (segment.end - segment.start);
  const bucketPreset = getAudiencePresetNameForPosition(safePosition);
  const bucketConfig = getAudiencePresetConfig(bucketPreset);
  const merged = {
    preset: bucketPreset,
    label: bucketConfig.label,
  };

  const keys = new Set([...Object.keys(fromPreset), ...Object.keys(toPreset)]);
  keys.forEach((key) => {
    if (key === "preset" || key === "label") {
      return;
    }
    const fromValue = fromPreset[key];
    const toValue = toPreset[key];
    if (typeof fromValue === "number" && typeof toValue === "number") {
      merged[key] = fromValue + (toValue - fromValue) * t;
      return;
    }
    if (
      Array.isArray(fromValue) &&
      Array.isArray(toValue) &&
      fromValue.every((value) => typeof value === "number") &&
      toValue.every((value) => typeof value === "number")
    ) {
      merged[key] = interpolateNumberArrays(fromValue, toValue, t);
      return;
    }
    merged[key] = bucketConfig[key] ?? fromValue ?? toValue;
  });

  return merged;
}

export function getAudienceTrackProfile(position, layerIndex, trackCount) {
  const factors = interpolateTrackFactors(position);
  const totalTracks = Math.max(1, trackCount || 1);
  const frontWeight = totalTracks <= 1 ? 1 : Math.max(0, 1 - (layerIndex / (totalTracks - 1)) * 0.85);
  const rearWeight = totalTracks <= 1 ? 0 : layerIndex / (totalTracks - 1);
  const volumeScaleRaw = factors.volumeScale.base + frontWeight * factors.volumeScale.front + rearWeight * factors.volumeScale.rear;
  return {
    volumeScale: factors.volumeScale.min === null ? volumeScaleRaw : Math.max(factors.volumeScale.min, volumeScaleRaw),
    reverbExtra: (factors.reverbExtra.front || 0) * frontWeight,
    suppressionExtra: (factors.suppressionExtra.front || 0) * frontWeight,
    clarityBoost: (factors.clarityBoost.front || 0) * frontWeight,
    wetMixTrim: (factors.wetMixTrim.front || 0) * frontWeight,
  };
}
