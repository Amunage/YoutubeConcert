const OFFSCREEN_PATH = "src/offscreen/offscreen.html";

let sessionState = {
  running: false,
  tabId: null,
  tabTitle: "",
  startedAt: 0,
  settings: null,
  lastError: "",
};

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

async function startCapture(request = {}) {
  const targetTab = await getTabForCapture(request.tabId);
  await ensureOffscreenDocument();

  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: targetTab.id,
  });

  sessionState = {
    running: true,
    tabId: targetTab.id,
    tabTitle: targetTab.title || "",
    startedAt: Date.now(),
    settings: request.settings || null,
    lastError: "",
  };

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

async function stopCapture() {
  try {
    await chrome.runtime.sendMessage({
      type: "offscreen:stop-capture",
      target: "offscreen",
    });
  } catch (error) {
  }

  sessionState = {
    running: false,
    tabId: null,
    tabTitle: "",
    startedAt: 0,
    settings: null,
    lastError: "",
  };

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
    sendResponse({ ok: true, state: sessionState });
    return false;
  }

  if (message.type === "popup:start-capture") {
    startCapture(message.payload)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => {
        sessionState = {
          ...sessionState,
          running: false,
          lastError: error.message || "Could not start tab audio capture.",
        };
        sendResponse({ ok: false, error: sessionState.lastError, state: sessionState });
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
    sessionState = {
      ...sessionState,
      settings: message.payload?.settings || sessionState.settings,
    };

    chrome.runtime.sendMessage({
      type: "offscreen:update-settings",
      target: "offscreen",
      payload: {
        settings: sessionState.settings,
      },
    }).catch(() => {});

    sendResponse({ ok: true, state: sessionState });
    return false;
  }

  if (message.type === "offscreen:state") {
    sessionState = {
      ...sessionState,
      ...message.payload,
    };
    return false;
  }

  if (message.type === "offscreen:error") {
    sessionState = {
      ...sessionState,
      running: false,
      lastError: message.payload?.error || "An audio processing error occurred.",
    };
    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (sessionState.tabId !== tabId) {
    return;
  }
  stopCapture().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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

  sessionState = {
    ...sessionState,
    tabTitle: nextTitle,
  };
  broadcastSessionState();
});
