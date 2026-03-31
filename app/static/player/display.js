    function setBusy(isBusy) {
      loadButton.disabled = isBusy;
      applySettingsButton.disabled = isBusy;
      playPauseButton.disabled = isBusy;
      if (originalToggleButton) {
        originalToggleButton.disabled = isBusy;
      }
      prevButton.disabled = isBusy;
      nextButton.disabled = isBusy;
    }

    function updatePlayerVolumeUI() {
      const volume = clamp(parseNumberInput(playerVolumeInput, 70), 0, 100);
      playerVolumeInput.value = String(volume);
      if (muteButton) {
        muteButton.textContent = volume === 0 ? "\uD83D\uDD07" : "\uD83D\uDD0A";
        muteButton.title = volume === 0 ? "\uC74C\uC18C\uAC70 \uD574\uC81C" : "\uC74C\uC18C\uAC70";
      }

    }

    function normalizeToggleLabels() {
      if (loopChip) {
        loopChip.title = "\uD604\uC7AC \uACE1 \uBC18\uBCF5";
        loopChip.setAttribute("aria-label", "\uD604\uC7AC \uACE1 \uBC18\uBCF5");
      }
      if (shuffleChip) {
        shuffleChip.title = "\uC154\uD50C";
        shuffleChip.setAttribute("aria-label", "\uC154\uD50C");
      }
    }

    function refreshOriginalToggleButton() {
      if (!originalToggleButton) {
        return;
      }
      originalToggleButton.classList.toggle("active", isOriginalMode);
      originalToggleButton.setAttribute("aria-pressed", isOriginalMode ? "true" : "false");
      originalToggleButton.title = isOriginalMode ? "\uCF58\uC11C\uD2B8 \uBAA8\uB4DC" : "\uC6D0\uBCF8 \uBAA8\uB4DC";
    }

    function getPlaylistOptionLabel(index) {
      const lightweightLabel = playlistEntryLabels[index];
      if (lightweightLabel) {
        return `${index + 1}. ${lightweightLabel}`;
      }

      const entry = playlistEntryCache[index];
      if (entry?.title) {
        return `${index + 1}. ${entry.title}`;
      }
      return `${index + 1}. \uC7AC\uC0DD\uBAA9\uB85D \uD56D\uBAA9`;
    }

    function getTrackThumbnailUrl(entry) {
      const videoId = String(entry?.id || "").trim();
      if (!videoId) {
        return "";
      }
      return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
    }

    function updateTrackThumbnail(entry = null) {
      if (!thumbnailPanel || !trackThumbnail) {
        return;
      }

      const thumbnailUrl = getTrackThumbnailUrl(entry);
      if (!thumbnailUrl) {
        trackThumbnail.removeAttribute("src");
        trackThumbnail.alt = "";
        thumbnailPanel.classList.remove("visible");
        thumbnailPanel.setAttribute("aria-hidden", "true");
        return;
      }

      trackThumbnail.src = thumbnailUrl;
      trackThumbnail.alt = entry?.title ? `${entry.title} thumbnail` : "Track thumbnail";
      thumbnailPanel.classList.add("visible");
      thumbnailPanel.setAttribute("aria-hidden", "false");
    }

    function applyStatusMarquee() {
      if (!inlineStatus) {
        return;
      }

      const inner = inlineStatus.querySelector(".status-text-inner");
      if (!inner) {
        inlineStatus.classList.remove("marquee");
        inlineStatus.style.removeProperty("--status-marquee-distance");
        inlineStatus.style.removeProperty("--status-marquee-duration");
        return;
      }

      inlineStatus.classList.remove("marquee");
      inlineStatus.style.removeProperty("--status-marquee-distance");
      inlineStatus.style.removeProperty("--status-marquee-duration");

      if (inner.scrollWidth > inlineStatus.clientWidth) {
        const distance = inner.scrollWidth - inlineStatus.clientWidth;
        const pixelsPerSecond = 40;
        const holdSeconds = 1.2;
        const duration = holdSeconds + distance / pixelsPerSecond;
        inlineStatus.style.setProperty("--status-marquee-distance", `${distance}px`);
        inlineStatus.style.setProperty("--status-marquee-duration", `${duration.toFixed(2)}s`);
        inlineStatus.classList.add("marquee");
      }
    }

    function setStatus(message, keepVisible = false) {
      if (!inlineStatus) {
        return;
      }

      const plainText = String(message || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\\s+/g, " ")
        .trim();

      inlineStatus.innerHTML = plainText
        ? `<span class="status-text-inner">${plainText}</span>`
        : "";
      inlineStatus.title = plainText;
      requestAnimationFrame(applyStatusMarquee);

      if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = null;
      }

      if (!plainText) {
        return;
      }

      const isFailure = plainText.startsWith("\uC2E4\uD328:") || plainText.includes(" \uC2E4\uD328:");
      if (keepVisible || isFailure) {
        return;
      }

      statusTimer = setTimeout(() => {
        inlineStatus.innerHTML = "";
        inlineStatus.classList.remove("marquee");
        statusTimer = null;
      }, 10000);
    }

    function setPlayButtonState() {
      playPauseButton.innerHTML = isPlaying ? "&#10074;&#10074;" : "&#9654;";
      playPauseButton.title = isPlaying ? "\uC77C\uC2DC\uC815\uC9C0" : "\uC7AC\uC0DD";
      updateMediaSessionPlaybackState();
    }

    function refreshToggleChips() {
      if (loopChip) {
        loopChip.classList.toggle("active", loopPlaybackInput.checked);
      }
      if (shuffleChip) {
        shuffleChip.classList.toggle("active", shufflePlaybackInput.checked);
      }
    }

    function updatePlaybackUI(positionSeconds) {
      const duration = currentBuffer ? currentBuffer.duration : 0;
      if (playbackTimes) {
        playbackTimes.textContent = `${formatTime(positionSeconds)}/${formatTime(duration)}`;
      }

      if (!duration || isSeeking) {
        return;
      }

      const ratio = Math.max(0, Math.min(1, positionSeconds / duration));
      playbackSlider.value = String(Math.round(ratio * 1000));
    }

    function renderTracks(count, delayMs, baseVolume, volumeDecay, reverbIntensity, diffusionAmount, auxiliaryAmount, peakSuppression, roomPreset, audiencePreset) {
      trackGrid.innerHTML = "";
      const preset = getRoomPresetConfig(roomPreset);
      const audience = getAudiencePresetConfig(audiencePreset);
      const effectiveDelayMs = Math.round(delayMs * audience.delayScale);
      const variationSeedBase = currentTrackId || currentTrackUrl || "preview";
      const layerCache = buildLayerComputationCache(
        count,
        baseVolume,
        volumeDecay,
        reverbIntensity,
        peakSuppression,
        audiencePreset
      );
      const layerVariationCache = buildLayerVariationCache(
        variationSeedBase,
        count,
        roomPreset,
        audiencePreset
      );

      for (let index = 0; index < count; index += 1) {
        const layerBlend = layerCache.layerBlends[index];
        const layerVariation = layerVariationCache[index];
        const audienceTrack = layerCache.audienceTracks[index];
        const shapedVolume = layerCache.shapedVolumes[index];
        const distanceBlend = clamp(layerBlend * (0.42 + preset.distanceEq) + audience.distanceOffset, 0, 1.25);
        const directMixLevel = audience.directMixTrim * Math.max(0.82, 1 - layerBlend * 0.12);
        const finalVolume = clamp(
          shapedVolume
            * audienceTrack.volumeScale
            * layerVariation.gainScale
            * Math.max(0.05, 1 - distanceBlend * 0.32)
            * audience.dryGain
            * directMixLevel
            * 100,
          0,
          100
        );
        const shownReverb = Math.round(layerCache.reverbStrengths[index]);
        const shownDiffusion = Math.round(clamp(diffusionAmount, 0, 100));
        const shownAuxiliary = Math.round(clamp(auxiliaryAmount, 0, 100));
        const shownSuppression = Math.round(layerCache.suppressionStrengths[index]);
        const depthPercent = Math.round(layerBlend * 100);
        const trackDelayMs = Math.round(index * effectiveDelayMs + layerVariation.timingJitterMs);
        const panValue = Math.round(
          clamp(
            getPanPosition(index, count, preset.stereoWidth * audience.stereoWidth) + layerVariation.panOffset,
            -0.84,
            0.84
          ) * 100
        );
        const panLabel = panValue === 0 ? "C0" : `${panValue < 0 ? "L" : "R"}${Math.abs(panValue)}`;
        const item = document.createElement("article");
        item.className = "track-card";
        item.innerHTML = `
          <h3>Track ${index + 1}</h3>
          <p class="track-desc">${trackDelayMs} ms / Vol ${finalVolume.toFixed(1)} / Echo ${shownReverb}% / Diff ${shownDiffusion}% / Aux ${shownAuxiliary}% / Peak ${shownSuppression}% / Pan ${panLabel} / Rate ${(layerVariation.playbackRate * 100).toFixed(2)}% / Depth ${depthPercent}%</p>
        `;
        trackGrid.appendChild(item);
      }
    }
