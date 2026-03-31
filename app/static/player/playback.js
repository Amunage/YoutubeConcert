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
        return;
      }

      const cleanup = playbackMonitorCleanup;
      playbackMonitorCleanup = null;
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

    function ensureAudioKeepAlive() {
      if (!audioContext || audioKeepAliveNode || typeof audioContext.createConstantSource !== "function") {
        return;
      }

      const keepAliveNode = audioContext.createConstantSource();
      const keepAliveGain = audioContext.createGain();
      keepAliveNode.offset.value = 0;
      keepAliveGain.gain.value = 1;
      keepAliveNode.connect(keepAliveGain);
      keepAliveGain.connect(audioContext.destination);
      keepAliveNode.start();

      audioKeepAliveNode = keepAliveNode;
    }

    async function restorePlaybackSession() {
      if (!isPlaying || !audioContext) {
        return;
      }

      try {
        await ensureAudioContext();
      } catch (error) {
        console.warn("audio context resume skipped", error);
      }

      if (!progressAnimationFrame) {
        startProgressLoop();
      }
      updatePlaybackUI(getCurrentPlaybackPosition());
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
        setStatus("<strong>\uD604\uC7AC \uACE1 \uBC18\uBCF5</strong>\uC73C\uB85C \uCC98\uC74C\uBD80\uD130 \uB2E4\uC2DC \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4.");
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
      setStatus("<strong>\uC7AC\uC0DD \uC644\uB8CC</strong> \uD604\uC7AC \uACE1\uC774 \uB05D\uB0AC\uC2B5\uB2C8\uB2E4.");
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
      ensureAudioKeepAlive();
      applyCurrentMasterBusProfile();
      setOutputVolume(clamp(parseNumberInput(playerVolumeInput, 70), 0, 100) / 100, audioContext);
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
