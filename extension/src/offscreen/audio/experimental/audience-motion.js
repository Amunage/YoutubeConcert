import { clamp } from "../effects.js";

function getRoomMotionScale(roomPreset) {
  if (roomPreset === "stadium") return 1;
  if (roomPreset === "arena") return 0.76;
  if (roomPreset === "theater") return 0.34;
  return 0.12;
}

function getAudienceDepthScale(audiencePreset) {
  if (audiencePreset === "outside") return 1;
  if (audiencePreset === "rear") return 0.78;
  if (audiencePreset === "mid") return 0.54;
  return 0.3;
}

export function buildAudienceMotionChain(inputNode, targetNode, context, options = {}) {
  const roomPreset = options.roomPreset || "arena";
  const audiencePreset = options.audiencePreset || "mid";
  const roomScale = getRoomMotionScale(roomPreset);
  const audienceScale = getAudienceDepthScale(audiencePreset);
  const motionAmount = clamp(0.2 + roomScale * 0.58 + audienceScale * 0.22, 0.18, 1);

  const directTrim = context.createGain();
  directTrim.gain.value = clamp(0.97 - motionAmount * 0.02, 0.94, 0.98);

  const motionMix = context.createGain();
  motionMix.gain.value = clamp(0.045 + motionAmount * 0.04, 0.04, 0.082);

  const swayPan = context.createStereoPanner();
  swayPan.pan.value = 0;
  const swayPanLfo = context.createOscillator();
  swayPanLfo.type = "sine";
  swayPanLfo.frequency.value = 0.027 + motionAmount * 0.01;
  const swayPanDepth = context.createGain();
  swayPanDepth.gain.value = clamp(0.014 + roomScale * 0.05 + audienceScale * 0.02, 0.014, 0.086);

  const swayDelay = context.createDelay(0.12);
  swayDelay.delayTime.value = 0.011 + roomScale * 0.01 + audienceScale * 0.004;
  const swayDelayLfo = context.createOscillator();
  swayDelayLfo.type = "triangle";
  swayDelayLfo.frequency.value = 0.041 + roomScale * 0.012;
  const swayDelayDepth = context.createGain();
  swayDelayDepth.gain.value = 0.00016 + roomScale * 0.00026 + audienceScale * 0.00008;

  const swayTone = context.createBiquadFilter();
  swayTone.type = "lowpass";
  swayTone.frequency.value = Math.max(1800, 5400 - roomScale * 900 + audienceScale * 300);
  swayTone.Q.value = 0.5;

  inputNode.connect(directTrim);
  directTrim.connect(targetNode);

  inputNode.connect(swayDelay);
  swayDelay.connect(swayTone);
  swayTone.connect(motionMix);
  motionMix.connect(swayPan);
  swayPan.connect(targetNode);

  swayPanLfo.connect(swayPanDepth);
  swayPanDepth.connect(swayPan.pan);

  swayDelayLfo.connect(swayDelayDepth);
  swayDelayDepth.connect(swayDelay.delayTime);

  swayPanLfo.start();
  swayDelayLfo.start();

  return [
    directTrim,
    motionMix,
    swayPan,
    swayPanLfo,
    swayPanDepth,
    swayDelay,
    swayDelayLfo,
    swayDelayDepth,
    swayTone,
  ];
}
