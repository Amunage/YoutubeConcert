
    const APP_CONFIG = __APP_CONFIG__;
    const youtubeUrlInput = document.getElementById("youtubeUrlVisible");
    const cloneCountInput = document.getElementById("cloneCount");
    const ensembleVolumeInput = document.getElementById("ensembleVolume");
    const delayMsInput = document.getElementById("delayMs");
    const playerVolumeInput = document.getElementById("playerVolume");
    const muteButton = document.getElementById("muteButton");
    const volumeDecayInput = document.getElementById("volumeDecay");
    const reverbIntensityInput = document.getElementById("reverbIntensity");
    const diffusionAmountInput = document.getElementById("diffusionAmount");
    const auxiliaryAmountInput = document.getElementById("auxiliaryAmount");
    const peakSuppressionInput = document.getElementById("peakSuppression");
    const roomPresetInput = document.getElementById("roomPreset");
    const audiencePresetInput = document.getElementById("audiencePreset");
    const applySettingsButton = document.getElementById("applySettingsButton");
    const playPauseButton = document.getElementById("playPauseButton");
    const loadButton = document.getElementById("loadButtonVisible");
    const playlistSelect = document.getElementById("playlistSelectRow");
    const originalToggleButton = document.getElementById("originalToggleButton");
    const prevButton = document.getElementById("prevButton");
    const nextButton = document.getElementById("nextButton");
    const shutdownButton = document.getElementById("shutdownButton");
    const loopPlaybackInput = document.getElementById("loopPlayback");
    const playlistLoopInput = document.getElementById("playlistLoop");
    const shufflePlaybackInput = document.getElementById("shufflePlayback");
    const loopChip = document.getElementById("loopChip");
    const shuffleChip = document.getElementById("shuffleChip");
    const thumbnailPanel = document.getElementById("thumbnailPanel");
    const trackThumbnail = document.getElementById("trackThumbnail");
    const metaText = document.getElementById("metaText");
    const playbackSlider = document.getElementById("playbackSlider");
    const playbackTimes = document.getElementById("playbackTimes");
    const inlineStatus = document.getElementById("inlineStatus");
    const trackGrid = document.getElementById("trackGrid");

    let audioContext = null;
    let currentBuffer = null;
    let activeNodes = [];
    let currentTrackId = null;
    let currentTrackUrl = "";
    let playbackSettings = null;
    let playbackStartedAt = 0;
    let playbackOffset = 0;
    let playbackTailSeconds = 0;
    let playbackEndTime = 0;
    let progressAnimationFrame = null;
    let isSeeking = false;
    let isPrepared = false;
    let isAdvancingTrack = false;
    let isPlaying = false;
    let playlistSourceUrl = "";
    let playlistCount = 0;
    let playlistEntryCache = {};
    let playOrder = [];
    let currentOrderPosition = 0;
    let statusTimer = null;
    let prefetchedTrackUrl = "";
    let prefetchInFlightUrl = "";
    let previousVolumeBeforeMute = 70;
    let isOriginalMode = false;
    let playbackMonitorNode = null;
    let playbackMonitorCleanup = null;
    let playbackMonitorTimer = null;
    let playbackSessionToken = 0;
    let hasPrimedAudioSession = false;

    const {
      getLayerBlend,
      getTrackVolume,
      getTrackEffectStrength,
      getAudienceTrackProfile,
      getRoomPresetConfig,
      getPanPosition,
      getLayerVariation,
      getAudiencePresetConfig,
      rebuildPlayOrder,
      getCurrentPlaylistIndex,
      getCurrentPlaylistEntry,
      getAdjacentOrderPosition,
      updateMetaText,
      scheduleLayeredTrack,
      ensureOutputChain,
      setOutputVolume,
      setMasterBusProfile,
    } = window.AudioEngine;

    if (!APP_CONFIG.canShutdown) {
      shutdownButton.style.display = "none";
    }

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
        muteButton.textContent = volume === 0 ? "🔇" : "🔊";
        muteButton.title = volume === 0 ? "음소거 해제" : "음소거";
      }

    }

    function normalizeToggleLabels() {
      if (loopChip) {
        loopChip.title = "현재 곡 반복";
        Array.from(loopChip.querySelectorAll("span")).forEach((node, index) => {
          node.textContent = index === 0 ? "↻" : "";
        });
      }
      if (shuffleChip) {
        shuffleChip.title = "셔플";
        Array.from(shuffleChip.querySelectorAll("span")).forEach((node, index) => {
          node.textContent = index === 0 ? "⤮" : "";
        });
      }
    }

    function refreshOriginalToggleButton() {
      if (!originalToggleButton) {
        return;
      }
      originalToggleButton.classList.toggle("active", isOriginalMode);
      originalToggleButton.setAttribute("aria-pressed", isOriginalMode ? "true" : "false");
      originalToggleButton.title = isOriginalMode ? "콘서트 모드" : "원본 모드";
    }

    function getPlaylistOptionLabel(index) {
      const entry = playlistEntryCache[index];
      if (entry?.title) {
        return `${index + 1}. ${entry.title}`;
      }
      return `${index + 1}. 재생목록 항목`;
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

    function refreshPlaylistSelect() {
      if (!playlistSelect) {
        return;
      }

      playlistSelect.innerHTML = "";

      if (!playlistCount || playlistCount <= 1) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "재생목록";
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

    function applyCurrentVolumeToOutput() {
      if (audioContext) {
        setOutputVolume(clamp(parseNumberInput(playerVolumeInput, 70), 0, 100) / 100, audioContext);
      }
    }

    function applyCurrentMasterBusProfile(settings = playbackSettings) {
      if (!audioContext) {
        return;
      }

      setMasterBusProfile(
        {
          peakSuppression: settings?.peakSuppression ?? 0,
          trackCount: settings?.count ?? 1,
          isOriginalMode,
        },
        audioContext
      );
    }

    function clearPlaybackCompletionMonitor(stopSource = true) {
      if (playbackMonitorTimer) {
        clearTimeout(playbackMonitorTimer);
        playbackMonitorTimer = null;
      }

      if (!playbackMonitorCleanup) {
        playbackMonitorNode = null;
        return;
      }

      const cleanup = playbackMonitorCleanup;
      playbackMonitorCleanup = null;
      playbackMonitorNode = null;
      cleanup(stopSource);
    }

    function primeAudioSession() {
      if (!audioContext || hasPrimedAudioSession || audioContext.state !== "running") {
        return;
      }

      const unlockSource = audioContext.createBufferSource();
      const unlockGain = audioContext.createGain();
      unlockSource.buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
      unlockGain.gain.value = 0;
      unlockSource.connect(unlockGain);
      unlockGain.connect(audioContext.destination);
      unlockSource.start();
      unlockSource.onended = () => {
        try {
          unlockSource.disconnect();
        } catch (error) {
        }
        try {
          unlockGain.disconnect();
        } catch (error) {
        }
      };
      hasPrimedAudioSession = true;
    }

    function handlePlaybackCompletion() {
      if (!currentBuffer) {
        return;
      }

      stopProgressLoop();
      clearPlaybackCompletionMonitor(false);

      if (loopPlaybackInput.checked) {
        cleanupActivePlaybackGraph(false);
        playbackEndTime = 0;
        playbackTailSeconds = 0;
        playbackOffset = 0;
        updatePlaybackUI(0);
        playCurrentBuffer(0);
        setStatus("<strong>?꾩옱 怨?諛섎났</strong>?쇰줈 泥섏쓬遺???ㅼ떆 ?쒖옉?덉뒿?덈떎.");
        return;
      }

      if (playlistCount > 1 && !isAdvancingTrack) {
        cleanupActivePlaybackGraph(false);
        playbackEndTime = 0;
        playbackTailSeconds = 0;
        advanceToNextTrack();
        return;
      }

      cleanupActivePlaybackGraph(false);
      playbackEndTime = 0;
      playbackTailSeconds = 0;
      playbackOffset = 0;
      updatePlaybackUI(0);
      isPlaying = false;
      setPlayButtonState();
      setStatus("<strong>?ъ깮 ?꾨즺</strong> 泥섏쓬 ?꾩튂濡??뚯븘媛붿뒿?덈떎.");
    }

    function schedulePlaybackCompletionMonitor(sessionToken) {
      clearPlaybackCompletionMonitor();

      if (!audioContext || !playbackStartedAt || !playbackEndTime || playbackEndTime <= playbackStartedAt) {
        return;
      }

      const handleComplete = () => {
        if (sessionToken !== playbackSessionToken || !isPlaying) {
          return;
        }
        handlePlaybackCompletion();
      };

      if (typeof audioContext.createConstantSource === "function") {
        const monitorSource = audioContext.createConstantSource();
        const monitorGain = audioContext.createGain();
        monitorGain.gain.value = 0;
        monitorSource.offset.value = 0;
        monitorSource.connect(monitorGain);
        monitorGain.connect(audioContext.destination);
        monitorSource.onended = handleComplete;
        monitorSource.start(playbackStartedAt);
        monitorSource.stop(playbackEndTime);

        playbackMonitorNode = monitorSource;
        playbackMonitorCleanup = (stopSource = true) => {
          monitorSource.onended = null;
          if (stopSource) {
            try {
              monitorSource.stop();
            } catch (error) {
            }
          }
          try {
            monitorSource.disconnect();
          } catch (error) {
          }
          try {
            monitorGain.disconnect();
          } catch (error) {
          }
        };
        return;
      }

      const timeoutMs = Math.max(0, Math.ceil((playbackEndTime - playbackStartedAt) * 1000));
      playbackMonitorTimer = window.setTimeout(handleComplete, timeoutMs + 120);
    }

    function arePlaybackSettingsEqual(left, right) {
      if (!left || !right) {
        return false;
      }

      return (
        left.count === right.count &&
        left.delayMs === right.delayMs &&
        left.baseVolume === right.baseVolume &&
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
      if (!previousSettings || !nextSettings) {
        return false;
      }

      return (
        previousSettings.count === nextSettings.count &&
        previousSettings.delayMs === nextSettings.delayMs &&
        previousSettings.volumeDecay === nextSettings.volumeDecay &&
        previousSettings.reverbIntensity === nextSettings.reverbIntensity &&
        previousSettings.diffusionAmount === nextSettings.diffusionAmount &&
        previousSettings.auxiliaryAmount === nextSettings.auxiliaryAmount &&
        previousSettings.peakSuppression === nextSettings.peakSuppression &&
        previousSettings.roomPreset === nextSettings.roomPreset &&
        previousSettings.audiencePreset === nextSettings.audiencePreset &&
        previousSettings.baseVolume !== nextSettings.baseVolume
      );
    }

    function applyActiveEnsembleTrim(previousSettings, nextSettings) {
      if (!audioContext || !previousSettings || !nextSettings) {
        return;
      }

      const previousBase = Math.max(1, previousSettings.baseVolume || 1);
      const nextBase = Math.max(0, nextSettings.baseVolume || 0);
      const ratio = nextBase / previousBase;
      const now = audioContext.currentTime;

      activeNodes.forEach(({ trimNode }) => {
        if (!trimNode) {
          return;
        }

        trimNode.gain.cancelScheduledValues(now);
        trimNode.gain.setTargetAtTime(trimNode.gain.value * ratio, now, 0.03);
      });
    }

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

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function parseNumberInput(input, fallback) {
      const parsed = Number.parseInt(input.value, 10);
      return Number.isNaN(parsed) ? fallback : parsed;
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

      const isFailure = plainText.startsWith("실패:") || plainText.includes(" 실패:");
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
      playPauseButton.title = isPlaying ? "일시정지" : "재생";
    }

    function refreshToggleChips() {
      if (loopChip) {
        loopChip.classList.toggle("active", loopPlaybackInput.checked);
      }
      if (shuffleChip) {
        shuffleChip.classList.toggle("active", shufflePlaybackInput.checked);
      }
    }

    function formatTime(seconds) {
      const safeSeconds = Math.max(0, Math.floor(seconds || 0));
      const minutes = Math.floor(safeSeconds / 60);
      const remain = safeSeconds % 60;
      return `${minutes}:${String(remain).padStart(2, "0")}`;
    }

    function getMaxMs(values = []) {
      if (!Array.isArray(values) || values.length === 0) {
        return 0;
      }
      return values.reduce((maxValue, value) => Math.max(maxValue, Number(value) || 0), 0);
    }

    function estimatePlaybackTailSeconds(settings = playbackSettings) {
      if (!settings || isOriginalMode) {
        return 0;
      }

      const preset = getRoomPresetConfig(settings.roomPreset);
      const audience = getAudiencePresetConfig(settings.audiencePreset);
      const trackCount = Math.max(1, settings.count || 1);
      const effectiveDelayMs = settings.delayMs * audience.delayScale;
      const layerStartMaxMs = Math.max(0, (trackCount - 1) * effectiveDelayMs);
      const diffusionScale = clamp(settings.diffusionAmount ?? 100, 0, 100) / 100;
      const auxiliaryScale = clamp(settings.auxiliaryAmount ?? 100, 0, 100) / 100;

      const smearExtraMs = auxiliaryScale > 0 ? getMaxMs(audience.smearTapMs) + 10 + effectiveDelayMs * 0.012 + 4.6 : 0;
      const blurCount = Array.isArray(audience.transientBlurTapMs) ? audience.transientBlurTapMs.length : 0;
      const blurExtraMs = auxiliaryScale > 0 ? getMaxMs(audience.transientBlurTapMs) + Math.max(0, blurCount - 1) * 1.7 + 4.5 : 0;
      const reflectionExtraMs = auxiliaryScale > 0
        ? getMaxMs(preset.earlyReflectionsMs) * audience.reflectionSpacing +
          12 +
          Math.max(0, trackCount - 1) * 2.5 +
          effectiveDelayMs * 0.02
        : 0;
      const reverbTailMs = settings.reverbIntensity > 0
        ? Math.max(0, preset.latePreDelayMs + audience.preDelayMs) * audience.preDelayScale +
          Math.max(preset.earlyReverbSeconds || 0, preset.lateReverbSeconds || preset.reverbSeconds) * 1000
        : 0;
      const diffusionTimeSumMs = Array.isArray(audience.diffusionTimesMs)
        ? audience.diffusionTimesMs.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
        : 0;
      const diffusionTailMs = diffusionScale > 0
        ? diffusionTimeSumMs * (1 + Math.min(0.9, audience.diffusionFeedback * 1.8)) + 140
        : 0;

      return (
        layerStartMaxMs +
        Math.max(smearExtraMs, blurExtraMs, reflectionExtraMs, reverbTailMs, diffusionTailMs)
      ) / 1000;
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

    function stopProgressLoop() {
      if (progressAnimationFrame) {
        cancelAnimationFrame(progressAnimationFrame);
        progressAnimationFrame = null;
      }
    }

    function cleanupActivePlaybackGraph(stopSources = true) {
      const stoppedSources = new Set();

      activeNodes.forEach(({ source, cleanup }) => {
        if (stopSources && source && !stoppedSources.has(source)) {
          try {
            source.stop();
          } catch (error) {
            console.warn("stop skipped", error);
          }
          stoppedSources.add(source);
        }

        if (typeof cleanup === "function") {
          cleanup();
        }
      });

      activeNodes = [];
    }

    function startProgressLoop() {
      stopProgressLoop();

      const tick = () => {
        if (!audioContext || !currentBuffer || !playbackSettings) {
          return;
        }

        const elapsed = Math.max(0, audioContext.currentTime - playbackStartedAt);
        const position = Math.min(currentBuffer.duration, playbackOffset + elapsed);
        updatePlaybackUI(position);

        if (playbackEndTime && audioContext.currentTime >= playbackEndTime) {
          handlePlaybackCompletion();
          return;
          stopProgressLoop();
          if (loopPlaybackInput.checked) {
            playbackOffset = 0;
            updatePlaybackUI(0);
            playCurrentBuffer(0);
            setStatus("<strong>현재 곡 반복</strong>으로 처음부터 다시 시작했습니다.");
            return;
          }
          if (playlistCount > 1 && !isAdvancingTrack) {
            cleanupActivePlaybackGraph(false);
            advanceToNextTrack();
            return;
          }
          cleanupActivePlaybackGraph(false);
          playbackEndTime = 0;
          playbackTailSeconds = 0;
          playbackOffset = 0;
          updatePlaybackUI(0);
          isPlaying = false;
          setPlayButtonState();
          setStatus("<strong>재생 완료</strong> 처음 위치로 돌아갔습니다.");
          return;
        }

        progressAnimationFrame = requestAnimationFrame(tick);
      };

      progressAnimationFrame = requestAnimationFrame(tick);
    }

    function stopPlayback() {
      playbackSessionToken += 1;
      stopProgressLoop();
      clearPlaybackCompletionMonitor();
      cleanupActivePlaybackGraph(true);
      playbackEndTime = 0;
      playbackTailSeconds = 0;
      isPlaying = false;
      setPlayButtonState();
    }

    function getCurrentPlaybackPosition() {
      if (!currentBuffer) {
        return 0;
      }
      if (!isPlaying || !audioContext) {
        return Math.max(0, Math.min(playbackOffset, currentBuffer.duration));
      }

      const elapsed = Math.max(0, audioContext.currentTime - playbackStartedAt);
      return Math.max(0, Math.min(playbackOffset + elapsed, currentBuffer.duration));
    }

    function renderTracks(count, delayMs, baseVolume, volumeDecay, reverbIntensity, diffusionAmount, auxiliaryAmount, peakSuppression, roomPreset, audiencePreset) {
      trackGrid.innerHTML = "";
      const preset = getRoomPresetConfig(roomPreset);
      const audience = getAudiencePresetConfig(audiencePreset);
      const effectiveDelayMs = Math.round(delayMs * audience.delayScale);
      const variationSeedBase = currentTrackId || currentTrackUrl || "preview";

      for (let index = 0; index < count; index += 1) {
        const layerBlend = getLayerBlend(index, count);
        const layerVariation = getLayerVariation(variationSeedBase, index, count, roomPreset, audiencePreset);
        const audienceTrack = getAudienceTrackProfile(audiencePreset, index, count);
        const trackVolume = getTrackVolume(baseVolume, volumeDecay, index);
        const shapedVolume = (trackVolume / 100) * Math.max(0.24, 1 - index * 0.08);
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
        const shownReverb = Math.round(clamp(getTrackEffectStrength(reverbIntensity, index) + audienceTrack.reverbExtra, 0, 100));
        const shownDiffusion = Math.round(clamp(diffusionAmount, 0, 100));
        const shownAuxiliary = Math.round(clamp(auxiliaryAmount, 0, 100));
        const shownSuppression = Math.round(clamp(getTrackEffectStrength(peakSuppression, index) + audienceTrack.suppressionExtra, 0, 100));
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

    async function ensureAudioContext(options = {}) {
      if (!audioContext) {
        audioContext = new AudioContext();
        ensureOutputChain(audioContext);
      }
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      if (options.primeSession) {
        primeAudioSession();
      }
      applyCurrentMasterBusProfile();
      setOutputVolume(clamp(parseNumberInput(playerVolumeInput, 70), 0, 100) / 100, audioContext);
    }

    async function fetchResolvedInput(url) {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "입력 URL을 읽지 못했습니다.");
      }
      return data;
    }

    async function fetchPlaylistEntry(url, index) {
      const response = await fetch("/api/playlist-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, index }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "재생목록 곡 정보를 읽지 못했습니다.");
      }
      return data;
    }

    async function fetchPreparedTrack(trackUrl) {
      const response = await fetch("/api/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trackUrl }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "오디오를 준비하지 못했습니다.");
      }
      return data;
    }

    async function loadAudioBuffer(trackId) {
      const response = await fetch(`/media/${trackId}`);
      if (!response.ok) {
        throw new Error("오디오 파일을 읽지 못했습니다.");
      }
      const payload = await response.arrayBuffer();
      return audioContext.decodeAudioData(payload);
    }

    function readPlaybackSettings() {
      return {
        count: clamp(parseNumberInput(cloneCountInput, 3), 1, 12),
        delayMs: Math.max(0, parseNumberInput(delayMsInput, 120)),
        baseVolume: clamp(parseNumberInput(ensembleVolumeInput, 70), 0, 100),
        volumeDecay: clamp(parseNumberInput(volumeDecayInput, 30), 0, 100),
        reverbIntensity: clamp(parseNumberInput(reverbIntensityInput, 60), 0, 100),
        diffusionAmount: clamp(parseNumberInput(diffusionAmountInput, 100), 0, 100),
        auxiliaryAmount: clamp(parseNumberInput(auxiliaryAmountInput, 100), 0, 100),
        peakSuppression: clamp(parseNumberInput(peakSuppressionInput, 55), 0, 100),
        roomPreset: roomPresetInput.value || "hall",
        audiencePreset: audiencePresetInput.value || "mid",
      };
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
        setStatus("<strong>설정 적용</strong> 다음 재생부터 반영됩니다.");
        return;
      }

      if (isPlaying) {
        if (canApplyLiveBaseVolumeOnly(previousSettings, settings)) {
          applyActiveEnsembleTrim(previousSettings, settings);
          setStatus("<strong>?ㅼ젙 ?곸슜</strong> 蹂쇰ⅷ留??ㅽ뙣?놁씠 ?ㅼ떆 ?곸슜?덉뒿?덈떎.");
          return;
        }
        await ensureAudioContext();
        const currentPosition = getCurrentPlaybackPosition();
        playCurrentBuffer(currentPosition);
        setStatus("<strong>설정 적용</strong> 현재 재생에 바로 반영했습니다.");
        return;
      }

      updatePlaybackUI(playbackOffset);
      setStatus("<strong>설정 적용</strong> 현재 곡에 반영했습니다.");
    }

    function playCurrentBuffer(offsetSeconds = 0) {
      if (!audioContext || !currentBuffer || !playbackSettings) {
        return;
      }

      stopPlayback();
      const sessionToken = playbackSessionToken;
      playbackOffset = Math.max(0, Math.min(offsetSeconds, Math.max(0, currentBuffer.duration - 0.05)));
      playbackStartedAt = audioContext.currentTime + 0.12;
      playbackTailSeconds = isOriginalMode ? 0 : estimatePlaybackTailSeconds(playbackSettings);
      playbackEndTime = playbackStartedAt + Math.max(0, currentBuffer.duration - playbackOffset) + playbackTailSeconds;
      applyCurrentMasterBusProfile(playbackSettings);

      if (isOriginalMode) {
        const source = audioContext.createBufferSource();
        source.buffer = currentBuffer;

        const gainNode = audioContext.createGain();
        gainNode.gain.value = 1;

        const output = ensureOutputChain(audioContext);
        source.connect(gainNode);
        gainNode.connect(output);
        source.start(playbackStartedAt, playbackOffset);
        activeNodes.push({
          source,
          cleanup: () => {
            try {
              source.disconnect();
            } catch (error) {
            }
            try {
              gainNode.disconnect();
            } catch (error) {
            }
          },
        });

        playbackSlider.disabled = false;
        updatePlaybackUI(playbackOffset);
        schedulePlaybackCompletionMonitor(sessionToken);
        startProgressLoop();
        isPlaying = true;
        setPlayButtonState();
        return;
      }

      const {
        count,
        delayMs,
        baseVolume,
        volumeDecay,
        reverbIntensity,
        diffusionAmount,
        auxiliaryAmount,
        peakSuppression,
        roomPreset,
        audiencePreset,
      } = playbackSettings;
      const audience = getAudiencePresetConfig(audiencePreset);
      const effectiveDelayMs = delayMs * audience.delayScale;
      const variationSeedBase = currentTrackId || currentTrackUrl || "default";
      for (let index = 0; index < count; index += 1) {
        const volume = getTrackVolume(baseVolume, volumeDecay, index);
        const shapedVolume = (volume / 100) * Math.max(0.24, 1 - index * 0.08);
        scheduleLayeredTrack(
          currentBuffer,
          playbackStartedAt + (index * effectiveDelayMs) / 1000,
          playbackOffset,
          shapedVolume,
          index,
          delayMs,
          reverbIntensity,
          peakSuppression,
          roomPreset,
          audiencePreset,
          {
            variationSeedBase,
            reverbAmount: reverbIntensity,
            diffusionAmount,
            auxiliaryAmount,
          }
        );
      }

      playbackSlider.disabled = false;
      updatePlaybackUI(playbackOffset);
      schedulePlaybackCompletionMonitor(sessionToken);
      startProgressLoop();
      isPlaying = true;
      setPlayButtonState();
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
      updateTrackThumbnail(entry);
      updateMetaText(entry.title || prepared.title, entryIndex);
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
        let nextOrderPosition = currentOrderPosition + 1;
        if (nextOrderPosition >= playOrder.length) {
          if (!playlistLoopInput.checked) {
            playbackOffset = currentBuffer ? currentBuffer.duration : 0;
            updatePlaybackUI(playbackOffset);
            setStatus("<strong>재생목록 종료</strong> 마지막 곡까지 재생했습니다.");
            return;
          }

          const restartIndex = shufflePlaybackInput.checked
            ? Math.floor(Math.random() * playlistCount)
            : 0;
          rebuildPlayOrder(restartIndex);
          nextOrderPosition = 0;
        }

        currentOrderPosition = nextOrderPosition;
        const nextEntryIndex = getCurrentPlaylistIndex();
        const nextEntry = nextEntryIndex === null ? null : await ensurePlaylistEntry(nextEntryIndex);
        if (!nextEntry) {
          return;
        }

        await ensureAudioContext();
        setStatus(`<strong>다음 곡 준비 중...</strong> ${nextEntry.title}`, true);
        await loadPreparedEntry(nextEntry, nextEntryIndex, 0);
        playCurrentBuffer(0);
        setStatus(`<strong>다음 곡 재생:</strong> ${nextEntry.title}`);
      } catch (error) {
        setStatus(`<strong>다음 곡 실패:</strong> ${error.message}`);
      } finally {
        setBusy(false);
        isAdvancingTrack = false;
      }
    }

    async function prepareAudio(autoPlay = false) {
      const url = youtubeUrlInput.value.trim();
      if (!url) {
        setStatus("유튜브 주소를 먼저 입력해 주세요.");
        return;
      }

      const settings = readPlaybackSettings();
      setBusy(true);
      setStatus("<strong>입력 분석 중...</strong> 영상 또는 재생목록을 읽고 있습니다.", true);
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
          throw new Error("재생 가능한 곡을 찾지 못했습니다.");
        }

        const startEntryIndex = shufflePlaybackInput.checked
          ? Math.floor(Math.random() * playlistCount)
          : 0;
        rebuildPlayOrder(startEntryIndex);
        const firstEntry = await ensurePlaylistEntry(startEntryIndex);
        if (!firstEntry) {
          throw new Error("첫 곡을 준비하지 못했습니다.");
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
            `<strong>${settings.count}개 트랙</strong> 재생 중 - ${currentEntry ? currentEntry.title : "현재 곡"}`
          );
        } else {
          setStatus(
            `<strong>준비 완료.</strong> ${playlistCount > 1 ? `재생목록 ${playlistCount}곡` : "단일 곡"}을 불러왔습니다.`
          );
        }
      } catch (error) {
        isPrepared = false;
        isPlaying = false;
        setPlayButtonState();
        setStatus(`<strong>실패:</strong> ${error.message}`);
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

      await ensureAudioContext();
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
        `<strong>${playbackSettings.count}개 트랙</strong> 재생 중 - ${currentEntry ? currentEntry.title : "현재 곡"}`
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
      setStatus("<strong>일시정지</strong> 다시 누르면 이어서 재생합니다.");
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
        setStatus(isOriginalMode ? "원본 재생 모드가 켜졌습니다." : "콘서트 재생 모드로 돌아왔습니다.");
        return;
      }

      if (isPlaying) {
        await ensureAudioContext();
        const currentPosition = getCurrentPlaybackPosition();
        playCurrentBuffer(currentPosition);
      } else {
        applyCurrentMasterBusProfile(playbackSettings);
      }

      setStatus(isOriginalMode ? "원본 재생 모드로 전환했습니다." : "콘서트 재생 모드로 전환했습니다.");
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
          setStatus("<strong>처음 위치</strong> 현재 곡의 시작점으로 이동했습니다.");
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
          setStatus("<strong>처음 위치</strong> 현재 곡의 시작점으로 이동했습니다.");
        }
        return;
      }

      isAdvancingTrack = true;
      try {
        stopPlayback();
        let nextOrderPosition = currentOrderPosition + direction;
        if (nextOrderPosition < 0) {
          nextOrderPosition = playlistLoopInput.checked ? playOrder.length - 1 : 0;
        }
        if (nextOrderPosition >= playOrder.length) {
          nextOrderPosition = playlistLoopInput.checked ? 0 : playOrder.length - 1;
        }

        currentOrderPosition = nextOrderPosition;
        const entryIndex = getCurrentPlaylistIndex();
        const entry = entryIndex === null ? null : await ensurePlaylistEntry(entryIndex);
        if (!entry) {
          return;
        }

        await ensureAudioContext();
        setStatus(
          `<strong>${direction < 0 ? "이전 곡" : "다음 곡"} 준비 중...</strong> ${entry.title}`,
          true
        );
        await loadPreparedEntry(entry, entryIndex, 0);
        playCurrentBuffer(0);
        setStatus(`<strong>${direction < 0 ? "이전 곡" : "다음 곡"} 재생</strong> ${entry.title}`);
      } catch (error) {
        setStatus(`<strong>곡 이동 실패:</strong> ${error.message}`);
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
          setStatus(`<strong>곡 준비 중..</strong> ${entry.title}`, true);
          await loadPreparedEntry(entry, selectedIndex, 0);
          playCurrentBuffer(0);
          setStatus(`<strong>곡 재생</strong> ${entry.title}`);
        } catch (error) {
          setStatus(`<strong>곡 이동 실패:</strong> ${error.message}`);
        } finally {
          setBusy(false);
          isAdvancingTrack = false;
        }
      });
    }
    applySettingsButton.addEventListener("click", () => {
      applyPlaybackSettings().catch((error) => {
        setStatus(`<strong>설정 적용 실패:</strong> ${error.message}`);
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
          setStatus(`<strong>원본 모드 전환 실패:</strong> ${error.message}`);
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
          `<strong>${formatTime(seekSeconds)}</strong> 위치부터 다시 재생합니다.`
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
    shutdownButton.addEventListener("click", async () => {
      if (!APP_CONFIG.canShutdown) {
        setStatus("이 접속에서는 프로그램 종료 권한이 없습니다.");
        return;
      }
      shutdownButton.disabled = true;
      setStatus("프로그램을 종료하는 중입니다...");
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

    updatePlayerVolumeUI();
    normalizeToggleLabels();
    refreshOriginalToggleButton();
    renderTrackPreviewFromInputs();
    refreshToggleChips();
    setPlayButtonState();
  
