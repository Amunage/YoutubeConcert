const OFFSCREEN_PATH = "src/offscreen/offscreen.html";
const SESSION_STATE_KEY = "concertSessionState";
const OFFSCREEN_READY_RETRY_COUNT = 10;
const OFFSCREEN_READY_RETRY_DELAY_MS = 50;

let sessionState = {
  running: false,
  tabId: null,
  tabTitle: "",
  startedAt: 0,
  settings: null,
  lastError: "",
};

let sessionStateReady = null;

function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function logWarning(message, error) {
  if (error) {
    console.warn(`[YTConcert] ${message}`, error);
    return;
  }
  console.warn(`[YTConcert] ${message}`);
}

function getDefaultSessionState() {
  return {
    running: false,
    tabId: null,
    tabTitle: "",
    startedAt: 0,
    settings: null,
    lastError: "",
  };
}

async function ensureSessionStateLoaded() {
  if (!sessionStateReady) {
    sessionStateReady = chrome.storage.session.get(SESSION_STATE_KEY)
      .then((stored) => {
        sessionState = {
          ...getDefaultSessionState(),
          ...(stored?.[SESSION_STATE_KEY] || {}),
        };
      })
      .catch((error) => {
        logWarning("Failed to restore session state from storage.session.", error);
        sessionState = getDefaultSessionState();
      });
  }

  await sessionStateReady;
}

async function persistSessionState() {
  await chrome.storage.session.set({ [SESSION_STATE_KEY]: sessionState });
}

async function setSessionState(nextState) {
  sessionState = {
    ...getDefaultSessionState(),
    ...nextState,
  };
  await persistSessionState();
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Process current tab audio in a persistent offscreen audio graph.",
  });
}

async function waitForOffscreenReady() {
  for (let attempt = 0; attempt < OFFSCREEN_READY_RETRY_COUNT; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "offscreen:get-state",
        target: "offscreen",
      });
      if (response?.ok) {
        return;
      }
    } catch (error) {
      if (attempt === OFFSCREEN_READY_RETRY_COUNT - 1) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, OFFSCREEN_READY_RETRY_DELAY_MS));
  }

  throw new Error("Offscreen audio processor did not become ready in time.");
}

async function closeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) {
    return;
  }
  await chrome.offscreen.closeDocument();
}

async function getTabForCapture(tabId) {
  if (tabId) {
    return chrome.tabs.get(tabId);
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!activeTab?.id) {
    throw new Error(t("errorCouldNotFindActiveTab"));
  }

  return activeTab;
}

async function syncStateFromOffscreen() {
  if (!(await hasOffscreenDocument())) {
    if (sessionState.running) {
      await setSessionState({
        ...sessionState,
        running: false,
        tabId: null,
        tabTitle: "",
        startedAt: 0,
      });
    }
    return sessionState;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "offscreen:get-state",
      target: "offscreen",
    });
    if (response?.ok && response.state) {
      await setSessionState({
        ...sessionState,
        ...response.state,
        lastError: sessionState.lastError,
      });
    }
  } catch (error) {
    logWarning("Failed to sync session state from offscreen document.", error);
  }

  return sessionState;
}

async function startCapture(request = {}) {
  await ensureSessionStateLoaded();
  if (await hasOffscreenDocument()) {
    await closeOffscreenDocument().catch((error) => {
      logWarning("Failed to close existing offscreen document before restart.", error);
    });
  }
  const targetTab = await getTabForCapture(request.tabId);
  await ensureOffscreenDocument();
  await waitForOffscreenReady();

  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: targetTab.id,
  });

  await setSessionState({
    running: true,
    tabId: targetTab.id,
    tabTitle: targetTab.title || "",
    startedAt: Date.now(),
    settings: request.settings || null,
    lastError: "",
  });

  await chrome.runtime.sendMessage({
    type: "offscreen:start-capture",
    target: "offscreen",
    payload: {
      streamId,
      tabId: targetTab.id,
      tabTitle: targetTab.title || "",
      settings: request.settings || {},
    },
  });

  return sessionState;
}

async function handleCaptureFailure(errorMessage = t("errorAudioProcessing")) {
  await setSessionState({
    ...sessionState,
    running: false,
    tabId: null,
    tabTitle: "",
    startedAt: 0,
    lastError: errorMessage,
  });
  await closeOffscreenDocument().catch((error) => {
    logWarning("Failed to close offscreen document after capture failure.", error);
  });
  broadcastSessionState();
  return sessionState;
}

async function stopCapture() {
  await ensureSessionStateLoaded();
  try {
    await chrome.runtime.sendMessage({
      type: "offscreen:stop-capture",
      target: "offscreen",
    });
  } catch (error) {
    logWarning("Failed to stop capture in offscreen document.", error);
  }

  await setSessionState({
    running: false,
    tabId: null,
    tabTitle: "",
    startedAt: 0,
    settings: null,
    lastError: "",
  });

  await closeOffscreenDocument();
  return sessionState;
}

function broadcastSessionState() {
  chrome.runtime.sendMessage({
    type: "offscreen:state",
    payload: sessionState,
  }).catch((error) => {
    logWarning("Failed to broadcast session state to popup.", error);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  if (message.type === "popup:get-state") {
    ensureSessionStateLoaded()
      .then(() => syncStateFromOffscreen())
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => {
        logWarning("Failed to serve popup state request.", error);
        sendResponse({ ok: true, state: sessionState });
      });
    return true;
  }

  if (message.type === "popup:start-capture") {
    startCapture(message.payload)
      .then((state) => sendResponse({ ok: true, state }))
      .catch(async (error) => {
        const failedState = await handleCaptureFailure(error.message || t("errorCouldNotStartTabAudioCapture"));
        sendResponse({ ok: false, error: failedState.lastError, state: failedState });
      });
    return true;
  }

  if (message.type === "popup:stop-capture") {
    stopCapture()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || t("errorCouldNotStopTabAudioCapture") });
      });
    return true;
  }

  if (message.type === "popup:update-settings") {
    ensureSessionStateLoaded()
      .then(async () => {
        await setSessionState({
          ...sessionState,
          settings: message.payload?.settings || sessionState.settings,
        });

        chrome.runtime.sendMessage({
          type: "offscreen:update-settings",
          target: "offscreen",
          payload: {
            settings: sessionState.settings,
          },
        }).catch((error) => {
          logWarning("Failed to forward updated settings to offscreen document.", error);
        });

        sendResponse({ ok: true, state: sessionState });
      })
      .catch((error) => {
        logWarning("Failed to update session settings.", error);
        sendResponse({ ok: false, error: t("errorCouldNotUpdateSettings") });
      });
    return true;
  }

  if (message.type === "offscreen:state") {
    ensureSessionStateLoaded()
      .then(() => setSessionState({ ...sessionState, ...message.payload }))
      .catch((error) => {
        logWarning("Failed to persist offscreen state update.", error);
      });
    return false;
  }

  if (message.type === "offscreen:error") {
    handleCaptureFailure(message.payload?.error || t("errorAudioProcessing")).catch((error) => {
      logWarning("Failed to handle offscreen processing error.", error);
    });
    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  ensureSessionStateLoaded()
    .then(() => {
      if (sessionState.tabId !== tabId) {
        return;
      }
      return stopCapture();
    })
    .catch((error) => {
      logWarning("Failed to react to tab removal while capture was active.", error);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  ensureSessionStateLoaded()
    .then(async () => {
      if (!sessionState.running || sessionState.tabId !== tabId) {
        return;
      }

      if (typeof changeInfo.title !== "string" && typeof tab?.title !== "string") {
        return;
      }

      const nextTitle = changeInfo.title || tab?.title || "";
      if (sessionState.tabTitle === nextTitle) {
        return;
      }

      await setSessionState({
        ...sessionState,
        tabTitle: nextTitle,
      });
      broadcastSessionState();
    })
    .catch((error) => {
      logWarning("Failed to react to tab title update while capture was active.", error);
    });
});
