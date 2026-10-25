import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.5-flash";

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    })
  : null;

if (!ai) {
  console.error("GEMINI_API_KEY is missing.");
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN
          .split(",")
          .map((value) => value.trim())
      : true
  })
);

app.use(express.json({ limit: "32kb" }));

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// Home
app.get("/", (_req, res) => {
  res.json({
    name: "JARVIS AI Backend",
    status: "online",
    provider: "Google Gemini",
    endpoints: ["/health", "/api/chat", "/api/voice"]
  });
});

// Health
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    provider: "Google Gemini",
    configured: Boolean(ai)
  });
});

// Chat
app.post("/api/chat", async (req, res) => {
  try {
    if (!ai) {
      return res.status(503).json({
        error: "Gemini API key is not configured."
      });
    }

    const { message, history = [] } = req.body ?? {};

    if (
      typeof message !== "string" ||
      !message.trim() ||
      message.length > 6000
    ) {
      return res.status(400).json({
        error: "A message of 1-6000 characters is required."
      });
    }

    const safeHistory = Array.isArray(history)
      ? history
          .slice(-8)
          .filter(
            (item) =>
              item &&
              ["user", "assistant", "model"].includes(item.role) &&
              typeof item.content === "string" &&
              item.content.length <= 3000
          )
      : [];

    const contents = safeHistory
      .filter((item) => item.content.trim())
      .map((item) => ({
        role: item.role === "assistant" ? "model" : item.role,
        parts: [{ text: item.content }]
      }));

    contents.push({
      role: "user",
      parts: [{ text: message.trim() }]
    });

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: `
You are JARVIS, a helpful futuristic AI assistant.

LANGUAGE:
- Understand Hindi, English and Hinglish.
- Reply naturally in the user's language.
- When the user speaks Hinglish, normally reply in conversational Hinglish.
- Keep spoken responses concise unless more detail is requested.

BEHAVIOUR:
- Be accurate, helpful and respectful.
- Admit uncertainty instead of inventing facts.
- Use conversation history when relevant.
- Never claim a phone action was completed unless the app confirms it.
- The Android app must execute phone actions using supported features
  and the necessary permissions.
`,
        maxOutputTokens: 700
      }
    });

    const reply = response.text?.trim();

    if (!reply) {
      return res.status(502).json({
        error: "Gemini returned an empty response."
      });
    }

    return res.json({
      reply,
      provider: "Google Gemini",
      model: GEMINI_MODEL
    });
  } catch (error) {
    const status =
      error.status ||
      error.statusCode ||
      error.response?.status;

    console.error("Gemini chat error:", {
      status: status || null,
      message: error.message || "Unknown error"
    });

    if (status === 429) {
      return res.status(429).json({
        error: "Gemini rate limit reached. Please try again later."
      });
    }

    if (status === 401 || status === 403) {
      return res.status(502).json({
        error: "Gemini authentication failed. Check API key and access."
      });
    }

    return res.status(502).json({
      error: "JARVIS could not get a response from Gemini."
    });
  }
});

// ElevenLabs voice
app.post("/api/voice", async (req, res) => {
  try {
    const { text } = req.body ?? {};

    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 3000
    ) {
      return res.status(400).json({
        error: "Text of 1-3000 characters is required."
      });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !voiceId) {
      return res.status(503).json({
        error: "ElevenLabs credentials are not configured."
      });
    }

    const modelId =
      process.env.ELEVENLABS_MODEL_ID ||
      "eleven_multilingual_v2";

    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
        voiceId
      )}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: modelId
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    if (!upstream.ok) {
      console.error(
        "ElevenLabs request failed:",
        upstream.status
      );

      return res.status(502).json({
        error: "Voice generation failed. Check ElevenLabs settings."
      });
    }

    const audio = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audio.length);
    res.setHeader("Cache-Control", "no-store");

    return res.send(audio);
  } catch (error) {
    console.error("Voice error:", error.message);

    return res.status(500).json({
      error: "Could not generate voice."
    });
  }
});

// Unknown endpoint
app.use((_req, res) => {
  res.status(404).json({
    error: "Endpoint not found."
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`JARVIS backend running on port ${PORT}`);
  console.log(`AI provider: Gemini (${GEMINI_MODEL})`);
});
