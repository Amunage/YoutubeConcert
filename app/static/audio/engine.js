window.AudioEngine = (() => {
    const {
      getAudienceTrackProfile,
      getRoomPresetConfig,
      getAudiencePresetConfig,
    } = window.AudioPresets;
    const {
      clamp,
      getConvolverBuffer,
    } = window.AudioEffects;
    const {
      ensureOutputChain,
      setOutputVolume,
      setMasterBusProfile,
    } = window.AudioOutput;
    const {
      getLayerBlend,
      getTrackVolume,
      getTrackEffectStrength,
      getPanPosition,
      getReflectionPan,
      getLayerVariation,
      scheduleLayeredTrack,
    } = window.AudioLayers;

    function shuffleIndices(count) {
      const items = Array.from({ length: count }, (_, index) => index);
      for (let index = items.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
      }
      return items;
    }

    function rebuildPlayOrder(startEntryIndex = 0) {
      if (!playlistCount) {
        playOrder = [];
        currentOrderPosition = 0;
        prefetchedTrackUrl = "";
        prefetchInFlightUrl = "";
        return;
      }

      playOrder = shufflePlaybackInput.checked
        ? shuffleIndices(playlistCount)
        : Array.from({ length: playlistCount }, (_, index) => index);

      const pinnedIndex = Math.max(0, Math.min(startEntryIndex, playlistCount - 1));
      const foundAt = playOrder.indexOf(pinnedIndex);
      if (foundAt > 0) {
        playOrder.splice(foundAt, 1);
        playOrder.unshift(pinnedIndex);
      }
      currentOrderPosition = 0;
      prefetchedTrackUrl = "";
      prefetchInFlightUrl = "";
    }

    function getCurrentPlaylistIndex() {
      if (!playlistCount || !playOrder.length) {
        return null;
      }
      return playOrder[currentOrderPosition] ?? null;
    }

    function getCurrentPlaylistEntry() {
      const entryIndex = getCurrentPlaylistIndex();
      if (entryIndex === null) {
        return null;
      }
      return playlistEntryCache[entryIndex] || null;
    }

    function getAdjacentOrderPosition(direction) {
      if (!playlistCount || !playOrder.length) {
        return null;
      }

      let nextOrderPosition = currentOrderPosition + direction;
      if (nextOrderPosition < 0) {
        return playlistLoopInput.checked ? playOrder.length - 1 : 0;
      }
      if (nextOrderPosition >= playOrder.length) {
        return playlistLoopInput.checked ? 0 : null;
      }
      return nextOrderPosition;
    }

    function updateMetaText(entryTitle = "", entryIndex = null) {
      const normalizedEntryTitle = (entryTitle || "").trim();
      const hasIndex = entryIndex !== null && playlistCount > 1;
      const indexText = hasIndex ? `<${entryIndex + 1}/${playlistCount}> ` : "";
      let text = "";

      if (normalizedEntryTitle) {
        text = `${indexText}${normalizedEntryTitle}`;
      } else if (hasIndex) {
        text = indexText.trim();
      }

      metaText.textContent = text || "아직 불러온 곡이 없습니다.";
    }

    return {
      getLayerBlend,
      getTrackVolume,
      getTrackEffectStrength,
      getAudienceTrackProfile,
      getRoomPresetConfig,
      getPanPosition,
      getLayerVariation,
      getAudiencePresetConfig,
      getReflectionPan,
      getConvolverBuffer,
      ensureOutputChain,
      setOutputVolume,
      setMasterBusProfile,
      rebuildPlayOrder,
      getCurrentPlaylistIndex,
      getCurrentPlaylistEntry,
      getAdjacentOrderPosition,
      updateMetaText,
      scheduleLayeredTrack,
    };
  })();
