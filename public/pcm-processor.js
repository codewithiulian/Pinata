// AudioWorklet processor: captures mic audio, downsamples to 16kHz PCM16
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.inputBuf = [];
    this.readIdx = 0;
    this.outputBuf = [];
    this.chunkSize = 1600; // 100ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      this.inputBuf.push(input[i]);
    }

    // Downsample with linear interpolation
    while (this.readIdx < this.inputBuf.length - 1) {
      const idx = Math.floor(this.readIdx);
      const frac = this.readIdx - idx;
      const sample =
        this.inputBuf[idx] * (1 - frac) +
        this.inputBuf[Math.min(idx + 1, this.inputBuf.length - 1)] * frac;
      const s = Math.max(-1, Math.min(1, sample));
      this.outputBuf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      this.readIdx += this.ratio;
    }

    const consumed = Math.floor(this.readIdx);
    if (consumed > 0) {
      this.inputBuf = this.inputBuf.slice(consumed);
      this.readIdx -= consumed;
    }

    // Send chunks of ~100ms
    while (this.outputBuf.length >= this.chunkSize) {
      const chunk = new Int16Array(this.outputBuf.splice(0, this.chunkSize));
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
