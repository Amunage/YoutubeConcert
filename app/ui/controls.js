function setBusy(isBusy) {
  loadButton.disabled = isBusy;
  applySettingsButton.disabled = isBusy;
  playPauseButton.disabled = isBusy && !isPlaying;
  prevButton.disabled = isBusy;
  nextButton.disabled = isBusy;
  originalToggleButton.disabled = isBusy;
}

function updatePlayerVolumeUI() {
  const volume = clamp(parseNumberInput(playerVolumeInput, 70), 0, 100);
  muteButton.textContent = volume === 0 ? "Mute" : volume < 45 ? "Low" : "On";
}

function normalizeToggleLabels() {
  loopChip.classList.toggle("active", loopPlaybackInput.checked);
  shuffleChip.classList.toggle("active", shufflePlaybackInput.checked);
}

function refreshOriginalToggleButton() {
  originalToggleButton.classList.toggle("active", isOriginalMode);
  originalToggleButton.title = isOriginalMode ? "Concert mode off" : "Original mode";
  originalToggleButton.setAttribute("aria-label", originalToggleButton.title);
}

function updateMediaSessionMetadata(entry) {
  if (!("mediaSession" in navigator)) {
    return;
  }

  if (!entry) {
    navigator.mediaSession.metadata = null;
    return;
  }

  const artworkUrl = getTrackThumbnailUrl(entry);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: entry.title || "YouTube Concert",
    artist: isOriginalMode ? "Original Mode" : "Concert Mode",
    album: "YouTube Concert",
    artwork: artworkUrl ? [{ src: artworkUrl, sizes: "480x360", type: "image/jpeg" }] : [],
  });
}

function updateMediaSessionPlaybackState() {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }
}

function installMediaSessionHandlers() {
  if (!("mediaSession" in navigator)) {
    return;
  }

  const safeHandler = function (action, handler) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {
    }
  };

  safeHandler("play", function () {
    playPauseToggle().catch(function (error) {
      console.warn("media session play failed", error);
    });
  });
  safeHandler("pause", function () {
    pausePlayback();
  });
  safeHandler("previoustrack", function () {
    playAdjacentTrack(-1).catch(function (error) {
      console.warn("media session previous failed", error);
    });
  });
  safeHandler("nexttrack", function () {
    playAdjacentTrack(1).catch(function (error) {
      console.warn("media session next failed", error);
    });
  });
}

function arePlaybackSettingsEqual(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    left.count === right.count &&
    left.delayMs === right.delayMs &&
    left.volumeDecay === right.volumeDecay &&
    left.reverbIntensity === right.reverbIntensity &&
    left.diffusionAmount === right.diffusionAmount &&
    left.auxiliaryAmount === right.auxiliaryAmount &&
    left.peakSuppression === right.peakSuppression &&
    left.roomPreset === right.roomPreset &&
    left.audiencePreset === right.audiencePreset
  );
}

function canApplyLiveBaseVolumeOnly(previousSettings, nextSettings) {
  return false;
}

function applyActiveEnsembleTrim(previousSettings, nextSettings) {
  return;
}

function readPlaybackSettings() {
  return {
    count: clamp(parseNumberInput(cloneCountInput, 3), 1, 8),
    delayMs: Math.max(0, parseNumberInput(delayMsInput, 160)),
    volumeDecay: clamp(parseNumberInput(volumeDecayInput, 50), 0, 100),
    reverbIntensity: clamp(parseNumberInput(reverbIntensityInput, 40), 0, 100),
    diffusionAmount: clamp(parseNumberInput(diffusionAmountInput, 90), 0, 100),
    auxiliaryAmount: clamp(parseNumberInput(auxiliaryAmountInput, 90), 0, 100),
    peakSuppression: clamp(parseNumberInput(peakSuppressionInput, 70), 0, 100),
    roomPreset: roomPresetInput.value || "hall",
    audiencePreset: audiencePresetInput.value || "mid",
  };
}

async function applyPlaybackSettings() {
  const nextSettings = readPlaybackSettings();
  const previousSettings = playbackSettings;

  renderTrackPreviewFromInputs();

  if (!previousSettings) {
    playbackSettings = nextSettings;
    return;
  }

  if (arePlaybackSettingsEqual(previousSettings, nextSettings)) {
    playbackSettings = nextSettings;
    setStatus("Settings are already applied.");
    return;
  }

  if (isPlaying && canApplyLiveBaseVolumeOnly(previousSettings, nextSettings)) {
    applyActiveEnsembleTrim(previousSettings, nextSettings);
    playbackSettings = nextSettings;
    setStatus("Volume applied live.");
    return;
  }

  const shouldResume = isPlaying;
  const resumeOffset = getCurrentPlaybackPosition();
  playbackSettings = nextSettings;

  if (shouldResume && currentBuffer) {
    await startPlayback(resumeOffset);
    setStatus("Playback settings reapplied.");
  } else {
    setStatus("Playback settings updated.");
  }
}

function toggleMute() {
  const currentVolume = clamp(parseNumberInput(playerVolumeInput, 70), 0, 100);
  if (currentVolume === 0) {
    playerVolumeInput.value = String(clamp(previousVolumeBeforeMute || 70, 1, 100));
  } else {
    previousVolumeBeforeMute = currentVolume;
    playerVolumeInput.value = "0";
  }

  updatePlayerVolumeUI();
  applyCurrentVolumeToOutput();
}

function renderTrackPreviewFromInputs() {
  const settings = readPlaybackSettings();
  renderTracks(
    settings.count,
    settings.delayMs,
    settings.volumeDecay,
    settings.reverbIntensity,
    settings.diffusionAmount,
    settings.auxiliaryAmount,
    settings.peakSuppression,
    settings.roomPreset,
    settings.audiencePreset
  );
}

function needsReload(nextSettings) {
  return !playbackSettings || !arePlaybackSettingsEqual(playbackSettings, nextSettings);
}

function applyStatusMarquee() {
  inlineStatus.classList.toggle("is-error", inlineStatus.dataset.level === "error");
}

function setStatus(message, isError) {
  clearTimeout(statusTimer);
  inlineStatus.textContent = message || "";
  inlineStatus.dataset.level = isError ? "error" : "info";
  applyStatusMarquee();

  if (message) {
    statusTimer = setTimeout(function () {
      inlineStatus.textContent = "";
      inlineStatus.dataset.level = "info";
      applyStatusMarquee();
    }, 3200);
  }
}

function setPlayButtonState() {
  playPauseButton.textContent = isPlaying ? "Pause" : "Play";
  playPauseButton.title = isPlaying ? "Pause" : "Play";
  playPauseButton.setAttribute("aria-label", playPauseButton.title);
  playPauseButton.disabled = !currentBuffer && !currentTrackUrl;
}

function refreshToggleChips() {
  normalizeToggleLabels();
  refreshOriginalToggleButton();
}

async function playPauseToggle() {
  if (isPlaying) {
    pausePlayback();
    return;
  }

  if (!currentBuffer) {
    const url = String(youtubeUrlInput.value || "").trim();
    if (!url) {
      setStatus("Enter a YouTube URL first.", true);
      return;
    }
    await loadTrackFromUrl(url, true);
    return;
  }

  await startPlayback(playbackOffset);
}

function toggleOriginalMode() {
  isOriginalMode = !isOriginalMode;
  refreshOriginalToggleButton();
  updateMediaSessionMetadata(getCurrentPlaylistEntry());
  renderTrackPreviewFromInputs();

  if (isPlaying && currentBuffer) {
    startPlayback(getCurrentPlaybackPosition()).catch(function (error) {
      console.warn("original mode toggle failed", error);
      setStatus("Failed to switch playback mode.", true);
    });
  }
}

async function playAdjacentTrack(direction) {
  if (!playlistCount || playlistCount <= 1) {
    setStatus("There is no adjacent track.", true);
    return;
  }

  try {
    setBusy(true);
    await switchToAdjacentPlayableTrack(direction);
    await startPlayback(0);
  } finally {
    setBusy(false);
  }
}

async function loadTrackFromUrl(url, autoPlay) {
  setBusy(true);
  setStatus("Loading playlist information...");

  try {
    stopPlayback();
    currentBuffer = null;
    currentTrackId = null;
    currentTrackUrl = url;
    playbackOffset = 0;
    isPrepared = false;
    playbackSettings = readPlaybackSettings();

    const resolved = await fetchResolvedInput(url);
    seedPlaylistEntries(resolved);

    const initialIndex = clamp(Number(resolved.firstEntryIndex) || 0, 0, Math.max(0, playlistCount - 1));
    if (playOrder.length) {
      currentOrderPosition = Math.max(0, playOrder.indexOf(initialIndex));
    }

    const firstEntry = await ensurePlaylistEntry(initialIndex);
    await loadPreparedEntry(firstEntry);
    preloadPlaylistEntriesInBackground();
    if (autoPlay) {
      await startPlayback(0);
      setStatus("Track loaded and playing.");
    } else {
      setStatus("Track loaded.");
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Track loading failed.", true);
    throw error;
  } finally {
    setBusy(false);
  }
}

loadButton.addEventListener("click", function () {
  const url = String(youtubeUrlInput.value || "").trim();
  if (!url) {
    setStatus("Enter a YouTube URL first.", true);
    return;
  }

  loadTrackFromUrl(url, true).catch(function () {
  });
});

playPauseButton.addEventListener("click", function () {
  playPauseToggle().catch(function (error) {
    console.error(error);
    setStatus(error.message || "Playback failed.", true);
  });
});

applySettingsButton.addEventListener("click", function () {
  applyPlaybackSettings().catch(function (error) {
    console.error(error);
    setStatus(error.message || "Failed to apply settings.", true);
  });
});

prevButton.addEventListener("click", function () {
  playAdjacentTrack(-1).catch(function (error) {
    console.error(error);
    setStatus(error.message || "Track change failed.", true);
  });
});

nextButton.addEventListener("click", function () {
  playAdjacentTrack(1).catch(function (error) {
    console.error(error);
    setStatus(error.message || "Track change failed.", true);
  });
});

playlistSelect.addEventListener("change", function () {
  if (!playlistSelect.value) {
    return;
  }

  const playlistIndex = clamp(parseInt(playlistSelect.value, 10), 0, Math.max(0, playlistCount - 1));
  const newPosition = playOrder.indexOf(playlistIndex);
  currentOrderPosition = newPosition >= 0 ? newPosition : 0;

  setBusy(true);
  ensurePlaylistEntry(playlistIndex)
    .then(loadPreparedEntry)
    .then(function () {
      return startPlayback(0);
    })
    .catch(function (error) {
      console.error(error);
      setStatus(error.message || "Playlist item load failed.", true);
    })
    .finally(function () {
      setBusy(false);
    });
});

playbackSlider.addEventListener("input", function () {
  isSeeking = true;
  const duration = currentBuffer ? currentBuffer.duration : 0;
  const nextPosition = duration ? (Number(playbackSlider.value) / 1000) * duration : 0;
  if (playbackTimes) {
    playbackTimes.textContent = `${formatTime(nextPosition)}/${formatTime(duration)}`;
  }
});

playbackSlider.addEventListener("change", function () {
  if (!currentBuffer) {
    isSeeking = false;
    return;
  }

  const duration = currentBuffer.duration;
  playbackOffset = duration ? clamp((Number(playbackSlider.value) / 1000) * duration, 0, duration) : 0;
  isSeeking = false;

  if (isPlaying) {
    startPlayback(playbackOffset).catch(function (error) {
      console.error(error);
      setStatus(error.message || "Seek failed.", true);
    });
  } else {
    updatePlaybackUI(playbackOffset);
  }
});

playbackSlider.addEventListener("pointerdown", function () {
  isSeeking = true;
});

playbackSlider.addEventListener("pointerup", function () {
  if (!currentBuffer) {
    isSeeking = false;
  }
});

playerVolumeInput.addEventListener("input", function () {
  updatePlayerVolumeUI();
  applyCurrentVolumeToOutput();
});

muteButton.addEventListener("click", toggleMute);
loopPlaybackInput.addEventListener("change", refreshToggleChips);
shufflePlaybackInput.addEventListener("change", function () {
  const currentIndex = getCurrentPlaylistIndex() ?? 0;
  rebuildPlayOrder(currentIndex);
  refreshPlaylistSelect();
  refreshToggleChips();
});
originalToggleButton.addEventListener("click", toggleOriginalMode);

[cloneCountInput, delayMsInput, volumeDecayInput, reverbIntensityInput, diffusionAmountInput, auxiliaryAmountInput, peakSuppressionInput, roomPresetInput, audiencePresetInput].forEach(function (input) {
  input.addEventListener("input", renderTrackPreviewFromInputs);
  input.addEventListener("change", renderTrackPreviewFromInputs);
});

shutdownButton.addEventListener("click", function () {
  if (!APP_CONFIG.canShutdown) {
    setStatus("Shutdown is only available on localhost.", true);
    return;
  }

  shutdownButton.disabled = true;
  setStatus("Shutdown requested.");

  fetch("/api/shutdown", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": APP_CONFIG.adminToken || "",
    },
    body: JSON.stringify({}),
  })
    .then(function (response) {
      if (!response.ok) {
        return response.json().then(function (payload) {
          throw new Error(payload.error || "Shutdown failed.");
        });
      }
      setTimeout(function () {
        try {
          window.opener = window;
        } catch (error) {
        }
        try {
          window.open("", "_self");
        } catch (error) {
        }
        try {
          window.close();
        } catch (error) {
        }
        setTimeout(function () {
          location.replace("about:blank");
        }, 120);
      }, 250);
    })
    .catch(function (error) {
      console.error(error);
      shutdownButton.disabled = false;
      setStatus(error.message || "Shutdown failed.", true);
    });
});

updatePlayerVolumeUI();
renderTrackPreviewFromInputs();
refreshToggleChips();
setPlayButtonState();
installMediaSessionHandlers();
updatePlaybackUI(0);
