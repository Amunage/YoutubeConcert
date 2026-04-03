export { ROOM_PRESETS } from "./room-presets.js";
export { AUDIENCE_PRESETS, AUDIENCE_PRESET_GROUPS } from "./audience-presets.js";
export { DEFAULT_SETTINGS } from "./preset-defaults.js";
export {
  clamp,
  getAudienceLabelForPosition,
  getAudiencePresetNameForPosition,
  normalizeAudiencePosition,
  normalizeEarlyReflectionSet,
  normalizeRoomPresetName,
} from "./preset-utils.js";
export {
  getAudiencePositionConfig,
  getAudiencePresetConfigForName as getAudiencePresetConfig,
  getAudienceTrackProfile,
  getRoomPresetConfig,
} from "./preset-interpolation.js";

import { DEFAULT_SETTINGS } from "./preset-defaults.js";
import {
  getAudiencePresetNameForPosition,
  normalizeAudiencePosition,
  normalizeRoomPresetName,
} from "./preset-utils.js";

export function withDefaults(settings = {}) {
  const audiencePosition = normalizeAudiencePosition(settings.audiencePosition, settings.audiencePreset);
  const normalizedSettings = {
    ...settings,
    roomPreset: normalizeRoomPresetName(settings.roomPreset),
    audiencePosition,
    audiencePreset: getAudiencePresetNameForPosition(audiencePosition),
  };
  return {
    ...DEFAULT_SETTINGS,
    ...normalizedSettings,
  };
}
