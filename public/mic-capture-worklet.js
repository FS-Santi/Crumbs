class CrumbsMicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 2048;
    this.frame = new Float32Array(this.frameSize);
    this.frameOffset = 0;
  }

  process(inputs, outputs) {
    const outputChannels = outputs[0] || [];
    for (const channel of outputChannels) {
      channel.fill(0);
    }

    const input = inputs[0]?.[0];
    if (!input) return true;

    let inputOffset = 0;
    while (inputOffset < input.length) {
      const copyLength = Math.min(
        this.frameSize - this.frameOffset,
        input.length - inputOffset
      );
      this.frame.set(
        input.subarray(inputOffset, inputOffset + copyLength),
        this.frameOffset
      );
      this.frameOffset += copyLength;
      inputOffset += copyLength;

      if (this.frameOffset === this.frameSize) {
        const completedFrame = this.frame;
        this.frame = new Float32Array(this.frameSize);
        this.frameOffset = 0;
        this.port.postMessage(completedFrame.buffer, [completedFrame.buffer]);
      }
    }

    return true;
  }
}

registerProcessor("crumbs-mic-capture", CrumbsMicCaptureProcessor);
