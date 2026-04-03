import { clamp } from "../effects.js";

export function buildLargeSpaceMicroModulationChain(inputNode, targetNode, context, options = {}) {
  const roomPreset = options.roomPreset || "arena";
  const roomScale = roomPreset === "stadium" ? 1 : roomPreset === "arena" ? 0.72 : 0.56;
  const dryMix = context.createGain();
  dryMix.gain.value = 0.9;

  const motionSum = context.createGain();
  motionSum.gain.value = 1;

  const leftDelay = context.createDelay(0.08);
  leftDelay.delayTime.value = 0.016 + roomScale * 0.004;
  const leftDepth = context.createGain();
  leftDepth.gain.value = 0.00032 + roomScale * 0.00012;
  const leftLfo = context.createOscillator();
  leftLfo.type = "sine";
  leftLfo.frequency.value = 0.043 + roomScale * 0.01;
  const leftMotionGain = context.createGain();
  leftMotionGain.gain.value = clamp(0.065 + roomScale * 0.015, 0.05, 0.09);
  const leftPanner = context.createStereoPanner();
  leftPanner.pan.value = -0.18 - roomScale * 0.06;

  const rightDelay = context.createDelay(0.08);
  rightDelay.delayTime.value = 0.024 + roomScale * 0.005;
  const rightDepth = context.createGain();
  rightDepth.gain.value = 0.00042 + roomScale * 0.00014;
  const rightLfo = context.createOscillator();
  rightLfo.type = "triangle";
  rightLfo.frequency.value = 0.061 + roomScale * 0.012;
  const rightMotionGain = context.createGain();
  rightMotionGain.gain.value = clamp(0.058 + roomScale * 0.018, 0.045, 0.086);
  const rightPanner = context.createStereoPanner();
  rightPanner.pan.value = 0.2 + roomScale * 0.07;

  inputNode.connect(dryMix);
  dryMix.connect(targetNode);

  inputNode.connect(leftDelay);
  leftDelay.connect(leftMotionGain);
  leftMotionGain.connect(leftPanner);
  leftPanner.connect(motionSum);

  inputNode.connect(rightDelay);
  rightDelay.connect(rightMotionGain);
  rightMotionGain.connect(rightPanner);
  rightPanner.connect(motionSum);

  motionSum.connect(targetNode);

  leftLfo.connect(leftDepth);
  leftDepth.connect(leftDelay.delayTime);
  rightLfo.connect(rightDepth);
  rightDepth.connect(rightDelay.delayTime);

  leftLfo.start();
  rightLfo.start();

  return [
    dryMix,
    motionSum,
    leftDelay,
    leftDepth,
    leftLfo,
    leftMotionGain,
    leftPanner,
    rightDelay,
    rightDepth,
    rightLfo,
    rightMotionGain,
    rightPanner,
  ];
}
