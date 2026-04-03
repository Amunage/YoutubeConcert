import { ROOM_PRESETS } from "./room-presets.js";
import { AUDIENCE_PRESETS } from "./audience-presets.js";
import { DEFAULT_SETTINGS } from "./preset-defaults.js";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeEarlyReflectionSet(entries, fallbackWidth = 0.2) {
  const sourceEntries = Array.isArray(entries) && entries.length ? entries : [8, 15, 24];
  return sourceEntries.map((entry, index) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return {
        timeMs: Math.max(0, Number(entry.timeMs) || 0),
        pan: Math.max(-1, Math.min(1, Number(entry.pan) || 0)),
        gainDb: Number(entry.gainDb) || 0,
        filterHz: Math.max(800, Number(entry.filterHz) || 5200),
      };
    }
    const timeMs = Math.max(0, Number(entry) || 0);
    const direction = index % 2 === 0 ? -1 : 1;
    return {
      timeMs,
      pan: Math.max(-1, Math.min(1, direction * fallbackWidth * (0.65 + index * 0.12))),
      gainDb: -index * 1.2,
      filterHz: Math.max(1400, 8200 - index * 900),
    };
  });
}

export function normalizeAudiencePosition(position, fallbackPreset = "mid") {
  const numericPosition = Number(position);
  if (Number.isFinite(numericPosition)) {
    return clamp(Math.round(numericPosition), 1, 10);
  }
  if (fallbackPreset === "front") return 1;
  if (fallbackPreset === "rear") return 7;
  if (fallbackPreset === "outside") return 10;
  return 4;
}

export function getAudiencePresetNameForPosition(position) {
  const safePosition = normalizeAudiencePosition(position);
  if (safePosition >= 10) return "outside";
  if (safePosition >= 7) return "rear";
  if (safePosition >= 4) return "mid";
  return "front";
}

export function getAudienceLabelForPosition(position) {
  const presetName = getAudiencePresetNameForPosition(position);
  return AUDIENCE_PRESETS[presetName]?.label || "Middle";
}

export function normalizeRoomPresetName(presetName) {
  switch (presetName) {
    case "dry":
      return "club";
    case "stage":
      return "theater";
    case "hall":
      return "arena";
    case "cathedral":
      return "stadium";
    case "ambient":
      return "stadium";
    default:
      return ROOM_PRESETS[presetName] ? presetName : DEFAULT_SETTINGS.roomPreset;
  }
}
