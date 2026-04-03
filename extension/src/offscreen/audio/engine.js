import { withDefaults } from "../../lib/presets.js";
import {
  canUpdateLiveConcertGraphInPlace,
  createLiveConcertGraph,
  updateLiveConcertAdaptiveWetness,
  updateLiveConcertGraph,
} from "./graph.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toDb(value) {
  return 20 * Math.log10(Math.max(value, 1e-6));
}

function mark(name) {
  if (typeof performance?.mark === "function") {
    performance.mark(name);
  }
}

function measure(name, startMark, endMark) {
  if (typeof performance?.measure === "function") {
    performance.measure(name, startMark, endMark);
  }
  if (typeof performance?.clearMarks === "function") {
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
  }
  if (typeof performance?.clearMeasures === "function") {
    performance.clearMeasures(name);
  }
}

export class LiveConcertEngine {
  constructor() {
    this.audioContext = null;
    this.sourceStream = null;
    this.sourceNode = null;
    this.outputNodes = null;
    this.settings = withDefaults();
    this.adaptiveWetMix = 1;
    this.adaptiveWetTimer = null;
  }

  async start({ mediaStream, settings }) {
    await this.stop();
    this.settings = withDefaults(settings);
    this.audioContext = new AudioContext({ latencyHint: "interactive" });
    this.sourceStream = mediaStream;
    this.sourceNode = this.audioContext.createMediaStreamSource(mediaStream);
    mark("ytconcert:start:begin");
    this.outputNodes = createLiveConcertGraph(this.audioContext, this.settings);
    mark("ytconcert:start:end");
    measure("ytconcert:start", "ytconcert:start:begin", "ytconcert:start:end");
    this.sourceNode.connect(this.outputNodes.input);
    if (this.audioContext.state !== "running") {
      await this.audioContext.resume();
    }
    this.adaptiveWetMix = 1;
    this.startAdaptiveWetLoop();
  }

  rebuildGraph(settings) {
    if (!this.audioContext || !this.sourceNode) return;
    mark("ytconcert:rebuild:begin");
    if (this.outputNodes?.cleanup) {
      this.outputNodes.cleanup();
    }
    try {
      this.sourceNode.disconnect();
    } catch (error) {
    }
    this.outputNodes = createLiveConcertGraph(this.audioContext, settings);
    this.sourceNode.connect(this.outputNodes.input);
    mark("ytconcert:rebuild:end");
    measure("ytconcert:rebuild", "ytconcert:rebuild:begin", "ytconcert:rebuild:end");
  }

  updateSettings(nextSettings) {
    const previousSettings = this.settings;
    this.settings = withDefaults(nextSettings);
    if (!this.audioContext || !this.sourceNode) return;
    if (this.outputNodes && canUpdateLiveConcertGraphInPlace(this.outputNodes, previousSettings, this.settings)) {
      mark("ytconcert:update:begin");
      updateLiveConcertGraph(this.audioContext, this.outputNodes, this.settings);
      mark("ytconcert:update:end");
      measure("ytconcert:update", "ytconcert:update:begin", "ytconcert:update:end");
      return;
    }
    this.rebuildGraph(this.settings);
  }

  startAdaptiveWetLoop() {
    this.stopAdaptiveWetLoop();
    this.adaptiveWetTimer = setInterval(() => {
      this.updateAdaptiveWetness();
    }, 220);
  }

  stopAdaptiveWetLoop() {
    if (this.adaptiveWetTimer) {
      clearInterval(this.adaptiveWetTimer);
      this.adaptiveWetTimer = null;
    }
  }

  updateAdaptiveWetness() {
    const graph = this.outputNodes;
    const analyser = graph?.densityTap;
    const timeData = graph?.densityTimeData;
    const frequencyData = graph?.densityFrequencyData;
    if (!this.audioContext || !analyser || !timeData || !frequencyData) {
      return;
    }

    analyser.getFloatTimeDomainData(timeData);
    analyser.getFloatFrequencyData(frequencyData);

    let sumSquares = 0;
    for (let index = 0; index < timeData.length; index += 1) {
      const sample = timeData[index];
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, timeData.length));
    const rmsNormalized = clamp((toDb(rms) + 54) / 30, 0, 1);

    let activeBins = 0;
    let midHighBins = 0;
    for (let index = 0; index < frequencyData.length; index += 1) {
      const magnitude = frequencyData[index];
      if (magnitude > -72) {
        activeBins += 1;
      }
      if (index > frequencyData.length * 0.18 && magnitude > -66) {
        midHighBins += 1;
      }
    }

    const occupancy = activeBins / Math.max(1, frequencyData.length);
    const upperActivity = midHighBins / Math.max(1, frequencyData.length * 0.82);
    const densityScore = clamp(occupancy * 0.5 + upperActivity * 0.22 + rmsNormalized * 0.28, 0, 1);

    let targetWetMix = 1;
    if (densityScore >= 0.58) {
      targetWetMix = 1 - ((densityScore - 0.58) / 0.42) * 0.08;
    } else {
      targetWetMix = 1 + ((0.58 - densityScore) / 0.58) * 0.015;
    }
    targetWetMix = clamp(targetWetMix, 0.92, 1.015);

    this.adaptiveWetMix += (targetWetMix - this.adaptiveWetMix) * 0.05;
    const nextAdaptiveWetMix = clamp(this.adaptiveWetMix, 0.92, 1.015);
    if (Math.abs(nextAdaptiveWetMix - (graph.adaptiveWetMix || 1)) < 0.02) {
      return;
    }
    updateLiveConcertAdaptiveWetness(this.audioContext, graph, nextAdaptiveWetMix);
  }

  async stop() {
    this.stopAdaptiveWetLoop();
    if (this.sourceStream) {
      this.sourceStream.getTracks().forEach((track) => track.stop());
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (error) {
      }
    }
    if (this.outputNodes?.cleanup) {
      this.outputNodes.cleanup();
    }
    if (this.audioContext) {
      await this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this.sourceStream = null;
    this.sourceNode = null;
    this.outputNodes = null;
    this.adaptiveWetMix = 1;
  }
}
