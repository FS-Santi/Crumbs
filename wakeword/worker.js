const fs = require("fs");
const { parentPort, workerData } = require("worker_threads");
const sherpa = require("sherpa-onnx-node");

const streams = new Map();

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
    keywordsThreshold: 0.55,
    keywordsFile: workerData.keywordsFile
  });

  parentPort.postMessage({ type: "ready" });

  parentPort.on("message", ({ type, clientId, pcm }) => {
    if (type === "close") {
      streams.delete(clientId);
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
    for (let i = 0; i < samples.length; i++) {
      samples[i] = input.readInt16LE(i * 2) / 32768;
    }
    if (!samples.length) return;

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
  });
} catch (error) {
  parentPort.postMessage({ type: "error", error: error.message });
}
