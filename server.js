import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT: Render reverse proxy configuration.
// This must be before rate limiting middleware.
app.set("trust proxy", 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Gemini configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL;

const gemini = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

// Request timeout
const REQUEST_TIMEOUT_MS = 45000;

// Rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.use(limiter);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "JARVIS Gemini Backend",
    provider: "Google Gemini",
    model: GEMINI_MODEL || "NOT_CONFIGURED",
    configured: Boolean(gemini && GEMINI_MODEL),
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "JARVIS Gemini Backend is running.",
    endpoints: ["/health", "/api/chat", "/api/voice"],
  });
});

// Gemini chat endpoint
app.post("/api/chat", async (req, res) => {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    if (!GEMINI_API_KEY || !gemini) {
      return res.status(503).json({
        error: "Gemini API key is missing in Render Environment Variables.",
      });
    }

    if (!GEMINI_MODEL) {
      return res.status(503).json({
        error: "GEMINI_MODEL is missing in Render Environment Variables.",
      });
    }

    const { message, history = [] } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "A non-empty message is required.",
      });
    }

    const contents = [];

    if (Array.isArray(history)) {
      for (const item of history.slice(-12)) {
        if (!item || typeof item.content !== "string") continue;

        let role;

        if (item.role === "assistant" || item.role === "model") {
          role = "model";
        } else if (item.role === "user") {
          role = "user";
        } else {
          continue;
        }

        contents.push({
          role,
          parts: [{ text: item.content }],
        });
      }
    }

    contents.push({
      role: "user",
      parts: [{ text: message.trim() }],
    });

    console.log("Gemini request received:", {
      model: GEMINI_MODEL,
      messageLength: message.length,
    });

    const result = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction:
          "You are JARVIS, a helpful AI assistant. Understand Hindi, English, and Hinglish. Reply in the language used by the user. Give useful, clear, accurate answers. Never claim to have performed actions on a device unless they actually happened.",
      },
      abortSignal: controller.signal,
    });

    const reply = result.text;

    if (!reply || !reply.trim()) {
      return res.status(502).json({
        error: "Gemini returned an empty response.",
      });
    }

    console.log("Gemini response received successfully.");

    return res.json({
      reply: reply.trim(),
      response: reply.trim(),
      provider: "Google Gemini",
      model: GEMINI_MODEL,
    });
  } catch (error) {
    console.error("Gemini request failed:", error);

    if (error?.name === "AbortError") {
      return res.status(504).json({
        error: "Gemini request timed out. Please try again.",
      });
    }

    return res.status(502).json({
      error: "Gemini request failed.",
      details: error?.message || "Unknown Gemini error",
    });
  } finally {
    clearTimeout(timeout);
  }
});

// ElevenLabs voice endpoint
app.post("/api/voice", async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !voiceId) {
      return res.status(503).json({
        error:
          "Voice service is not configured. Check ElevenLabs environment variables.",
      });
    }

    const { text, message } = req.body || {};
    const textToSpeak = text || message;

    if (typeof textToSpeak !== "string" || !textToSpeak.trim()) {
      return res.status(400).json({
        error: "A non-empty text or message field is required.",
      });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: textToSpeak.trim(),
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.75,
          },
        }),
        signal: AbortSignal.timeout(40000),
      }
    );

    if (!response.ok) {
      const details = await response.text();

      console.error("ElevenLabs error:", response.status, details);

      return res.status(502).json({
        error: "ElevenLabs voice generation failed.",
        details: details.slice(0, 800),
      });
    }

    const audio = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audio.length);
    res.setHeader("Cache-Control", "no-store");

    return res.send(audio);
  } catch (error) {
    console.error("Voice request failed:", error);

    return res.status(502).json({
      error: "Voice generation failed.",
      details: error?.message || "Unknown voice error",
    });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found.",
    path: req.path,
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "Internal server error.",
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`JARVIS backend listening on port ${PORT}`);
  console.log(`AI provider: Google Gemini`);
  console.log(`Gemini model: ${GEMINI_MODEL || "NOT CONFIGURED"}`);
  console.log(`Gemini API key configured: ${Boolean(GEMINI_API_KEY)}`);
});
