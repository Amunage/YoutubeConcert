function shuffleIndices(count) {
  const indices = Array.from({ length: count }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = indices[index];
    indices[index] = indices[swapIndex];
    indices[swapIndex] = temp;
  }
  return indices;
}

function rebuildPlayOrder(startEntryIndex) {
  if (!playlistCount) {
    playOrder = [];
    currentOrderPosition = 0;
    return;
  }

  const pinnedIndex = clamp(startEntryIndex ?? 0, 0, Math.max(0, playlistCount - 1));
  playOrder = shufflePlaybackInput.checked
    ? shuffleIndices(playlistCount)
    : Array.from({ length: playlistCount }, (_, index) => index);

  const pinnedPosition = playOrder.indexOf(pinnedIndex);
  if (pinnedPosition > 0) {
    playOrder.splice(pinnedPosition, 1);
    playOrder.unshift(pinnedIndex);
  }

  currentOrderPosition = 0;
  prefetchedTrackUrl = "";
  prefetchInFlightUrl = "";
}

function getCurrentPlaylistIndex() {
  if (!playOrder.length) {
    return null;
  }
  return playOrder[currentOrderPosition] ?? null;
}

function getCurrentPlaylistEntry() {
  const playlistIndex = getCurrentPlaylistIndex();
  if (playlistIndex === null) {
    return null;
  }
  return playlistEntryCache[playlistIndex] || null;
}

function getAdjacentOrderPosition(direction) {
  if (!playOrder.length) {
    return null;
  }

  const nextPosition = currentOrderPosition + direction;
  if (nextPosition < 0) {
    return playlistLoopInput.checked ? playOrder.length - 1 : null;
  }
  if (nextPosition >= playOrder.length) {
    return playlistLoopInput.checked ? 0 : null;
  }
  return nextPosition;
}

function updateMetaText(entryTitle, entryIndex) {
  const title = String(entryTitle || "").trim();
  const hasIndex = Number.isInteger(entryIndex) && playlistCount > 1;
  const prefix = hasIndex ? `[${entryIndex + 1}/${playlistCount}] ` : "";
  metaText.textContent = title ? `${prefix}${title}` : "No track loaded yet.";
}

function getPlaylistOptionLabel(entry, index) {
  const title = entry && entry.title ? entry.title : `Track ${index + 1}`;
  return `${index + 1}. ${title}`;
}

function getTrackThumbnailUrl(entry) {
  if (!entry || !entry.id) {
    return "";
  }
  return `https://i.ytimg.com/vi/${encodeURIComponent(entry.id)}/hqdefault.jpg`;
}

function updateTrackThumbnail(entry) {
  const thumbnailUrl = getTrackThumbnailUrl(entry);
  if (!thumbnailUrl) {
    trackThumbnail.removeAttribute("src");
    trackThumbnail.alt = "";
    thumbnailPanel.classList.remove("visible");
    thumbnailPanel.setAttribute("aria-hidden", "true");
    return;
  }

  trackThumbnail.src = thumbnailUrl;
  trackThumbnail.alt = entry.title || "Track thumbnail";
  thumbnailPanel.classList.add("visible");
  thumbnailPanel.setAttribute("aria-hidden", "false");
}

function refreshPlaylistSelect() {
  playlistSelect.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = playlistCount > 1 ? "Select a playlist item" : "Single track";
  playlistSelect.appendChild(defaultOption);

  for (let index = 0; index < playlistCount; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = getPlaylistOptionLabel(playlistEntryCache[index], index);
    playlistSelect.appendChild(option);
  }

  const currentIndex = getCurrentPlaylistIndex();
  playlistSelect.disabled = playlistCount <= 1;
  playlistSelect.value = currentIndex === null ? "" : String(currentIndex);
}

async function preloadPlaylistEntriesInBackground() {
  if (!playlistCount || !playlistSourceUrl) {
    return;
  }

  const targets = [];
  for (let index = 0; index < Math.min(playlistCount, 8); index += 1) {
    if (!playlistEntryCache[index] && !failedPlaylistEntryIndexes.has(index)) {
      targets.push(index);
    }
  }

  for (const playlistIndex of targets) {
    try {
      await ensurePlaylistEntry(playlistIndex);
      refreshPlaylistSelect();
    } catch (error) {
      markPlaylistEntryFailed(playlistIndex);
    }
  }
}

function seedPlaylistEntries(resolved) {
  playlistEntryCache = {};
  failedPlaylistEntryIndexes = new Set();
  playlistSourceUrl = currentTrackUrl;
  playlistCount = Math.max(1, Number(resolved.playlistCount) || 1);

  if (resolved.firstEntry) {
    const firstIndex = clamp(Number(resolved.firstEntryIndex) || 0, 0, playlistCount - 1);
    playlistEntryCache[firstIndex] = resolved.firstEntry;
    rebuildPlayOrder(firstIndex);
  } else {
    rebuildPlayOrder(0);
  }

  if (Array.isArray(resolved.entries)) {
    resolved.entries.forEach((entry, index) => {
      if (entry) {
        playlistEntryCache[index] = entry;
      }
    });
  }

  refreshPlaylistSelect();
}

function clearPlaylistEntryFailure(playlistIndex) {
  failedPlaylistEntryIndexes.delete(playlistIndex);
}

function markPlaylistEntryFailed(playlistIndex) {
  failedPlaylistEntryIndexes.add(playlistIndex);
}

function getStepwiseOrderPosition(startPosition, direction) {
  if (!playOrder.length) {
    return null;
  }

  let position = startPosition;
  for (let count = 0; count < playOrder.length; count += 1) {
    position += direction;
    if (position < 0) {
      if (!playlistLoopInput.checked) {
        return null;
      }
      position = playOrder.length - 1;
    }
    if (position >= playOrder.length) {
      if (!playlistLoopInput.checked) {
        return null;
      }
      position = 0;
    }
    if (!failedPlaylistEntryIndexes.has(playOrder[position])) {
      return position;
    }
  }

  return null;
}

async function switchToAdjacentPlayableTrack(direction) {
  const nextPosition = getStepwiseOrderPosition(currentOrderPosition, direction);
  if (nextPosition === null) {
    setStatus("No more playable tracks in the playlist.", true);
    return false;
  }

  currentOrderPosition = nextPosition;
  const entry = await ensurePlaylistEntry(playOrder[currentOrderPosition]);
  await loadPreparedEntry(entry);
  refreshPlaylistSelect();
  return true;
}

async function ensurePlaylistEntry(playlistIndex) {
  const normalizedIndex = clamp(Number(playlistIndex) || 0, 0, Math.max(0, playlistCount - 1));
  if (playlistEntryCache[normalizedIndex]) {
    return playlistEntryCache[normalizedIndex];
  }

  const entry = await fetchPlaylistEntry(playlistSourceUrl || currentTrackUrl, normalizedIndex + 1);
  playlistEntryCache[normalizedIndex] = entry;
  clearPlaylistEntryFailure(normalizedIndex);
  return entry;
}

async function prefetchUpcomingTrack() {
  const nextPosition = getStepwiseOrderPosition(currentOrderPosition, 1);
  if (nextPosition === null) {
    return;
  }

  const playlistIndex = playOrder[nextPosition];
  try {
    const entry = await ensurePlaylistEntry(playlistIndex);
    if (!entry || !entry.url || prefetchInFlightUrl === entry.url || prefetchedTrackUrl === entry.url) {
      return;
    }

    prefetchInFlightUrl = entry.url;
    await fetchPreparedTrack(entry.url);
    prefetchedTrackUrl = entry.url;
  } catch (error) {
    console.warn("prefetch skipped", error);
  } finally {
    prefetchInFlightUrl = "";
  }
}

async function loadPreparedEntry(entry) {
  if (!entry || !entry.url) {
    throw new Error("Playlist entry is missing.");
  }

  const prepared = await fetchPreparedTrack(entry.url);
  currentTrackId = prepared.id;
  currentTrackUrl = entry.url;
  currentBuffer = await loadAudioBuffer(prepared.id);
  isPrepared = true;
  playbackOffset = 0;
  isSeeking = false;
  playbackSlider.disabled = false;
  updateMetaText(entry.title, getCurrentPlaylistIndex());
  updateTrackThumbnail(entry);
  updateMediaSessionMetadata(entry);
  updatePlaybackUI(0);
  renderTrackPreviewFromInputs();
  refreshPlaylistSelect();
  setPlayButtonState();
}

async function advanceToNextTrack() {
  if (loopPlaybackInput.checked) {
    playbackOffset = 0;
    await startPlayback(0);
    return true;
  }

  return switchToAdjacentPlayableTrack(1);
}
