
import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
    : true
}));

app.use(express.json({ limit: "32kb" }));

app.use("/api", rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get("/", (_req, res) => {
  res.json({
    name: "JARVIS AI Backend",
    status: "online",
    endpoints: ["/health", "/api/chat", "/api/voice"]
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// OpenAI: Hindi, English and Hinglish conversations
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body ?? {};

    if (typeof message !== "string" ||
        !message.trim() ||
        message.length > 6000) {
      return res.status(400).json({
        error: "A message of 1-6000 characters is required."
      });
    }

    // Accept only a small, validated conversation history.
    const safeHistory = Array.isArray(history)
      ? history.slice(-8).filter(item =>
          item &&
          ["user", "assistant"].includes(item.role) &&
          typeof item.content === "string" &&
          item.content.length <= 3000
        )
      : [];

    const input = [
      ...safeHistory.map(item => ({
        role: item.role,
        content: item.content
      })),
      { role: "user", content: message.trim() }
    ];

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: `
You are JARVIS, a helpful futuristic AI assistant.
Understand Hindi, English and Hinglish.
Reply naturally in the language the user uses.
If the user speaks Hinglish, normally reply in conversational Hinglish.
Keep spoken replies concise unless the user asks for detail.
Never claim a phone action was completed unless the app confirms it.
For phone actions, explain that the Android app must execute
the action with permission; never pretend the backend did it.
`,
      input,
      max_output_tokens: 700
    });

    res.json({
      reply: response.output_text || "Sorry, main jawab nahi bana paaya."
    });
  } catch (error) {
    console.error("Chat error:", error.status || error.message);
    res.status(500).json({
      error: "JARVIS could not process your message."
    });
  }
});

// ElevenLabs: turn text into your chosen voice
app.post("/api/voice", async (req, res) => {
  try {
    const { text } = req.body ?? {};

    if (typeof text !== "string" ||
        !text.trim() ||
        text.length > 3000) {
      return res.status(400).json({
        error: "Text of 1-3000 characters is required."
      });
    }

    if (!process.env.ELEVENLABS_API_KEY ||
        !process.env.ELEVENLABS_VOICE_ID) {
      return res.status(503).json({
        error: "ElevenLabs credentials are not configured."
      });
    }

    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    const modelId =
      process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: modelId
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    if (!upstream.ok) {
      console.error("ElevenLabs error status:", upstream.status);
      return res.status(502).json({
        error: "Voice generation failed. Check your ElevenLabs settings."
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`JARVIS backend running on port ${PORT}`);
});
