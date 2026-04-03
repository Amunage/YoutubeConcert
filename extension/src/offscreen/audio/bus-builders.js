import { clamp, dbToGain, getConvolverBuffer } from "./effects.js";
import { buildCrowdReactionChain } from "./experimental/crowd-reaction.js";
import { buildLargeSpaceMicroModulationChain } from "./experimental/large-space-modulation.js";
import { buildSubtleSpaceResponseChain } from "./experimental/subtle-space-response.js";
import { connectToOutput } from "./output.js";

function getAuxBusProfile(options = {}, kind = "") {
  const roomPreset = options.roomPreset || "arena";
  const audiencePreset = options.audiencePreset || "mid";
  const roomScale = roomPreset === "stadium"
    ? 1
    : roomPreset === "arena"
      ? 0.64
      : roomPreset === "theater"
        ? 0.24
        : 0.06;
  const audienceDepth = audiencePreset === "outside" ? 1 : audiencePreset === "rear" ? 0.62 : audiencePreset === "mid" ? 0.28 : 0.06;

  if (kind === "smear") {
    return {
      timeScale: 0.92 + roomScale * 0.3 + audienceDepth * 0.24,
      toneShift: roomScale * 520 - audienceDepth * 240,
      widthScale: 0.88 + audienceDepth * 0.34,
      gainScale: 0.92 + roomScale * 0.1,
    };
  }

  if (kind === "blur") {
    return {
      timeScale: 0.86 + audienceDepth * 0.26,
      bandShift: roomScale * 180 - audienceDepth * 260,
      lowpassTrim: audienceDepth * 620 + roomScale * 180,
      gainScale: 0.96 + roomScale * 0.06,
    };
  }

  if (kind === "reflection") {
    return {
      spacingScale: 0.94 + roomScale * 0.22 + audienceDepth * 0.3,
      widthScale: 0.92 + audienceDepth * 0.24,
      gainScale: 0.94 + roomScale * 0.08 + audienceDepth * 0.08,
      toneTrim: roomScale * 480 + audienceDepth * 360,
    };
  }

  return {
    timeScale: 1,
    toneShift: 0,
    widthScale: 1,
    gainScale: 1,
    spacingScale: 1,
    toneTrim: 0,
    bandShift: 0,
    lowpassTrim: 0,
  };
}

function buildDiffusionNetwork(inputNode, targetNode, options = {}, context) {
  const diffusionTimesMs = options.timesMs || [11, 17, 29, 41];
  const feedbackAmount = clamp(options.feedback ?? 0.42, 0, 0.72);
  const cutoffHz = options.cutoffHz || 4200;
  const spread = options.stereoSpread || 0.12;
  let previousNode = inputNode;
  const nodes = [];

  diffusionTimesMs.forEach((timeMs, index) => {
    const stageDelay = context.createDelay(0.12);
    stageDelay.delayTime.value = Math.max(0.003, timeMs / 1000);

    const stageAllpass = context.createBiquadFilter();
    stageAllpass.type = "allpass";
    stageAllpass.frequency.value = 900 + index * 650;
    stageAllpass.Q.value = 0.7 + index * 0.08;

    const stageTone = context.createBiquadFilter();
    stageTone.type = "lowpass";
    stageTone.frequency.value = Math.max(900, cutoffHz - index * 380);
    stageTone.Q.value = 0.5;

    const stagePanner = context.createStereoPanner();
    stagePanner.pan.value = clamp((index % 2 === 0 ? -1 : 1) * spread * (0.55 + index * 0.14), -0.82, 0.82);

    const stageMixGain = context.createGain();
    stageMixGain.gain.value = Math.max(0.18, 0.44 - index * 0.04);

    const feedbackGain = context.createGain();
    feedbackGain.gain.value = clamp(feedbackAmount * (0.78 - index * 0.09), 0, 0.68);

    previousNode.connect(stageDelay);
    stageDelay.connect(stageAllpass);
    stageAllpass.connect(stageTone);
    stageTone.connect(stageMixGain);
    stageMixGain.connect(stagePanner);
    stagePanner.connect(targetNode);
    stageMixGain.connect(feedbackGain);
    feedbackGain.connect(stageDelay);

    nodes.push(stageDelay, stageAllpass, stageTone, stagePanner, stageMixGain, feedbackGain);
    previousNode = stageMixGain;
  });

  return nodes;
}

function buildSmearNetwork(inputNode, targetNode, options = {}, context) {
  const tapTimesMs = Array.isArray(options.tapTimesMs) && options.tapTimesMs.length ? options.tapTimesMs : [8, 15, 24, 35];
  const cutHz = Math.max(500, options.cutHz || 2400);
  const stereoWidth = clamp(options.stereoWidth ?? 1, 0.6, 1.5);
  const profile = getAuxBusProfile(options, "smear");
  const nodes = [];

  tapTimesMs.forEach((timeMs, index) => {
    const tapDelay = context.createDelay(0.28);
    tapDelay.delayTime.value = Math.max(0.003, ((timeMs + index * 2.4) * profile.timeScale) / 1000);

    const tapFilter = context.createBiquadFilter();
    tapFilter.type = "lowpass";
    tapFilter.frequency.value = Math.max(320, cutHz + 3800 + profile.toneShift - index * 460);

    const tapGain = context.createGain();
    tapGain.gain.value = Math.max(0.018, (0.11 - index * 0.013) * profile.gainScale);

    const tapPanner = context.createStereoPanner();
    tapPanner.pan.value = clamp((index % 2 === 0 ? -1 : 1) * (0.08 + index * 0.03) * stereoWidth * profile.widthScale, -0.84, 0.84);

    inputNode.connect(tapDelay);
    tapDelay.connect(tapFilter);
    tapFilter.connect(tapGain);
    tapGain.connect(tapPanner);
    tapPanner.connect(targetNode);

    nodes.push(tapDelay, tapFilter, tapGain, tapPanner);
  });

  return nodes;
}

function buildBlurNetwork(inputNode, targetNode, options = {}, context) {
  const tapTimesMs = Array.isArray(options.tapTimesMs) && options.tapTimesMs.length ? options.tapTimesMs : [4, 8, 13, 19];
  const directCutHz = Math.max(0, options.directCutHz || 0);
  const profile = getAuxBusProfile(options, "blur");
  const nodes = [];

  tapTimesMs.forEach((timeMs, index) => {
    const tapDelay = context.createDelay(0.16);
    tapDelay.delayTime.value = Math.max(0.002, ((timeMs + index * 1.6) * profile.timeScale) / 1000);

    const bandFilter = context.createBiquadFilter();
    bandFilter.type = "bandpass";
    bandFilter.frequency.value = Math.max(1200, 2200 + profile.bandShift + index * 420);
    bandFilter.Q.value = 0.72;

    const toneFilter = context.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = Math.max(1200, 5600 - index * 420 - directCutHz * 0.4 - profile.lowpassTrim);

    const tapGain = context.createGain();
    tapGain.gain.value = Math.max(0.018, (0.086 - index * 0.012) * profile.gainScale);

    const tapPanner = context.createStereoPanner();
    tapPanner.pan.value = clamp((index % 2 === 0 ? -1 : 1) * (0.06 + index * 0.018), -0.74, 0.74);

    inputNode.connect(tapDelay);
    tapDelay.connect(bandFilter);
    bandFilter.connect(toneFilter);
    toneFilter.connect(tapGain);
    tapGain.connect(tapPanner);
    tapPanner.connect(targetNode);

    nodes.push(tapDelay, bandFilter, toneFilter, tapGain, tapPanner);
  });

  return nodes;
}

function buildReflectionNetwork(inputNode, targetNode, options = {}, context) {
  const reflections = Array.isArray(options.reflections) && options.reflections.length
    ? options.reflections
    : Array.isArray(options.tapTimesMs) && options.tapTimesMs.length
      ? options.tapTimesMs.map((timeMs, index) => ({
          timeMs,
          pan: (index % 2 === 0 ? -1 : 1) * (0.16 + index * 0.08),
          gainDb: -index * 1.4,
          filterHz: Math.max(1000, 9000 - index * 720),
        }))
      : [14, 29, 46, 66].map((timeMs, index) => ({
          timeMs,
          pan: (index % 2 === 0 ? -1 : 1) * (0.16 + index * 0.08),
          gainDb: -index * 1.4,
          filterHz: Math.max(1000, 9000 - index * 720),
        }));
  const spacing = Math.max(0.7, options.spacing || 1);
  const stereoWidth = clamp(options.stereoWidth ?? 0.4, 0.12, 0.9);
  const reflectionBoost = clamp(options.reflectionBoost ?? 1, 0.5, 1.6);
  const profile = getAuxBusProfile(options, "reflection");
  const nodes = [];

  reflections.forEach((reflection, index) => {
    const timeMs = Math.max(0, Number(reflection?.timeMs) || 0);
    const filterHz = Math.max(900, (Number(reflection?.filterHz) || 9000 - index * 720) - profile.toneTrim);
    const pan = clamp((Number(reflection?.pan) || 0) * stereoWidth * profile.widthScale, -0.9, 0.9);
    const gain = Math.max(0.016, 0.16 - index * 0.025) * dbToGain(reflection?.gainDb) * reflectionBoost * profile.gainScale;

    const tapDelay = context.createDelay(0.42);
    tapDelay.delayTime.value = Math.max(0.004, (timeMs * spacing * profile.spacingScale + index * 2.6) / 1000);

    const tapFilter = context.createBiquadFilter();
    tapFilter.type = "lowpass";
    tapFilter.frequency.value = filterHz;

    const tapGain = context.createGain();
    tapGain.gain.value = gain;

    const tapPanner = context.createStereoPanner();
    tapPanner.pan.value = pan;

    inputNode.connect(tapDelay);
    tapDelay.connect(tapFilter);
    tapFilter.connect(tapGain);
    tapGain.connect(tapPanner);
    tapPanner.connect(targetNode);

    nodes.push(tapDelay, tapFilter, tapGain, tapPanner);
  });

  return nodes;
}

export function createEffectBus(kind, busKey, options = {}, context) {
  const input = context.createGain();
  input.gain.value = 1;
  const returnGain = context.createGain();
  const transitionGain = context.createGain();
  const limiter = context.createDynamicsCompressor();
  const nodes = [input, returnGain, transitionGain, limiter];
  let bus = null;

  if (kind === "diffusion") {
    returnGain.gain.value = 1;
    transitionGain.gain.value = 0;
    limiter.threshold.value = -22;
    limiter.knee.value = 18;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.14;
    nodes.push(...buildDiffusionNetwork(input, returnGain, options, context));
    bus = { key: busKey, kind, input, returnGain, transitionGain, limiter, nodes };
  } else if (kind === "smear") {
    returnGain.gain.value = 0.94;
    transitionGain.gain.value = 0;
    limiter.threshold.value = -24;
    limiter.knee.value = 14;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    nodes.push(...buildSmearNetwork(input, returnGain, options, context));
    bus = { key: busKey, kind, input, returnGain, transitionGain, limiter, nodes };
  } else if (kind === "blur") {
    returnGain.gain.value = 0.92;
    transitionGain.gain.value = 0;
    limiter.threshold.value = -24;
    limiter.knee.value = 16;
    limiter.ratio.value = 7;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    nodes.push(...buildBlurNetwork(input, returnGain, options, context));
    bus = { key: busKey, kind, input, returnGain, transitionGain, limiter, nodes };
  } else if (kind === "reflection") {
    returnGain.gain.value = 1;
    transitionGain.gain.value = 0;
    limiter.threshold.value = -22;
    limiter.knee.value = 16;
    limiter.ratio.value = 9;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    nodes.push(...buildReflectionNetwork(input, returnGain, options, context));
    bus = { key: busKey, kind, input, returnGain, transitionGain, limiter, nodes };
  } else if (kind === "early" || kind === "late") {
    const convolver = context.createConvolver();
    convolver.buffer = getConvolverBuffer(context, options.preset, kind);
    const wetHighpass = context.createBiquadFilter();
    wetHighpass.type = "highpass";
    wetHighpass.frequency.value = kind === "early"
      ? Math.max(70, 85 + (options.preset?.wetToneCut || 0) * 0.06)
      : Math.max(65, 80 + (options.preset?.wetToneCut || 0) * 0.035);
    wetHighpass.Q.value = kind === "early" ? 0.54 : 0.62;

    const wetLowShelf = context.createBiquadFilter();
    wetLowShelf.type = "lowshelf";
    wetLowShelf.frequency.value = kind === "early" ? 180 : 220;
    wetLowShelf.gain.value = kind === "early"
      ? Math.max(-2.2, -0.4 - (options.preset?.wetToneCut || 0) / 380)
      : Math.max(-3.2, -0.6 - (options.preset?.wetToneCut || 0) / 420);

    const wetPresenceDip = context.createBiquadFilter();
    wetPresenceDip.type = "peaking";
    wetPresenceDip.frequency.value = kind === "early" ? 3200 : 2900;
    wetPresenceDip.Q.value = 0.72;
    wetPresenceDip.gain.value = kind === "early"
      ? Math.max(-1.2, -(options.preset?.wetToneCut || 0) / 1200)
      : Math.max(-1.4, -0.35 - (options.preset?.wetToneCut || 0) / 900);

    returnGain.gain.value = kind === "early" ? 1.06 : 1;
    transitionGain.gain.value = 0;
    limiter.threshold.value = kind === "early" ? -18 : -20;
    limiter.knee.value = kind === "early" ? 16 : 20;
    limiter.ratio.value = kind === "early" ? 6 : 10;
    limiter.attack.value = kind === "early" ? 0.002 : 0.004;
    limiter.release.value = kind === "early" ? 0.11 : 0.18;

    input.connect(convolver);
    convolver.connect(wetHighpass);
    wetHighpass.connect(wetLowShelf);
    wetLowShelf.connect(wetPresenceDip);

    const enableLargeSpaceMicroModulation =
      kind === "late" &&
      options.experimentalLargeSpaceModulation === true &&
      (options.roomPreset === "arena" || options.roomPreset === "stadium");
    const enableSubtleSpaceResponse =
      kind === "late" &&
      options.experimentalSubtleSpaceResponse === true &&
      (options.roomPreset === "arena" || options.roomPreset === "stadium");
    const enableCrowdReaction =
      kind === "late" &&
      options.experimentalCrowdReaction === true &&
      (options.roomPreset === "arena" || options.roomPreset === "stadium");

    if (enableLargeSpaceMicroModulation || enableSubtleSpaceResponse || enableCrowdReaction) {
      let experimentalInput = wetPresenceDip;
      if (enableCrowdReaction) {
        const crowdReactionTarget = (enableSubtleSpaceResponse || enableLargeSpaceMicroModulation) ? context.createGain() : returnGain;
        nodes.push(crowdReactionTarget);
        nodes.push(
          ...buildCrowdReactionChain(
            experimentalInput,
            crowdReactionTarget,
            context,
            {
              roomPreset: options.roomPreset,
              audiencePreset: options.audiencePreset,
            },
          ),
        );
        experimentalInput = crowdReactionTarget;
      }
      if (enableSubtleSpaceResponse) {
        const spaceResponseTarget = enableLargeSpaceMicroModulation ? context.createGain() : returnGain;
        nodes.push(spaceResponseTarget);
        nodes.push(
          ...buildSubtleSpaceResponseChain(
            experimentalInput,
            spaceResponseTarget,
            context,
            { roomPreset: options.roomPreset },
          ),
        );
        experimentalInput = spaceResponseTarget;
      }

      if (enableLargeSpaceMicroModulation) {
        nodes.push(
          ...buildLargeSpaceMicroModulationChain(
            experimentalInput,
            returnGain,
            context,
            { roomPreset: options.roomPreset },
          ),
        );
      }
    } else {
      wetPresenceDip.connect(returnGain);
    }

    nodes.push(convolver, wetHighpass, wetLowShelf, wetPresenceDip);
    bus = {
      key: busKey,
      kind,
      input,
      convolver,
      wetHighpass,
      wetLowShelf,
      wetPresenceDip,
      returnGain,
      transitionGain,
      limiter,
      nodes,
    };
  }

  if (!bus) {
    return null;
  }

  returnGain.connect(transitionGain);
  transitionGain.connect(limiter);
  connectToOutput(limiter, context);
  return bus;
}
