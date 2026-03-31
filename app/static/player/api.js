    async function fetchResolvedInput(url) {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "\uC785\uB825 URL\uC744 \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
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
        throw new Error(data.error || "\uC7AC\uC0DD\uBAA9\uB85D \uACE1 \uC815\uBCF4\uB97C \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
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
        throw new Error(data.error || "\uC624\uB514\uC624\uB97C \uC900\uBE44\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      }
      return data;
    }

    async function loadAudioBuffer(trackId) {
      const response = await fetch(`/media/${trackId}`);
      if (!response.ok) {
        throw new Error("\uC624\uB514\uC624 \uD30C\uC77C\uC744 \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      }
      const payload = await response.arrayBuffer();
      return audioContext.decodeAudioData(payload);
    }
