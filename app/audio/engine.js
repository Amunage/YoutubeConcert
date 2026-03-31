window.AudioEngine = (() => {
  const {
    getAudienceTrackProfile,
    getRoomPresetConfig,
    getAudiencePresetConfig,
  } = window.AudioPresets;
  const {
    getLayerBlend,
    getTrackVolume,
    getTrackEffectStrength,
    getPanPosition,
    getReflectionPan,
    getLayerVariation,
    scheduleLayeredTrack,
  } = window.AudioLayers;
  const {
    ensureOutputChain,
    setOutputVolume,
    setMasterBusProfile,
  } = window.AudioOutput;
  const { getConvolverBuffer } = window.AudioEffects;

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
    scheduleLayeredTrack,
  };
})();
