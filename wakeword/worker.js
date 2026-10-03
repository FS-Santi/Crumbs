const fs = require("fs");
const { parentPort, workerData } = require("worker_threads");
const sherpa = require("sherpa-onnx-node");

const streams = new Map();
const audioLevels = new Map();

try {
  for (const file of [
    workerData.wakeFiles.encoder,
    workerData.wakeFiles.decoder,
    workerData.wakeFiles.joiner,
    workerData.wakeFiles.tokens,
    workerData.keywordsFile
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing wake-word file: ${file}`);
    }
  }

  const spotter = new sherpa.KeywordSpotter({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: workerData.wakeFiles.encoder,
        decoder: workerData.wakeFiles.decoder,
        joiner: workerData.wakeFiles.joiner
      },
      tokens: workerData.wakeFiles.tokens,
      numThreads: 1,
      provider: "cpu",
      debug: 0
    },
    maxActivePaths: 4,
    keywordsScore: 1.5,
    keywordsThreshold: 0.25,
    keywordsFile: workerData.keywordsFile
  });

  parentPort.postMessage({ type: "ready" });

  parentPort.on("message", ({ type, clientId, pcm }) => {
    if (type === "close") {
      streams.delete(clientId);
      audioLevels.delete(clientId);
      return;
    }
    if (type !== "audio") return;

    let stream = streams.get(clientId);
    if (!stream) {
      stream = spotter.createStream();
      streams.set(clientId, stream);
    }

    const input = Buffer.from(pcm);
    const samples = new Float32Array(Math.floor(input.length / 2));
    let chunkSquares = 0;
    let chunkPeak = 0;
    for (let i = 0; i < samples.length; i++) {
      const sample = input.readInt16LE(i * 2) / 32768;
      samples[i] = sample;
      chunkSquares += sample * sample;
      chunkPeak = Math.max(chunkPeak, Math.abs(sample));
    }
    if (!samples.length) return;

    let levels = audioLevels.get(clientId);
    if (!levels) {
      levels = { squares: 0, peak: 0, count: 0, lastReportAt: Date.now() };
      audioLevels.set(clientId, levels);
    }
    levels.squares += chunkSquares;
    levels.peak = Math.max(levels.peak, chunkPeak);
    levels.count += samples.length;

    stream.acceptWaveform({ sampleRate: 16000, samples });
    while (spotter.isReady(stream)) {
      spotter.decode(stream);
      const result = spotter.getResult(stream);
      if (result.keyword) {
        console.log("👀 WAKE WORD DETECTED:", result.keyword);
        spotter.reset(stream);
        parentPort.postMessage({ type: "wake", clientId });
        break;
      }
    }

    const now = Date.now();
    if (now - levels.lastReportAt >= 1000) {
      const rms = Math.sqrt(levels.squares / levels.count);
      const toDbfs = (value) => value > 0 ? Math.max(-80, 20 * Math.log10(value)) : -80;
      parentPort.postMessage({
        type: "audio-level",
        clientId,
        rmsDbfs: toDbfs(rms),
        peakDbfs: toDbfs(levels.peak)
      });
      levels.squares = 0;
      levels.peak = 0;
      levels.count = 0;
      levels.lastReportAt = now;
    }
  });
} catch (error) {
  parentPort.postMessage({ type: "error", error: error.message });
}
