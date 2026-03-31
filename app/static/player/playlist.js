    function refreshPlaylistSelect() {
      if (!playlistSelect) {
        return;
      }

      playlistSelect.innerHTML = "";

      if (!playlistCount || playlistCount <= 1) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "\uC7AC\uC0DD\uBAA9\uB85D";
        playlistSelect.appendChild(option);
        playlistSelect.disabled = true;
        return;
      }

      for (let index = 0; index < playlistCount; index += 1) {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = getPlaylistOptionLabel(index);
        playlistSelect.appendChild(option);
      }

      const currentIndex = getCurrentPlaylistIndex();
      playlistSelect.value = currentIndex === null ? "0" : String(currentIndex);
      playlistSelect.disabled = false;
    }

    function preloadPlaylistEntriesInBackground() {
      if (!playlistCount || playlistCount <= 1) {
        return;
      }

      queueMicrotask(async () => {
        for (let index = 0; index < playlistCount; index += 1) {
          if (playlistEntryCache[index]) {
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
      playlistEntryCache = {};
      failedPlaylistEntryIndexes = new Set();
      if (!Array.isArray(entries)) {
        updateTrackThumbnail(null);
        return;
      }

      entries.forEach((entry, index) => {
        if (entry && entry.url) {
          playlistEntryCache[index] = entry;
        }
      });
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
        return playlistEntryCache[index];
      }

      const data = await fetchPlaylistEntry(playlistSourceUrl, index + 1);
      playlistEntryCache[index] = data.entry;
      refreshPlaylistSelect();
      return data.entry;
    }

    async function prefetchUpcomingTrack() {
      if (playlistCount <= 1 || !playOrder.length) {
        prefetchedTrackUrl = "";
        prefetchInFlightUrl = "";
        return;
      }

      const nextOrderPosition = getAdjacentOrderPosition(1);
      if (nextOrderPosition === null) {
        prefetchedTrackUrl = "";
        prefetchInFlightUrl = "";
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
      prefetchInFlightUrl = targetUrl;

      try {
        await fetchPreparedTrack(targetUrl);
        prefetchedTrackUrl = targetUrl;
      } catch (error) {
        console.warn("prefetch skipped", error);
        if (prefetchedTrackUrl === targetUrl) {
          prefetchedTrackUrl = "";
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

      if (!currentBuffer || currentTrackId !== prepared.id) {
        currentBuffer = await loadAudioBuffer(prepared.id);
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
