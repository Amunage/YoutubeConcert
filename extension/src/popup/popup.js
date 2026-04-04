import { DEFAULT_SETTINGS, withDefaults } from "../lib/presets.js";

const controls = {
  toggleButton: document.getElementById("toggleButton"),
  statusText: document.getElementById("statusText"),
  hoverHint: document.getElementById("hoverHint"),
  tabMeta: document.getElementById("tabMeta"),
  tabMetaTrack: document.getElementById("tabMetaTrack"),
  tabMetaText: document.getElementById("tabMetaText"),
  tabMetaTextClone: document.getElementById("tabMetaTextClone"),
  appVersion: document.getElementById("appVersion"),
  advancedOptions: document.getElementById("advancedOptions"),
  resetAdvancedButton: document.getElementById("resetAdvancedButton"),
  roomPreset: document.getElementById("roomPreset"),
  audiencePosition: document.getElementById("audiencePosition"),
  audiencePositionValue: document.getElementById("audiencePositionValue"),
  cloneCount: document.getElementById("cloneCount"),
  cloneCountValue: document.getElementById("cloneCountValue"),
  delayMs: document.getElementById("delayMs"),
  delayMsValue: document.getElementById("delayMsValue"),
  ensembleVolume: document.getElementById("ensembleVolume"),
  ensembleVolumeValue: document.getElementById("ensembleVolumeValue"),
  volumeDecay: document.getElementById("volumeDecay"),
  volumeDecayValue: document.getElementById("volumeDecayValue"),
  reverbIntensity: document.getElementById("reverbIntensity"),
  reverbIntensityValue: document.getElementById("reverbIntensityValue"),
  diffusionAmount: document.getElementById("diffusionAmount"),
  diffusionAmountValue: document.getElementById("diffusionAmountValue"),
  auxiliaryAmount: document.getElementById("auxiliaryAmount"),
  auxiliaryAmountValue: document.getElementById("auxiliaryAmountValue"),
  peakSuppression: document.getElementById("peakSuppression"),
  peakSuppressionValue: document.getElementById("peakSuppressionValue"),
  directMixTrim: document.getElementById("directMixTrim"),
  directMixTrimValue: document.getElementById("directMixTrimValue"),
  preDelayScale: document.getElementById("preDelayScale"),
  preDelayScaleValue: document.getElementById("preDelayScaleValue"),
  tailGainScale: document.getElementById("tailGainScale"),
  tailGainScaleValue: document.getElementById("tailGainScaleValue"),
  reflectionSpacing: document.getElementById("reflectionSpacing"),
  reflectionSpacingValue: document.getElementById("reflectionSpacingValue"),
  dynamicWetTrimStrength: document.getElementById("dynamicWetTrimStrength"),
  dynamicWetTrimStrengthValue: document.getElementById("dynamicWetTrimStrengthValue"),
  experimentalLargeSpaceModulation: document.getElementById("experimentalLargeSpaceModulation"),
  experimentalSubtleSpaceResponse: document.getElementById("experimentalSubtleSpaceResponse"),
  experimentalCrowdReaction: document.getElementById("experimentalCrowdReaction"),
};

controls.appVersion.textContent = `v${chrome.runtime.getManifest().version}`;

const SETTINGS_STORAGE_KEY = "concertSettings";
const ADVANCED_OPEN_KEY = "concertAdvancedOpen";
const SETTINGS_DEBOUNCE_MS = 140;
const STATUS_RESET_DELAY_MS = 4200;
const INITIAL_STATE_RETRY_DELAY_MS = 180;
const HOVER_HINT_DELAY_MS = 480;
const HOVER_HINT_OFFSET_X = 14;
const HOVER_HINT_OFFSET_Y = 12;

const settingFields = [
  "roomPreset",
  "audiencePosition",
  "cloneCount",
  "delayMs",
  "ensembleVolume",
  "volumeDecay",
  "reverbIntensity",
  "diffusionAmount",
  "auxiliaryAmount",
  "peakSuppression",
  "directMixTrim",
  "preDelayScale",
  "tailGainScale",
  "reflectionSpacing",
  "dynamicWetTrimStrength",
  "experimentalLargeSpaceModulation",
  "experimentalSubtleSpaceResponse",
  "experimentalCrowdReaction",
];

const basicSettingFields = [
  "roomPreset",
  "audiencePosition",
  "cloneCount",
  "delayMs",
];

const advancedSettingFields = [
  "ensembleVolume",
  "volumeDecay",
  "reverbIntensity",
  "diffusionAmount",
  "auxiliaryAmount",
  "peakSuppression",
  "directMixTrim",
  "preDelayScale",
  "tailGainScale",
  "reflectionSpacing",
  "dynamicWetTrimStrength",
  "experimentalLargeSpaceModulation",
  "experimentalSubtleSpaceResponse",
  "experimentalCrowdReaction",
];

const hoverHintKeys = {
  roomPreset: "hintRoomPreset",
  audiencePosition: "hintAudiencePosition",
  cloneCount: "hintCloneCount",
  delayMs: "hintDelayMs",
  ensembleVolume: "hintEnsembleVolume",
  volumeDecay: "hintVolumeDecay",
  reverbIntensity: "hintReverbIntensity",
  diffusionAmount: "hintDiffusionAmount",
  auxiliaryAmount: "hintAuxiliaryAmount",
  peakSuppression: "hintPeakSuppression",
  directMixTrim: "hintDirectMixTrim",
  preDelayScale: "hintPreDelayScale",
  tailGainScale: "hintTailGainScale",
  reflectionSpacing: "hintReflectionSpacing",
  dynamicWetTrimStrength: "hintDynamicWetTrimStrength",
  experimentalLargeSpaceModulation: "hintExperimentalLargeSpaceModulation",
  experimentalSubtleSpaceResponse: "hintExperimentalSubtleSpaceResponse",
  experimentalCrowdReaction: "hintExperimentalCrowdReaction",
};

let currentState = {
  running: false,
  tabId: null,
  tabTitle: "",
  startedAt: 0,
  settings: withDefaults(),
  lastError: "",
};

let pendingSettingsTimer = null;
let pendingSettingsPromise = Promise.resolve();
let statusResetTimer = null;
let transientStatusMessage = "";
let transientStatusIsError = false;
let hoverHintTimer = null;
let hoverHintTarget = null;

function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function applyI18n() {
  document.title = t("popupTitle");
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0] || "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
}

function getAudienceLabelForPositionLocalized(position) {
  const numericPosition = Number(position);
  if (numericPosition >= 10) return t("audienceLabelOutside");
  if (numericPosition >= 7) return t("audienceLabelRear");
  if (numericPosition >= 4) return t("audienceLabelMiddle");
  return t("audienceLabelFront");
}

function logWarning(message, error) {
  if (error) {
    console.warn(`[YTConcert] ${message}`, error);
    return;
  }
  console.warn(`[YTConcert] ${message}`);
}

function clearStatusResetTimer() {
  if (statusResetTimer === null) {
    return;
  }
  clearTimeout(statusResetTimer);
  statusResetTimer = null;
}

function clearTransientStatus() {
  transientStatusMessage = "";
  transientStatusIsError = false;
}

function clearHoverHintTimer() {
  if (hoverHintTimer === null) {
    return;
  }
  clearTimeout(hoverHintTimer);
  hoverHintTimer = null;
}

function hideHoverHint() {
  clearHoverHintTimer();
  hoverHintTarget = null;
  controls.hoverHint.classList.remove("is-visible");
  controls.hoverHint.setAttribute("aria-hidden", "true");
}

function positionHoverHint(target) {
  const rect = target.getBoundingClientRect();
  const hintRect = controls.hoverHint.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - hintRect.width - 8);
  const preferredLeft = rect.left + HOVER_HINT_OFFSET_X;
  const left = Math.min(Math.max(8, preferredLeft), maxLeft);
  const fitsBelow = rect.bottom + HOVER_HINT_OFFSET_Y + hintRect.height <= window.innerHeight - 8;
  const top = fitsBelow
    ? rect.bottom + HOVER_HINT_OFFSET_Y
    : Math.max(8, rect.top - hintRect.height - HOVER_HINT_OFFSET_Y);
  controls.hoverHint.style.left = `${left}px`;
  controls.hoverHint.style.top = `${top}px`;
}

function showHoverHint(target, message) {
  hoverHintTarget = target;
  controls.hoverHint.textContent = message;
  controls.hoverHint.setAttribute("aria-hidden", "false");
  controls.hoverHint.classList.add("is-visible");
  positionHoverHint(target);
}

function scheduleHoverHint(target, message) {
  clearHoverHintTimer();
  hoverHintTimer = setTimeout(() => {
    hoverHintTimer = null;
    if (hoverHintTarget !== target) {
      return;
    }
    showHoverHint(target, message);
  }, HOVER_HINT_DELAY_MS);
}

function attachHoverHint(fieldName, target) {
  const key = hoverHintKeys[fieldName];
  const message = key ? t(key) : "";
  if (!message || !target) {
    return;
  }

  target.dataset.hoverHint = message;

  const handleEnter = () => {
    hoverHintTarget = target;
    scheduleHoverHint(target, message);
  };
  const handleLeave = () => {
    if (hoverHintTarget === target) {
      hideHoverHint();
    }
  };

  target.addEventListener("pointerenter", handleEnter);
  target.addEventListener("pointerleave", handleLeave);
  target.addEventListener("focusin", handleEnter);
  target.addEventListener("focusout", handleLeave);
}

function setupHoverHints() {
  [...basicSettingFields, ...advancedSettingFields].forEach((fieldName) => {
    const element = controls[fieldName];
    if (!element) {
      return;
    }

    const target = element.closest(".field, .toggle-field");
    attachHoverHint(fieldName, target);
  });

  window.addEventListener("scroll", () => {
    if (hoverHintTarget && controls.hoverHint.classList.contains("is-visible")) {
      positionHoverHint(hoverHintTarget);
    }
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (hoverHintTarget && controls.hoverHint.classList.contains("is-visible")) {
      positionHoverHint(hoverHintTarget);
    }
  });
}

function scheduleTransientStatusReset() {
  clearStatusResetTimer();
  statusResetTimer = setTimeout(() => {
    statusResetTimer = null;
    clearTransientStatus();
    renderState();
  }, STATUS_RESET_DELAY_MS);
}

function showTransientError(message, options = {}) {
  const { shouldReset = true } = options;
  transientStatusMessage = message;
  transientStatusIsError = true;
  renderState();
  if (shouldReset) {
    scheduleTransientStatusReset();
  }
}

function updateTabMeta() {
  const title = (currentState.tabTitle || "").trim();
  controls.tabMetaText.textContent = title;
  controls.tabMetaTextClone.textContent = title;
  controls.tabMeta.classList.toggle("is-empty", !title);
  controls.tabMeta.classList.remove("is-scrolling");
  controls.tabMeta.style.removeProperty("--tab-scroll-duration");
  controls.tabMeta.style.removeProperty("--tab-scroll-distance");

  if (!title) {
    return;
  }

  requestAnimationFrame(() => {
    const shouldScroll = controls.tabMetaText.scrollWidth > controls.tabMeta.clientWidth;
    if (!shouldScroll) {
      return;
    }

    const trackGap = 60;
    const scrollDistance = controls.tabMetaText.scrollWidth + trackGap;
    const durationSeconds = Math.max(8, Math.ceil(scrollDistance / 28));
    controls.tabMeta.style.setProperty("--tab-scroll-distance", `${scrollDistance}px`);
    controls.tabMeta.style.setProperty("--tab-scroll-duration", `${durationSeconds}s`);
    controls.tabMeta.classList.add("is-scrolling");
  });
}

function getSettingsFromForm() {
  return withDefaults({
    roomPreset: controls.roomPreset.value,
    audiencePosition: Number(controls.audiencePosition.value),
    cloneCount: Number(controls.cloneCount.value),
    delayMs: Number(controls.delayMs.value),
    ensembleVolume: Number(controls.ensembleVolume.value),
    volumeDecay: Number(controls.volumeDecay.value),
    reverbIntensity: Number(controls.reverbIntensity.value),
    diffusionAmount: Number(controls.diffusionAmount.value),
    auxiliaryAmount: Number(controls.auxiliaryAmount.value),
    peakSuppression: Number(controls.peakSuppression.value),
    directMixTrim: Number(controls.directMixTrim.value),
    preDelayScale: Number(controls.preDelayScale.value),
    tailGainScale: Number(controls.tailGainScale.value),
    reflectionSpacing: Number(controls.reflectionSpacing.value),
    dynamicWetTrimStrength: Number(controls.dynamicWetTrimStrength.value),
    experimentalLargeSpaceModulation: controls.experimentalLargeSpaceModulation.checked,
    experimentalSubtleSpaceResponse: controls.experimentalSubtleSpaceResponse.checked,
    experimentalCrowdReaction: controls.experimentalCrowdReaction.checked,
  });
}

function applySettingsToForm(settings = DEFAULT_SETTINGS) {
  const safe = withDefaults(settings);
  controls.roomPreset.value = safe.roomPreset;
  controls.audiencePosition.value = safe.audiencePosition;
  controls.cloneCount.value = safe.cloneCount;
  controls.delayMs.value = safe.delayMs;
  controls.ensembleVolume.value = safe.ensembleVolume;
  controls.volumeDecay.value = safe.volumeDecay;
  controls.reverbIntensity.value = safe.reverbIntensity;
  controls.diffusionAmount.value = safe.diffusionAmount;
  controls.auxiliaryAmount.value = safe.auxiliaryAmount;
  controls.peakSuppression.value = safe.peakSuppression;
  controls.directMixTrim.value = safe.directMixTrim;
  controls.preDelayScale.value = safe.preDelayScale;
  controls.tailGainScale.value = safe.tailGainScale;
  controls.reflectionSpacing.value = safe.reflectionSpacing;
  controls.dynamicWetTrimStrength.value = safe.dynamicWetTrimStrength;
  controls.experimentalLargeSpaceModulation.checked = Boolean(safe.experimentalLargeSpaceModulation);
  controls.experimentalSubtleSpaceResponse.checked = Boolean(safe.experimentalSubtleSpaceResponse);
  controls.experimentalCrowdReaction.checked = Boolean(safe.experimentalCrowdReaction);
  syncValueLabels();
}

function applyAdvancedDefaultsToForm() {
  advancedSettingFields.forEach((fieldName) => {
    const element = controls[fieldName];
    const defaultValue = DEFAULT_SETTINGS[fieldName];
    if (element.type === "checkbox") {
      element.checked = Boolean(defaultValue);
      return;
    }
    element.value = defaultValue;
  });
  syncValueLabels();
}

function syncValueLabels() {
  controls.audiencePositionValue.textContent = `${controls.audiencePosition.value} - ${getAudienceLabelForPositionLocalized(Number(controls.audiencePosition.value))}`;
  controls.cloneCountValue.textContent = `${controls.cloneCount.value}`;
  controls.delayMsValue.textContent = `${controls.delayMs.value}ms`;
  controls.ensembleVolumeValue.textContent = `${controls.ensembleVolume.value}%`;
  controls.volumeDecayValue.textContent = `${controls.volumeDecay.value}%`;
  controls.reverbIntensityValue.textContent = `${controls.reverbIntensity.value}%`;
  controls.diffusionAmountValue.textContent = `${controls.diffusionAmount.value}%`;
  controls.auxiliaryAmountValue.textContent = `${controls.auxiliaryAmount.value}%`;
  controls.peakSuppressionValue.textContent = `${controls.peakSuppression.value}%`;
  controls.directMixTrimValue.textContent = `${controls.directMixTrim.value}%`;
  controls.preDelayScaleValue.textContent = `${controls.preDelayScale.value}%`;
  controls.tailGainScaleValue.textContent = `${controls.tailGainScale.value}%`;
  controls.reflectionSpacingValue.textContent = `${controls.reflectionSpacing.value}%`;
  controls.dynamicWetTrimStrengthValue.textContent = `${controls.dynamicWetTrimStrength.value}%`;
}

function renderState() {
  const running = Boolean(currentState.running);
  const statusMessage = transientStatusMessage || (running ? t("statusLiveProcessing") : currentState.lastError || t("statusIdle"));
  const isError = transientStatusIsError || (!running && Boolean(currentState.lastError));
  controls.statusText.textContent = statusMessage;
  controls.statusText.classList.toggle("is-error", isError);
  controls.toggleButton.textContent = running ? t("stopButton") : t("startButton");
  controls.toggleButton.classList.toggle("is-running", running);
  updateTabMeta();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: "popup:get-state" });
  if (!response?.ok) return;
  clearTransientStatus();
  currentState = { ...currentState, ...response.state, settings: withDefaults(response.state?.settings) };
  applySettingsToForm(currentState.settings);
  renderState();
}

async function refreshStateWithRetry(retries = 1) {
  try {
    await refreshState();
  } catch (error) {
    if (retries <= 0) {
      throw error;
    }
    await delay(INITIAL_STATE_RETRY_DELAY_MS);
    await refreshStateWithRetry(retries - 1);
  }
}

async function persistSettings() {
  const settings = getSettingsFromForm();
  currentState.settings = settings;
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
  await chrome.runtime.sendMessage({ type: "popup:update-settings", payload: { settings } });
}

function clearPendingSettingsTimer() {
  if (pendingSettingsTimer === null) {
    return;
  }
  clearTimeout(pendingSettingsTimer);
  pendingSettingsTimer = null;
}

function queueSettingsPersist(delayMs = SETTINGS_DEBOUNCE_MS) {
  currentState.settings = getSettingsFromForm();
  clearPendingSettingsTimer();
  pendingSettingsTimer = setTimeout(() => {
    pendingSettingsTimer = null;
    pendingSettingsPromise = persistSettings().catch((error) => {
      logWarning("Failed to persist queued settings.", error);
      showTransientError(t("errorCouldNotSaveSettings"));
    });
  }, delayMs);
}

async function flushQueuedSettings() {
  clearPendingSettingsTimer();
  pendingSettingsPromise = persistSettings().catch((error) => {
    logWarning("Failed to flush queued settings.", error);
    showTransientError(t("errorCouldNotSaveSettings"));
  });
  await pendingSettingsPromise;
}

async function loadStoredSettings() {
  const stored = await chrome.storage.local.get([SETTINGS_STORAGE_KEY, ADVANCED_OPEN_KEY]);
  currentState.settings = withDefaults(stored[SETTINGS_STORAGE_KEY]);
  controls.advancedOptions.open = Boolean(stored[ADVANCED_OPEN_KEY]);
  applySettingsToForm(currentState.settings);
}

async function persistAdvancedOpen() {
  await chrome.storage.local.set({ [ADVANCED_OPEN_KEY]: controls.advancedOptions.open });
}

async function toggleCapture() {
  try {
    const settings = getSettingsFromForm();
    clearPendingSettingsTimer();
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });

    if (currentState.running) {
      const response = await chrome.runtime.sendMessage({ type: "popup:stop-capture" });
      if (response?.ok) {
        clearTransientStatus();
        currentState = { ...currentState, ...response.state, settings };
        renderState();
      } else {
        showTransientError(response?.error || t("errorCouldNotStopCapture"));
      }
      return;
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      type: "popup:start-capture",
      payload: { tabId: activeTab?.id, settings },
    });

    if (response?.ok) {
      clearStatusResetTimer();
      clearTransientStatus();
      currentState = { ...currentState, ...response.state, settings, lastError: "" };
    } else {
      currentState = { ...currentState, running: false, lastError: response?.error || t("errorCouldNotStartCapture"), settings };
    }
    renderState();
  } catch (error) {
    logWarning("Toggle capture failed.", error);
    showTransientError(t("errorCouldNotUpdateCaptureState"));
  }
}

controls.toggleButton.addEventListener("click", toggleCapture);
controls.resetAdvancedButton.addEventListener("click", () => {
  applyAdvancedDefaultsToForm();
  flushQueuedSettings().catch((error) => {
    logWarning("Failed to reset advanced settings.", error);
    showTransientError(t("errorCouldNotSaveSettings"));
  });
});
controls.advancedOptions.addEventListener("toggle", () => {
  persistAdvancedOpen().catch((error) => {
    logWarning("Failed to persist advanced section state.", error);
  });
});

settingFields.forEach((fieldName) => {
  const element = controls[fieldName];
  element.addEventListener("input", () => {
    syncValueLabels();
    queueSettingsPersist();
  });
  element.addEventListener("change", () => {
    syncValueLabels();
    flushQueuedSettings().catch((error) => {
      logWarning(`Failed to save setting change for ${fieldName}.`, error);
      showTransientError(t("errorCouldNotSaveSettings"));
    });
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "offscreen:state") {
    clearTransientStatus();
    currentState = { ...currentState, ...message.payload, settings: withDefaults(message.payload?.settings) };
    renderState();
  }
  if (message?.type === "offscreen:error") {
    currentState = { ...currentState, running: false, lastError: message.payload?.error || t("errorAudioProcessing") };
    renderState();
    scheduleTransientStatusReset();
  }
});

applyI18n();

try {
  await loadStoredSettings();
} catch (error) {
  logWarning("Failed to load stored popup settings.", error);
  applySettingsToForm(currentState.settings);
}

try {
  await refreshStateWithRetry();
} catch (error) {
  logWarning("Initial popup state refresh failed; falling back to local defaults.", error);
  renderState();
}

setupHoverHints();
syncValueLabels();
