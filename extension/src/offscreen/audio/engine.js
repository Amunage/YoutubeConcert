import { withDefaults } from "../../lib/presets.js";
import { canUpdateLiveConcertGraphInPlace, createLiveConcertGraph, updateLiveConcertGraph } from "./graph.js";

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
}

export class LiveConcertEngine {
  constructor() {
    this.audioContext = null;
    this.sourceStream = null;
    this.sourceNode = null;
    this.outputNodes = null;
    this.settings = withDefaults();
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

  async stop() {
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
  }
}
