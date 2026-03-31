const {
  getLayerBlend,
  getTrackVolume,
  getTrackEffectStrength,
  getAudienceTrackProfile,
  getRoomPresetConfig,
  getPanPosition,
  getLayerVariation,
  getAudiencePresetConfig,
  ensureOutputChain,
  setOutputVolume,
  setMasterBusProfile,
  scheduleLayeredTrack,
} = window.AudioEngine;

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getMaxMs(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  return values.reduce((maxValue, value) => Math.max(maxValue, Number(value) || 0), 0);
}

function estimatePlaybackTailSeconds(settings) {
  const activeSettings = settings || playbackSettings;
  if (!activeSettings || isOriginalMode) {
    return 0;
  }

  const preset = getRoomPresetConfig(activeSettings.roomPreset);
  const audience = getAudiencePresetConfig(activeSettings.audiencePreset);
  const trackCount = Math.max(1, activeSettings.count || 1);
  const effectiveDelayMs = activeSettings.delayMs * audience.delayScale;

  return (
    ((trackCount - 1) * effectiveDelayMs +
      getMaxMs(preset.earlyReflectionsMs) +
      getMaxMs(audience.smearTapMs) +
      getMaxMs(audience.transientBlurTapMs)) / 1000 +
    Math.max(preset.reverbSeconds || 0, preset.lateReverbSeconds || 0, 0.15)
  );
}

function updatePlaybackUI(positionSeconds) {
  const duration = currentBuffer ? currentBuffer.duration : 0;
  playbackTimes.textContent = `${formatTime(positionSeconds)}/${formatTime(duration)}`;

  if (!duration || isSeeking) {
    return;
  }

  const ratio = clamp(positionSeconds / duration, 0, 1);
  playbackSlider.value = String(Math.round(ratio * 1000));
}

function stopProgressLoop() {
  if (progressAnimationFrame) {
    cancelAnimationFrame(progressAnimationFrame);
    progressAnimationFrame = null;
  }
}

function cleanupActivePlaybackGraph(stopSources) {
  const shouldStopSources = stopSources !== false;
  const visitedSources = new Set();

  activeNodes.forEach((node) => {
    if (shouldStopSources && node.source && !visitedSources.has(node.source)) {
      try {
        node.source.stop();
      } catch (error) {
      }
      visitedSources.add(node.source);
    }

    if (typeof node.cleanup === "function") {
      node.cleanup();
    }
  });

  activeNodes = [];
}

function startProgressLoop() {
  stopProgressLoop();

  const tick = () => {
    if (!audioContext || !currentBuffer) {
      return;
    }

    const elapsed = isPlaying ? Math.max(0, audioContext.currentTime - playbackStartedAt) : 0;
    const position = clamp(playbackOffset + elapsed, 0, currentBuffer.duration);
    updatePlaybackUI(position);

    if (isPlaying) {
      progressAnimationFrame = requestAnimationFrame(tick);
    }
  };

  progressAnimationFrame = requestAnimationFrame(tick);
}

function stopPlayback() {
  stopProgressLoop();
  clearPlaybackCompletionMonitor();
  cleanupActivePlaybackGraph(true);
  isPlaying = false;
  playbackEndTime = 0;
  playbackTailSeconds = 0;
  setPlayButtonState();
  updateMediaSessionPlaybackState();
}

function getCurrentPlaybackPosition() {
  if (!currentBuffer) {
    return 0;
  }
  if (!isPlaying || !audioContext) {
    return clamp(playbackOffset, 0, currentBuffer.duration);
  }

  const elapsed = Math.max(0, audioContext.currentTime - playbackStartedAt);
  return clamp(playbackOffset + elapsed, 0, currentBuffer.duration);
}

function renderTracks(
  count,
  delayMs,
  volumeDecay,
  reverbIntensity,
  diffusionAmount,
  auxiliaryAmount,
  peakSuppression
) {
  trackGrid.innerHTML = "";

  for (let index = 0; index < count; index += 1) {
    const card = document.createElement("article");
    const layerBlend = getLayerBlend(index, count);
    const volume = Math.round(getTrackVolume(100, volumeDecay, index));
    const reverb = Math.round(getTrackEffectStrength(reverbIntensity, index));
    const audienceTrack = getAudienceTrackProfile(audiencePreset, index, count);

    card.className = "track-card";
    card.innerHTML = `
      <strong>Layer ${index + 1}</strong>
      <span>
      ${Math.round(index * delayMs)} ms / 
      Volume ${volume}% / 
      Depth ${Math.round(layerBlend * 100)}% / 
      Reverb ${Math.round(clamp(reverb + audienceTrack.reverbExtra, 0, 100))}% / 
      Diffusion ${Math.round(clamp(diffusionAmount, 0, 100))}% / 
      Aux ${Math.round(clamp(auxiliaryAmount, 0, 100))}% / 
      Suppression ${Math.round(clamp(peakSuppression, 0, 100))}%
      </span>
    `;
    trackGrid.appendChild(card);
  }
}

function applyCurrentVolumeToOutput() {
  if (!audioContext) {
    return;
  }
  setOutputVolume(clamp(parseNumberInput(playerVolumeInput, 70), 0, 100) / 100, audioContext);
}

function applyCurrentMasterBusProfile(settings) {
  if (!audioContext) {
    return;
  }

  const activeSettings = settings || playbackSettings;
  setMasterBusProfile(
    {
      peakSuppression: activeSettings ? activeSettings.peakSuppression : 0,
      trackCount: activeSettings ? activeSettings.count : 1,
      isOriginalMode: isOriginalMode,
    },
    audioContext
  );
}

function clearPlaybackCompletionMonitor() {
  if (playbackMonitorTimer) {
    clearTimeout(playbackMonitorTimer);
    playbackMonitorTimer = null;
  }
}

function primeAudioSession() {
  if (!audioContext || hasPrimedAudioSession || audioContext.state !== "running") {
    return;
  }

  const buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = buffer;
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(audioContext.destination);
  source.start();
  source.onended = function () {
    try {
      source.disconnect();
    } catch (error) {
    }
    try {
      gain.disconnect();
    } catch (error) {
    }
  };

  hasPrimedAudioSession = true;
}

function ensureAudioKeepAlive() {
  if (!audioContext || audioKeepAliveNode || typeof audioContext.createConstantSource !== "function") {
    return;
  }

  const source = audioContext.createConstantSource();
  const gain = audioContext.createGain();
  source.offset.value = 0;
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(audioContext.destination);
  source.start();
  audioKeepAliveNode = source;
}

async function restorePlaybackSession() {
  if (!isPlaying) {
    return;
  }
  await startPlayback(playbackOffset);
}

function handlePlaybackCompletion() {
  if (!currentBuffer) {
    stopPlayback();
    return;
  }

  playbackOffset = 0;
  stopPlayback();
  advanceToNextTrack().catch((error) => {
    console.warn("track advance failed", error);
    setStatus("Next track failed.", true);
  });
}

function schedulePlaybackCompletionMonitor() {
  clearPlaybackCompletionMonitor();

  if (!currentBuffer) {
    return;
  }

  const remainingSeconds = Math.max(0, currentBuffer.duration - playbackOffset);
  const totalMs = Math.ceil((remainingSeconds + playbackTailSeconds) * 1000 + 80);
  playbackMonitorTimer = setTimeout(handlePlaybackCompletion, totalMs);
}

async function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Web Audio API is not available in this browser.");
    }
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  ensureOutputChain(audioContext);
  primeAudioSession();
  ensureAudioKeepAlive();
  applyCurrentVolumeToOutput();
  applyCurrentMasterBusProfile();
  return audioContext;
}

async function fetchResolvedInput(url) {
  const response = await fetch("/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to resolve the input.");
  }
  return payload;
}

async function fetchPlaylistEntry(url, index) {
  const response = await fetch("/api/playlist-entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url, index: index }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to fetch the playlist item.");
  }
  return payload.entry;
}

async function fetchPreparedTrack(url) {
  const response = await fetch("/api/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to prepare audio.");
  }
  return payload;
}

async function loadAudioBuffer(trackId) {
  const context = await ensureAudioContext();
  const response = await fetch(`/media/${encodeURIComponent(trackId)}`);
  if (!response.ok) {
    throw new Error("Audio file download failed.");
  }

  const arrayBuffer = await response.arrayBuffer();
  return context.decodeAudioData(arrayBuffer);
}

function playCurrentBuffer(startOffsetSeconds) {
  const safeOffset = Math.max(0, startOffsetSeconds || 0);
  cleanupActivePlaybackGraph(true);

  if (isOriginalMode) {
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const trimNode = audioContext.createGain();
    source.buffer = currentBuffer;
    gain.gain.value = 1;
    trimNode.gain.value = 1;
    source.connect(gain);
    gain.connect(trimNode);
    trimNode.connect(ensureOutputChain(audioContext));
    source.start(audioContext.currentTime, safeOffset);
    activeNodes.push({
      source: source,
      trimNode: trimNode,
      cleanup: function () {
        try {
          source.disconnect();
        } catch (error) {
        }
        try {
          gain.disconnect();
        } catch (error) {
        }
        try {
          trimNode.disconnect();
        } catch (error) {
        }
      },
    });
    return;
  }

  const settings = playbackSettings;
  for (let index = 0; index < settings.count; index += 1) {
    const volumeRatio = getTrackVolume(100, settings.volumeDecay, index) / 100;
    scheduleLayeredTrack(
      currentBuffer,
      audioContext.currentTime,
      safeOffset,
      volumeRatio,
      index,
      settings.delayMs,
      settings.reverbIntensity,
      settings.peakSuppression,
      settings.roomPreset,
      settings.audiencePreset,
      {
        variationSeedBase: currentTrackId || currentTrackUrl || "track",
        diffusionAmount: settings.diffusionAmount,
        auxiliaryAmount: settings.auxiliaryAmount,
      }
    );
  }
}

async function prepareAudio(url) {
  const prepared = await fetchPreparedTrack(url);
  currentTrackId = prepared.id;
  currentTrackUrl = url;
  currentBuffer = await loadAudioBuffer(prepared.id);
  isPrepared = true;
  playbackOffset = 0;
  updatePlaybackUI(0);
  return prepared;
}

async function startPlayback(startOffsetSeconds) {
  if (!currentBuffer) {
    throw new Error("No audio is loaded.");
  }

  await ensureAudioContext();
  const safeOffset = clamp(startOffsetSeconds ?? playbackOffset, 0, currentBuffer.duration);

  playCurrentBuffer(safeOffset);
  playbackOffset = safeOffset;
  playbackStartedAt = audioContext.currentTime;
  playbackTailSeconds = estimatePlaybackTailSeconds();
  playbackEndTime = playbackStartedAt + Math.max(0, currentBuffer.duration - safeOffset) + playbackTailSeconds;
  isPlaying = true;

  applyCurrentVolumeToOutput();
  applyCurrentMasterBusProfile();
  setPlayButtonState();
  updateMediaSessionPlaybackState();
  updatePlaybackUI(safeOffset);
  startProgressLoop();
  schedulePlaybackCompletionMonitor();
  prefetchUpcomingTrack();
}

function pausePlayback() {
  if (!currentBuffer) {
    return;
  }

  playbackOffset = getCurrentPlaybackPosition();
  stopPlayback();
  updatePlaybackUI(playbackOffset);
}
