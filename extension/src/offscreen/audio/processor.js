class PassthroughProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[channel] || input[0];
      const target = output[channel];

      if (!source || !target) {
        continue;
      }

      target.set(source);
    }

    return true;
  }
}

registerProcessor("passthrough-processor", PassthroughProcessor);
