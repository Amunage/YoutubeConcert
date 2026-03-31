    function refreshPlaylistSelect() {
      if (!playlistSelect) {
        return;
      }

      if (!playlistCount || playlistCount <= 1) {
        const nextKey = "single";
        if (playlistSelectRenderKey !== nextKey) {
          playlistSelect.innerHTML = "";
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "\uC7AC\uC0DD\uBAA9\uB85D";
          playlistSelect.appendChild(option);
          playlistSelectRenderKey = nextKey;
        }
        playlistSelect.disabled = true;
        return;
      }

      const labels = [];
      for (let index = 0; index < playlistCount; index += 1) {
        labels.push(getPlaylistOptionLabel(index));
      }
      const nextKey = `${playlistCount}:${labels.join("\n")}`;

      if (playlistSelectRenderKey !== nextKey) {
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < playlistCount; index += 1) {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = labels[index];
          fragment.appendChild(option);
        }
        playlistSelect.innerHTML = "";
        playlistSelect.appendChild(fragment);
        playlistSelectRenderKey = nextKey;
      }

      const currentIndex = getCurrentPlaylistIndex();
      playlistSelect.value = currentIndex === null ? "0" : String(currentIndex);
      playlistSelect.disabled = false;
    }

    function markPlaylistEntryAccess(index) {
      if (index === null || index === undefined) {
        return;
      }
      playlistEntryAccessTick += 1;
      playlistEntryAccessTimes[index] = playlistEntryAccessTick;
    }

    function getPlaylistPreloadIndexes(centerOrderPosition = currentOrderPosition) {
      const indexes = new Set();
      if (!playlistCount || playlistCount <= 1) {
        return indexes;
      }

      const safeCenter = Number.isInteger(centerOrderPosition) ? centerOrderPosition : currentOrderPosition;
      for (let offset = -PLAYLIST_PRELOAD_BEHIND; offset <= PLAYLIST_PRELOAD_AHEAD; offset += 1) {
        const orderPosition = getStepwiseOrderPosition(safeCenter, 1, offset);
        if (orderPosition === null) {
          continue;
        }
        const entryIndex = playOrder[orderPosition];
        if (entryIndex !== null && entryIndex !== undefined) {
          indexes.add(entryIndex);
        }
      }

      const currentIndex = getCurrentPlaylistIndex();
      if (currentIndex !== null) {
        indexes.add(currentIndex);
      }
      indexes.add(0);
      return indexes;
    }

    function trimPlaylistEntryCache(anchorIndexes = []) {
      const cachedIndexes = Object.keys(playlistEntryCache);
      if (cachedIndexes.length <= PLAYLIST_ENTRY_CACHE_LIMIT) {
        return;
      }

      const protectedIndexes = getPlaylistPreloadIndexes();
      anchorIndexes.forEach((index) => {
        if (index !== null && index !== undefined) {
          protectedIndexes.add(index);
        }
      });

      const evictable = cachedIndexes
        .map((value) => Number.parseInt(value, 10))
        .filter((index) => !Number.isNaN(index) && !protectedIndexes.has(index))
        .sort((left, right) => (playlistEntryAccessTimes[left] || 0) - (playlistEntryAccessTimes[right] || 0));

      while (Object.keys(playlistEntryCache).length > PLAYLIST_ENTRY_CACHE_LIMIT && evictable.length) {
        const evictIndex = evictable.shift();
        delete playlistEntryCache[evictIndex];
        delete playlistEntryAccessTimes[evictIndex];
      }
    }

    function cachePlaylistEntry(index, entry, options = {}) {
      if (index === null || index === undefined || !entry || !entry.url) {
        return;
      }

      playlistEntryCache[index] = entry;
      markPlaylistEntryAccess(index);
      trimPlaylistEntryCache(options.anchorIndexes || [index]);
    }

    function preloadPlaylistEntriesInBackground() {
      if (!playlistCount || playlistCount <= 1) {
        return;
      }

      queueMicrotask(async () => {
        for (const index of getPlaylistPreloadIndexes()) {
          if (playlistEntryCache[index]) {
            markPlaylistEntryAccess(index);
            continue;
          }
          try {
            await ensurePlaylistEntry(index);
          } catch (error) {
            console.warn("playlist entry preload skipped", error);
          }
        }
      });
    }

    function seedPlaylistEntries(entries = []) {
      clearPrefetchedAudioBuffer();
      playlistEntryCache = {};
      playlistEntryLabels = [];
      playlistSelectRenderKey = "";
      playlistEntryAccessTimes = {};
      playlistEntryAccessTick = 0;
      failedPlaylistEntryIndexes = new Set();
      if (!Array.isArray(entries)) {
        updateTrackThumbnail(null);
        return;
      }

      entries.forEach((entry, index) => {
        const title = String(entry?.title || "").trim();
        playlistEntryLabels[index] = title || `${index + 1}. \uC7AC\uC0DD\uBAA9\uB85D \uD56D\uBAA9`;
      });

      entries.slice(0, PLAYLIST_ENTRY_CACHE_LIMIT).forEach((entry, index) => {
        if (entry && entry.url) {
          cachePlaylistEntry(index, entry, { anchorIndexes: [index, 0] });
        }
      });
    }

    function clearPrefetchedAudioBuffer() {
      prefetchedBufferTrackId = null;
      prefetchedBufferTrackUrl = "";
      prefetchedAudioBuffer = null;
      predecodeInFlightUrl = "";
    }

    function clearPlaylistEntryFailure(index) {
      failedPlaylistEntryIndexes.delete(index);
    }

    function markPlaylistEntryFailed(index, error) {
      if (index === null || index === undefined) {
        return;
      }
      failedPlaylistEntryIndexes.add(index);
      console.warn("playlist entry skipped", { index, error });
    }

    function getStepwiseOrderPosition(startPosition, direction, stepOffset) {
      if (!playOrder.length) {
        return null;
      }

      let nextOrderPosition = startPosition + direction * stepOffset;
      if (playlistLoopInput.checked) {
        nextOrderPosition %= playOrder.length;
        if (nextOrderPosition < 0) {
          nextOrderPosition += playOrder.length;
        }
        return nextOrderPosition;
      }

      if (nextOrderPosition < 0 || nextOrderPosition >= playOrder.length) {
        return null;
      }

      return nextOrderPosition;
    }

    async function switchToAdjacentPlayableTrack(direction, labels, options = {}) {
      if (!playlistCount || playlistCount <= 1 || !playOrder.length) {
        return { ok: false, reason: "unavailable" };
      }

      await ensureAudioContext({ primeSession: Boolean(options.primeSession) });

      const attemptedIndexes = new Set();
      const maxAttempts = playOrder.length;

      for (let stepOffset = 1; stepOffset <= maxAttempts; stepOffset += 1) {
        const orderPosition = getStepwiseOrderPosition(currentOrderPosition, direction, stepOffset);
        if (orderPosition === null) {
          break;
        }

        const entryIndex = playOrder[orderPosition];
        if (attemptedIndexes.has(entryIndex) || failedPlaylistEntryIndexes.has(entryIndex)) {
          continue;
        }
        attemptedIndexes.add(entryIndex);

        try {
          const entry = await ensurePlaylistEntry(entryIndex);
          if (!entry || !entry.url) {
            throw new Error("entry unavailable");
          }

          setStatus(`<strong>${labels.loading}</strong> ${entry.title}`, true);
          await loadPreparedEntry(entry, entryIndex, 0);
          clearPlaylistEntryFailure(entryIndex);
          currentOrderPosition = orderPosition;
          playCurrentBuffer(0);
          setStatus(`<strong>${labels.success}</strong> ${entry.title}`);
          return { ok: true, entryIndex };
        } catch (error) {
          markPlaylistEntryFailed(entryIndex, error);
        }
      }

      return {
        ok: false,
        reason: attemptedIndexes.size ? "exhausted" : "end",
      };
    }

    async function ensurePlaylistEntry(index) {
      if (playlistEntryCache[index]) {
        markPlaylistEntryAccess(index);
        return playlistEntryCache[index];
      }

      const data = await fetchPlaylistEntry(playlistSourceUrl, index + 1);
      if (data?.entry?.title) {
        playlistEntryLabels[index] = String(data.entry.title).trim() || playlistEntryLabels[index];
      }
      cachePlaylistEntry(index, data.entry, { anchorIndexes: [index] });
      refreshPlaylistSelect();
      return data.entry;
    }

    async function prefetchUpcomingTrack() {
      if (playlistCount <= 1 || !playOrder.length) {
        prefetchedTrackUrl = "";
        prefetchInFlightUrl = "";
        clearPrefetchedAudioBuffer();
        return;
      }

      const nextOrderPosition = getAdjacentOrderPosition(1);
      if (nextOrderPosition === null) {
        prefetchedTrackUrl = "";
        prefetchInFlightUrl = "";
        clearPrefetchedAudioBuffer();
        return;
      }

      const nextEntryIndex = playOrder[nextOrderPosition];
      if (failedPlaylistEntryIndexes.has(nextEntryIndex)) {
        return;
      }
      const nextEntry = await ensurePlaylistEntry(nextEntryIndex);
      if (!nextEntry || !nextEntry.url || nextEntry.url === currentTrackUrl) {
        return;
      }

      if (nextEntry.url === prefetchedTrackUrl || nextEntry.url === prefetchInFlightUrl) {
        return;
      }

      const targetUrl = nextEntry.url;
      if (prefetchedBufferTrackUrl === targetUrl && prefetchedAudioBuffer) {
        prefetchedTrackUrl = targetUrl;
        return;
      }
      if (predecodeInFlightUrl === targetUrl) {
        return;
      }
      prefetchInFlightUrl = targetUrl;

      try {
        const prepared = await fetchPreparedTrack(targetUrl);
        prefetchedTrackUrl = targetUrl;
        predecodeInFlightUrl = targetUrl;
        try {
          const decoded = await loadAudioBuffer(prepared.id);
          if (predecodeInFlightUrl === targetUrl) {
            prefetchedBufferTrackId = prepared.id;
            prefetchedBufferTrackUrl = targetUrl;
            prefetchedAudioBuffer = decoded;
          }
        } finally {
          if (predecodeInFlightUrl === targetUrl) {
            predecodeInFlightUrl = "";
          }
        }
      } catch (error) {
        console.warn("prefetch skipped", error);
        if (prefetchedTrackUrl === targetUrl) {
          prefetchedTrackUrl = "";
        }
        if (prefetchedBufferTrackUrl === targetUrl) {
          clearPrefetchedAudioBuffer();
        }
      } finally {
        if (prefetchInFlightUrl === targetUrl) {
          prefetchInFlightUrl = "";
        }
      }
    }

    async function loadPreparedEntry(entry, entryIndex, offsetSeconds = 0) {
      const prepared = await fetchPreparedTrack(entry.url);
      currentTrackUrl = entry.url;
      if (prefetchedTrackUrl === currentTrackUrl) {
        prefetchedTrackUrl = "";
      }

      if (prefetchedBufferTrackId === prepared.id && prefetchedBufferTrackUrl === entry.url && prefetchedAudioBuffer) {
        currentBuffer = prefetchedAudioBuffer;
        clearPrefetchedAudioBuffer();
      } else if (!currentBuffer || currentTrackId !== prepared.id) {
        currentBuffer = await loadAudioBuffer(prepared.id);
      } else if (prefetchedBufferTrackUrl === entry.url) {
        clearPrefetchedAudioBuffer();
      }
      currentTrackId = prepared.id;
      clearPlaylistEntryFailure(entryIndex);
      updateTrackThumbnail(entry);
      updateMetaText(entry.title || prepared.title, entryIndex);
      updateMediaSessionMetadata(entry);
      refreshPlaylistSelect();
      playbackOffset = offsetSeconds;
      updatePlaybackUI(offsetSeconds);
      playbackSlider.disabled = false;
      queueMicrotask(() => {
        prefetchUpcomingTrack().catch((error) => {
          console.warn("prefetch queue failed", error);
        });
      });
    }

    async function advanceToNextTrack() {
      if (isAdvancingTrack || playlistCount <= 1) {
        return;
      }

      isAdvancingTrack = true;
      setBusy(true);
      try {
        const result = await switchToAdjacentPlayableTrack(1, {
          loading: "\uB2E4\uC74C \uACE1 \uC900\uBE44 \uC911...",
          success: "\uB2E4\uC74C \uACE1 \uC7AC\uC0DD:",
        });
        if (result.ok) {
          return;
        }

        playbackOffset = currentBuffer ? currentBuffer.duration : 0;
        updatePlaybackUI(playbackOffset);
        isPlaying = false;
        setPlayButtonState();

        if (!playlistLoopInput.checked && result.reason === "end") {
          setStatus("<strong>\uC7AC\uC0DD\uBAA9\uB85D \uC885\uB8CC</strong> \uB9C8\uC9C0\uB9C9 \uACE1\uAE4C\uC9C0 \uC7AC\uC0DD\uD588\uC2B5\uB2C8\uB2E4.");
          return;
        }

        setStatus("<strong>\uC7AC\uC0DD \uAC00\uB2A5\uD55C \uB2E4\uC74C \uACE1 \uC5C6\uC74C</strong> \uBD88\uB7EC\uC62C \uC218 \uC788\uB294 \uB2E4\uC74C \uACE1\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
        return;
      } catch (error) {
        setStatus(`<strong>\uB2E4\uC74C \uACE1 \uC2E4\uD328:</strong> ${error.message}`);
      } finally {
        setBusy(false);
        isAdvancingTrack = false;
      }
    }
