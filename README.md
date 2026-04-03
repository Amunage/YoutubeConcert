# YT Concert Live

YT Concert Live is a Chrome extension that captures the current tab audio, processes it like a live venue, and plays it back in real time.

It is designed for people who want YouTube performances, concert clips, fan cams, and other live-style content to feel wider, deeper, and more venue-like without leaving the browser.

## Features

- Real-time tab audio capture and venue-style playback
- Multiple room presets such as Arena, Stadium, Hall, Club, and more
- Listener position presets from front-facing to distant/outside perspectives
- Layered audience/space rendering for a wider live feel
- Advanced controls for direct/wet balance, diffusion, reflections, blur, and tone shaping
- Optional experimental toggles for trying alternate ambience behaviors
- Reset button for advanced-only settings without changing the main preset selection

## Installation

This project is currently installed as an unpacked Chrome extension.

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or another Chromium-based browser.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select the [`extension`](./extension) folder from this repository.

After installation, the extension icon should appear in your browser toolbar.

## Quick Start

1. Open a YouTube video or any page that plays audio in the current tab.
2. Click the `YT Concert Live` extension icon.
3. Choose a `Room Preset`.
4. Choose a `Listener Position`.
5. Adjust `Layer Count` and `Delay` if needed.
6. Start playback processing from the popup.

For a stronger live-space effect:

- Use `Arena` or `Stadium`
- Move the listener farther back
- Increase layers carefully
- Fine-tune with the `Advanced` section

## Advanced Settings

The `Advanced` section is for more detailed tuning.

Examples include:

- Ensemble balance
- Wet/dry behavior
- Reflection and diffusion intensity
- Blur and smear character
- Space and tone shaping

If the sound gets too extreme, use the `Reset Advanced` button to restore only advanced settings to their defaults while keeping your main preset choices.

## Experimental Features

Experimental options are separated from the main sound path and are off by default.

These are intended for A/B listening and quick rollback, so you can try different ambient behaviors without committing to them as the default sound.

## Notes

- This extension processes the current tab audio in real time.
- It is intended for Chrome/Chromium environments that support the required extension APIs.
- Because this is a live-processing tool, perceived results can vary depending on the source mix, speaker/headphone setup, and browser state.
- Very dense mixes or very aggressive settings may need additional manual tuning.


## Status

This project is under active tuning and iteration. Preset behavior, advanced controls, and experimental modules may continue to evolve as the audio engine is refined.
