    function updateMediaSessionMetadata(entry = getCurrentPlaylistEntry()) {
      if (!("mediaSession" in navigator)) {
        return;
      }

      if (!entry) {
        navigator.mediaSession.metadata = null;
        return;
      }

      const artworkUrl = getTrackThumbnailUrl(entry);
      const modeLabel = isOriginalMode ? "Original Mode" : "Concert Mode";
      navigator.mediaSession.metadata = new MediaMetadata({
        title: entry.title || "YouTube Concert",
        artist: modeLabel,
        album: "YouTube Concert",
        artwork: artworkUrl
          ? [
              { src: artworkUrl, sizes: "480x360", type: "image/jpeg" },
            ]
          : [],
      });
    }

    function updateMediaSessionPlaybackState() {
      if (!("mediaSession" in navigator)) {
        return;
      }

      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }

    function installMediaSessionHandlers() {
      if (!("mediaSession" in navigator)) {
        return;
      }

      const setHandler = (action, handler) => {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch (error) {
        }
      };

      setHandler("play", () => {
        playPauseToggle().catch((error) => {
          console.warn("media session play failed", error);
        });
      });
      setHandler("pause", () => {
        pausePlayback();
      });
      setHandler("previoustrack", () => {
        playAdjacentTrack(-1).catch((error) => {
          console.warn("media session prev failed", error);
        });
      });
      setHandler("nexttrack", () => {
        playAdjacentTrack(1).catch((error) => {
          console.warn("media session next failed", error);
        });
      });
    }
