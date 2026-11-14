import type { Express } from "express";
import { type FunctionDeclaration, GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

function getAssistantClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      apiVersion: "v1beta",
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function formatAssistantError(err: unknown): { status: number; message: string } {
  if (err instanceof Error && err.message === "API_KEY_MISSING") {
    return {
      status: 500,
      message: "API key is not configured. Please check Settings > Secrets or .env.",
    };
  }

  const raw = err as { status?: number; code?: number; message?: string };
  let status = raw?.status || raw?.code || 500;
  let msg = raw?.message || "Unexpected error while processing editing request.";

  if (msg.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(msg) as {
        error?: { code?: number; message?: string };
      };
      if (parsed?.error?.message) msg = parsed.error.message;
      if (parsed?.error?.code) status = parsed.error.code;
    } catch {
      // Keep original message
    }
  }

  if (status === 403 || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID")) {
    return {
      status: 403,
      message: "API key permission error. Please verify your Gemini API key.",
    };
  }
  if (status === 429 || msg.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Rate limit reached. Please wait a moment and try again.",
    };
  }

  return {
    status: typeof status === "number" && status >= 400 && status < 600 ? status : 500,
    message: msg,
  };
}

export function registerMediaAssistantRoute(app: Express): void {
  app.post("/api/media/assistant", async (req, res) => {
    try {
      const body = req.body as {
        message?: string;
        history?: Array<{ role: "user" | "assistant"; text: string }>;
        projectSummary?: Record<string, unknown>;
        selectedImageBase64?: string;
        selectedImageMime?: string;
      };

      const userMessage = (body.message ?? "").trim();
      if (!userMessage) {
        res.status(400).json({ error: "Enter an instruction for the editing assistant." });
        return;
      }

      const ai = getAssistantClient();

      const declarations: FunctionDeclaration[] = [
        {
          name: "updateImageAdjustments",
          description:
            "Adjust color, lighting, warmth, saturation, grayscale, blur, or vignette on the selected scene/image or all background scenes.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              target: {
                type: Type.STRING,
                description: "'selected', 'all', or 'index'.",
              },
              slideIndex: { type: Type.INTEGER },
              brightness: { type: Type.NUMBER, description: "50 to 160 (100 is normal)." },
              contrast: { type: Type.NUMBER, description: "50 to 160 (100 is normal)." },
              saturation: { type: Type.NUMBER, description: "0 to 200 (100 is normal)." },
              warmth: { type: Type.NUMBER, description: "0 to 100." },
              grayscale: { type: Type.NUMBER, description: "0 to 100." },
              blur: { type: Type.NUMBER, description: "0 to 12 px." },
              vignette: { type: Type.NUMBER, description: "0 to 100." },
            },
            required: ["target"],
          },
        },
        {
          name: "updateImageTransform",
          description: "Zoom, rotate, or pan the selected background scene or overlay image.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              target: { type: Type.STRING, description: "'selected', 'all', or 'index'." },
              slideIndex: { type: Type.INTEGER },
              zoom: { type: Type.NUMBER, description: "1.0 to 2.2." },
              rotation: { type: Type.INTEGER, description: "0, 90, 180, or 270." },
              offsetX: { type: Type.NUMBER, description: "-50 to 50." },
              offsetY: { type: Type.NUMBER, description: "-50 to 50." },
            },
            required: ["target"],
          },
        },
        {
          name: "updateSlideCaption",
          description:
            "Add, update, or clear a text caption overlay (English or Amharic) on the selected scene or overlay.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              target: { type: Type.STRING, description: "'selected', 'all', or 'index'." },
              slideIndex: { type: Type.INTEGER },
              text: { type: Type.STRING },
              position: { type: Type.STRING, description: "'top', 'center', or 'bottom'." },
              color: { type: Type.STRING },
              showBackdrop: { type: Type.BOOLEAN },
            },
            required: ["target", "text"],
          },
        },
        {
          name: "setBackgroundCue",
          description:
            "Add a background change at specific seconds, swap an existing background cue to a different uploaded background, or remove a background cue.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: "'add', 'swap', or 'remove'." },
              cueIndex: { type: Type.INTEGER, description: "Zero-based cue index when swapping/removing." },
              backgroundNameOrIndex: {
                type: Type.STRING,
                description: "Name or 1-based number of the uploaded background to use.",
              },
              startSec: { type: Type.NUMBER },
              endSec: { type: Type.NUMBER },
            },
            required: ["action"],
          },
        },
        {
          name: "setCharacterCue",
          description:
            "Place or move the character on screen (x/y percent, scale, flipX), change the character's expression from uploaded expressions, or add/remove a timed expression cue.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: "'update', 'add', or 'remove'." },
              cueIndex: { type: Type.INTEGER },
              expressionNameOrIndex: {
                type: Type.STRING,
                description: "Expression name (e.g. 'happy', 'surprised') or 1-based index.",
              },
              x: { type: Type.NUMBER, description: "Horizontal center percent 5 to 95." },
              y: { type: Type.NUMBER, description: "Vertical center percent 5 to 95." },
              scale: { type: Type.NUMBER, description: "Height scale 0.2 to 1.8." },
              flipX: { type: Type.BOOLEAN },
              startSec: { type: Type.NUMBER },
              endSec: { type: Type.NUMBER },
            },
            required: ["action"],
          },
        },
        {
          name: "manageOverlayCue",
          description:
            "Add an extra image onto the video for specific seconds, swap it with another uploaded image, move/resize it, or remove it.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: "'add', 'update', 'swap', or 'remove'." },
              cueIndex: { type: Type.INTEGER },
              assetNameOrIndex: { type: Type.STRING },
              startSec: { type: Type.NUMBER },
              endSec: { type: Type.NUMBER },
              mode: { type: Type.STRING, description: "'overlay' or 'fullscreen'." },
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              scale: { type: Type.NUMBER },
            },
            required: ["action"],
          },
        },
        {
          name: "updateAudioEffects",
          description:
            "Change overall audio speed and pitch or add/remove a timed speed/pitch effect segment (fast/slow/high pitch/deep voice).",
          parameters: {
            type: Type.OBJECT,
            properties: {
              action: {
                type: Type.STRING,
                description: "'set_global', 'add_segment', 'remove_segment', or 'reset'.",
              },
              speed: { type: Type.NUMBER, description: "Playback speed multiplier 0.5 to 2.0." },
              pitchSemitones: { type: Type.NUMBER, description: "Pitch shift -12 to +12 semitones." },
              startSec: { type: Type.NUMBER },
              endSec: { type: Type.NUMBER },
              label: { type: Type.STRING },
              segmentIndex: { type: Type.INTEGER },
            },
            required: ["action"],
          },
        },
        {
          name: "syncSlidesToAudio",
          description:
            "Automatically divide the attached audio track duration evenly across all background scenes.",
          parameters: {
            type: Type.OBJECT,
            properties: {},
          },
        },
        {
          name: "updateProjectSettings",
          description: "Update video aspect ratio, transition style, or image fit mode.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              aspectRatio: { type: Type.STRING, description: "'16:9', '9:16', '1:1', or '4:5'." },
              transition: { type: Type.STRING, description: "'crossfade', 'cut', or 'ken-burns'." },
              imageFit: { type: Type.STRING, description: "'cover' or 'contain'." },
            },
          },
        },
        {
          name: "manageShapeCue",
          description:
            "Add, update, or remove a shape or speech/thought bubble at specific seconds with optional text inside.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: "'add', 'update', or 'remove'." },
              cueIndex: { type: Type.INTEGER },
              kind: {
                type: Type.STRING,
                description:
                  "'speech-bubble', 'thought-bubble', 'callout', 'rectangle', 'circle', 'arrow', or 'star'.",
              },
              text: { type: Type.STRING, description: "Text displayed inside the bubble/shape." },
              startSec: { type: Type.NUMBER },
              endSec: { type: Type.NUMBER },
              x: { type: Type.NUMBER, description: "Horizontal center 5 to 95." },
              y: { type: Type.NUMBER, description: "Vertical center 5 to 95." },
              fillColor: { type: Type.STRING },
              strokeColor: { type: Type.STRING },
              textColor: { type: Type.STRING },
            },
            required: ["action"],
          },
        },
        {
          name: "manageTextCue",
          description:
            "Add, update, or remove a timed text/subtitle block matched to specific seconds of the audio.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: "'add', 'update', or 'remove'." },
              cueIndex: { type: Type.INTEGER },
              text: { type: Type.STRING },
              startSec: { type: Type.NUMBER },
              endSec: { type: Type.NUMBER },
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              fontSize: { type: Type.NUMBER },
              color: { type: Type.STRING },
            },
            required: ["action"],
          },
        },
        {
          name: "resetImageEdits",
          description: "Reset visual filters and transforms back to defaults.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              target: { type: Type.STRING, description: "'selected' or 'all'." },
            },
            required: ["target"],
          },
        },
      ];

      const systemPrompt = [
        "You are Kidus Video's Image, Character, Shapes, Subtitles & Audio Video Editor Assistant.",
        "You help users edit backgrounds, place characters and switch expressions over time, add speech bubbles and shapes, add timed text/subtitles matched to audio, add/swap/remove timed overlay images, and speed up/slow/pitch-shift audio.",
        "Always call the appropriate tool(s) immediately based on the user's request and the current project state.",
        "You can see the currently selected visual frame if attached, so you can write accurate English or Amharic captions/bubbles or tailor edits to the image.",
        `Current project state: ${JSON.stringify(body.projectSummary ?? {})}`,
      ].join(" ");

      const historyParts = (body.history ?? []).slice(-6).map((turn) => ({
        role: turn.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: turn.text }],
      }));

      const currentParts: Array<
        { text: string } | { inlineData: { data: string; mimeType: string } }
      > = [];
      if (body.selectedImageBase64) {
        currentParts.push({
          inlineData: {
            data: body.selectedImageBase64,
            mimeType: body.selectedImageMime || "image/jpeg",
          },
        });
      }
      currentParts.push({ text: userMessage });

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: [...historyParts, { role: "user", parts: currentParts }],
        config: {
          systemInstruction: systemPrompt,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          tools: [{ functionDeclarations: declarations }],
        },
      });

      const toolCalls = (response.functionCalls ?? []).map((fc) => ({
        name: fc.name ?? "",
        args: (fc.args ?? {}) as Record<string, unknown>,
      }));

      res.json({
        reply: (response.text ?? "").trim(),
        toolCalls,
      });
    } catch (error) {
      console.error("Media assistant error:", error);
      const formatted = formatAssistantError(error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
}
