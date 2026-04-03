import { clamp } from "../effects.js";

export function buildSubtleSpaceResponseChain(inputNode, targetNode, context, options = {}) {
  const roomPreset = options.roomPreset || "arena";
  const roomScale = roomPreset === "stadium" ? 1 : roomPreset === "arena" ? 0.68 : 0.52;

  const directTrim = context.createGain();
  directTrim.gain.value = 0.94;

  const bloomSum = context.createGain();
  bloomSum.gain.value = 1;

  const earlyBloomDelay = context.createDelay(0.12);
  earlyBloomDelay.delayTime.value = 0.027 + roomScale * 0.012;
  const earlyBloomFilter = context.createBiquadFilter();
  earlyBloomFilter.type = "bandpass";
  earlyBloomFilter.frequency.value = 1700 - roomScale * 180;
  earlyBloomFilter.Q.value = 0.85;
  const earlyBloomGain = context.createGain();
  earlyBloomGain.gain.value = clamp(0.045 + roomScale * 0.014, 0.04, 0.062);
  const earlyBloomPanner = context.createStereoPanner();
  earlyBloomPanner.pan.value = -0.12 - roomScale * 0.05;

  const lateBloomDelay = context.createDelay(0.16);
  lateBloomDelay.delayTime.value = 0.053 + roomScale * 0.021;
  const lateBloomFilter = context.createBiquadFilter();
  lateBloomFilter.type = "lowpass";
  lateBloomFilter.frequency.value = 2800 - roomScale * 420;
  lateBloomFilter.Q.value = 0.6;
  const lateBloomGain = context.createGain();
  lateBloomGain.gain.value = clamp(0.034 + roomScale * 0.018, 0.03, 0.056);
  const lateBloomPanner = context.createStereoPanner();
  lateBloomPanner.pan.value = 0.14 + roomScale * 0.05;

  inputNode.connect(directTrim);
  directTrim.connect(targetNode);

  inputNode.connect(earlyBloomDelay);
  earlyBloomDelay.connect(earlyBloomFilter);
  earlyBloomFilter.connect(earlyBloomGain);
  earlyBloomGain.connect(earlyBloomPanner);
  earlyBloomPanner.connect(bloomSum);

  inputNode.connect(lateBloomDelay);
  lateBloomDelay.connect(lateBloomFilter);
  lateBloomFilter.connect(lateBloomGain);
  lateBloomGain.connect(lateBloomPanner);
  lateBloomPanner.connect(bloomSum);

  bloomSum.connect(targetNode);

  return [
    directTrim,
    bloomSum,
    earlyBloomDelay,
    earlyBloomFilter,
    earlyBloomGain,
    earlyBloomPanner,
    lateBloomDelay,
    lateBloomFilter,
    lateBloomGain,
    lateBloomPanner,
  ];
}
