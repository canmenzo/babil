// Runs inside an AudioContext created at 16 kHz; batches 128-sample render quanta into 100 ms frames.
const FRAME = 1600;

class CaptureProcessor extends AudioWorkletProcessor {
  buf = new Float32Array(FRAME);
  len = 0;

  process(inputs) {
    const ch = inputs[0];
    if (!ch.length) return true;
    const n = ch[0].length;
    for (let i = 0; i < n; i++) {
      // downmix to mono
      let s = 0;
      for (let c = 0; c < ch.length; c++) s += ch[c][i];
      this.buf[this.len++] = s / ch.length;
      if (this.len === FRAME) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(FRAME);
        this.len = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
