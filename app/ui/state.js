var APP_CONFIG = __APP_CONFIG__;

var youtubeUrlInput = document.getElementById("youtubeUrlVisible");
var cloneCountInput = document.getElementById("cloneCount");
var delayMsInput = document.getElementById("delayMs");
var playerVolumeInput = document.getElementById("playerVolume");
var muteButton = document.getElementById("muteButton");
var volumeDecayInput = document.getElementById("volumeDecay");
var reverbIntensityInput = document.getElementById("reverbIntensity");
var diffusionAmountInput = document.getElementById("diffusionAmount");
var auxiliaryAmountInput = document.getElementById("auxiliaryAmount");
var peakSuppressionInput = document.getElementById("peakSuppression");
var roomPresetInput = document.getElementById("roomPreset");
var audiencePresetInput = document.getElementById("audiencePreset");
var applySettingsButton = document.getElementById("applySettingsButton");
var playPauseButton = document.getElementById("playPauseButton");
var loadButton = document.getElementById("loadButtonVisible");
var playlistSelect = document.getElementById("playlistSelectRow");
var originalToggleButton = document.getElementById("originalToggleButton");
var prevButton = document.getElementById("prevButton");
var nextButton = document.getElementById("nextButton");
var shutdownButton = document.getElementById("shutdownButton");
var loopPlaybackInput = document.getElementById("loopPlayback");
var playlistLoopInput = document.getElementById("playlistLoop");
var shufflePlaybackInput = document.getElementById("shufflePlayback");
var loopChip = document.getElementById("loopChip");
var shuffleChip = document.getElementById("shuffleChip");
var thumbnailPanel = document.getElementById("thumbnailPanel");
var trackThumbnail = document.getElementById("trackThumbnail");
var metaText = document.getElementById("metaText");
var playbackSlider = document.getElementById("playbackSlider");
var playbackTimes = document.getElementById("playbackTimes");
var inlineStatus = document.getElementById("inlineStatus");
var trackGrid = document.getElementById("trackGrid");

var audioContext = null;
var currentBuffer = null;
var activeNodes = [];
var currentTrackId = null;
var currentTrackUrl = "";
var playbackSettings = null;
var playbackStartedAt = 0;
var playbackOffset = 0;
var playbackTailSeconds = 0;
var playbackEndTime = 0;
var progressAnimationFrame = null;
var isSeeking = false;
var isPrepared = false;
var isAdvancingTrack = false;
var isPlaying = false;
var playlistSourceUrl = "";
var playlistCount = 0;
var playlistEntryCache = {};
var playOrder = [];
var currentOrderPosition = 0;
var statusTimer = null;
var prefetchedTrackUrl = "";
var prefetchInFlightUrl = "";
var previousVolumeBeforeMute = 70;
var isOriginalMode = false;
var failedPlaylistEntryIndexes = new Set();
var playbackMonitorCleanup = null;
var playbackMonitorTimer = null;
var playbackSessionToken = 0;
var hasPrimedAudioSession = false;
var audioKeepAliveNode = null;

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(max, Math.max(min, number));
}

function parseNumberInput(input, fallbackValue) {
  const number = Number(input && input.value);
  return Number.isFinite(number) ? number : fallbackValue;
}
