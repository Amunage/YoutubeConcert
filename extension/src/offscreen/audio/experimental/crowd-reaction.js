import { clamp } from "../effects.js";

const crowdNoiseBufferCache = new WeakMap();

function getCrowdNoiseBuffer(context) {
  if (crowdNoiseBufferCache.has(context)) {
    return crowdNoiseBufferCache.get(context);
  }

  const sampleRate = context.sampleRate || 48000;
  const durationSeconds = 2.4;
  const frameCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < frameCount; index += 1) {
    const white = Math.random() * 2 - 1;
    const shimmer = Math.sin(index / 41.3) * 0.08 + Math.sin(index / 113.7) * 0.05;
    data[index] = (white * 0.72 + shimmer) * 0.18;
  }

  crowdNoiseBufferCache.set(context, buffer);
  return buffer;
}

export function buildCrowdReactionChain(inputNode, targetNode, context, options = {}) {
  const roomPreset = options.roomPreset || "arena";
  const audiencePreset = options.audiencePreset || "mid";
  const roomScale = roomPreset === "stadium" ? 1 : roomPreset === "arena" ? 0.72 : 0.56;
  const audienceScale = audiencePreset === "outside" ? 1 : audiencePreset === "rear" ? 0.78 : 0.58;

  const directTrim = context.createGain();
  directTrim.gain.value = 0.95;

  const crowdBedInput = context.createGain();
  crowdBedInput.gain.value = clamp(0.038 + roomScale * 0.014 + audienceScale * 0.01, 0.03, 0.064);

  const crowdNoise = context.createBufferSource();
  crowdNoise.buffer = getCrowdNoiseBuffer(context);
  crowdNoise.loop = true;

  const crowdHighpass = context.createBiquadFilter();
  crowdHighpass.type = "highpass";
  crowdHighpass.frequency.value = 420 + audienceScale * 160;
  crowdHighpass.Q.value = 0.52;

  const crowdLowpass = context.createBiquadFilter();
  crowdLowpass.type = "lowpass";
  crowdLowpass.frequency.value = 2200 - roomScale * 260 + audienceScale * 180;
  crowdLowpass.Q.value = 0.58;

  const crowdBand = context.createBiquadFilter();
  crowdBand.type = "peaking";
  crowdBand.frequency.value = 1300 + audienceScale * 120;
  crowdBand.Q.value = 0.9;
  crowdBand.gain.value = 1.4 + roomScale * 0.4;

  const crowdMotion = context.createGain();
  crowdMotion.gain.value = 0.82;
  const crowdMotionLfo = context.createOscillator();
  crowdMotionLfo.type = "sine";
  crowdMotionLfo.frequency.value = 0.067 + roomScale * 0.018;
  const crowdMotionDepth = context.createGain();
  crowdMotionDepth.gain.value = 0.12 + audienceScale * 0.04;

  const crowdPanner = context.createStereoPanner();
  crowdPanner.pan.value = 0;
  const crowdPanLfo = context.createOscillator();
  crowdPanLfo.type = "triangle";
  crowdPanLfo.frequency.value = 0.031 + roomScale * 0.008;
  const crowdPanDepth = context.createGain();
  crowdPanDepth.gain.value = 0.1 + audienceScale * 0.04;

  const crowdOutput = context.createGain();
  crowdOutput.gain.value = 1;

  inputNode.connect(directTrim);
  directTrim.connect(targetNode);

  crowdNoise.connect(crowdBedInput);
  crowdBedInput.connect(crowdHighpass);
  crowdHighpass.connect(crowdLowpass);
  crowdLowpass.connect(crowdBand);
  crowdBand.connect(crowdMotion);
  crowdMotion.connect(crowdPanner);
  crowdPanner.connect(crowdOutput);
  crowdOutput.connect(targetNode);

  crowdMotionLfo.connect(crowdMotionDepth);
  crowdMotionDepth.connect(crowdMotion.gain);

  crowdPanLfo.connect(crowdPanDepth);
  crowdPanDepth.connect(crowdPanner.pan);

  crowdNoise.start();
  crowdMotionLfo.start();
  crowdPanLfo.start();

  return [
    directTrim,
    crowdBedInput,
    crowdNoise,
    crowdHighpass,
    crowdLowpass,
    crowdBand,
    crowdMotion,
    crowdMotionLfo,
    crowdMotionDepth,
    crowdPanner,
    crowdPanLfo,
    crowdPanDepth,
    crowdOutput,
  ];
}
