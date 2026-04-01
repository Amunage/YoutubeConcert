const OFFSCREEN_PATH = "src/offscreen/offscreen.html";
const SESSION_STATE_KEY = "concertSessionState";

let sessionState = {
  running: false,
  tabId: null,
  tabTitle: "",
  startedAt: 0,
  settings: null,
  lastError: "",
};

let sessionStateReady = null;

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
      .catch(() => {
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
    throw new Error("Could not find an active tab.");
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
  } catch {
  }

  return sessionState;
}

async function startCapture(request = {}) {
  await ensureSessionStateLoaded();
  if (await hasOffscreenDocument()) {
    await closeOffscreenDocument().catch(() => {});
  }
  const targetTab = await getTabForCapture(request.tabId);
  await ensureOffscreenDocument();

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

async function handleCaptureFailure(errorMessage = "An audio processing error occurred.") {
  await setSessionState({
    ...sessionState,
    running: false,
    tabId: null,
    tabTitle: "",
    startedAt: 0,
    lastError: errorMessage,
  });
  await closeOffscreenDocument().catch(() => {});
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
  } catch {
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
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  if (message.type === "popup:get-state") {
    ensureSessionStateLoaded()
      .then(() => syncStateFromOffscreen())
      .then((state) => sendResponse({ ok: true, state }))
      .catch(() => sendResponse({ ok: true, state: sessionState }));
    return true;
  }

  if (message.type === "popup:start-capture") {
    startCapture(message.payload)
      .then((state) => sendResponse({ ok: true, state }))
      .catch(async (error) => {
        const failedState = await handleCaptureFailure(error.message || "Could not start tab audio capture.");
        sendResponse({ ok: false, error: failedState.lastError, state: failedState });
      });
    return true;
  }

  if (message.type === "popup:stop-capture") {
    stopCapture()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || "Could not stop tab audio capture." });
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
        }).catch(() => {});

        sendResponse({ ok: true, state: sessionState });
      })
      .catch(() => sendResponse({ ok: false, error: "Could not update settings." }));
    return true;
  }

  if (message.type === "offscreen:state") {
    ensureSessionStateLoaded()
      .then(() => setSessionState({ ...sessionState, ...message.payload }))
      .catch(() => {});
    return false;
  }

  if (message.type === "offscreen:error") {
    handleCaptureFailure(message.payload?.error || "An audio processing error occurred.").catch(() => {});
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
    .catch(() => {});
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
    .catch(() => {});
});
