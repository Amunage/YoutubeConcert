    function toggleMute() {
      const currentVolume = clamp(parseNumberInput(playerVolumeInput, 70), 0, 100);
      if (currentVolume === 0) {
        const restoreVolume = clamp(previousVolumeBeforeMute || 70, 1, 100);
        playerVolumeInput.value = String(restoreVolume);
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
        settings.baseVolume,
        settings.volumeDecay,
        settings.reverbIntensity,
        settings.diffusionAmount,
        settings.auxiliaryAmount,
        settings.peakSuppression,
        settings.roomPreset,
        settings.audiencePreset
      );
    }

    function needsReload() {
      const inputUrl = youtubeUrlInput.value.trim();
      return !isPrepared || !currentBuffer || !inputUrl || inputUrl !== playlistSourceUrl;
    }

    async function applyPlaybackSettings() {
      const settings = readPlaybackSettings();
      const previousSettings = playbackSettings;
      playbackSettings = settings;
      applyCurrentMasterBusProfile(settings);
      renderTracks(
        settings.count,
        settings.delayMs,
        settings.baseVolume,
        settings.volumeDecay,
        settings.reverbIntensity,
        settings.diffusionAmount,
        settings.auxiliaryAmount,
        settings.peakSuppression,
        settings.roomPreset,
        settings.audiencePreset
      );

      if (!currentBuffer || !isPrepared) {
        setStatus("<strong>\uC124\uC815 \uC801\uC6A9</strong> \uB2E4\uC74C \uC7AC\uC0DD\uBD80\uD130 \uBC18\uC601\uB429\uB2C8\uB2E4.");
        return;
      }

      if (isPlaying) {
        if (canApplyLiveBaseVolumeOnly(previousSettings, settings)) {
          applyActiveEnsembleTrim(previousSettings, settings);
          setStatus("<strong>?ㅼ젙 ?곸슜</strong> 蹂쇰ⅷ留??ㅽ뙣?놁씠 ?ㅼ떆 ?곸슜?덉뒿?덈떎.");
          return;
        }
        await ensureAudioContext();
        const currentPosition = getCurrentPlaybackPosition();
        playCurrentBuffer(currentPosition);
        setStatus("<strong>\uC124\uC815 \uC801\uC6A9</strong> \uD604\uC7AC \uC7AC\uC0DD\uC5D0 \uBC14\uB85C \uBC18\uC601\uD588\uC2B5\uB2C8\uB2E4.");
        return;
      }

      updatePlaybackUI(playbackOffset);
      setStatus("<strong>\uC124\uC815 \uC801\uC6A9</strong> \uD604\uC7AC \uACE1\uC5D0 \uBC18\uC601\uD588\uC2B5\uB2C8\uB2E4.");
    }

    async function prepareAudio(autoPlay = false) {
      const url = youtubeUrlInput.value.trim();
      if (!url) {
        setStatus("\uC720\uD29C\uBE0C \uC8FC\uC18C\uB97C \uBA3C\uC800 \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
        return;
      }

      const settings = readPlaybackSettings();
      setBusy(true);
      setStatus("<strong>\uC785\uB825 \uBD84\uC11D \uC911...</strong> \uC601\uC0C1 \uB610\uB294 \uC7AC\uC0DD\uBAA9\uB85D\uC744 \uC77D\uACE0 \uC788\uC2B5\uB2C8\uB2E4.", true);
      metaText.textContent = "";
      renderTracks(
        settings.count,
        settings.delayMs,
        settings.baseVolume,
        settings.volumeDecay,
        settings.reverbIntensity,
        settings.diffusionAmount,
        settings.auxiliaryAmount,
        settings.peakSuppression,
        settings.roomPreset,
        settings.audiencePreset
      );

      try {
        await ensureAudioContext({ primeSession: autoPlay });
        stopPlayback();

        const resolved = await fetchResolvedInput(url);
        playlistSourceUrl = url;
        playlistCount = resolved.playlistCount || 1;
        seedPlaylistEntries(resolved.entries || []);
        if (resolved.firstEntry) {
          playlistEntryCache[resolved.firstEntryIndex || 0] = resolved.firstEntry;
        }
        refreshPlaylistSelect();
        if (!playlistCount) {
          throw new Error("\uC7AC\uC0DD \uAC00\uB2A5\uD55C \uACE1\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
        }

        const startEntryIndex = shufflePlaybackInput.checked
          ? Math.floor(Math.random() * playlistCount)
          : 0;
        rebuildPlayOrder(startEntryIndex);
        const firstEntry = await ensurePlaylistEntry(startEntryIndex);
        if (!firstEntry) {
          throw new Error("\uCCAB \uACE1\uC744 \uC900\uBE44\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
        }

        if (Object.keys(playlistEntryCache).length < playlistCount) {
          preloadPlaylistEntriesInBackground();
        }
        await loadPreparedEntry(firstEntry, startEntryIndex, 0);

        playbackSettings = settings;
        playbackOffset = 0;
        updatePlaybackUI(0);
        playbackSlider.disabled = false;
        isPrepared = true;
        isPlaying = false;
        setPlayButtonState();

        if (autoPlay) {
          playbackSettings = settings;
          playCurrentBuffer(0);
          const currentEntry = getCurrentPlaylistEntry();
          setStatus(
            `<strong>${settings.count}\uAC1C \uD2B8\uB799</strong> \uC7AC\uC0DD \uC911 - ${currentEntry ? currentEntry.title : "\uD604\uC7AC \uACE1"}`
          );
        } else {
          setStatus(
            `<strong>\uC900\uBE44 \uC644\uB8CC.</strong> ${playlistCount > 1 ? `\uC7AC\uC0DD\uBAA9\uB85D ${playlistCount}\uACE1` : "\uB2E8\uC77C \uACE1"}\uC744 \uBD88\uB7EC\uC654\uC2B5\uB2C8\uB2E4.`
          );
        }
      } catch (error) {
        isPrepared = false;
        isPlaying = false;
        setPlayButtonState();
        setStatus(`<strong>\uC2E4\uD328:</strong> ${error.message}`);
      } finally {
        setBusy(false);
      }
    }

    async function startPlayback() {
      if (needsReload()) {
        await prepareAudio();
        if (!isPrepared || !currentBuffer) {
          return;
        }
      }

      await ensureAudioContext({ primeSession: true });
      playbackSettings = readPlaybackSettings();
      renderTracks(
        playbackSettings.count,
        playbackSettings.delayMs,
        playbackSettings.baseVolume,
        playbackSettings.volumeDecay,
        playbackSettings.reverbIntensity,
        playbackSettings.diffusionAmount,
        playbackSettings.auxiliaryAmount,
        playbackSettings.peakSuppression,
        playbackSettings.roomPreset,
        playbackSettings.audiencePreset
      );
      playCurrentBuffer(playbackOffset);
      const currentEntry = getCurrentPlaylistEntry();
      setStatus(
        `<strong>${playbackSettings.count}\uAC1C \uD2B8\uB799</strong> \uC7AC\uC0DD \uC911 - ${currentEntry ? currentEntry.title : "\uD604\uC7AC \uACE1"}`
      );
    }

    function pausePlayback() {
      if (!isPlaying || !audioContext || !currentBuffer) {
        return;
      }

      const elapsed = Math.max(0, audioContext.currentTime - playbackStartedAt);
      playbackOffset = Math.min(currentBuffer.duration, playbackOffset + elapsed);
      stopPlayback();
      updatePlaybackUI(playbackOffset);
      setStatus("<strong>\uC77C\uC2DC\uC815\uC9C0</strong> \uB2E4\uC2DC \uB204\uB974\uBA74 \uC774\uC5B4\uC11C \uC7AC\uC0DD\uD569\uB2C8\uB2E4.");
    }

    async function playPauseToggle() {
      if (isPlaying) {
        pausePlayback();
        return;
      }
      await startPlayback();
    }

    async function toggleOriginalMode() {
      isOriginalMode = !isOriginalMode;
      refreshOriginalToggleButton();

      if (!currentBuffer) {
        setStatus(isOriginalMode ? "\uC6D0\uBCF8 \uC7AC\uC0DD \uBAA8\uB4DC\uAC00 \uCF1C\uC84C\uC2B5\uB2C8\uB2E4." : "\uCF58\uC11C\uD2B8 \uC7AC\uC0DD \uBAA8\uB4DC\uB85C \uB3CC\uC544\uC654\uC2B5\uB2C8\uB2E4.");
        updateMediaSessionMetadata();
        return;
      }

      if (isPlaying) {
        await ensureAudioContext({ primeSession: true });
        const currentPosition = getCurrentPlaybackPosition();
        playCurrentBuffer(currentPosition);
      } else {
        applyCurrentMasterBusProfile(playbackSettings);
      }

      setStatus(isOriginalMode ? "\uC6D0\uBCF8 \uC7AC\uC0DD \uBAA8\uB4DC\uB85C \uC804\uD658\uD588\uC2B5\uB2C8\uB2E4." : "\uCF58\uC11C\uD2B8 \uC7AC\uC0DD \uBAA8\uB4DC\uB85C \uC804\uD658\uD588\uC2B5\uB2C8\uB2E4.");
      updateMediaSessionMetadata();
    }

    async function playAdjacentTrack(direction) {
      if (direction < 0 && currentBuffer) {
        const currentPosition = getCurrentPlaybackPosition();
        if (currentPosition > 3) {
          stopPlayback();
          playbackOffset = 0;
          updatePlaybackUI(0);
          if (currentBuffer) {
            playCurrentBuffer(0);
          }
          setStatus("<strong>\uCC98\uC74C \uC704\uCE58</strong> \uD604\uC7AC \uACE1\uC758 \uC2DC\uC791\uC810\uC73C\uB85C \uC774\uB3D9\uD588\uC2B5\uB2C8\uB2E4.");
          return;
        }
      }

      if (!playlistCount || playlistCount <= 1 || isAdvancingTrack) {
        if (direction < 0 && currentBuffer) {
          playbackOffset = 0;
          updatePlaybackUI(0);
          if (isPlaying) {
            playCurrentBuffer(0);
          }
          setStatus("<strong>\uCC98\uC74C \uC704\uCE58</strong> \uD604\uC7AC \uACE1\uC758 \uC2DC\uC791\uC810\uC73C\uB85C \uC774\uB3D9\uD588\uC2B5\uB2C8\uB2E4.");
        }
        return;
      }

      isAdvancingTrack = true;
      try {
        stopPlayback();
        const result = await switchToAdjacentPlayableTrack(direction, {
          loading: direction < 0 ? "\uC774\uC804 \uACE1 \uC900\uBE44 \uC911..." : "\uB2E4\uC74C \uACE1 \uC900\uBE44 \uC911...",
          success: direction < 0 ? "\uC774\uC804 \uACE1 \uC7AC\uC0DD" : "\uB2E4\uC74C \uACE1 \uC7AC\uC0DD",
        }, { primeSession: true });
        if (result.ok) {
          return;
        }

        if (result.reason === "end") {
          setStatus(
            direction < 0
              ? "<strong>\uCC98\uC74C \uACE1</strong> \uB354 \uC774\uC804 \uACE1\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."
              : "<strong>\uB9C8\uC9C0\uB9C9 \uACE1</strong> \uB354 \uB2E4\uC74C \uACE1\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."
          );
          return;
        }

        setStatus(
          direction < 0
            ? "<strong>\uC774\uC804 \uACE1 \uC5C6\uC74C</strong> \uC7AC\uC0DD \uAC00\uB2A5\uD55C \uC774\uC804 \uACE1\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."
            : "<strong>\uB2E4\uC74C \uACE1 \uC5C6\uC74C</strong> \uC7AC\uC0DD \uAC00\uB2A5\uD55C \uB2E4\uC74C \uACE1\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."
          );
        return;
      } catch (error) {
        setStatus(`<strong>\uACE1 \uC774\uB3D9 \uC2E4\uD328:</strong> ${error.message}`);
      } finally {
        isAdvancingTrack = false;
      }
    }

    loadButton.addEventListener("click", () => {
      prepareAudio(true);
    });
    playerVolumeInput.addEventListener("input", () => {
      const currentVolume = clamp(parseNumberInput(playerVolumeInput, 70), 0, 100);
      if (currentVolume > 0) {
        previousVolumeBeforeMute = currentVolume;
      }
      updatePlayerVolumeUI();
      applyCurrentVolumeToOutput();
    });
    if (ensembleVolumeInput) {
      ensembleVolumeInput.addEventListener("input", renderTrackPreviewFromInputs);
    }
    if (muteButton) {
      muteButton.addEventListener("click", toggleMute);
    }
    if (playlistSelect) {
      playlistSelect.addEventListener("change", async () => {
        const selectedIndex = Number.parseInt(playlistSelect.value, 10);
        if (Number.isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= playlistCount || isAdvancingTrack) {
          return;
        }

        try {
          isAdvancingTrack = true;
          setBusy(true);
          stopPlayback();
          currentOrderPosition = playOrder.indexOf(selectedIndex);
          if (currentOrderPosition < 0) {
            rebuildPlayOrder(selectedIndex);
          }
          const entry = await ensurePlaylistEntry(selectedIndex);
          if (!entry) {
            return;
          }
          await ensureAudioContext();
          primeAudioSession();
          setStatus(`<strong>\uACE1 \uC900\uBE44 \uC911..</strong> ${entry.title}`, true);
          await loadPreparedEntry(entry, selectedIndex, 0);
          playCurrentBuffer(0);
          setStatus(`<strong>\uACE1 \uC7AC\uC0DD</strong> ${entry.title}`);
        } catch (error) {
          setStatus(`<strong>\uACE1 \uC774\uB3D9 \uC2E4\uD328:</strong> ${error.message}`);
        } finally {
          setBusy(false);
          isAdvancingTrack = false;
        }
      });
    }
    applySettingsButton.addEventListener("click", () => {
      applyPlaybackSettings().catch((error) => {
        setStatus(`<strong>\uC124\uC815 \uC801\uC6A9 \uC2E4\uD328:</strong> ${error.message}`);
      });
    });
    playPauseButton.addEventListener("click", playPauseToggle);
    prevButton.addEventListener("click", () => {
      playAdjacentTrack(-1);
    });
    nextButton.addEventListener("click", () => {
      playAdjacentTrack(1);
    });
    if (originalToggleButton) {
      originalToggleButton.addEventListener("click", () => {
        toggleOriginalMode().catch((error) => {
          setStatus(`<strong>\uC6D0\uBCF8 \uBAA8\uB4DC \uC804\uD658 \uC2E4\uD328:</strong> ${error.message}`);
        });
      });
    }
    playbackSlider.addEventListener("pointerdown", () => {
      isSeeking = true;
    });
    playbackSlider.addEventListener("input", () => {
      if (!currentBuffer) {
        return;
      }
      const previewSeconds = (Number(playbackSlider.value) / 1000) * currentBuffer.duration;
      if (playbackTimes) {
        playbackTimes.textContent = `${formatTime(previewSeconds)}/${formatTime(currentBuffer.duration)}`;
      }
    });
    playbackSlider.addEventListener("change", async () => {
      if (!currentBuffer) {
        isSeeking = false;
        return;
      }

      try {
        await ensureAudioContext();
        primeAudioSession();
        const nextSettings = readPlaybackSettings();
        const seekSeconds = (Number(playbackSlider.value) / 1000) * currentBuffer.duration;
        if (!arePlaybackSettingsEqual(playbackSettings, nextSettings)) {
          playbackSettings = nextSettings;
          applyCurrentMasterBusProfile(playbackSettings);
          renderTracks(
            playbackSettings.count,
            playbackSettings.delayMs,
            playbackSettings.baseVolume,
            playbackSettings.volumeDecay,
            playbackSettings.reverbIntensity,
            playbackSettings.diffusionAmount,
            playbackSettings.auxiliaryAmount,
            playbackSettings.peakSuppression,
            playbackSettings.roomPreset,
            playbackSettings.audiencePreset
          );
        }
        playCurrentBuffer(seekSeconds);
        setStatus(
          `<strong>${formatTime(seekSeconds)}</strong> \uC704\uCE58\uBD80\uD130 \uB2E4\uC2DC \uC7AC\uC0DD\uD569\uB2C8\uB2E4.`
        );
      } finally {
        isSeeking = false;
      }
    });
    loopPlaybackInput.addEventListener("change", refreshToggleChips);
    playlistLoopInput.checked = true;
    playlistLoopInput.addEventListener("change", () => {
      playlistLoopInput.checked = true;
      refreshToggleChips();
    });
    shufflePlaybackInput.addEventListener("change", () => {
      refreshToggleChips();
      if (!playlistCount) {
        return;
      }
      const currentEntryIndex = getCurrentPlaylistIndex() ?? 0;
      rebuildPlayOrder(currentEntryIndex);
      prefetchUpcomingTrack().catch((error) => {
        console.warn("prefetch queue failed", error);
      });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        restorePlaybackSession().catch((error) => {
          console.warn("visibility restore skipped", error);
        });
      }
    });
    window.addEventListener("pageshow", () => {
      restorePlaybackSession().catch((error) => {
        console.warn("pageshow restore skipped", error);
      });
    });
    shutdownButton.addEventListener("click", async () => {
      if (!APP_CONFIG.canShutdown) {
        setStatus("\uC774 \uC811\uC18D\uC5D0\uC11C\uB294 \uD504\uB85C\uADF8\uB7A8 \uC885\uB8CC \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
        return;
      }
      shutdownButton.disabled = true;
      setStatus("\uD504\uB85C\uADF8\uB7A8\uC744 \uC885\uB8CC\uD558\uB294 \uC911\uC785\uB2C8\uB2E4...");
      try {
        await fetch("/api/shutdown", {
          method: "POST",
          headers: { "X-Admin-Token": APP_CONFIG.adminToken },
        });
      } catch (error) {
        console.warn("shutdown request finished with browser disconnect", error);
      }
      setTimeout(() => {
        window.close();
      }, 250);
    });

    if (!APP_CONFIG.canShutdown) {
      shutdownButton.style.display = "none";
    }

    updatePlayerVolumeUI();
    normalizeToggleLabels();
    refreshOriginalToggleButton();
    renderTrackPreviewFromInputs();
    refreshToggleChips();
    installMediaSessionHandlers();
    updateMediaSessionMetadata();
    setPlayButtonState();
