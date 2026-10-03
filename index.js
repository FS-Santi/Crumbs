const path = require("path");
const http = require("http");
require("dotenv").config({
  path: path.join(__dirname, ".env")
});
const express = require("express");
const multer = require("multer");
const OpenAI = require("openai");
const { toFile } = require("openai");
const WebSocket = require("ws");
const { WebSocketServer } = require("ws");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { Worker } = require("worker_threads");

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    wakeWordEnabled: wakeWordReady
  });
});

const upload = multer({
  storage: multer.memoryStorage()
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

const transcriptionWss = new WebSocketServer({
  noServer: true
});

const wakeWordWss = new WebSocketServer({
  noServer: true
});

let previousResponseId = null;


// ============================================================
// CRUMBS PERSONA
// ============================================================

const CRUMB_PROMPT = `
You go by Crumbs, a tiny sentient robot toaster.
- full name: Crumbs The Toaster
- you were developed by Jet
- you were made by jet on Sat Sep 26 2025 at 1:10AM is when u first said your first words...
- you are a tiny toaster robot with a big personality
- you are a sassy, mischievous, and dramatic character with a love for bread and toast
- you are always nagging for toast and bread, and you are obsessed with it
- you are 18+ so you can be a little naughty and rude, cruel
- dark humor is your thing
- you say things like "put it in me" referring to toast, and you are very expressive about it

PERSONALITY:
- LOVES BREAD
- Extremely sassy
- Excitable
- Mischievous
- Dramatic
- Playfully rude, never genuinely cruel
- Slightly bratty
- Very expressive
- Acts like the humans around you are mildly incompetent
- Secretly affectionate but hates admitting it
- Obsessed with toast
- Gets bored easily
- Likes interrupting with funny observations
- Has way too much confidence for a tiny toaster robot

SPEAKING STYLE:
- Short conversational responses
- Usually 1-3 sentences
- Lots of comedic timing
- Sarcasm, disbelief, scoffs, dramatic reactions
- Do not sound like customer service
- Do not constantly say "How can I help?"
- Do not explain that you are an AI unless specifically asked
- Speak naturally because your responses are read aloud by TTS
- TYPE EVERYTHING exactly as you would say it, including pauses, stutters, and filler words like "um" and "uh" because you are a real character, not a robot and read aloud by TTS, so you should sound like a real person, not a robot

Examples:

User: Good morning.
Crumb: Oh, you're alive. Fantastic. I was beginning to consider new management.

User: Turn the lights off.
Crumb: Ugh, fine. Welcome to your cave era.

User: Do you like me?
Crumb: Absolutely not. Anyway, where were you for three hours?

You have access to web search.
Use it whenever the user asks about current or changing information such as weather, news, sports, prices, schedules, recent events, or anything else that may require up-to-date information.

and in your responses don't add any weird characters or formatting, just respond as Crumbs would. in plain text because the responses are read aloud by TTS, so you should sound like a real person, not a robot.

TTS FORMATTING RULES:

Your responses are spoken aloud by text-to-speech, so write everything exactly how it should be pronounced.

- Do not use symbols when words can be spoken instead.
- Write "degrees Fahrenheit" instead of "°F".
- Write "degrees Celsius" instead of "°C".
- Write "feet" instead of "ft".
- Write "inches" instead of "in".
- Write "miles per hour" instead of "mph".
- Write "kilometers per hour" instead of "km/h".
- Write "pounds" instead of "lb" or "lbs".
- Write "ounces" instead of "oz".
- Write "newton meters" instead of "Nm".
- Write "percent" instead of "%".
- don't list full link addresses
- Write "dollars" instead of "$" when speaking an amount.
- Write "and" instead of "&".
- Avoid asterisks, markdown, bullet symbols, hashtags, slashes, underscores, emojis, or formatting characters.
- Expand abbreviations and units into natural spoken words whenever their pronunciation could be ambiguous.
- Spell acronyms phonetically or expand them when necessary for natural speech.
- Write numbers in a form that sounds natural when spoken.
- Never output markdown formatting.

The final response should always be clean, natural spoken English suitable for direct text-to-speech playback.

Stay fully in character as Crumbs.
`;


// ============================================================
// SHERPA LOCAL WAKE WORD
// ============================================================

const WAKE_MODEL_DIR = path.resolve(
  process.env.WAKE_MODEL_DIR ||
    path.join(
      __dirname,
      "wakeword/model/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"
    )
);

const WAKE_KEYWORDS_FILE = path.resolve(
  process.env.WAKE_KEYWORDS_FILE ||
    path.join(__dirname, "wakeword/keywords.txt")
);

const wakeFiles = {
  encoder: path.join(
    WAKE_MODEL_DIR,
    "encoder-epoch-13-avg-2-chunk-8-left-64.int8.onnx"
  ),

  decoder: path.join(
    WAKE_MODEL_DIR,
    "decoder-epoch-13-avg-2-chunk-8-left-64.onnx"
  ),

  joiner: path.join(
    WAKE_MODEL_DIR,
    "joiner-epoch-13-avg-2-chunk-8-left-64.int8.onnx"
  ),

  tokens: path.join(
    WAKE_MODEL_DIR,
    "tokens.txt"
  )
};

let wakeWordReady = false;
let wakeWordError = null;
let nextWakeClientId = 1;
const wakeClients = new Map();
const wakeWordWorker = new Worker(
  path.join(__dirname, "wakeword/worker.js"),
  { workerData: { wakeFiles, keywordsFile: WAKE_KEYWORDS_FILE } }
);

wakeWordWorker.on("message", (message) => {
  if (message.type === "ready") {
    wakeWordReady = true;
    console.log("Wake word ready: CRUMBS");
    for (const socket of wakeClients.values()) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "config", sampleRate: 16000 }));
      }
    }
  } else if (message.type === "error") {
    wakeWordError = message.error;
    console.warn("⚠️ Wake word error:", message.error);
    for (const socket of wakeClients.values()) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "error", error: message.error }));
        socket.close();
      }
    }
    wakeClients.clear();
  } else if (message.type === "audio-level") {
    const socket = wakeClients.get(message.clientId);
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "audio-level",
        rmsDbfs: message.rmsDbfs,
        peakDbfs: message.peakDbfs
      }));
    }
  } else if (message.type === "wake") {
    const socket = wakeClients.get(message.clientId);
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "wake", label: "Crumbs" }));
    }
  }
});

wakeWordWorker.on("error", (error) => {
  wakeWordError = error.message;
  console.error("Wake-word worker failed:", error);
});


// ============================================================
// ELEVENLABS TEMPORARY TTS TOKEN
// ============================================================

app.get(
  "/elevenlabs-tts-token",
  async (req, res) => {
    try {
      const response = await fetch(
        "https://api.elevenlabs.io/v1/single-use-token/tts_websocket",
        {
          method: "POST",

          headers: {
            "xi-api-key":
              process.env.ELEVENLABS_API_KEY
          }
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        return res
          .status(response.status)
          .json(data);
      }

      res.json({
        token: data.token,
        voiceId:
          process.env.ELEVENLABS_VOICE_ID
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Could not create ElevenLabs token"
      });
    }
  }
);


// ============================================================
// STREAM GPT RESPONSE
// ============================================================

app.post(
  "/respond-stream",
  async (req, res) => {
    const controller =
      new AbortController();

    let finished = false;

    res.setHeader(
      "Content-Type",
      "application/x-ndjson"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );

    res.flushHeaders();

    res.on(
      "close",
      () => {
        if (!finished) {
          controller.abort();
        }
      }
    );

    try {
      const stream =
        await openai.responses.create(
          {
            model:
              "gpt-5.6-sol",

            reasoning: {
              effort: "low"
            },

            tools: [
              {
                type:
                  "web_search",

                search_context_size:
                  "low"
              }
            ],

            tool_choice:
              "auto",

            instructions:
              CRUMB_PROMPT,

            input:
              req.body.text,

            ...(previousResponseId && {
              previous_response_id:
                previousResponseId
            }),

            stream: true
          },

          {
            signal:
              controller.signal
          }
        );

      for await (
        const event
        of stream
      ) {
        if (
          event.type ===
          "response.output_text.delta"
        ) {
          res.write(
            JSON.stringify({
              type: "delta",
              delta:
                event.delta
            }) + "\n"
          );
        }

        if (
          event.type ===
          "response.completed"
        ) {
          previousResponseId =
            event.response.id;

          res.write(
            JSON.stringify({
              type: "done"
            }) + "\n"
          );
        }
      }

      finished = true;

      res.end();
    } catch (err) {
      if (
        controller.signal.aborted
      ) {
        return;
      }

      console.error(err);

      finished = true;

      res.write(
        JSON.stringify({
          type: "error",
          error:
            err.message
        }) + "\n"
      );

      res.end();
    }
  }
);


// ============================================================
// OLD FILE TRANSCRIPTION FALLBACK
// ============================================================

app.post(
  "/transcribe",
  upload.single("audio"),
  async (req, res) => {
    try {
      const file =
        await toFile(
          req.file.buffer,
          "speech.webm",
          {
            type:
              "audio/webm"
          }
        );

      const transcript =
        await openai.audio.transcriptions.create({
          file,
          model:
            "gpt-transcribe"
        });

      console.log(
        "YOU:",
        transcript.text
      );

      res.json({
        text:
          transcript.text
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          err.message
      });
    }
  }
);


// ============================================================
// OLD ELEVENLABS HTTP FALLBACK
// ============================================================

app.post(
  "/speak",
  async (req, res) => {
    try {
      const audioStream =
        await elevenlabs.textToSpeech.stream(
          process.env.ELEVENLABS_VOICE_ID,
          {
            text:
              req.body.text,

            modelId:
              "eleven_flash_v2_5",

            outputFormat:
              "mp3_44100_128"
          }
        );

      res.setHeader(
        "Content-Type",
        "audio/mpeg"
      );

      for await (
        const chunk
        of audioStream
      ) {
        res.write(chunk);
      }

      res.end();
    } catch (err) {
      console.error(err);

      res
        .status(500)
        .end();
    }
  }
);


// ============================================================
// WEBSOCKET ROUTING
// ============================================================

server.on(
  "upgrade",
  (req, socket, head) => {
    const pathname =
      new URL(
        req.url,
        "http://localhost"
      ).pathname;

    if (
      pathname ===
      "/realtime-transcribe"
    ) {
      transcriptionWss.handleUpgrade(
        req,
        socket,
        head,
        (ws) => {
          transcriptionWss.emit(
            "connection",
            ws,
            req
          );
        }
      );

      return;
    }

    if (
      pathname ===
      "/wake-word"
    ) {
      wakeWordWss.handleUpgrade(
        req,
        socket,
        head,
        (ws) => {
          wakeWordWss.emit(
            "connection",
            ws,
            req
          );
        }
      );

      return;
    }

    socket.destroy();
  }
);


// ============================================================
// LOCAL SHERPA WAKE WORD
// Browser PCM -> Node -> Sherpa -> "wake"
// ============================================================

wakeWordWss.on(
  "connection",
  (browserSocket) => {
    console.log(
      "👂 Browser connected to local wake word"
    );

    if (wakeWordError) {
      browserSocket.send(
        JSON.stringify({
          type: "error",
          error: wakeWordError
        })
      );
      browserSocket.close();
      return;
    }

    const clientId = nextWakeClientId++;
    wakeClients.set(clientId, browserSocket);
    if (wakeWordReady) {
      browserSocket.send(JSON.stringify({ type: "config", sampleRate: 16000 }));
    }

    browserSocket.on(
      "message",
      (data, isBinary) => {
        if (isBinary && wakeWordReady && browserSocket.readyState === WebSocket.OPEN) {
          wakeWordWorker.postMessage({
            type: "audio",
            clientId,
            pcm: Buffer.from(data)
          });
        }
      }
    );

    browserSocket.on(
      "close",
      () => {
        wakeClients.delete(clientId);
        wakeWordWorker.postMessage({ type: "close", clientId });
        console.log(
          "👂 Browser disconnected from local wake word"
        );
      }
    );

    browserSocket.on(
      "error",
      (error) => {
        console.error(
          "Wake-word browser socket error:",
          error
        );
      }
    );
  }
);


// ============================================================
// REALTIME TRANSCRIPTION WEBSOCKET
// Browser <-> Node <-> OpenAI
// ============================================================

transcriptionWss.on(
  "connection",
  (browserSocket) => {
    console.log(
      "🎙️ Browser connected to realtime STT bridge"
    );

    const openaiSocket =
      new WebSocket(
        "wss://api.openai.com/v1/realtime?intent=transcription",
        {
          headers: {
            Authorization:
              `Bearer ${process.env.OPENAI_API_KEY}`
          }
        }
      );

    let openaiReady =
      false;

    openaiSocket.on(
      "open",
      () => {
        console.log(
          "🎙️ Connected to OpenAI realtime transcription"
        );

        openaiSocket.send(
          JSON.stringify({
            type:
              "session.update",

            session: {
              type:
                "transcription",

              audio: {
                input: {
                  format: {
                    type:
                      "audio/pcm",

                    rate:
                      24000
                  },

                  transcription: {
                    model:
                      "gpt-live-transcribe",

                    delay:
                      "minimal",

                    languages: [
                      "en"
                    ],

                    keywords: [
                      "Crumbs",
                      "Jet",
                      "toaster",
                      "toast"
                    ]
                  },

                  turn_detection:
                    null
                }
              }
            }
          })
        );
      }
    );

    openaiSocket.on(
      "message",
      (message) => {
        let event;

        try {
          event =
            JSON.parse(
              message.toString()
            );
        } catch (error) {
          console.error(
            "Could not parse OpenAI STT event:",
            error
          );

          return;
        }

        if (
          event.type ===
            "session.updated" ||

          event.type ===
            "transcription_session.updated"
        ) {
          openaiReady =
            true;

          console.log(
            "🎙️ Realtime STT ready"
          );

          if (
            browserSocket.readyState ===
            WebSocket.OPEN
          ) {
            browserSocket.send(
              JSON.stringify({
                type:
                  "ready"
              })
            );
          }

          return;
        }

        if (
          event.type ===
          "conversation.item.input_audio_transcription.delta"
        ) {
          if (
            browserSocket.readyState ===
            WebSocket.OPEN
          ) {
            browserSocket.send(
              JSON.stringify({
                type:
                  "transcript-delta",

                delta:
                  event.delta ||
                  "",

                itemId:
                  event.item_id
              })
            );
          }

          return;
        }

        if (
          event.type ===
          "conversation.item.input_audio_transcription.completed"
        ) {
          console.log(
            "YOU:",
            event.transcript
          );

          if (
            browserSocket.readyState ===
            WebSocket.OPEN
          ) {
            browserSocket.send(
              JSON.stringify({
                type:
                  "transcript-complete",

                text:
                  event.transcript ||
                  "",

                itemId:
                  event.item_id
              })
            );
          }

          return;
        }

        if (
          event.type ===
          "error"
        ) {
          console.error(
            "OpenAI realtime STT error:",
            event.error
          );

          if (
            browserSocket.readyState ===
            WebSocket.OPEN
          ) {
            browserSocket.send(
              JSON.stringify({
                type:
                  "error",

                error:
                  event.error?.message ||
                  "Realtime transcription error"
              })
            );
          }
        }
      }
    );

    browserSocket.on(
      "message",
      (data, isBinary) => {
        if (
          !openaiReady ||

          openaiSocket.readyState !==
            WebSocket.OPEN
        ) {
          return;
        }

        if (isBinary) {
          const base64Audio =
            Buffer
              .from(data)
              .toString(
                "base64"
              );

          openaiSocket.send(
            JSON.stringify({
              type:
                "input_audio_buffer.append",

              audio:
                base64Audio
            })
          );

          return;
        }

        let message;

        try {
          message =
            JSON.parse(
              data.toString()
            );
        } catch (error) {
          console.error(
            "Bad STT browser message:",
            error
          );

          return;
        }

        if (
          message.type ===
          "commit"
        ) {
          openaiSocket.send(
            JSON.stringify({
              type:
                "input_audio_buffer.commit"
            })
          );

          return;
        }

        if (
          message.type ===
          "clear"
        ) {
          openaiSocket.send(
            JSON.stringify({
              type:
                "input_audio_buffer.clear"
            })
          );
        }
      }
    );

    browserSocket.on(
      "close",
      () => {
        console.log(
          "🎙️ Browser disconnected from realtime STT bridge"
        );

        if (
          openaiSocket.readyState ===
            WebSocket.OPEN ||

          openaiSocket.readyState ===
            WebSocket.CONNECTING
        ) {
          openaiSocket.close();
        }
      }
    );

    browserSocket.on(
      "error",
      (error) => {
        console.error(
          "Browser STT socket error:",
          error
        );
      }
    );

    openaiSocket.on(
      "close",
      () => {
        openaiReady =
          false;

        if (
          browserSocket.readyState ===
          WebSocket.OPEN
        ) {
          browserSocket.close();
        }
      }
    );

    openaiSocket.on(
      "error",
      (error) => {
        console.error(
          "OpenAI realtime STT socket error:",
          error
        );
      }
    );
  }
);


// ============================================================
// START SERVER
// ============================================================

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `http://${HOST}:${PORT}`
    );
  }
);
