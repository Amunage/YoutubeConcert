import { DEFAULT_SETTINGS, withDefaults } from "../lib/presets.js";

const controls = {
  toggleButton: document.getElementById("toggleButton"),
  statusText: document.getElementById("statusText"),
  tabMeta: document.getElementById("tabMeta"),
  advancedOptions: document.getElementById("advancedOptions"),
  roomPreset: document.getElementById("roomPreset"),
  audiencePreset: document.getElementById("audiencePreset"),
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
};

const SETTINGS_STORAGE_KEY = "concertSettings";
const ADVANCED_OPEN_KEY = "concertAdvancedOpen";
const SETTINGS_DEBOUNCE_MS = 140;

const settingFields = [
  "roomPreset",
  "audiencePreset",
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
];

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

function getSettingsFromForm() {
  return withDefaults({
    roomPreset: controls.roomPreset.value,
    audiencePreset: controls.audiencePreset.value,
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
  });
}

function applySettingsToForm(settings = DEFAULT_SETTINGS) {
  const safe = withDefaults(settings);
  controls.roomPreset.value = safe.roomPreset;
  controls.audiencePreset.value = safe.audiencePreset;
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
  syncValueLabels();
}

function syncValueLabels() {
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
  controls.statusText.textContent = running ? "Live processing" : currentState.lastError || "Idle";
  controls.toggleButton.textContent = running ? "Stop" : "Start Current Tab";
  controls.toggleButton.classList.toggle("is-running", running);
  controls.tabMeta.textContent = currentState.tabTitle ? `${currentState.tabTitle}` : "";
}

async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: "popup:get-state" });
  if (!response?.ok) return;
  currentState = { ...currentState, ...response.state, settings: withDefaults(response.state?.settings) };
  applySettingsToForm(currentState.settings);
  renderState();
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
    pendingSettingsPromise = persistSettings().catch(() => {});
  }, delayMs);
}

async function flushQueuedSettings() {
  clearPendingSettingsTimer();
  pendingSettingsPromise = persistSettings().catch(() => {});
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
  const settings = getSettingsFromForm();
  clearPendingSettingsTimer();
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });

  if (currentState.running) {
    const response = await chrome.runtime.sendMessage({ type: "popup:stop-capture" });
    if (response?.ok) {
      currentState = { ...currentState, ...response.state, settings };
      renderState();
    }
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await chrome.runtime.sendMessage({
    type: "popup:start-capture",
    payload: { tabId: activeTab?.id, settings },
  });

  if (response?.ok) {
    currentState = { ...currentState, ...response.state, settings, lastError: "" };
  } else {
    currentState = { ...currentState, running: false, lastError: response?.error || "Could not start capture.", settings };
  }
  renderState();
}

controls.toggleButton.addEventListener("click", toggleCapture);
controls.advancedOptions.addEventListener("toggle", () => {
  persistAdvancedOpen().catch(() => {});
});

settingFields.forEach((fieldName) => {
  const element = controls[fieldName];
  element.addEventListener("input", () => {
    syncValueLabels();
    queueSettingsPersist();
  });
  element.addEventListener("change", () => {
    syncValueLabels();
    flushQueuedSettings().catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "offscreen:state") {
    currentState = { ...currentState, ...message.payload, settings: withDefaults(message.payload?.settings) };
    renderState();
  }
  if (message?.type === "offscreen:error") {
    currentState = { ...currentState, running: false, lastError: message.payload?.error || "Audio processing error" };
    renderState();
  }
});

await loadStoredSettings();
await refreshState();
syncValueLabels();
