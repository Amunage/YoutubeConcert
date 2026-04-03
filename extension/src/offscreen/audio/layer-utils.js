import { clamp } from "../../lib/presets.js";

function getRoomScale(room) {
  return clamp(((room?.lateReverbSeconds || room?.reverbSeconds || 1) - 0.3) / 6.2, 0, 1.1);
}

export function setAudioParam(param, value, context, timeConstant = 0.03) {
  if (!param || typeof value !== "number") {
    return;
  }
  if (Math.abs((param.value ?? 0) - value) < 1e-4) {
    return;
  }
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, timeConstant);
}

export function getEarlyPreDelaySeconds({ room, audience, layerBlend, distanceBlend }) {
  const roomScale = getRoomScale(room);
  const earlyMs =
    room.earlyPreDelayMs +
    audience.preDelayMs * 0.18 +
    distanceBlend * (3.5 + roomScale * 4.2) +
    layerBlend * (4.5 + roomScale * 3.2);
  return Math.max(0, earlyMs * audience.preDelayScale / 1000);
}

export function getLatePreDelaySeconds({ room, audience, layerBlend, distanceBlend }) {
  const roomScale = getRoomScale(room);
  const lateMs =
    room.latePreDelayMs +
    audience.preDelayMs * (0.72 + roomScale * 0.18) +
    distanceBlend * (9 + roomScale * 16) +
    layerBlend * (11 + roomScale * 9);
  return Math.max(0, lateMs * audience.preDelayScale / 1000);
}

export function getLayerDelaySeconds(safe, audience, room, index) {
  const roomDelayScale = room?.layerDelayScale ?? 1;
  return Math.max(0, (safe.delayMs * audience.delayScale * roomDelayScale * index) / 1000);
}

export function getAudienceWidthProfile(audience, layerBlend, distanceBlend) {
  const preset = audience?.preset || "mid";
  const baseProfile = preset === "front"
    ? { direct: 0.88, wet: 0.84, reflection: 0.82 }
    : preset === "rear"
      ? { direct: 1.08, wet: 1.14, reflection: 1.18 }
      : preset === "outside"
        ? { direct: 1.16, wet: 1.28, reflection: 1.34 }
        : { direct: 1, wet: 1.02, reflection: 1.04 };

  const distanceDrive = clamp(distanceBlend, 0, 1.2);
  return {
    direct: clamp(baseProfile.direct + distanceDrive * 0.06 - layerBlend * 0.03, 0.76, 1.24),
    wet: clamp(baseProfile.wet + distanceDrive * 0.14 + layerBlend * 0.04, 0.78, 1.42),
    reflection: clamp(baseProfile.reflection + distanceDrive * 0.18 + layerBlend * 0.06, 0.8, 1.55),
  };
}

export function getCenterImageProfile(audience, layerBlend, distanceBlend, leadClarity) {
  const preset = audience?.preset || "mid";
  const baseAnchor = preset === "front"
    ? 0.3
    : preset === "rear"
      ? 0.18
      : preset === "outside"
        ? 0.12
        : 0.24;
  const anchor = clamp(
    baseAnchor +
    (1 - layerBlend) * 0.16 +
    leadClarity * 0.035 -
    distanceBlend * 0.08,
    0.1,
    0.52,
  );
  return {
    anchor,
    panScale: clamp(1 - anchor * 0.58, 0.62, 0.94),
  };
}
