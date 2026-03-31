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
    let prefetchedBufferTrackId = null;
    let prefetchedBufferTrackUrl = "";
    let prefetchedAudioBuffer = null;
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
    let playlistEntryLabels = [];
    let playOrder = [];
    let currentOrderPosition = 0;
    let statusTimer = null;
    let prefetchedTrackUrl = "";
    let prefetchInFlightUrl = "";
    let predecodeInFlightUrl = "";
    let previousVolumeBeforeMute = 70;
    let isOriginalMode = false;
    let failedPlaylistEntryIndexes = new Set();
    let playbackMonitorCleanup = null;
    let playbackMonitorTimer = null;
    let playbackSessionToken = 0;
    let hasPrimedAudioSession = false;
    let audioKeepAliveNode = null;
    let trackPreviewRenderFrame = null;
    let playlistSelectRenderKey = "";
    let playlistEntryAccessTick = 0;
    let playlistEntryAccessTimes = {};

    const PLAYLIST_ENTRY_CACHE_LIMIT = 24;
    const PLAYLIST_PRELOAD_BEHIND = 1;
    const PLAYLIST_PRELOAD_AHEAD = 3;

    const {
      buildLayerComputationCache,
      buildLayerVariationCache,
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
      ensureSharedEffectBus,
      syncSharedEffectBusUsage,
      setOutputVolume,
      setMasterBusProfile,
    } = window.AudioEngine;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function parseNumberInput(input, fallback) {
      const parsed = Number.parseInt(input.value, 10);
      return Number.isNaN(parsed) ? fallback : parsed;
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
      return values.reduce((maxValue, value) => {
        const numericValue = value && typeof value === "object" && !Array.isArray(value)
          ? Number(value.timeMs) || 0
          : Number(value) || 0;
        return Math.max(maxValue, numericValue);
      }, 0);
    }
