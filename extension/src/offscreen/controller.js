import { LiveConcertEngine } from "./audio/engine.js";
import { DEFAULT_SETTINGS, withDefaults } from "../lib/presets.js";

const engine = new LiveConcertEngine();

let activeState = {
  running: false,
  tabId: null,
  tabTitle: "",
  startedAt: 0,
  settings: DEFAULT_SETTINGS,
};

async function sendState() {
  await chrome.runtime.sendMessage({
    type: "offscreen:state",
    payload: activeState,
  });
}

async function sendError(error) {
  await chrome.runtime.sendMessage({
    type: "offscreen:error",
    payload: {
      error: error?.message || "Offscreen audio processing failed.",
    },
  });
}

async function getCapturedTabStream(streamId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });
}

async function startCapture(payload) {
  const settings = withDefaults(payload.settings);
  const mediaStream = await getCapturedTabStream(payload.streamId);
  await engine.start({
    mediaStream,
    settings,
  });

  activeState = {
    running: true,
    tabId: payload.tabId,
    tabTitle: payload.tabTitle || "",
    startedAt: Date.now(),
    settings,
  };

  await sendState();
}

async function stopCapture() {
  await engine.stop();
  activeState = {
    running: false,
    tabId: null,
    tabTitle: "",
    startedAt: 0,
    settings: activeState.settings || DEFAULT_SETTINGS,
  };
  await sendState();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return false;
  }

  if (message.type === "offscreen:start-capture") {
    startCapture(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendError(error).catch(() => {});
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "offscreen:stop-capture") {
    stopCapture()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendError(error).catch(() => {});
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "offscreen:update-settings") {
    const settings = withDefaults(message.payload?.settings);
    activeState = {
      ...activeState,
      settings,
    };
    engine.updateSettings(settings);
    sendState().catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
