import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  FlipHorizontal2,
  Highlighter,
  ImagePlus,
  Layers,
  Loader2,
  MessageCircle,
  MessageSquare,
  Music,
  Pause,
  PenTool,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Send,
  Shapes,
  SlidersHorizontal,
  Trash2,
  Type as TypeIcon,
  Undo2,
  UserCheck,
  Volume2,
  X,
} from "lucide-react";
import {
  ASPECT_RATIO_DIMENSIONS,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_AUDIO_EFFECTS,
  DEFAULT_CAPTION,
  type AspectRatioId,
  type AssistantToolCall,
  type AudioEffectSegment,
  type AudioEffectSettings,
  type AudioTrack,
  type BackgroundCue,
  type CaptionPosition,
  type CharacterCue,
  type DrawingStroke,
  type ImageFitMode,
  type LibraryAudioClip,
  type MediaAsset,
  type OverlayCue,
  type ShapeCue,
  type ShapeType,
  type StudioChatMessage,
  type TailDirection,
  type TextCue,
  type TransitionType,
} from "../types/mediaStudio";
import { base64ToBlob, formatDuration } from "../utils/audioDecoder";
import { audioBufferToWavBlob, processAudioWithEffects } from "../utils/audioEffects";
import {
  createDemoExpressionDataUrl,
  createSampleSlideDataUrl,
  exportCompositeVideo,
  loadImageElement,
  renderCompositeToCanvas,
} from "../utils/canvasRenderer";

interface ImageVideoStudioProps {
  libraryTakes?: LibraryAudioClip[];
}

type SelectedItemRef =
  | { kind: "bg"; id: string }
  | { kind: "char"; id: string }
  | { kind: "overlay"; id: string }
  | { kind: "shape"; id: string }
  | { kind: "text"; id: string }
  | null;

interface RawAudioState {
  id: string;
  title: string;
  sourceLabel: string;
  buffer: AudioBuffer;
  rawDurationSec: number;
}

const SHAPE_OPTIONS: Array<{ id: ShapeType; label: string }> = [
  { id: "speech-bubble", label: "Speech Bubble" },
  { id: "thought-bubble", label: "Thought Bubble" },
  { id: "callout", label: "Callout Box" },
  { id: "rectangle", label: "Rectangle" },
  { id: "circle", label: "Circle" },
  { id: "arrow", label: "Arrow" },
  { id: "star", label: "Star" },
];

const NEON_COLORS = ["#00E5FF", "#FFFFFF", "#3B82F6", "#FACC15", "#F43F5E", "#34D399"];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function stripExt(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function createCanvasSnapshotBase64(canvas: HTMLCanvasElement | null): Promise<{
  base64: string;
  mime: string;
} | null> {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
  const maxDim = 640;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, w, h);
  const out = tmp.toDataURL("image/jpeg", 0.8);
  const comma = out.indexOf(",");
  return { base64: out.slice(comma + 1), mime: "image/jpeg" };
}

export function ImageVideoStudio({ libraryTakes = [] }: ImageVideoStudioProps) {
  // Asset Libraries
  const [backgrounds, setBackgrounds] = useState<MediaAsset[]>([]);
  const [expressions, setExpressions] = useState<MediaAsset[]>([]);
  const [overlayAssets, setOverlayAssets] = useState<MediaAsset[]>([]);

  // Layered Timeline Cues
  const [bgCues, setBgCues] = useState<BackgroundCue[]>([]);
  const [charCues, setCharCues] = useState<CharacterCue[]>([]);
  const [overlayCues, setOverlayCues] = useState<OverlayCue[]>([]);
  const [shapeCues, setShapeCues] = useState<ShapeCue[]>([]);
  const [textCues, setTextCues] = useState<TextCue[]>([]);
  const [drawingStrokes, setDrawingStrokes] = useState<DrawingStroke[]>([]);

  // Interactive Drawing Mode State
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<"pen" | "highlighter">("pen");
  const [drawColor, setDrawColor] = useState("#00E5FF");
  const [drawSize, setDrawSize] = useState(8);
  const [drawEntireVideo, setDrawEntireVideo] = useState(true);
  const [draftStroke, setDraftStroke] = useState<DrawingStroke | null>(null);

  // Audio-Matched Subtitle Script Helper
  const [scriptText, setScriptText] = useState("");
  const [nextLineIndex, setNextLineIndex] = useState(0);

  // Selection & Project Settings
  const [selectedRef, setSelectedRef] = useState<SelectedItemRef>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioId>("16:9");
  const [transition, setTransition] = useState<TransitionType>("crossfade");
  const [imageFit, setImageFit] = useState<ImageFitMode>("cover");

  // Audio & Effects State
  const [rawAudio, setRawAudio] = useState<RawAudioState | null>(null);
  const [audioEffects, setAudioEffects] = useState<AudioEffectSettings>({
    ...DEFAULT_AUDIO_EFFECTS,
  });
  const [audioTrack, setAudioTrack] = useState<AudioTrack | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Playback & Canvas Refs
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const playbackTimerRef = useRef<number | null>(null);
  const lastFrameTsRef = useRef<number>(0);

  // Canvas drag-to-position state
  const dragStateRef = useRef<{
    kind: "char" | "overlay" | "shape" | "text";
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Export & Error State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Right Rail Tabs ("manual" | "assets" | "chat")
  const [railTab, setRailTab] = useState<"manual" | "assets" | "chat">("manual");
  const [chatInput, setChatInput] = useState("");
  const [isAssistantBusy, setIsAssistantBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<StudioChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Upload backgrounds, character expressions, images, and audio. Ask me to add speech bubbles or shapes, sync timed subtitles to your audio, move your character, or change audio speed and pitch!",
    },
  ]);

  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const exprInputRef = useRef<HTMLInputElement | null>(null);
  const overlayInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const hasAnyVisuals =
    backgrounds.length > 0 ||
    expressions.length > 0 ||
    overlayAssets.length > 0 ||
    shapeCues.length > 0 ||
    textCues.length > 0 ||
    drawingStrokes.length > 0;

  const totalTimelineDuration = useMemo(() => {
    const maxBg = bgCues.reduce((m, c) => Math.max(m, c.endSec), 0);
    const maxChar = charCues.reduce((m, c) => Math.max(m, c.endSec), 0);
    const maxOv = overlayCues.reduce((m, c) => Math.max(m, c.endSec), 0);
    const maxShape = shapeCues.reduce((m, c) => Math.max(m, c.endSec), 0);
    const maxText = textCues.reduce((m, c) => Math.max(m, c.endSec), 0);
    const maxAudio = audioTrack?.durationSec ?? 0;
    const maxAll = Math.max(maxBg, maxChar, maxOv, maxShape, maxText, maxAudio);
    return maxAll > 0 ? maxAll : hasAnyVisuals ? 6 : 0;
  }, [bgCues, charCues, overlayCues, shapeCues, textCues, audioTrack, hasAnyVisuals]);

  // Keep selected cues resolved
  const selectedBgCue = useMemo(
    () => (selectedRef?.kind === "bg" ? bgCues.find((c) => c.id === selectedRef.id) ?? null : null),
    [selectedRef, bgCues]
  );
  const selectedCharCue = useMemo(
    () =>
      selectedRef?.kind === "char" ? charCues.find((c) => c.id === selectedRef.id) ?? null : null,
    [selectedRef, charCues]
  );
  const selectedOverlayCue = useMemo(
    () =>
      selectedRef?.kind === "overlay"
        ? overlayCues.find((c) => c.id === selectedRef.id) ?? null
        : null,
    [selectedRef, overlayCues]
  );
  const selectedShapeCue = useMemo(
    () =>
      selectedRef?.kind === "shape" ? shapeCues.find((s) => s.id === selectedRef.id) ?? null : null,
    [selectedRef, shapeCues]
  );
  const selectedTextCue = useMemo(
    () =>
      selectedRef?.kind === "text" ? textCues.find((t) => t.id === selectedRef.id) ?? null : null,
    [selectedRef, textCues]
  );

  // Hydrate imageCache for all uploaded assets
  useEffect(() => {
    let active = true;
    const allAssets = [...backgrounds, ...expressions, ...overlayAssets];
    const hydrate = async () => {
      for (const asset of allAssets) {
        if (!imageCacheRef.current.has(asset.id)) {
          try {
            const img = await loadImageElement(asset.dataUrl);
            if (active) imageCacheRef.current.set(asset.id, img);
          } catch {
            // Skip invalid image
          }
        }
      }
      if (active) drawCurrentCanvas(playheadSec);
    };
    hydrate();
    return () => {
      active = false;
    };
  }, [backgrounds, expressions, overlayAssets]);

  // Process audio whenever rawAudio or audioEffects change
  useEffect(() => {
    if (!rawAudio) {
      setAudioTrack((prev) => {
        if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
        return null;
      });
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        const processed = processAudioWithEffects(rawAudio.buffer, audioEffects);
        const wavBlob = audioBufferToWavBlob(processed);
        const blobUrl = URL.createObjectURL(wavBlob);

        setAudioTrack((prev) => {
          if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
          return {
            id: rawAudio.id,
            title: rawAudio.title,
            sourceLabel: rawAudio.sourceLabel,
            blobUrl,
            rawBuffer: rawAudio.buffer,
            processedBuffer: processed,
            rawDurationSec: rawAudio.rawDurationSec,
            durationSec: processed.duration,
          };
        });
      } catch {
        setErrorMsg("Could not apply audio speed/pitch effect.");
      }
    }, 90);

    return () => {
      window.clearTimeout(timer);
    };
  }, [rawAudio, audioEffects]);

  // Cleanup audio blob URL on unmount
  useEffect(() => {
    return () => {
      if (audioTrack?.blobUrl) {
        URL.revokeObjectURL(audioTrack.blobUrl);
      }
    };
  }, []);

  const drawCurrentCanvas = (timeSec: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio];
    if (canvas.width !== dims.width || canvas.height !== dims.height) {
      canvas.width = dims.width;
      canvas.height = dims.height;
    }
    const strokesToDraw = draftStroke ? [...drawingStrokes, draftStroke] : drawingStrokes;
    renderCompositeToCanvas(ctx, {
      bgCues,
      charCues,
      overlayCues,
      shapeCues,
      textCues,
      drawingStrokes: strokesToDraw,
      imageCache: imageCacheRef.current,
      timeSec,
      canvasW: dims.width,
      canvasH: dims.height,
      transition,
      imageFit,
      selectedCharCueId: selectedRef?.kind === "char" ? selectedRef.id : null,
      selectedOverlayCueId: selectedRef?.kind === "overlay" ? selectedRef.id : null,
      selectedShapeCueId: selectedRef?.kind === "shape" ? selectedRef.id : null,
      selectedTextCueId: selectedRef?.kind === "text" ? selectedRef.id : null,
      showSelectionGuides: !isPlaying && !isExporting && !isDrawMode,
    });
  };

  useEffect(() => {
    drawCurrentCanvas(playheadSec);
  }, [
    bgCues,
    charCues,
    overlayCues,
    shapeCues,
    textCues,
    drawingStrokes,
    draftStroke,
    aspectRatio,
    transition,
    imageFit,
    playheadSec,
    selectedRef,
    isPlaying,
    isExporting,
    isDrawMode,
    backgrounds,
    expressions,
    overlayAssets,
  ]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (playbackTimerRef.current !== null) {
        cancelAnimationFrame(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      return;
    }

    lastFrameTsRef.current = performance.now();

    const step = (now: number) => {
      const dt = (now - lastFrameTsRef.current) / 1000;
      lastFrameTsRef.current = now;

      setPlayheadSec((prev) => {
        const audio = audioElRef.current;
        let next = prev + dt;
        if (audio && audioTrack && !audio.paused && Number.isFinite(audio.currentTime)) {
          next = audio.currentTime;
        }
        if (next >= totalTimelineDuration && totalTimelineDuration > 0) {
          setIsPlaying(false);
          if (audio) {
            audio.pause();
            audio.currentTime = 0;
          }
          return totalTimelineDuration;
        }
        return next;
      });

      playbackTimerRef.current = requestAnimationFrame(step);
    };

    playbackTimerRef.current = requestAnimationFrame(step);

    return () => {
      if (playbackTimerRef.current !== null) {
        cancelAnimationFrame(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    };
  }, [isPlaying, totalTimelineDuration, audioTrack]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isAssistantBusy]);

  // Quick Add Helpers (make everything easier!)
  const handleQuickAddShape = (kind: ShapeType = "speech-bubble") => {
    setIsDrawMode(false);
    const start = round1(playheadSec);
    const end = round1(start + 3.5);
    const id = crypto.randomUUID();
    const isBubble = kind === "speech-bubble" || kind === "thought-bubble" || kind === "callout";
    const newShape: ShapeCue = {
      id,
      kind,
      startSec: start,
      endSec: end,
      x: 56,
      y: 26,
      widthPct: kind === "circle" || kind === "star" ? 20 : 34,
      heightPct: kind === "arrow" ? 14 : 20,
      fillColor: isBubble ? "#F0F6FF" : "#1D4ED8",
      strokeColor: "#00E5FF",
      strokeWidth: 4,
      text: isBubble ? "Hello!" : "",
      textColor: isBubble ? "#050816" : "#FFFFFF",
      tailDirection: "bottom-left",
      rotation: 0,
      opacity: 100,
    };
    setShapeCues((prev) => [...prev, newShape]);
    setSelectedRef({ kind: "shape", id });
    setRailTab("manual");
  };

  const handleQuickAddText = (initialText = "Type what the audio says...") => {
    setIsDrawMode(false);
    const start = round1(playheadSec);
    const end = round1(start + 2.5);
    const id = crypto.randomUUID();
    const newText: TextCue = {
      id,
      text: initialText,
      startSec: start,
      endSec: end,
      x: 50,
      y: 84,
      fontSize: 40,
      color: "#FFFFFF",
      bgColor: "#050816",
      showBackdrop: true,
    };
    setTextCues((prev) => [...prev, newText]);
    setSelectedRef({ kind: "text", id });
    setRailTab("manual");
  };

  // Script-to-Audio Matcher helpers
  const parsedScriptLines = useMemo(
    () =>
      scriptText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [scriptText]
  );

  const handleDropNextScriptLine = () => {
    if (parsedScriptLines.length === 0) return;
    const idx = clamp(nextLineIndex, 0, parsedScriptLines.length - 1);
    const line = parsedScriptLines[idx];
    const nowSec = round1(playheadSec);
    const defaultDur = 2.5;
    const id = crypto.randomUUID();

    setTextCues((prev) => {
      // Auto-close any open/overlapping previous text cue neatly at nowSec so subtitles flow cleanly!
      const updated = prev.map((t) =>
        t.startSec < nowSec && t.endSec > nowSec ? { ...t, endSec: nowSec } : t
      );
      return [
        ...updated,
        {
          id,
          text: line,
          startSec: nowSec,
          endSec: round1(nowSec + defaultDur),
          x: 50,
          y: 85,
          fontSize: 40,
          color: "#FFFFFF",
          bgColor: "#050816",
          showBackdrop: true,
        },
      ];
    });
    setSelectedRef({ kind: "text", id });
    setNextLineIndex((idx + 1) % parsedScriptLines.length);
  };

  const handleSpreadScriptAcrossAudio = () => {
    if (parsedScriptLines.length === 0) return;
    const dur = totalTimelineDuration > 0 ? totalTimelineDuration : parsedScriptLines.length * 2.5;
    const per = dur / parsedScriptLines.length;
    const generated: TextCue[] = parsedScriptLines.map((line, i) => ({
      id: crypto.randomUUID(),
      text: line,
      startSec: round1(i * per),
      endSec: round1((i + 1) * per),
      x: 50,
      y: 85,
      fontSize: 40,
      color: "#FFFFFF",
      bgColor: "#050816",
      showBackdrop: true,
    }));
    setTextCues(generated);
    setSelectedRef({ kind: "text", id: generated[0].id });
    setNextLineIndex(0);
  };

  // Asset upload helpers
  const loadAssetsFromFiles = async (fileList: FileList | null): Promise<MediaAsset[]> => {
    if (!fileList || fileList.length === 0) return [];
    const results: MediaAsset[] = [];
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const img = await loadImageElement(dataUrl);
        const id = crypto.randomUUID();
        imageCacheRef.current.set(id, img);
        results.push({
          id,
          name: stripExt(file.name) || "Image",
          dataUrl,
          width: img.naturalWidth || 1280,
          height: img.naturalHeight || 720,
        });
      } catch {
        // Skip invalid image
      }
    }
    return results;
  };

  const handleUploadBackgrounds = async (fileList: FileList | null) => {
    setErrorMsg(null);
    const added = await loadAssetsFromFiles(fileList);
    if (added.length === 0) return;

    setBackgrounds((prev) => [...prev, ...added]);
    setBgCues((prev) => {
      let cursor = prev.reduce((m, c) => Math.max(m, c.endSec), 0);
      const newCues: BackgroundCue[] = added.map((asset) => {
        const start = cursor;
        const end = cursor + 4;
        cursor = end;
        return {
          id: crypto.randomUUID(),
          assetId: asset.id,
          startSec: start,
          endSec: end,
          adjustments: { ...DEFAULT_ADJUSTMENTS },
          caption: { ...DEFAULT_CAPTION },
        };
      });
      if (newCues.length > 0 && !selectedRef) {
        setSelectedRef({ kind: "bg", id: newCues[0].id });
      }
      return [...prev, ...newCues];
    });
  };

  const handleUploadExpressions = async (fileList: FileList | null) => {
    setErrorMsg(null);
    const added = await loadAssetsFromFiles(fileList);
    if (added.length === 0) return;

    setExpressions((prev) => [...prev, ...added]);
    setCharCues((prev) => {
      if (prev.length === 0) {
        const cueDur = 3.5;
        const created: CharacterCue[] = added.map((expr, i) => ({
          id: crypto.randomUUID(),
          expressionId: expr.id,
          startSec: i * cueDur,
          endSec: (i + 1) * cueDur,
          x: 50,
          y: 62,
          scale: 0.62,
          flipX: false,
          rotation: 0,
          opacity: 100,
        }));
        setSelectedRef({ kind: "char", id: created[0].id });
        return created;
      }
      return prev;
    });
  };

  const handleUploadOverlays = async (fileList: FileList | null) => {
    setErrorMsg(null);
    const added = await loadAssetsFromFiles(fileList);
    if (added.length === 0) return;

    setOverlayAssets((prev) => [...prev, ...added]);
    const start = round1(playheadSec);
    const end = round1(start + 3);
    const newOv: OverlayCue = {
      id: crypto.randomUUID(),
      assetId: added[0].id,
      startSec: start,
      endSec: end,
      mode: "overlay",
      x: 75,
      y: 35,
      scale: 0.35,
      rotation: 0,
      opacity: 100,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      caption: { ...DEFAULT_CAPTION },
    };
    setOverlayCues((prev) => [...prev, newOv]);
    setSelectedRef({ kind: "overlay", id: newOv.id });
    setRailTab("manual");
  };

  const handleLoadDemoCastAndStage = async () => {
    setErrorMsg(null);
    const bgSpecs = [
      { title: "Neon Studio", subtitle: "Scene 1 · Deep Blue", a: "#091A4A", b: "#030714", ac: "#00E5FF" },
      { title: "City Skyline", subtitle: "Scene 2 · Electric Shift", a: "#0F296D", b: "#060B1E", ac: "#38BDF8" },
      { title: "Midnight Stage", subtitle: "Scene 3 · Finale", a: "#1E1B5E", b: "#040818", ac: "#60A5FA" },
    ];
    const newBgs: MediaAsset[] = [];
    for (let i = 0; i < bgSpecs.length; i++) {
      const s = createSampleSlideDataUrl(bgSpecs[i].title, bgSpecs[i].subtitle, bgSpecs[i].a, bgSpecs[i].b, bgSpecs[i].ac);
      const id = crypto.randomUUID();
      imageCacheRef.current.set(id, await loadImageElement(s.dataUrl));
      newBgs.push({ id, name: bgSpecs[i].title, dataUrl: s.dataUrl, width: s.width, height: s.height });
    }

    const exprMoods: Array<{ name: string; mood: "happy" | "surprised" | "cool"; color: string }> = [
      { name: "Happy", mood: "happy", color: "#00E5FF" },
      { name: "Surprised", mood: "surprised", color: "#38BDF8" },
      { name: "Cool Shades", mood: "cool", color: "#60A5FA" },
    ];
    const newExprs: MediaAsset[] = [];
    for (const em of exprMoods) {
      const imgData = createDemoExpressionDataUrl(em.mood, em.color);
      const id = crypto.randomUUID();
      imageCacheRef.current.set(id, await loadImageElement(imgData.dataUrl));
      newExprs.push({ id, name: em.name, dataUrl: imgData.dataUrl, width: imgData.width, height: imgData.height });
    }

    const newBgCues: BackgroundCue[] = newBgs.map((bg, i) => ({
      id: crypto.randomUUID(),
      assetId: bg.id,
      startSec: i * 4,
      endSec: (i + 1) * 4,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      caption: { ...DEFAULT_CAPTION },
    }));

    const newCharCues: CharacterCue[] = newExprs.map((expr, i) => ({
      id: crypto.randomUUID(),
      expressionId: expr.id,
      startSec: i * 4,
      endSec: (i + 1) * 4,
      x: 28,
      y: 64,
      scale: 0.68,
      flipX: false,
      rotation: 0,
      opacity: 100,
    }));

    const demoBubble: ShapeCue = {
      id: crypto.randomUUID(),
      kind: "speech-bubble",
      startSec: 0,
      endSec: 4,
      x: 56,
      y: 28,
      widthPct: 32,
      heightPct: 18,
      fillColor: "#F0F6FF",
      strokeColor: "#00E5FF",
      strokeWidth: 4,
      text: "Welcome to Kidus Video!",
      textColor: "#050816",
      tailDirection: "bottom-left",
      rotation: 0,
      opacity: 100,
    };

    const demoTexts: TextCue[] = [
      {
        id: crypto.randomUUID(),
        text: "Match your subtitles to what the audio says",
        startSec: 0,
        endSec: 4,
        x: 50,
        y: 88,
        fontSize: 36,
        color: "#FFFFFF",
        bgColor: "#050816",
        showBackdrop: true,
      },
      {
        id: crypto.randomUUID(),
        text: "Switch backgrounds, expressions & draw anytime!",
        startSec: 4,
        endSec: 8,
        x: 50,
        y: 88,
        fontSize: 36,
        color: "#00E5FF",
        bgColor: "#050816",
        showBackdrop: true,
      },
    ];

    setBackgrounds((prev) => [...prev, ...newBgs]);
    setExpressions((prev) => [...prev, ...newExprs]);
    setBgCues(newBgCues);
    setCharCues(newCharCues);
    setShapeCues([demoBubble]);
    setTextCues(demoTexts);
    setSelectedRef({ kind: "shape", id: demoBubble.id });
    setPlayheadSec(0);
  };

  // Audio uploads
  const handleUploadAudioFile = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    setErrorMsg(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      await ctx.close();

      setIsPlaying(false);
      setPlayheadSec(0);
      setRawAudio({
        id: crypto.randomUUID(),
        title: file.name,
        sourceLabel: "Uploaded file",
        buffer: decoded,
        rawDurationSec: decoded.duration,
      });
    } catch {
      setErrorMsg("Could not decode that audio file. Try MP3, WAV, M4A, or OGG.");
    }
  };

  const handlePickLibraryTake = async (takeId: string) => {
    const take = libraryTakes.find((t) => t.id === takeId);
    if (!take) return;
    setErrorMsg(null);
    try {
      const blob = base64ToBlob(take.audioBase64, take.mimeType || "audio/wav");
      const arrayBuffer = await blob.arrayBuffer();
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      await ctx.close();

      setIsPlaying(false);
      setPlayheadSec(0);
      setRawAudio({
        id: take.id,
        title: take.title,
        sourceLabel: `${take.voiceLabel} · Library`,
        buffer: decoded,
        rawDurationSec: decoded.duration,
      });
    } catch {
      setErrorMsg("Could not load selected voice clip.");
    }
  };

  const handleFitBackgroundsToAudio = () => {
    if (!audioTrack || bgCues.length === 0) return;
    const dur = audioTrack.durationSec;
    const per = dur / bgCues.length;
    setBgCues((prev) =>
      prev.map((c, idx) => ({
        ...c,
        startSec: Number((idx * per).toFixed(2)),
        endSec: Number(((idx + 1) * per).toFixed(2)),
      }))
    );
  };

  const togglePlayback = async () => {
    if (!hasAnyVisuals) return;
    setIsDrawMode(false);
    const audio = audioElRef.current;
    if (isPlaying) {
      setIsPlaying(false);
      audio?.pause();
      return;
    }

    let startAt = playheadSec;
    if (startAt >= totalTimelineDuration - 0.05) {
      startAt = 0;
      setPlayheadSec(0);
    }

    if (audio && audioTrack) {
      audio.currentTime = Math.min(startAt, Math.max(0, audioTrack.durationSec - 0.05));
      try {
        await audio.play();
      } catch {
        // Silent fallback
      }
    }
    setIsPlaying(true);
  };

  const handleSeek = (ratio: number) => {
    const target = clamp(ratio, 0, 1) * totalTimelineDuration;
    setPlayheadSec(target);
    if (audioElRef.current && audioTrack) {
      audioElRef.current.currentTime = clamp(target, 0, audioTrack.durationSec);
    }
  };

  const handleExportVideo = async () => {
    if (!hasAnyVisuals) {
      setErrorMsg("Add at least one background, character, shape, text, or drawing before exporting.");
      return;
    }
    setErrorMsg(null);
    setIsDrawMode(false);
    setIsPlaying(false);
    audioElRef.current?.pause();
    setIsExporting(true);
    setExportProgress(0);

    try {
      const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio];
      const result = await exportCompositeVideo({
        bgCues,
        charCues,
        overlayCues,
        shapeCues,
        textCues,
        drawingStrokes,
        assetList: [...backgrounds, ...expressions, ...overlayAssets],
        processedAudioBuffer: audioTrack?.processedBuffer ?? null,
        totalDurationSec: Math.max(1, totalTimelineDuration),
        canvasW: dims.width,
        canvasH: dims.height,
        transition,
        imageFit,
        onProgress: setExportProgress,
      });

      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `kidus-video.${result.extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to export video.");
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  // Interactive Canvas Pointer Handlers (Freehand Draw OR Drag-to-Place)
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPlaying || isExporting) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickXPct = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
    const clickYPct = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);

    if (isDrawMode) {
      const startSec = drawEntireVideo ? 0 : round1(playheadSec);
      const endSec = drawEntireVideo
        ? Math.max(300, totalTimelineDuration + 60)
        : round1(playheadSec + 3);
      setDraftStroke({
        id: crypto.randomUUID(),
        points: [{ x: clickXPct, y: clickYPct }],
        color: drawColor,
        size: drawSize,
        tool: drawTool,
        startSec,
        endSec,
      });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Reverse z-order hit testing: Text -> Shape -> Overlay -> Character
    const activeText = [...textCues]
      .reverse()
      .find(
        (t) =>
          playheadSec >= t.startSec &&
          playheadSec < t.endSec &&
          Math.abs(t.x - clickXPct) < 28 &&
          Math.abs(t.y - clickYPct) < 12
      );
    if (activeText) {
      setSelectedRef({ kind: "text", id: activeText.id });
      setRailTab("manual");
      dragStateRef.current = {
        kind: "text",
        id: activeText.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: activeText.x,
        origY: activeText.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const activeShape = [...shapeCues]
      .reverse()
      .find(
        (s) =>
          playheadSec >= s.startSec &&
          playheadSec < s.endSec &&
          Math.abs(s.x - clickXPct) <= Math.max(12, s.widthPct / 2 + 4) &&
          Math.abs(s.y - clickYPct) <= Math.max(10, s.heightPct / 2 + 4)
      );
    if (activeShape) {
      setSelectedRef({ kind: "shape", id: activeShape.id });
      setRailTab("manual");
      dragStateRef.current = {
        kind: "shape",
        id: activeShape.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: activeShape.x,
        origY: activeShape.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const activeOv = [...overlayCues]
      .reverse()
      .find(
        (o) =>
          o.mode === "overlay" &&
          playheadSec >= o.startSec &&
          playheadSec < o.endSec &&
          Math.abs(o.x - clickXPct) < 22 &&
          Math.abs(o.y - clickYPct) < 25
      );
    if (activeOv) {
      setSelectedRef({ kind: "overlay", id: activeOv.id });
      setRailTab("manual");
      dragStateRef.current = {
        kind: "overlay",
        id: activeOv.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: activeOv.x,
        origY: activeOv.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const activeChar =
      charCues.find((c) => playheadSec >= c.startSec && playheadSec < c.endSec) ??
      (bgCues.length === 0 ? charCues[0] : undefined);
    if (activeChar) {
      setSelectedRef({ kind: "char", id: activeChar.id });
      setRailTab("manual");
      dragStateRef.current = {
        kind: "char",
        id: activeChar.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: activeChar.x,
        origY: activeChar.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (isDrawMode && draftStroke) {
      const px = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
      const py = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
      setDraftStroke((prev) =>
        prev ? { ...prev, points: [...prev.points, { x: px, y: py }] } : null
      );
      return;
    }

    const drag = dragStateRef.current;
    if (!drag) return;
    const dxPct = ((e.clientX - drag.startClientX) / rect.width) * 100;
    const dyPct = ((e.clientY - drag.startClientY) / rect.height) * 100;
    const nx = clamp(Math.round(drag.origX + dxPct), 5, 95);
    const ny = clamp(Math.round(drag.origY + dyPct), 5, 95);

    if (drag.kind === "char") {
      setCharCues((prev) => prev.map((c) => (c.id === drag.id ? { ...c, x: nx, y: ny } : c)));
    } else if (drag.kind === "overlay") {
      setOverlayCues((prev) => prev.map((o) => (o.id === drag.id ? { ...o, x: nx, y: ny } : o)));
    } else if (drag.kind === "shape") {
      setShapeCues((prev) => prev.map((s) => (s.id === drag.id ? { ...s, x: nx, y: ny } : s)));
    } else if (drag.kind === "text") {
      setTextCues((prev) => prev.map((t) => (t.id === drag.id ? { ...t, x: nx, y: ny } : t)));
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDrawMode && draftStroke) {
      setDrawingStrokes((prev) => [...prev, draftStroke]);
      setDraftStroke(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if not captured
      }
      return;
    }

    if (dragStateRef.current) {
      dragStateRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if not captured
      }
    }
  };

  // Helper to resolve asset by name or 1-based index from AI assistant
  const findAssetMatch = (list: MediaAsset[], query: unknown): MediaAsset | undefined => {
    if (list.length === 0) return undefined;
    if (typeof query === "number") {
      return list[clamp(Math.round(query) - 1, 0, list.length - 1)];
    }
    if (typeof query === "string" && query.trim()) {
      const q = query.trim().toLowerCase();
      const num = Number(q);
      if (Number.isFinite(num) && num >= 1 && num <= list.length) {
        return list[Math.round(num) - 1];
      }
      return (
        list.find((a) => a.name.toLowerCase() === q) ||
        list.find((a) => a.name.toLowerCase().includes(q)) ||
        list[0]
      );
    }
    return list[0];
  };

  const applyToolCalls = (toolCalls: AssistantToolCall[]): string[] => {
    const summaries: string[] = [];

    for (const call of toolCalls) {
      const args = call.args || {};

      if (call.name === "updateImageAdjustments") {
        const patchAdj = (adj: BackgroundCue["adjustments"]) => ({
          ...adj,
          ...(typeof args.brightness === "number" ? { brightness: clamp(args.brightness, 50, 160) } : {}),
          ...(typeof args.contrast === "number" ? { contrast: clamp(args.contrast, 50, 160) } : {}),
          ...(typeof args.saturation === "number" ? { saturation: clamp(args.saturation, 0, 200) } : {}),
          ...(typeof args.warmth === "number" ? { warmth: clamp(args.warmth, 0, 100) } : {}),
          ...(typeof args.grayscale === "number" ? { grayscale: clamp(args.grayscale, 0, 100) } : {}),
          ...(typeof args.blur === "number" ? { blur: clamp(args.blur, 0, 12) } : {}),
          ...(typeof args.vignette === "number" ? { vignette: clamp(args.vignette, 0, 100) } : {}),
        });

        setBgCues((prev) =>
          prev.map((c, i) => {
            const match =
              args.target === "all" ||
              (args.target === "index" && args.slideIndex === i) ||
              (selectedRef?.kind === "bg" && c.id === selectedRef.id) ||
              (!selectedRef && i === 0);
            return match ? { ...c, adjustments: patchAdj(c.adjustments) } : c;
          })
        );
        summaries.push("Updated lighting & color filters");
      } else if (call.name === "updateImageTransform") {
        setBgCues((prev) =>
          prev.map((c, i) => {
            const match =
              args.target === "all" ||
              (args.target === "index" && args.slideIndex === i) ||
              (selectedRef?.kind === "bg" && c.id === selectedRef.id) ||
              (!selectedRef && i === 0);
            if (!match) return c;
            return {
              ...c,
              adjustments: {
                ...c.adjustments,
                ...(typeof args.zoom === "number" ? { zoom: clamp(args.zoom, 1, 2.2) } : {}),
                ...(typeof args.rotation === "number"
                  ? { rotation: ((Math.round(args.rotation / 90) * 90) % 360 + 360) % 360 }
                  : {}),
                ...(typeof args.offsetX === "number" ? { offsetX: clamp(args.offsetX, -50, 50) } : {}),
                ...(typeof args.offsetY === "number" ? { offsetY: clamp(args.offsetY, -50, 50) } : {}),
              },
            };
          })
        );
        summaries.push("Updated zoom / framing");
      } else if (call.name === "updateSlideCaption") {
        const text = typeof args.text === "string" ? args.text : "";
        setBgCues((prev) =>
          prev.map((c, i) => {
            const match =
              args.target === "all" ||
              (args.target === "index" && args.slideIndex === i) ||
              (selectedRef?.kind === "bg" && c.id === selectedRef.id) ||
              (!selectedRef && i === 0);
            if (!match) return c;
            return {
              ...c,
              caption: {
                text,
                position:
                  args.position === "top" || args.position === "center" || args.position === "bottom"
                    ? args.position
                    : c.caption.position,
                color: typeof args.color === "string" ? args.color : c.caption.color,
                showBackdrop:
                  typeof args.showBackdrop === "boolean" ? args.showBackdrop : c.caption.showBackdrop,
              },
            };
          })
        );
        summaries.push(text ? `Set caption: "${text}"` : "Cleared caption");
      } else if (call.name === "setBackgroundCue") {
        const action = String(args.action || "swap");
        const matchedBg = findAssetMatch(backgrounds, args.backgroundNameOrIndex);
        if (action === "add" && matchedBg) {
          const start = typeof args.startSec === "number" ? Math.max(0, args.startSec) : playheadSec;
          const end = typeof args.endSec === "number" ? Math.max(start + 0.5, args.endSec) : start + 4;
          const id = crypto.randomUUID();
          setBgCues((prev) => [
            ...prev,
            {
              id,
              assetId: matchedBg.id,
              startSec: start,
              endSec: end,
              adjustments: { ...DEFAULT_ADJUSTMENTS },
              caption: { ...DEFAULT_CAPTION },
            },
          ]);
          summaries.push(`Added background "${matchedBg.name}" (${start}s–${end}s)`);
        } else if (action === "swap" && matchedBg) {
          setBgCues((prev) =>
            prev.map((c, i) => {
              const match =
                (typeof args.cueIndex === "number" && i === args.cueIndex) ||
                (selectedRef?.kind === "bg" && c.id === selectedRef.id) ||
                (playheadSec >= c.startSec && playheadSec < c.endSec);
              return match ? { ...c, assetId: matchedBg.id } : c;
            })
          );
          summaries.push(`Swapped background to "${matchedBg.name}"`);
        } else if (action === "remove") {
          setBgCues((prev) =>
            prev.filter((c, i) =>
              typeof args.cueIndex === "number"
                ? i !== args.cueIndex
                : selectedRef?.kind === "bg"
                  ? c.id !== selectedRef.id
                  : true
            )
          );
          summaries.push("Removed background cue");
        }
      } else if (call.name === "setCharacterCue") {
        const action = String(args.action || "update");
        const matchedExpr = findAssetMatch(expressions, args.expressionNameOrIndex);
        if (action === "add" && matchedExpr) {
          const start = typeof args.startSec === "number" ? Math.max(0, args.startSec) : playheadSec;
          const end = typeof args.endSec === "number" ? Math.max(start + 0.5, args.endSec) : start + 3;
          const id = crypto.randomUUID();
          setCharCues((prev) => [
            ...prev,
            {
              id,
              expressionId: matchedExpr.id,
              startSec: start,
              endSec: end,
              x: typeof args.x === "number" ? clamp(args.x, 5, 95) : 50,
              y: typeof args.y === "number" ? clamp(args.y, 5, 95) : 62,
              scale: typeof args.scale === "number" ? clamp(args.scale, 0.2, 1.8) : 0.62,
              flipX: Boolean(args.flipX),
              rotation: 0,
              opacity: 100,
            },
          ]);
          summaries.push(`Added character expression "${matchedExpr.name}" (${start}s–${end}s)`);
        } else if (action === "remove") {
          setCharCues((prev) =>
            prev.filter((c, i) =>
              typeof args.cueIndex === "number"
                ? i !== args.cueIndex
                : selectedRef?.kind === "char"
                  ? c.id !== selectedRef.id
                  : true
            )
          );
          summaries.push("Removed character expression cue");
        } else {
          setCharCues((prev) =>
            prev.map((c, i) => {
              const match =
                (typeof args.cueIndex === "number" && i === args.cueIndex) ||
                (selectedRef?.kind === "char" && c.id === selectedRef.id) ||
                (playheadSec >= c.startSec && playheadSec < c.endSec) ||
                i === 0;
              if (!match) return c;
              return {
                ...c,
                ...(matchedExpr && args.expressionNameOrIndex ? { expressionId: matchedExpr.id } : {}),
                ...(typeof args.x === "number" ? { x: clamp(args.x, 5, 95) } : {}),
                ...(typeof args.y === "number" ? { y: clamp(args.y, 5, 95) } : {}),
                ...(typeof args.scale === "number" ? { scale: clamp(args.scale, 0.2, 1.8) } : {}),
                ...(typeof args.flipX === "boolean" ? { flipX: args.flipX } : {}),
              };
            })
          );
          summaries.push("Updated character placement / expression");
        }
      } else if (call.name === "manageOverlayCue") {
        const action = String(args.action || "add");
        const matchedOv = findAssetMatch(overlayAssets, args.assetNameOrIndex);
        if (action === "add" && matchedOv) {
          const start = typeof args.startSec === "number" ? Math.max(0, args.startSec) : playheadSec;
          const end = typeof args.endSec === "number" ? Math.max(start + 0.5, args.endSec) : start + 3;
          setOverlayCues((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              assetId: matchedOv.id,
              startSec: start,
              endSec: end,
              mode: args.mode === "fullscreen" ? "fullscreen" : "overlay",
              x: typeof args.x === "number" ? clamp(args.x, 5, 95) : 72,
              y: typeof args.y === "number" ? clamp(args.y, 5, 95) : 36,
              scale: typeof args.scale === "number" ? clamp(args.scale, 0.15, 1.8) : 0.36,
              rotation: 0,
              opacity: 100,
              adjustments: { ...DEFAULT_ADJUSTMENTS },
              caption: { ...DEFAULT_CAPTION },
            },
          ]);
          summaries.push(`Added timed image "${matchedOv.name}" (${start}s–${end}s)`);
        } else if (action === "remove") {
          setOverlayCues((prev) =>
            prev.filter((o, i) =>
              typeof args.cueIndex === "number"
                ? i !== args.cueIndex
                : selectedRef?.kind === "overlay"
                  ? o.id !== selectedRef.id
                  : i !== prev.length - 1
            )
          );
          summaries.push("Removed timed overlay image");
        } else {
          setOverlayCues((prev) =>
            prev.map((o, i) => {
              const match =
                (typeof args.cueIndex === "number" && i === args.cueIndex) ||
                (selectedRef?.kind === "overlay" && o.id === selectedRef.id);
              if (!match) return o;
              return {
                ...o,
                ...(matchedOv && args.assetNameOrIndex ? { assetId: matchedOv.id } : {}),
                ...(typeof args.startSec === "number" ? { startSec: Math.max(0, args.startSec) } : {}),
                ...(typeof args.endSec === "number" ? { endSec: Math.max(0.5, args.endSec) } : {}),
                ...(args.mode === "fullscreen" || args.mode === "overlay" ? { mode: args.mode } : {}),
                ...(typeof args.x === "number" ? { x: clamp(args.x, 5, 95) } : {}),
                ...(typeof args.y === "number" ? { y: clamp(args.y, 5, 95) } : {}),
                ...(typeof args.scale === "number" ? { scale: clamp(args.scale, 0.15, 1.8) } : {}),
              };
            })
          );
          summaries.push("Updated timed overlay image");
        }
      } else if (call.name === "manageShapeCue") {
        const action = String(args.action || "add");
        const validKinds: ShapeType[] = [
          "speech-bubble",
          "thought-bubble",
          "callout",
          "rectangle",
          "circle",
          "arrow",
          "star",
        ];
        const kind: ShapeType =
          typeof args.kind === "string" && validKinds.includes(args.kind as ShapeType)
            ? (args.kind as ShapeType)
            : "speech-bubble";

        if (action === "add") {
          const start = typeof args.startSec === "number" ? Math.max(0, args.startSec) : round1(playheadSec);
          const end = typeof args.endSec === "number" ? Math.max(start + 0.5, args.endSec) : round1(start + 3.5);
          const isBubble = kind === "speech-bubble" || kind === "thought-bubble" || kind === "callout";
          const id = crypto.randomUUID();
          setShapeCues((prev) => [
            ...prev,
            {
              id,
              kind,
              startSec: start,
              endSec: end,
              x: typeof args.x === "number" ? clamp(args.x, 5, 95) : 56,
              y: typeof args.y === "number" ? clamp(args.y, 5, 95) : 26,
              widthPct: kind === "circle" || kind === "star" ? 20 : 34,
              heightPct: kind === "arrow" ? 14 : 20,
              fillColor: typeof args.fillColor === "string" ? args.fillColor : isBubble ? "#F0F6FF" : "#1D4ED8",
              strokeColor: typeof args.strokeColor === "string" ? args.strokeColor : "#00E5FF",
              strokeWidth: 4,
              text: typeof args.text === "string" ? args.text : "",
              textColor: typeof args.textColor === "string" ? args.textColor : isBubble ? "#050816" : "#FFFFFF",
              tailDirection: "bottom-left",
              rotation: 0,
              opacity: 100,
            },
          ]);
          setSelectedRef({ kind: "shape", id });
          summaries.push(`Added ${kind}${args.text ? ` ("${String(args.text)}")` : ""} (${start}s–${end}s)`);
        } else if (action === "remove") {
          setShapeCues((prev) =>
            prev.filter((s, i) =>
              typeof args.cueIndex === "number"
                ? i !== args.cueIndex
                : selectedRef?.kind === "shape"
                  ? s.id !== selectedRef.id
                  : i !== prev.length - 1
            )
          );
          summaries.push("Removed shape / bubble");
        } else {
          setShapeCues((prev) =>
            prev.map((s, i) => {
              const match =
                (typeof args.cueIndex === "number" && i === args.cueIndex) ||
                (selectedRef?.kind === "shape" && s.id === selectedRef.id);
              if (!match) return s;
              return {
                ...s,
                ...(typeof args.kind === "string" && validKinds.includes(args.kind as ShapeType)
                  ? { kind: args.kind as ShapeType }
                  : {}),
                ...(typeof args.text === "string" ? { text: args.text } : {}),
                ...(typeof args.startSec === "number" ? { startSec: Math.max(0, args.startSec) } : {}),
                ...(typeof args.endSec === "number" ? { endSec: Math.max(0.5, args.endSec) } : {}),
                ...(typeof args.x === "number" ? { x: clamp(args.x, 5, 95) } : {}),
                ...(typeof args.y === "number" ? { y: clamp(args.y, 5, 95) } : {}),
                ...(typeof args.fillColor === "string" ? { fillColor: args.fillColor } : {}),
                ...(typeof args.strokeColor === "string" ? { strokeColor: args.strokeColor } : {}),
                ...(typeof args.textColor === "string" ? { textColor: args.textColor } : {}),
              };
            })
          );
          summaries.push("Updated shape / bubble");
        }
      } else if (call.name === "manageTextCue") {
        const action = String(args.action || "add");
        if (action === "add") {
          const start = typeof args.startSec === "number" ? Math.max(0, args.startSec) : round1(playheadSec);
          const end = typeof args.endSec === "number" ? Math.max(start + 0.5, args.endSec) : round1(start + 2.5);
          const text = typeof args.text === "string" ? args.text : "Subtitle text";
          const id = crypto.randomUUID();
          setTextCues((prev) => [
            ...prev,
            {
              id,
              text,
              startSec: start,
              endSec: end,
              x: typeof args.x === "number" ? clamp(args.x, 5, 95) : 50,
              y: typeof args.y === "number" ? clamp(args.y, 5, 95) : 84,
              fontSize: typeof args.fontSize === "number" ? clamp(args.fontSize, 20, 90) : 40,
              color: typeof args.color === "string" ? args.color : "#FFFFFF",
              bgColor: "#050816",
              showBackdrop: true,
            },
          ]);
          setSelectedRef({ kind: "text", id });
          summaries.push(`Added subtitle "${text}" (${start}s–${end}s)`);
        } else if (action === "remove") {
          setTextCues((prev) =>
            prev.filter((t, i) =>
              typeof args.cueIndex === "number"
                ? i !== args.cueIndex
                : selectedRef?.kind === "text"
                  ? t.id !== selectedRef.id
                  : i !== prev.length - 1
            )
          );
          summaries.push("Removed timed text");
        } else {
          setTextCues((prev) =>
            prev.map((t, i) => {
              const match =
                (typeof args.cueIndex === "number" && i === args.cueIndex) ||
                (selectedRef?.kind === "text" && t.id === selectedRef.id);
              if (!match) return t;
              return {
                ...t,
                ...(typeof args.text === "string" ? { text: args.text } : {}),
                ...(typeof args.startSec === "number" ? { startSec: Math.max(0, args.startSec) } : {}),
                ...(typeof args.endSec === "number" ? { endSec: Math.max(0.5, args.endSec) } : {}),
                ...(typeof args.x === "number" ? { x: clamp(args.x, 5, 95) } : {}),
                ...(typeof args.y === "number" ? { y: clamp(args.y, 5, 95) } : {}),
                ...(typeof args.fontSize === "number" ? { fontSize: clamp(args.fontSize, 20, 90) } : {}),
                ...(typeof args.color === "string" ? { color: args.color } : {}),
              };
            })
          );
          summaries.push("Updated timed text");
        }
      } else if (call.name === "updateAudioEffects") {
        const action = String(args.action || "set_global");
        if (action === "reset") {
          setAudioEffects({ ...DEFAULT_AUDIO_EFFECTS });
          summaries.push("Reset audio speed & pitch to normal");
        } else if (action === "add_segment") {
          const start = typeof args.startSec === "number" ? Math.max(0, args.startSec) : playheadSec;
          const end = typeof args.endSec === "number" ? Math.max(start + 0.3, args.endSec) : start + 2.5;
          const speed = typeof args.speed === "number" ? clamp(args.speed, 0.5, 2.0) : 1.5;
          const pitch =
            typeof args.pitchSemitones === "number" ? clamp(args.pitchSemitones, -12, 12) : 0;
          const label =
            typeof args.label === "string" && args.label
              ? args.label
              : `${speed.toFixed(1)}x · ${pitch >= 0 ? "+" : ""}${pitch}st`;
          setAudioEffects((prev) => ({
            ...prev,
            segments: [
              ...prev.segments,
              { id: crypto.randomUUID(), label, startSec: start, endSec: end, speed, pitchSemitones: pitch },
            ],
          }));
          summaries.push(`Added audio FX (${start}s–${end}s): ${label}`);
        } else if (action === "remove_segment" && typeof args.segmentIndex === "number") {
          setAudioEffects((prev) => ({
            ...prev,
            segments: prev.segments.filter((_, i) => i !== args.segmentIndex),
          }));
          summaries.push("Removed audio FX segment");
        } else {
          setAudioEffects((prev) => ({
            ...prev,
            ...(typeof args.speed === "number" ? { baseSpeed: clamp(args.speed, 0.5, 2.0) } : {}),
            ...(typeof args.pitchSemitones === "number"
              ? { basePitchSemitones: clamp(args.pitchSemitones, -12, 12) }
              : {}),
          }));
          summaries.push("Updated global audio speed / pitch");
        }
      } else if (call.name === "syncSlidesToAudio") {
        handleFitBackgroundsToAudio();
        summaries.push("Fitted backgrounds evenly to audio duration");
      } else if (call.name === "updateProjectSettings") {
        if (
          args.aspectRatio === "16:9" ||
          args.aspectRatio === "9:16" ||
          args.aspectRatio === "1:1" ||
          args.aspectRatio === "4:5"
        ) {
          setAspectRatio(args.aspectRatio);
          summaries.push(`Aspect ratio: ${args.aspectRatio}`);
        }
        if (args.transition === "crossfade" || args.transition === "cut" || args.transition === "ken-burns") {
          setTransition(args.transition);
          summaries.push(`Transition: ${args.transition}`);
        }
        if (args.imageFit === "cover" || args.imageFit === "contain") {
          setImageFit(args.imageFit);
          summaries.push(`Framing: ${args.imageFit}`);
        }
      } else if (call.name === "resetImageEdits") {
        setBgCues((prev) =>
          prev.map((c) => ({ ...c, adjustments: { ...DEFAULT_ADJUSTMENTS }, caption: { ...DEFAULT_CAPTION } }))
        );
        summaries.push("Reset scene adjustments");
      }
    }

    return summaries;
  };

  const handleSendChat = async (promptOverride?: string) => {
    const promptText = (promptOverride ?? chatInput).trim();
    if (!promptText || isAssistantBusy) return;

    setErrorMsg(null);
    if (!promptOverride) setChatInput("");

    setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: promptText }]);
    setIsAssistantBusy(true);

    try {
      const snap = await createCanvasSnapshotBase64(canvasRef.current);

      const projectSummary = {
        playheadSec: Number(playheadSec.toFixed(1)),
        aspectRatio,
        transition,
        imageFit,
        backgrounds: backgrounds.map((b, i) => ({ index: i + 1, name: b.name })),
        expressions: expressions.map((e, i) => ({ index: i + 1, name: e.name })),
        extraImages: overlayAssets.map((o, i) => ({ index: i + 1, name: o.name })),
        backgroundCues: bgCues.map((c, i) => ({
          index: i,
          background: backgrounds.find((b) => b.id === c.assetId)?.name ?? "Unknown",
          startSec: c.startSec,
          endSec: c.endSec,
        })),
        characterCues: charCues.map((c, i) => ({
          index: i,
          expression: expressions.find((e) => e.id === c.expressionId)?.name ?? "Unknown",
          startSec: c.startSec,
          endSec: c.endSec,
          x: c.x,
          y: c.y,
          scale: c.scale,
        })),
        overlayCues: overlayCues.map((o, i) => ({
          index: i,
          image: overlayAssets.find((a) => a.id === o.assetId)?.name ?? "Unknown",
          startSec: o.startSec,
          endSec: o.endSec,
          mode: o.mode,
        })),
        shapeCues: shapeCues.map((s, i) => ({
          index: i,
          kind: s.kind,
          text: s.text,
          startSec: s.startSec,
          endSec: s.endSec,
        })),
        textCues: textCues.map((t, i) => ({
          index: i,
          text: t.text,
          startSec: t.startSec,
          endSec: t.endSec,
        })),
        drawingStrokesCount: drawingStrokes.length,
        audio: audioTrack
          ? {
              title: audioTrack.title,
              durationSec: Number(audioTrack.durationSec.toFixed(1)),
              baseSpeed: audioEffects.baseSpeed,
              basePitchSemitones: audioEffects.basePitchSemitones,
              segments: audioEffects.segments.length,
            }
          : null,
      };

      const res = await fetch("/api/media/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: promptText,
          history: chatMessages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
          projectSummary,
          selectedImageBase64: snap?.base64,
          selectedImageMime: snap?.mime,
        }),
      });

      const data = (await res.json()) as {
        reply?: string;
        toolCalls?: AssistantToolCall[];
        error?: string;
      };

      if (!res.ok) throw new Error(data.error || "Assistant request failed.");

      const appliedActions = applyToolCalls(Array.isArray(data.toolCalls) ? data.toolCalls : []);
      const replyText =
        data.reply ||
        (appliedActions.length > 0
          ? "Done — I updated your scene."
          : "I couldn't find any changes to apply for that request.");

      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: replyText,
          actions: appliedActions.length > 0 ? appliedActions : undefined,
        },
      ]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: err instanceof Error ? err.message : "Could not process edit instruction.",
        },
      ]);
    } finally {
      setIsAssistantBusy(false);
    }
  };

  // Add Audio FX Segment helper
  const addAudioEffectSegment = (label: string, speed: number, pitchSemitones: number) => {
    if (!rawAudio) return;
    const start = Number(clamp(playheadSec, 0, Math.max(0, rawAudio.rawDurationSec - 0.5)).toFixed(1));
    const end = Number(Math.min(rawAudio.rawDurationSec, start + 2.5).toFixed(1));
    setAudioEffects((prev) => ({
      ...prev,
      segments: [
        ...prev.segments,
        {
          id: crypto.randomUUID(),
          label,
          startSec: start,
          endSec: Math.max(start + 0.3, end),
          speed,
          pitchSemitones,
        },
      ],
    }));
  };

  // Easy Timing Control helper component
  const renderTimeRangeInputs = (
    startSec: number,
    endSec: number,
    onChangeStart: (v: number) => void,
    onChangeEnd: (v: number) => void
  ) => (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#9FB3D9]">Start (s)</span>
          <button
            type="button"
            onClick={() => onChangeStart(round1(playheadSec))}
            className="text-[10px] font-medium text-[#00E5FF] hover:underline"
          >
            Set = Now ({round1(playheadSec)}s)
          </button>
        </div>
        <input
          type="number"
          min={0}
          step={0.1}
          value={startSec}
          onChange={(e) => onChangeStart(Math.max(0, Number(e.target.value)))}
          className="w-full px-2 py-1 text-xs font-mono bg-[#070B1A] border border-[#1E356B] rounded text-[#F0F6FF]"
        />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#9FB3D9]">End (s)</span>
          <button
            type="button"
            onClick={() => onChangeEnd(Math.max(round1(startSec + 0.3), round1(playheadSec)))}
            className="text-[10px] font-medium text-[#00E5FF] hover:underline"
          >
            Set = Now ({round1(playheadSec)}s)
          </button>
        </div>
        <input
          type="number"
          min={0.3}
          step={0.1}
          value={endSec}
          onChange={(e) => onChangeEnd(Math.max(startSec + 0.2, Number(e.target.value)))}
          className="w-full px-2 py-1 text-xs font-mono bg-[#070B1A] border border-[#1E356B] rounded text-[#F0F6FF]"
        />
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Hidden file inputs */}
      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleUploadBackgrounds(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={exprInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleUploadExpressions(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={overlayInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleUploadOverlays(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          handleUploadAudioFile(e.target.files);
          e.target.value = "";
        }}
      />

      {audioTrack && (
        <audio
          ref={audioElRef}
          src={audioTrack.blobUrl}
          preload="metadata"
          onEnded={() => {
            if (playheadSec >= totalTimelineDuration - 0.1) {
              setIsPlaying(false);
            }
          }}
        />
      )}

      {/* Left Main Stage & Multi-Track Timeline (8 cols) */}
      <div className="lg:col-span-8 space-y-4">
        {/* Top Easy Creation Strip + Format Controls Bar */}
        <div className="bg-[#0B1124] border border-[#1A2B56] rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => bgInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-[#040B1A] bg-[#00E5FF] hover:bg-[#38EEFF] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-[0_0_14px_rgba(0,229,255,0.3)]"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>+ Backgrounds</span>
            </button>

            <button
              type="button"
              onClick={() => exprInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E0F2FE] bg-[#0F1B3D] border border-[#243B73] hover:border-[#00E5FF] hover:text-[#00E5FF] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>+ Character</span>
            </button>

            <button
              type="button"
              onClick={() => overlayInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#BFDBFE] bg-[#0F1B3D] border border-[#243B73] hover:border-[#38BDF8] hover:text-[#00E5FF] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <ImagePlus className="w-3.5 h-3.5" />
              <span>+ Image</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickAddShape("speech-bubble")}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E0F2FE] bg-[#0F1B3D] border border-[#243B73] hover:border-[#00E5FF] hover:text-[#00E5FF] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>+ Bubble / Shape</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickAddText()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#E0F2FE] bg-[#0F1B3D] border border-[#243B73] hover:border-[#00E5FF] hover:text-[#00E5FF] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <TypeIcon className="w-3.5 h-3.5" />
              <span>+ Text</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!hasAnyVisuals) handleLoadDemoCastAndStage();
                setIsPlaying(false);
                setIsDrawMode((v) => !v);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                isDrawMode
                  ? "bg-[#2563EB] text-white border-[#00E5FF] shadow-[0_0_16px_rgba(0,229,255,0.45)]"
                  : "bg-[#0F1B3D] text-[#BFDBFE] border-[#243B73] hover:border-[#00E5FF] hover:text-[#00E5FF]"
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>{isDrawMode ? "Drawing On" : "Draw"}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Aspect ratio"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatioId)}
              className="px-2 py-1.5 text-xs font-medium bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF] focus:outline-none focus:border-[#00E5FF]"
            >
              {(Object.keys(ASPECT_RATIO_DIMENSIONS) as AspectRatioId[]).map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ASPECT_RATIO_DIMENSIONS[ratio].label}
                </option>
              ))}
            </select>

            <select
              aria-label="Transition style"
              value={transition}
              onChange={(e) => setTransition(e.target.value as TransitionType)}
              className="px-2 py-1.5 text-xs font-medium bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF] focus:outline-none focus:border-[#00E5FF]"
            >
              <option value="crossfade">Crossfade</option>
              <option value="ken-burns">Smooth Zoom</option>
              <option value="cut">Hard Cut</option>
            </select>

            <div className="flex items-center p-0.5 bg-[#070B1A] border border-[#1E356B] rounded-lg">
              {(["cover", "contain"] as const).map((fit) => (
                <button
                  key={fit}
                  type="button"
                  onClick={() => setImageFit(fit)}
                  className={`px-2 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                    imageFit === fit
                      ? "bg-[#1D4ED8] text-[#F0F6FF] shadow-[0_0_10px_rgba(37,99,235,0.45)]"
                      : "text-[#9FB3D9] hover:text-[#F0F6FF]"
                  }`}
                >
                  {fit === "cover" ? "Fill" : "Fit"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Interactive Draw Toolbar (visible when Draw Mode is active) */}
        {isDrawMode && (
          <div className="bg-[#0B1124] border border-[#00E5FF]/60 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-[0_0_18px_rgba(0,229,255,0.16)]">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center p-0.5 bg-[#070B1A] border border-[#1E356B] rounded-lg">
                <button
                  type="button"
                  onClick={() => setDrawTool("pen")}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md ${
                    drawTool === "pen" ? "bg-[#00E5FF] text-[#040B1A] font-semibold" : "text-[#9FB3D9]"
                  }`}
                >
                  <PenTool className="w-3 h-3" />
                  <span>Pen</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawTool("highlighter")}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md ${
                    drawTool === "highlighter"
                      ? "bg-[#00E5FF] text-[#040B1A] font-semibold"
                      : "text-[#9FB3D9]"
                  }`}
                >
                  <Highlighter className="w-3 h-3" />
                  <span>Highlighter</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                {NEON_COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    aria-label={`Select color ${col}`}
                    onClick={() => setDrawColor(col)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${
                      drawColor === col ? "border-white scale-110" : "border-[#1A2B56]"
                    }`}
                    style={{ backgroundColor: col }}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2 text-xs text-[#9FB3D9]">
                <span>Size</span>
                <input
                  type="range"
                  min={2}
                  max={28}
                  step={1}
                  value={drawSize}
                  onChange={(e) => setDrawSize(Number(e.target.value))}
                  className="w-20 accent-[#00E5FF]"
                />
                <span className="font-mono text-[#00E5FF]">{drawSize}px</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawEntireVideo((v) => !v)}
                className="px-2.5 py-1 text-[11px] font-medium bg-[#0F1B3D] border border-[#243B73] text-[#BFDBFE] hover:border-[#00E5FF] rounded-lg"
              >
                Show: {drawEntireVideo ? "Whole Video" : `3s (${round1(playheadSec)}s)`}
              </button>
              <button
                type="button"
                disabled={drawingStrokes.length === 0}
                onClick={() => setDrawingStrokes((prev) => prev.slice(0, -1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#070B1A] border border-[#1E356B] text-[#F0F6FF] disabled:opacity-40 rounded-lg"
              >
                <Undo2 className="w-3 h-3" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                disabled={drawingStrokes.length === 0}
                onClick={() => setDrawingStrokes([])}
                className="px-2.5 py-1 text-[11px] font-medium bg-[#070B1A] border border-[#1E356B] text-[#FB7185] disabled:opacity-40 rounded-lg"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsDrawMode(false)}
                className="px-2.5 py-1 text-[11px] font-semibold bg-[#00E5FF] text-[#040B1A] rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Live Canvas / Initial Setup Prompt */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleUploadBackgrounds(e.dataTransfer.files);
          }}
          className="bg-[#0B1124] border border-[#1A2B56] rounded-xl overflow-hidden shadow-[0_0_30px_rgba(15,23,42,0.7)]"
        >
          <div className="bg-[#03050F] flex flex-col items-center justify-center p-4 min-h-[360px]">
            {!hasAnyVisuals ? (
              <div className="w-full max-w-2xl py-6 px-4 space-y-6">
                <div className="text-center">
                  <h2 className="text-base font-semibold text-[#F0F6FF]">
                    Start Your Scene in Seconds
                  </h2>
                  <p className="text-xs text-[#9FB3D9] mt-1">
                    Upload backgrounds and your character, or drop in bubbles, shapes, drawings, and
                    timed subtitles matched to your audio.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <button
                    type="button"
                    onClick={() => bgInputRef.current?.click()}
                    className="p-4 text-left rounded-xl bg-[#0B1124] border border-[#1E356B] hover:border-[#00E5FF] transition-colors space-y-1.5"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#00E5FF]">
                      <Layers className="w-4 h-4" />
                      <span>1. Upload Backgrounds</span>
                    </div>
                    <p className="text-xs text-[#9FB3D9]">
                      Pick 1 or many background scenes to switch between during your video.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => exprInputRef.current?.click()}
                    className="p-4 text-left rounded-xl bg-[#0B1124] border border-[#1E356B] hover:border-[#38BDF8] transition-colors space-y-1.5"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#38BDF8]">
                      <UserCheck className="w-4 h-4" />
                      <span>2. Upload Character &amp; Expressions</span>
                    </div>
                    <p className="text-xs text-[#9FB3D9]">
                      Upload your character pose(s) (happy, surprised, talking) and drag to place anywhere.
                    </p>
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleLoadDemoCastAndStage}
                    className="px-4 py-2 text-xs font-semibold text-[#040B1A] bg-[#00E5FF] hover:bg-[#38EEFF] rounded-lg transition-colors shadow-[0_0_16px_rgba(0,229,255,0.35)]"
                  >
                    Load Demo Cast, Bubble &amp; Text
                  </button>
                  <button
                    type="button"
                    onClick={() => audioInputRef.current?.click()}
                    className="px-4 py-2 text-xs font-medium text-[#BFDBFE] bg-[#0F1B3D] border border-[#243B73] hover:border-[#00E5FF] rounded-lg transition-colors"
                  >
                    Attach Audio First
                  </button>
                </div>
              </div>
            ) : (
              <>
                <canvas
                  ref={canvasRef}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={handleCanvasPointerUp}
                  className={`max-h-[430px] max-w-full rounded border border-[#1A2B56]/70 object-contain touch-none ${
                    isDrawMode
                      ? "cursor-crosshair border-[#00E5FF]"
                      : "cursor-grab active:cursor-grabbing"
                  }`}
                />
                {!isPlaying && (
                  <p className="mt-2 text-[11px] text-[#647BA8]">
                    {isDrawMode
                      ? "Draw Mode Active: Click and drag directly on the canvas to draw with your pen or highlighter."
                      : "Tip: Drag your character, speech bubble, shape, text, or image directly on the preview to position it anywhere."}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Playback & Export Bar */}
          <div className="px-4 py-3 border-t border-[#1A2B56] bg-[#0B1124] flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!hasAnyVisuals || isExporting}
              onClick={togglePlayback}
              aria-label={isPlaying ? "Pause preview" : "Play preview"}
              className="w-9 h-9 rounded-lg bg-[#00E5FF] hover:bg-[#38EEFF] disabled:opacity-40 text-[#040B1A] flex items-center justify-center shrink-0 transition-colors shadow-[0_0_16px_rgba(0,229,255,0.35)]"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <button
              type="button"
              disabled={!hasAnyVisuals || isExporting}
              onClick={() => {
                setIsPlaying(false);
                setPlayheadSec(0);
                if (audioElRef.current) {
                  audioElRef.current.pause();
                  audioElRef.current.currentTime = 0;
                }
              }}
              aria-label="Reset to start"
              className="w-9 h-9 rounded-lg border border-[#1E356B] bg-[#070B1A] hover:border-[#00E5FF] hover:text-[#00E5FF] disabled:opacity-40 text-[#9FB3D9] flex items-center justify-center shrink-0 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <div
              className="flex-1 h-2.5 bg-[#132044] rounded-full cursor-pointer relative overflow-hidden min-w-[120px]"
              onClick={(e) => {
                if (totalTimelineDuration <= 0) return;
                const rect = e.currentTarget.getBoundingClientRect();
                handleSeek((e.clientX - rect.left) / rect.width);
              }}
            >
              <div
                className="h-full bg-gradient-to-r from-[#2563EB] to-[#00E5FF] shadow-[0_0_12px_rgba(0,229,255,0.6)] transition-all duration-75"
                style={{
                  width: `${
                    totalTimelineDuration > 0
                      ? Math.min(100, (playheadSec / totalTimelineDuration) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>

            <span className="text-xs font-mono tabular-nums text-[#9FB3D9] whitespace-nowrap shrink-0">
              {formatDuration(playheadSec)} / {formatDuration(totalTimelineDuration)}
            </span>

            <button
              type="button"
              disabled={!hasAnyVisuals || isExporting}
              onClick={handleExportVideo}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#3B82F6] border border-[#60A5FA]/40 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-[0_0_18px_rgba(37,99,235,0.45)]"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="font-mono tabular-nums">Rendering {exportProgress}%</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Video</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Multi-Track Scene Timeline */}
        <div className="bg-[#0B1124] border border-[#1A2B56] rounded-xl p-4 space-y-3.5">
          {/* Track 1: Timed Text / Audio-Matched Subtitles */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#00E5FF]">
                Timed Text &amp; Audio Subtitles ({textCues.length})
              </span>
              <button
                type="button"
                onClick={() => handleQuickAddText()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#BFDBFE] hover:text-[#00E5FF]"
              >
                <Plus className="w-3 h-3" />
                <span>Drop Text at {round1(playheadSec)}s</span>
              </button>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {textCues.length === 0 ? (
                <span className="text-xs text-[#647BA8]">
                  Click + Text or paste lines in Manual Edits to match what your audio says.
                </span>
              ) : (
                textCues.map((t) => {
                  const isSel = selectedRef?.kind === "text" && selectedRef.id === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={() => {
                        setSelectedRef({ kind: "text", id: t.id });
                        setPlayheadSec(t.startSec + 0.05);
                        setRailTab("manual");
                      }}
                      className={`px-2.5 py-1.5 shrink-0 rounded-lg border cursor-pointer flex items-center gap-2 transition-colors ${
                        isSel
                          ? "border-[#00E5FF] bg-[#00E5FF]/10"
                          : "border-[#1A2B56] bg-[#070B1A] hover:border-[#00E5FF]"
                      }`}
                    >
                      <TypeIcon className="w-3.5 h-3.5 text-[#00E5FF] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-[#F0F6FF] truncate max-w-[130px] font-ethiopic">
                          {t.text || "(Empty text)"}
                        </p>
                        <p className="text-[10px] font-mono tabular-nums text-[#00E5FF]">
                          {t.startSec}s–{t.endSec}s
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTextCues((prev) => prev.filter((item) => item.id !== t.id));
                        }}
                        aria-label="Remove text cue"
                        className="text-[#647BA8] hover:text-[#FB7185]"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Track 2: Shapes & Speech Bubbles */}
          <div className="pt-3 border-t border-[#1A2B56] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#38BDF8]">
                Shapes &amp; Speech Bubbles ({shapeCues.length})
              </span>
              <button
                type="button"
                onClick={() => handleQuickAddShape("speech-bubble")}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#BFDBFE] hover:text-[#00E5FF]"
              >
                <Plus className="w-3 h-3" />
                <span>Add Bubble at {round1(playheadSec)}s</span>
              </button>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {shapeCues.length === 0 ? (
                <span className="text-xs text-[#647BA8]">
                  Add speech bubbles, thought bubbles, arrows, or stars anywhere in your video.
                </span>
              ) : (
                shapeCues.map((s) => {
                  const isSel = selectedRef?.kind === "shape" && selectedRef.id === s.id;
                  return (
                    <div
                      key={s.id}
                      onClick={() => {
                        setSelectedRef({ kind: "shape", id: s.id });
                        setPlayheadSec(s.startSec + 0.05);
                        setRailTab("manual");
                      }}
                      className={`px-2.5 py-1.5 shrink-0 rounded-lg border cursor-pointer flex items-center gap-2 transition-colors ${
                        isSel
                          ? "border-[#00E5FF] bg-[#00E5FF]/10"
                          : "border-[#1A2B56] bg-[#070B1A] hover:border-[#38BDF8]"
                      }`}
                    >
                      <Shapes className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-[#F0F6FF] truncate max-w-[110px]">
                          {s.text.trim() || s.kind}
                        </p>
                        <p className="text-[10px] font-mono tabular-nums text-[#38BDF8]">
                          {s.startSec}s–{s.endSec}s
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShapeCues((prev) => prev.filter((item) => item.id !== s.id));
                        }}
                        aria-label="Remove shape cue"
                        className="text-[#647BA8] hover:text-[#FB7185]"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Track 3: Backgrounds */}
          <div className="pt-3 border-t border-[#1A2B56] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#60A5FA]">
                Backgrounds ({bgCues.length})
              </span>
              {backgrounds.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const end = bgCues.reduce((m, c) => Math.max(m, c.endSec), 0);
                    const id = crypto.randomUUID();
                    setBgCues((prev) => [
                      ...prev,
                      {
                        id,
                        assetId: backgrounds[0].id,
                        startSec: end,
                        endSec: end + 4,
                        adjustments: { ...DEFAULT_ADJUSTMENTS },
                        caption: { ...DEFAULT_CAPTION },
                      },
                    ]);
                    setSelectedRef({ kind: "bg", id });
                    setRailTab("manual");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#BFDBFE] hover:text-[#00E5FF]"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Background Change</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
              {bgCues.length === 0 ? (
                <span className="text-xs text-[#647BA8]">
                  No backgrounds added yet — click + Backgrounds above.
                </span>
              ) : (
                bgCues.map((cue, idx) => {
                  const asset = backgrounds.find((b) => b.id === cue.assetId);
                  const isSel = selectedRef?.kind === "bg" && selectedRef.id === cue.id;
                  return (
                    <div
                      key={cue.id}
                      onClick={() => {
                        setSelectedRef({ kind: "bg", id: cue.id });
                        setPlayheadSec(cue.startSec + 0.05);
                        setRailTab("manual");
                      }}
                      className={`w-36 shrink-0 rounded-lg border p-2 cursor-pointer transition-colors ${
                        isSel
                          ? "border-[#00E5FF] bg-[#00E5FF]/10 shadow-[0_0_14px_rgba(0,229,255,0.18)]"
                          : "border-[#1A2B56] bg-[#070B1A] hover:border-[#3B82F6]"
                      }`}
                    >
                      <div className="relative h-12 rounded bg-[#03050F] overflow-hidden mb-1.5">
                        {asset && (
                          <img src={asset.dataUrl} alt={asset.name} className="w-full h-full object-cover" />
                        )}
                        <span className="absolute top-1 left-1 px-1 py-0.5 text-[10px] font-mono tabular-nums bg-[#050816]/85 text-[#00E5FF] rounded">
                          BG {idx + 1}
                        </span>
                        <span className="absolute bottom-1 right-1 px-1 py-0.5 text-[10px] font-mono tabular-nums bg-[#050816]/85 text-[#F0F6FF] rounded">
                          {cue.startSec}s–{cue.endSec}s
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] text-[#F0F6FF] truncate">
                          {asset?.name ?? "Background"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBgCues((prev) => prev.filter((c) => c.id !== cue.id));
                          }}
                          aria-label="Remove background cue"
                          className="text-[#647BA8] hover:text-[#FB7185]"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Track 4: Character Expressions */}
          <div className="pt-3 border-t border-[#1A2B56] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#38BDF8]">
                Character Expressions ({charCues.length})
              </span>
              {expressions.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const last = charCues[charCues.length - 1];
                    const start = last ? last.endSec : round1(playheadSec);
                    const id = crypto.randomUUID();
                    setCharCues((prev) => [
                      ...prev,
                      {
                        id,
                        expressionId: expressions[0].id,
                        startSec: start,
                        endSec: start + 3,
                        x: last?.x ?? 50,
                        y: last?.y ?? 62,
                        scale: last?.scale ?? 0.62,
                        flipX: last?.flipX ?? false,
                        rotation: last?.rotation ?? 0,
                        opacity: 100,
                      },
                    ]);
                    setSelectedRef({ kind: "char", id });
                    setPlayheadSec(start + 0.05);
                    setRailTab("manual");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#BFDBFE] hover:text-[#00E5FF]"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Expression Change</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {charCues.length === 0 ? (
                <span className="text-xs text-[#647BA8]">
                  No character expressions yet — click + Character above.
                </span>
              ) : (
                charCues.map((cue) => {
                  const expr = expressions.find((e) => e.id === cue.expressionId);
                  const isSel = selectedRef?.kind === "char" && selectedRef.id === cue.id;
                  return (
                    <div
                      key={cue.id}
                      onClick={() => {
                        setSelectedRef({ kind: "char", id: cue.id });
                        setPlayheadSec(cue.startSec + 0.05);
                        setRailTab("manual");
                      }}
                      className={`px-2.5 py-1.5 shrink-0 rounded-lg border cursor-pointer flex items-center gap-2 transition-colors ${
                        isSel
                          ? "border-[#00E5FF] bg-[#00E5FF]/10"
                          : "border-[#1A2B56] bg-[#070B1A] hover:border-[#38BDF8]"
                      }`}
                    >
                      {expr && (
                        <img
                          src={expr.dataUrl}
                          alt={expr.name}
                          className="w-7 h-7 rounded object-contain bg-[#03050F]"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-[#F0F6FF] truncate max-w-[90px]">
                          {expr?.name ?? "Expression"}
                        </p>
                        <p className="text-[10px] font-mono tabular-nums text-[#38BDF8]">
                          {cue.startSec}s–{cue.endSec}s
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCharCues((prev) => prev.filter((c) => c.id !== cue.id));
                        }}
                        aria-label="Remove character expression cue"
                        className="text-[#647BA8] hover:text-[#FB7185] ml-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Track 5: Timed Extra Images */}
          <div className="pt-3 border-t border-[#1A2B56] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#60A5FA]">
                Timed Extra Images ({overlayCues.length})
              </span>
              {overlayAssets.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const start = round1(playheadSec);
                    const id = crypto.randomUUID();
                    setOverlayCues((prev) => [
                      ...prev,
                      {
                        id,
                        assetId: overlayAssets[0].id,
                        startSec: start,
                        endSec: round1(start + 3),
                        mode: "overlay",
                        x: 74,
                        y: 34,
                        scale: 0.36,
                        rotation: 0,
                        opacity: 100,
                        adjustments: { ...DEFAULT_ADJUSTMENTS },
                        caption: { ...DEFAULT_CAPTION },
                      },
                    ]);
                    setSelectedRef({ kind: "overlay", id });
                    setRailTab("manual");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#BFDBFE] hover:text-[#00E5FF]"
                >
                  <Plus className="w-3 h-3" />
                  <span>Insert Image at Playhead</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => overlayInputRef.current?.click()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#BFDBFE] hover:text-[#00E5FF]"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Image for Seconds</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {overlayCues.length === 0 ? (
                <span className="text-xs text-[#647BA8]">
                  Add an image to appear for specific seconds, swap it with another, or remove it.
                </span>
              ) : (
                overlayCues.map((ov) => {
                  const asset = overlayAssets.find((a) => a.id === ov.assetId);
                  const isSel = selectedRef?.kind === "overlay" && selectedRef.id === ov.id;
                  return (
                    <div
                      key={ov.id}
                      onClick={() => {
                        setSelectedRef({ kind: "overlay", id: ov.id });
                        setPlayheadSec(ov.startSec + 0.05);
                        setRailTab("manual");
                      }}
                      className={`px-2.5 py-1.5 shrink-0 rounded-lg border cursor-pointer flex items-center gap-2 transition-colors ${
                        isSel
                          ? "border-[#00E5FF] bg-[#00E5FF]/10"
                          : "border-[#1A2B56] bg-[#070B1A] hover:border-[#60A5FA]"
                      }`}
                    >
                      {asset && (
                        <img
                          src={asset.dataUrl}
                          alt={asset.name}
                          className="w-7 h-7 rounded object-cover bg-[#03050F]"
                        />
                      )}
                      <div>
                        <p className="text-[11px] font-medium text-[#F0F6FF] truncate max-w-[90px]">
                          {asset?.name ?? "Image"}
                        </p>
                        <p className="text-[10px] font-mono tabular-nums text-[#60A5FA]">
                          {ov.startSec}s–{ov.endSec}s · {ov.mode === "fullscreen" ? "Full" : "Overlay"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOverlayCues((prev) => prev.filter((o) => o.id !== ov.id));
                        }}
                        aria-label="Remove timed image"
                        className="text-[#647BA8] hover:text-[#FB7185] ml-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Drawing Summary Bar (when drawings exist) */}
          {drawingStrokes.length > 0 && (
            <div className="pt-3 border-t border-[#1A2B56] flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#9FB3D9]">
                Canvas Drawings: {drawingStrokes.length} stroke(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDrawingStrokes((prev) => prev.slice(0, -1))}
                  className="text-[11px] text-[#BFDBFE] hover:text-[#00E5FF]"
                >
                  Undo Last
                </button>
                <button
                  type="button"
                  onClick={() => setDrawingStrokes([])}
                  className="text-[11px] text-[#FB7185] hover:underline"
                >
                  Clear Drawings
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Audio Track & Speed/Pitch Summary Bar */}
        <div className="bg-[#0B1124] border border-[#1A2B56] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-[#0F1B3D] border border-[#00E5FF]/35 flex items-center justify-center text-[#00E5FF] shrink-0 shadow-[0_0_12px_rgba(0,229,255,0.18)]">
                <Music className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#F0F6FF] truncate font-ethiopic">
                  {audioTrack ? audioTrack.title : "No audio track attached"}
                </p>
                <p className="text-xs text-[#9FB3D9]">
                  {audioTrack
                    ? `${audioTrack.sourceLabel} · ${formatDuration(audioTrack.durationSec)} (${audioEffects.baseSpeed}x, ${audioEffects.basePitchSemitones >= 0 ? "+" : ""}${audioEffects.basePitchSemitones}st${audioEffects.segments.length > 0 ? `, ${audioEffects.segments.length} FX` : ""})`
                    : "Upload MP3/WAV audio or attach a saved voice clip"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className="px-3 py-1.5 text-xs font-medium text-[#E0F2FE] bg-[#0F1B3D] border border-[#243B73] hover:border-[#00E5FF] hover:text-[#00E5FF] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Upload Audio
              </button>

              {libraryTakes.length > 0 && (
                <select
                  aria-label="Choose from Saved Audio Library"
                  value={
                    audioTrack && libraryTakes.some((t) => t.id === audioTrack.id)
                      ? audioTrack.id
                      : ""
                  }
                  onChange={(e) => {
                    if (e.target.value) handlePickLibraryTake(e.target.value);
                  }}
                  className="max-w-[200px] px-2.5 py-1.5 text-xs font-medium bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF] focus:outline-none focus:border-[#00E5FF]"
                >
                  <option value="">Use Saved Voice Clip...</option>
                  {libraryTakes.map((take) => (
                    <option key={take.id} value={take.id}>
                      {take.voiceLabel}: {take.title.slice(0, 24)} ({formatDuration(take.durationSec)})
                    </option>
                  ))}
                </select>
              )}

              {audioTrack && bgCues.length > 0 && (
                <button
                  type="button"
                  onClick={handleFitBackgroundsToAudio}
                  className="px-3 py-1.5 text-xs font-semibold text-[#00E5FF] bg-[#00E5FF]/12 border border-[#00E5FF]/40 hover:bg-[#00E5FF]/20 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Fit Backgrounds to Audio
                </button>
              )}

              {audioTrack && (
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setRawAudio(null);
                    setAudioEffects({ ...DEFAULT_AUDIO_EFFECTS });
                  }}
                  aria-label="Remove audio track"
                  className="p-1.5 text-[#9FB3D9] hover:text-[#FB7185] border border-[#1E356B] rounded-lg"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 rounded-lg bg-[#2A0A14] border border-[#F43F5E]/40 text-xs text-[#FDA4AF]"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right Rail: Manual Edits (Context Editor + Audio Script Matcher + Speed/Pitch FX), Cast & Assets, AI Chat (4 cols) */}
      <aside className="lg:col-span-4 bg-[#0B1124] border border-[#1A2B56] rounded-xl overflow-hidden flex flex-col h-[840px] shadow-[0_0_24px_rgba(37,99,235,0.12)]">
        <div className="p-2 border-b border-[#1A2B56] bg-[#070B1A] flex items-center gap-1">
          {(
            [
              { id: "manual", label: "Manual Edits", Icon: SlidersHorizontal },
              { id: "assets", label: "Cast & Media", Icon: Layers },
              { id: "chat", label: "AI Chat", Icon: MessageSquare },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setRailTab(id)}
              className={`flex-1 py-2 px-2 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                railTab === id
                  ? "bg-[#13224A] text-[#00E5FF] border border-[#00E5FF]/40 shadow-[0_0_12px_rgba(0,229,255,0.16)]"
                  : "text-[#9FB3D9] hover:text-[#F0F6FF]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* TAB 1: MANUAL EDITS */}
        {railTab === "manual" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Context-Aware Visual Cue Editor */}
            {selectedTextCue ? (
              <section className="space-y-4 pb-5 border-b border-[#1A2B56]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#00E5FF]">
                    Timed Text / Subtitle Editor
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setTextCues((prev) => prev.filter((t) => t.id !== selectedTextCue.id))
                    }
                    className="text-xs text-[#FB7185] hover:underline"
                  >
                    Remove text
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-[#9FB3D9] mb-1">
                    Displayed Text (English or Amharic)
                  </label>
                  <textarea
                    rows={2}
                    value={selectedTextCue.text}
                    onChange={(e) =>
                      setTextCues((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextCue.id ? { ...t, text: e.target.value } : t
                        )
                      )
                    }
                    placeholder="Type what the audio is saying..."
                    className="w-full px-3 py-2 text-xs font-ethiopic bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF] focus:outline-none focus:border-[#00E5FF]"
                  />
                </div>

                {renderTimeRangeInputs(
                  selectedTextCue.startSec,
                  selectedTextCue.endSec,
                  (v) =>
                    setTextCues((prev) =>
                      prev.map((t) => (t.id === selectedTextCue.id ? { ...t, startSec: v } : t))
                    ),
                  (v) =>
                    setTextCues((prev) =>
                      prev.map((t) => (t.id === selectedTextCue.id ? { ...t, endSec: v } : t))
                    )
                )}

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#9FB3D9]">Text Size</span>
                    <span className="font-mono text-[#00E5FF]">{selectedTextCue.fontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={90}
                    step={2}
                    value={selectedTextCue.fontSize}
                    onChange={(e) =>
                      setTextCues((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextCue.id
                            ? { ...t, fontSize: Number(e.target.value) }
                            : t
                        )
                      )
                    }
                    className="w-full accent-[#00E5FF]"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[#9FB3D9]">Text Color</span>
                  <div className="flex items-center gap-1.5">
                    {NEON_COLORS.map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() =>
                          setTextCues((prev) =>
                            prev.map((t) =>
                              t.id === selectedTextCue.id ? { ...t, color: col } : t
                            )
                          )
                        }
                        className={`w-5 h-5 rounded-full border-2 ${
                          selectedTextCue.color === col ? "border-white" : "border-[#1E356B]"
                        }`}
                        style={{ backgroundColor: col }}
                      />
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-[#F0F6FF] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTextCue.showBackdrop}
                    onChange={(e) =>
                      setTextCues((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextCue.id
                            ? { ...t, showBackdrop: e.target.checked }
                            : t
                        )
                      )
                    }
                    className="accent-[#00E5FF]"
                  />
                  <span>Show dark neon box behind text</span>
                </label>
              </section>
            ) : selectedShapeCue ? (
              <section className="space-y-4 pb-5 border-b border-[#1A2B56]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#38BDF8]">
                    Shape &amp; Speech Bubble Editor
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setShapeCues((prev) => prev.filter((s) => s.id !== selectedShapeCue.id))
                    }
                    className="text-xs text-[#FB7185] hover:underline"
                  >
                    Remove shape
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-[#9FB3D9] mb-1.5">Shape Style</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {SHAPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          setShapeCues((prev) =>
                            prev.map((s) =>
                              s.id === selectedShapeCue.id ? { ...s, kind: opt.id } : s
                            )
                          )
                        }
                        className={`px-2 py-1.5 text-[11px] font-medium rounded-lg border text-left transition-colors ${
                          selectedShapeCue.kind === opt.id
                            ? "border-[#00E5FF] bg-[#00E5FF]/15 text-[#00E5FF]"
                            : "border-[#1E356B] bg-[#070B1A] text-[#BFDBFE] hover:border-[#38BDF8]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[#9FB3D9] mb-1">
                    Text Inside Bubble / Shape
                  </label>
                  <input
                    type="text"
                    value={selectedShapeCue.text}
                    onChange={(e) =>
                      setShapeCues((prev) =>
                        prev.map((s) =>
                          s.id === selectedShapeCue.id ? { ...s, text: e.target.value } : s
                        )
                      )
                    }
                    placeholder="Type dialogue or callout..."
                    className="w-full px-3 py-1.5 text-xs font-ethiopic bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF]"
                  />
                </div>

                {(selectedShapeCue.kind === "speech-bubble" ||
                  selectedShapeCue.kind === "thought-bubble") && (
                  <div>
                    <label className="block text-xs text-[#9FB3D9] mb-1">Pointer Direction</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { id: "bottom-left", label: "Bottom Left" },
                          { id: "bottom-right", label: "Bottom Right" },
                          { id: "top-left", label: "Top Left" },
                          { id: "top-right", label: "Top Right" },
                        ] as Array<{ id: TailDirection; label: string }>
                      ).map((dir) => (
                        <button
                          key={dir.id}
                          type="button"
                          onClick={() =>
                            setShapeCues((prev) =>
                              prev.map((s) =>
                                s.id === selectedShapeCue.id ? { ...s, tailDirection: dir.id } : s
                              )
                            )
                          }
                          className={`py-1 text-[11px] rounded border ${
                            selectedShapeCue.tailDirection === dir.id
                              ? "border-[#00E5FF] bg-[#00E5FF]/15 text-[#00E5FF]"
                              : "border-[#1E356B] bg-[#070B1A] text-[#9FB3D9]"
                          }`}
                        >
                          {dir.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {renderTimeRangeInputs(
                  selectedShapeCue.startSec,
                  selectedShapeCue.endSec,
                  (v) =>
                    setShapeCues((prev) =>
                      prev.map((s) => (s.id === selectedShapeCue.id ? { ...s, startSec: v } : s))
                    ),
                  (v) =>
                    setShapeCues((prev) =>
                      prev.map((s) => (s.id === selectedShapeCue.id ? { ...s, endSec: v } : s))
                    )
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[#9FB3D9]">Fill Color</span>
                    <div className="flex items-center gap-1.5">
                      {["#F0F6FF", "#0B1124", "#1D4ED8", "#00E5FF", "#FACC15", "#F43F5E"].map(
                        (col) => (
                          <button
                            key={col}
                            type="button"
                            onClick={() =>
                              setShapeCues((prev) =>
                                prev.map((s) =>
                                  s.id === selectedShapeCue.id ? { ...s, fillColor: col } : s
                                )
                              )
                            }
                            className={`w-5 h-5 rounded-full border-2 ${
                              selectedShapeCue.fillColor === col ? "border-white" : "border-[#1E356B]"
                            }`}
                            style={{ backgroundColor: col }}
                          />
                        )
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[#9FB3D9]">Text Color</span>
                    <div className="flex items-center gap-1.5">
                      {["#050816", "#FFFFFF", "#00E5FF", "#FACC15", "#F43F5E"].map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() =>
                            setShapeCues((prev) =>
                              prev.map((s) =>
                                s.id === selectedShapeCue.id ? { ...s, textColor: col } : s
                              )
                            )
                          }
                          className={`w-5 h-5 rounded-full border-2 ${
                            selectedShapeCue.textColor === col ? "border-white" : "border-[#1E356B]"
                          }`}
                          style={{ backgroundColor: col }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {(
                  [
                    { key: "widthPct", label: "Width", min: 10, max: 75, step: 1, unit: "%" },
                    { key: "heightPct", label: "Height", min: 8, max: 60, step: 1, unit: "%" },
                    { key: "rotation", label: "Rotate", min: -180, max: 180, step: 5, unit: "°" },
                    { key: "opacity", label: "Opacity", min: 15, max: 100, step: 5, unit: "%" },
                  ] as const
                ).map((item) => (
                  <div key={item.key}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#9FB3D9]">{item.label}</span>
                      <span className="font-mono tabular-nums text-[#00E5FF]">
                        {selectedShapeCue[item.key]}
                        {item.unit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={selectedShapeCue[item.key]}
                      onChange={(e) =>
                        setShapeCues((prev) =>
                          prev.map((s) =>
                            s.id === selectedShapeCue.id
                              ? { ...s, [item.key]: Number(e.target.value) }
                              : s
                          )
                        )
                      }
                      className="w-full accent-[#00E5FF]"
                    />
                  </div>
                ))}
              </section>
            ) : selectedCharCue ? (
              <section className="space-y-4 pb-5 border-b border-[#1A2B56]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#38BDF8]">
                    Character Expression &amp; Position
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCharCues((prev) => prev.filter((c) => c.id !== selectedCharCue.id))
                    }
                    className="text-xs text-[#FB7185] hover:underline"
                  >
                    Remove cue
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-[#9FB3D9] mb-1.5">
                    Choose Uploaded Expression
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {expressions.map((expr) => {
                      const active = selectedCharCue.expressionId === expr.id;
                      return (
                        <button
                          key={expr.id}
                          type="button"
                          onClick={() =>
                            setCharCues((prev) =>
                              prev.map((c) =>
                                c.id === selectedCharCue.id ? { ...c, expressionId: expr.id } : c
                              )
                            )
                          }
                          className={`p-1.5 rounded-lg border text-center transition-colors ${
                            active
                              ? "border-[#00E5FF] bg-[#00E5FF]/12"
                              : "border-[#1E356B] bg-[#070B1A] hover:border-[#38BDF8]"
                          }`}
                        >
                          <img
                            src={expr.dataUrl}
                            alt={expr.name}
                            className="w-full h-10 object-contain mb-1"
                          />
                          <span className="block text-[10px] text-[#F0F6FF] truncate">
                            {expr.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {renderTimeRangeInputs(
                  selectedCharCue.startSec,
                  selectedCharCue.endSec,
                  (v) =>
                    setCharCues((prev) =>
                      prev.map((c) => (c.id === selectedCharCue.id ? { ...c, startSec: v } : c))
                    ),
                  (v) =>
                    setCharCues((prev) =>
                      prev.map((c) => (c.id === selectedCharCue.id ? { ...c, endSec: v } : c))
                    )
                )}

                {(
                  [
                    { key: "x", label: "Horizontal X", min: 5, max: 95, step: 1, unit: "%" },
                    { key: "y", label: "Vertical Y", min: 5, max: 95, step: 1, unit: "%" },
                    { key: "scale", label: "Character Size", min: 0.2, max: 1.8, step: 0.05, unit: "x" },
                    { key: "opacity", label: "Opacity", min: 10, max: 100, step: 5, unit: "%" },
                  ] as const
                ).map((item) => (
                  <div key={item.key}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#9FB3D9]">{item.label}</span>
                      <span className="font-mono tabular-nums text-[#00E5FF]">
                        {selectedCharCue[item.key]}
                        {item.unit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={selectedCharCue[item.key]}
                      onChange={(e) =>
                        setCharCues((prev) =>
                          prev.map((c) =>
                            c.id === selectedCharCue.id
                              ? { ...c, [item.key]: Number(e.target.value) }
                              : c
                          )
                        )
                      }
                      className="w-full accent-[#00E5FF]"
                    />
                  </div>
                ))}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setCharCues((prev) =>
                        prev.map((c) =>
                          c.id === selectedCharCue.id ? { ...c, flipX: !c.flipX } : c
                        )
                      )
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border ${
                      selectedCharCue.flipX
                        ? "border-[#00E5FF] bg-[#00E5FF]/15 text-[#00E5FF]"
                        : "border-[#1E356B] bg-[#070B1A] text-[#F0F6FF]"
                    }`}
                  >
                    <FlipHorizontal2 className="w-3.5 h-3.5" />
                    <span>Flip Side</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setCharCues((prev) =>
                        prev.map((c) => ({
                          ...c,
                          x: selectedCharCue.x,
                          y: selectedCharCue.y,
                          scale: selectedCharCue.scale,
                          flipX: selectedCharCue.flipX,
                        }))
                      )
                    }
                    className="px-3 py-1.5 text-xs font-medium text-[#BFDBFE] bg-[#0F1B3D] border border-[#243B73] hover:border-[#00E5FF] rounded-lg"
                  >
                    Apply Position to All
                  </button>
                </div>
              </section>
            ) : selectedOverlayCue ? (
              <section className="space-y-4 pb-5 border-b border-[#1A2B56]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#60A5FA]">
                    Timed Image Controls
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setOverlayCues((prev) => prev.filter((o) => o.id !== selectedOverlayCue.id))
                    }
                    className="text-xs text-[#FB7185] hover:underline"
                  >
                    Remove image
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-[#9FB3D9] mb-1">Swap With Another Image</label>
                  <select
                    value={selectedOverlayCue.assetId}
                    onChange={(e) =>
                      setOverlayCues((prev) =>
                        prev.map((o) =>
                          o.id === selectedOverlayCue.id ? { ...o, assetId: e.target.value } : o
                        )
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF]"
                  >
                    {[...overlayAssets, ...backgrounds].map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                {renderTimeRangeInputs(
                  selectedOverlayCue.startSec,
                  selectedOverlayCue.endSec,
                  (v) =>
                    setOverlayCues((prev) =>
                      prev.map((o) => (o.id === selectedOverlayCue.id ? { ...o, startSec: v } : o))
                    ),
                  (v) =>
                    setOverlayCues((prev) =>
                      prev.map((o) => (o.id === selectedOverlayCue.id ? { ...o, endSec: v } : o))
                    )
                )}

                <div className="flex items-center gap-1 p-0.5 bg-[#070B1A] border border-[#1E356B] rounded-lg">
                  {(["overlay", "fullscreen"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setOverlayCues((prev) =>
                          prev.map((o) => (o.id === selectedOverlayCue.id ? { ...o, mode: m } : o))
                        )
                      }
                      className={`flex-1 py-1 text-xs rounded capitalize ${
                        selectedOverlayCue.mode === m
                          ? "bg-[#1D4ED8] text-[#F0F6FF] font-medium"
                          : "text-[#9FB3D9]"
                      }`}
                    >
                      {m === "overlay" ? "Floating Image" : "Full Screen"}
                    </button>
                  ))}
                </div>

                {selectedOverlayCue.mode === "overlay" && (
                  <>
                    {(
                      [
                        { key: "x", label: "Horizontal X", min: 5, max: 95, step: 1, unit: "%" },
                        { key: "y", label: "Vertical Y", min: 5, max: 95, step: 1, unit: "%" },
                        { key: "scale", label: "Size", min: 0.15, max: 1.5, step: 0.05, unit: "x" },
                      ] as const
                    ).map((item) => (
                      <div key={item.key}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[#9FB3D9]">{item.label}</span>
                          <span className="font-mono tabular-nums text-[#00E5FF]">
                            {selectedOverlayCue[item.key]}
                            {item.unit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={item.min}
                          max={item.max}
                          step={item.step}
                          value={selectedOverlayCue[item.key]}
                          onChange={(e) =>
                            setOverlayCues((prev) =>
                              prev.map((o) =>
                                o.id === selectedOverlayCue.id
                                  ? { ...o, [item.key]: Number(e.target.value) }
                                  : o
                              )
                            )
                          }
                          className="w-full accent-[#00E5FF]"
                        />
                      </div>
                    ))}
                  </>
                )}
              </section>
            ) : selectedBgCue ? (
              <section className="space-y-4 pb-5 border-b border-[#1A2B56]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#F0F6FF]">
                    Background Scene Controls
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setBgCues((prev) =>
                        prev.map((c) =>
                          c.id === selectedBgCue.id
                            ? {
                                ...c,
                                adjustments: { ...DEFAULT_ADJUSTMENTS },
                                caption: { ...DEFAULT_CAPTION },
                              }
                            : c
                        )
                      )
                    }
                    className="text-xs text-[#00E5FF] hover:underline"
                  >
                    Reset scene
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-[#9FB3D9] mb-1">
                    Background Image (Swap Anytime)
                  </label>
                  <select
                    value={selectedBgCue.assetId}
                    onChange={(e) =>
                      setBgCues((prev) =>
                        prev.map((c) =>
                          c.id === selectedBgCue.id ? { ...c, assetId: e.target.value } : c
                        )
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF]"
                  >
                    {backgrounds.map((bg) => (
                      <option key={bg.id} value={bg.id}>
                        {bg.name}
                      </option>
                    ))}
                  </select>
                </div>

                {renderTimeRangeInputs(
                  selectedBgCue.startSec,
                  selectedBgCue.endSec,
                  (v) =>
                    setBgCues((prev) =>
                      prev.map((c) => (c.id === selectedBgCue.id ? { ...c, startSec: v } : c))
                    ),
                  (v) =>
                    setBgCues((prev) =>
                      prev.map((c) => (c.id === selectedBgCue.id ? { ...c, endSec: v } : c))
                    )
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9FB3D9]">Rotate Background</span>
                  <button
                    type="button"
                    onClick={() =>
                      setBgCues((prev) =>
                        prev.map((c) =>
                          c.id === selectedBgCue.id
                            ? {
                                ...c,
                                adjustments: {
                                  ...c.adjustments,
                                  rotation: (c.adjustments.rotation + 90) % 360,
                                },
                              }
                            : c
                        )
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#F0F6FF] bg-[#070B1A] border border-[#1E356B] hover:border-[#00E5FF] rounded-md"
                  >
                    <RotateCw className="w-3 h-3 text-[#00E5FF]" />
                    <span className="font-mono">{selectedBgCue.adjustments.rotation}°</span>
                  </button>
                </div>

                {(
                  [
                    { key: "brightness", label: "Brightness", min: 50, max: 160, unit: "%" },
                    { key: "contrast", label: "Contrast", min: 50, max: 160, unit: "%" },
                    { key: "saturation", label: "Saturation", min: 0, max: 200, unit: "%" },
                    { key: "warmth", label: "Warmth", min: 0, max: 100, unit: "%" },
                    { key: "grayscale", label: "Black & White", min: 0, max: 100, unit: "%" },
                    { key: "blur", label: "Background Blur", min: 0, max: 12, unit: "px" },
                    { key: "zoom", label: "Zoom", min: 1, max: 2.2, step: 0.05, unit: "x" },
                  ] as const
                ).map((item) => {
                  const val = selectedBgCue.adjustments[item.key];
                  return (
                    <div key={item.key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[#9FB3D9]">{item.label}</span>
                        <span className="font-mono tabular-nums text-[#00E5FF]">
                          {val}
                          {item.unit}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={item.min}
                        max={item.max}
                        step={"step" in item ? item.step : 1}
                        value={val}
                        onChange={(e) =>
                          setBgCues((prev) =>
                            prev.map((c) =>
                              c.id === selectedBgCue.id
                                ? {
                                    ...c,
                                    adjustments: {
                                      ...c.adjustments,
                                      [item.key]: Number(e.target.value),
                                    },
                                  }
                                : c
                            )
                          )
                        }
                        className="w-full accent-[#00E5FF]"
                      />
                    </div>
                  );
                })}

                <div className="pt-2 border-t border-[#1A2B56] space-y-2">
                  <label className="block text-xs font-semibold text-[#F0F6FF]">
                    Scene Caption (English or Amharic)
                  </label>
                  <input
                    type="text"
                    value={selectedBgCue.caption.text}
                    onChange={(e) =>
                      setBgCues((prev) =>
                        prev.map((c) =>
                          c.id === selectedBgCue.id
                            ? { ...c, caption: { ...c.caption, text: e.target.value } }
                            : c
                        )
                      )
                    }
                    placeholder="Type overlay text..."
                    className="w-full px-3 py-2 text-xs font-ethiopic bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF]"
                  />
                  <div className="flex items-center gap-1 p-0.5 bg-[#070B1A] border border-[#1E356B] rounded-md">
                    {(["top", "center", "bottom"] as CaptionPosition[]).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() =>
                          setBgCues((prev) =>
                            prev.map((c) =>
                              c.id === selectedBgCue.id
                                ? { ...c, caption: { ...c.caption, position: pos } }
                                : c
                            )
                          )
                        }
                        className={`flex-1 py-1 text-[11px] capitalize rounded ${
                          selectedBgCue.caption.position === pos
                            ? "bg-[#1D4ED8] text-[#F0F6FF] font-medium"
                            : "text-[#9FB3D9]"
                        }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {/* Match Text Lines to Spoken Audio Section */}
            <section className="space-y-2.5 pb-5 border-b border-[#1A2B56]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#00E5FF]">
                  <TypeIcon className="w-3.5 h-3.5" />
                  <span>Match Spoken Audio to Text</span>
                </div>
                {parsedScriptLines.length > 0 && (
                  <span className="text-[10px] font-mono text-[#9FB3D9]">
                    Next: #{clamp(nextLineIndex, 0, parsedScriptLines.length - 1) + 1}/{parsedScriptLines.length}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#9FB3D9]">
                Paste lines your audio says (one per line). Play your audio and click{" "}
                <strong className="text-[#F0F6FF]">Drop Next Line</strong> as each phrase is spoken!
              </p>
              <textarea
                rows={3}
                value={scriptText}
                onChange={(e) => {
                  setScriptText(e.target.value);
                  setNextLineIndex(0);
                }}
                placeholder={"Line 1: Welcome everyone!\nLine 2: Look what happens next...\nLine 3: Don't forget to subscribe!"}
                className="w-full px-3 py-2 text-xs font-ethiopic bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF] placeholder:text-[#647BA8] focus:outline-none focus:border-[#00E5FF]"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={parsedScriptLines.length === 0}
                  onClick={handleDropNextScriptLine}
                  className="flex-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#040B1A] bg-[#00E5FF] hover:bg-[#38EEFF] disabled:opacity-40 rounded-lg transition-colors"
                >
                  Drop Next Line at {round1(playheadSec)}s
                </button>
                <button
                  type="button"
                  disabled={parsedScriptLines.length === 0}
                  onClick={handleSpreadScriptAcrossAudio}
                  className="px-2.5 py-1.5 text-[11px] font-medium text-[#BFDBFE] bg-[#0F1B3D] border border-[#243B73] hover:border-[#00E5FF] disabled:opacity-40 rounded-lg transition-colors"
                >
                  Auto-Spread All
                </button>
              </div>
            </section>

            {/* Audio Speed & Pitch Effects Section */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#38BDF8]">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Audio Speed &amp; Pitch Effects</span>
                </div>
                {rawAudio && (
                  <button
                    type="button"
                    onClick={() => setAudioEffects({ ...DEFAULT_AUDIO_EFFECTS })}
                    className="text-[11px] text-[#9FB3D9] hover:text-[#00E5FF]"
                  >
                    Reset FX
                  </button>
                )}
              </div>

              {!rawAudio ? (
                <p className="text-xs text-[#647BA8]">
                  Attach an audio file to adjust speed (fast/slow) and pitch (high/deep), or add
                  timed sound effects at specific seconds.
                </p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#9FB3D9]">Master Speed</span>
                      <span className="font-mono tabular-nums text-[#00E5FF]">
                        {audioEffects.baseSpeed.toFixed(2)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      value={audioEffects.baseSpeed}
                      onChange={(e) =>
                        setAudioEffects((prev) => ({
                          ...prev,
                          baseSpeed: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-[#00E5FF]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#9FB3D9]">Master Pitch</span>
                      <span className="font-mono tabular-nums text-[#00E5FF]">
                        {audioEffects.basePitchSemitones > 0 ? "+" : ""}
                        {audioEffects.basePitchSemitones} st
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={audioEffects.basePitchSemitones}
                      onChange={(e) =>
                        setAudioEffects((prev) => ({
                          ...prev,
                          basePitchSemitones: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-[#00E5FF]"
                    />
                  </div>

                  <div className="pt-2 space-y-2">
                    <span className="block text-[11px] font-medium text-[#F0F6FF]">
                      Timed Speed / Pitch Segments
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => addAudioEffectSegment("Fast Burst", 1.65, 2)}
                        className="px-2 py-1 text-[11px] font-medium text-[#BFDBFE] bg-[#0F1B3D] border border-[#1E356B] hover:border-[#00E5FF] hover:text-[#00E5FF] rounded"
                      >
                        + Fast 1.65x
                      </button>
                      <button
                        type="button"
                        onClick={() => addAudioEffectSegment("Slow-Mo", 0.65, -2)}
                        className="px-2 py-1 text-[11px] font-medium text-[#BFDBFE] bg-[#0F1B3D] border border-[#1E356B] hover:border-[#00E5FF] hover:text-[#00E5FF] rounded"
                      >
                        + Slow 0.65x
                      </button>
                      <button
                        type="button"
                        onClick={() => addAudioEffectSegment("High Pitch", 1.15, 6)}
                        className="px-2 py-1 text-[11px] font-medium text-[#BFDBFE] bg-[#0F1B3D] border border-[#1E356B] hover:border-[#00E5FF] hover:text-[#00E5FF] rounded"
                      >
                        + High +6st
                      </button>
                      <button
                        type="button"
                        onClick={() => addAudioEffectSegment("Deep Voice", 0.9, -6)}
                        className="px-2 py-1 text-[11px] font-medium text-[#BFDBFE] bg-[#0F1B3D] border border-[#1E356B] hover:border-[#00E5FF] hover:text-[#00E5FF] rounded"
                      >
                        + Deep -6st
                      </button>
                    </div>

                    {audioEffects.segments.map((seg: AudioEffectSegment) => (
                      <div
                        key={seg.id}
                        className="p-2.5 rounded-lg bg-[#070B1A] border border-[#1E356B] space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-[#38BDF8] truncate">
                            {seg.label}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setAudioEffects((prev) => ({
                                ...prev,
                                segments: prev.segments.filter((s) => s.id !== seg.id),
                              }))
                            }
                            aria-label="Remove FX segment"
                            className="text-[#647BA8] hover:text-[#FB7185]"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>

                        {renderTimeRangeInputs(
                          seg.startSec,
                          seg.endSec,
                          (v) =>
                            setAudioEffects((prev) => ({
                              ...prev,
                              segments: prev.segments.map((s) =>
                                s.id === seg.id ? { ...s, startSec: v } : s
                              ),
                            })),
                          (v) =>
                            setAudioEffects((prev) => ({
                              ...prev,
                              segments: prev.segments.map((s) =>
                                s.id === seg.id ? { ...s, endSec: v } : s
                              ),
                            }))
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="flex justify-between text-[10px] text-[#9FB3D9]">
                              <span>Speed</span>
                              <span className="font-mono text-[#00E5FF]">{seg.speed}x</span>
                            </div>
                            <input
                              type="range"
                              min={0.5}
                              max={2.0}
                              step={0.05}
                              value={seg.speed}
                              onChange={(e) =>
                                setAudioEffects((prev) => ({
                                  ...prev,
                                  segments: prev.segments.map((s) =>
                                    s.id === seg.id ? { ...s, speed: Number(e.target.value) } : s
                                  ),
                                }))
                              }
                              className="w-full accent-[#00E5FF]"
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-[10px] text-[#9FB3D9]">
                              <span>Pitch</span>
                              <span className="font-mono text-[#00E5FF]">
                                {seg.pitchSemitones > 0 ? "+" : ""}
                                {seg.pitchSemitones}st
                              </span>
                            </div>
                            <input
                              type="range"
                              min={-12}
                              max={12}
                              step={1}
                              value={seg.pitchSemitones}
                              onChange={(e) =>
                                setAudioEffects((prev) => ({
                                  ...prev,
                                  segments: prev.segments.map((s) =>
                                    s.id === seg.id
                                      ? { ...s, pitchSemitones: Number(e.target.value) }
                                      : s
                                  ),
                                }))
                              }
                              className="w-full accent-[#00E5FF]"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: CAST & ASSETS MANAGER */}
        {railTab === "assets" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[#00E5FF]">
                  Backgrounds ({backgrounds.length})
                </h3>
                <button
                  type="button"
                  onClick={() => bgInputRef.current?.click()}
                  className="text-xs text-[#BFDBFE] hover:text-[#00E5FF]"
                >
                  + Upload
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {backgrounds.map((bg) => (
                  <div
                    key={bg.id}
                    className="p-1.5 rounded-lg bg-[#070B1A] border border-[#1E356B] space-y-1.5"
                  >
                    <img
                      src={bg.dataUrl}
                      alt={bg.name}
                      className="w-full h-16 object-cover rounded"
                    />
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-[#F0F6FF] truncate">{bg.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setBackgrounds((prev) => prev.filter((b) => b.id !== bg.id));
                          setBgCues((prev) => prev.filter((c) => c.assetId !== bg.id));
                        }}
                        aria-label="Delete background asset"
                        className="text-[#647BA8] hover:text-[#FB7185]"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="pt-4 border-t border-[#1A2B56] space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[#38BDF8]">
                  Character Expressions ({expressions.length})
                </h3>
                <button
                  type="button"
                  onClick={() => exprInputRef.current?.click()}
                  className="text-xs text-[#BFDBFE] hover:text-[#00E5FF]"
                >
                  + Upload
                </button>
              </div>
              <div className="space-y-2">
                {expressions.map((expr) => (
                  <div
                    key={expr.id}
                    className="p-2 rounded-lg bg-[#070B1A] border border-[#1E356B] flex items-center gap-2.5"
                  >
                    <img
                      src={expr.dataUrl}
                      alt={expr.name}
                      className="w-10 h-10 object-contain rounded bg-[#03050F] shrink-0"
                    />
                    <input
                      type="text"
                      value={expr.name}
                      onChange={(e) =>
                        setExpressions((prev) =>
                          prev.map((item) =>
                            item.id === expr.id ? { ...item, name: e.target.value } : item
                          )
                        )
                      }
                      aria-label="Expression name"
                      className="flex-1 min-w-0 px-2 py-1 text-xs bg-[#0B1124] border border-[#1E356B] rounded text-[#F0F6FF]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setExpressions((prev) => prev.filter((e) => e.id !== expr.id));
                        setCharCues((prev) => prev.filter((c) => c.expressionId !== expr.id));
                      }}
                      aria-label="Delete expression"
                      className="text-[#647BA8] hover:text-[#FB7185]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="pt-4 border-t border-[#1A2B56] space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[#60A5FA]">
                  Extra Images ({overlayAssets.length})
                </h3>
                <button
                  type="button"
                  onClick={() => overlayInputRef.current?.click()}
                  className="text-xs text-[#BFDBFE] hover:text-[#00E5FF]"
                >
                  + Upload
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {overlayAssets.map((ov) => (
                  <div
                    key={ov.id}
                    className="p-1.5 rounded-lg bg-[#070B1A] border border-[#1E356B] space-y-1.5"
                  >
                    <img
                      src={ov.dataUrl}
                      alt={ov.name}
                      className="w-full h-16 object-cover rounded"
                    />
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-[#F0F6FF] truncate">{ov.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setOverlayAssets((prev) => prev.filter((o) => o.id !== ov.id));
                          setOverlayCues((prev) => prev.filter((c) => c.assetId !== ov.id));
                        }}
                        aria-label="Delete extra image"
                        className="text-[#647BA8] hover:text-[#FB7185]"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: AI ASSISTANT CHAT */}
        {railTab === "chat" && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[90%] px-3.5 py-2.5 rounded-xl text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-[#2563EB] text-[#F0F6FF] shadow-[0_0_14px_rgba(37,99,235,0.4)]"
                        : "bg-[#0F1B3D] text-[#E2E8F0] border border-[#1E356B]"
                    }`}
                  >
                    <p>{msg.text}</p>
                    {msg.actions && msg.actions.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#00E5FF]/20 space-y-1 text-[11px] text-[#00E5FF] font-medium">
                        {msg.actions.map((act, i) => (
                          <div key={i}>• {act}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isAssistantBusy && (
                <div className="flex items-center gap-2 text-xs text-[#38BDF8]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00E5FF]" />
                  <span>Editing your video...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="px-3 py-2 border-t border-[#1A2B56] bg-[#070B1A] flex flex-wrap gap-1.5">
              {[
                "Add speech bubble saying Let's go! at 0s-3s",
                "Add subtitle Welcome to the show at 0s-3s",
                "Move character to right & switch expression",
                "Speed up audio 1.5x at 2s-4s",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={isAssistantBusy || !hasAnyVisuals}
                  onClick={() => handleSendChat(suggestion)}
                  className="px-2 py-1 text-[11px] font-medium text-[#BFDBFE] bg-[#0F1B3D] border border-[#1E356B] hover:border-[#00E5FF] hover:text-[#00E5FF] disabled:opacity-40 rounded transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendChat();
              }}
              className="p-3 border-t border-[#1A2B56] bg-[#0B1124] flex items-center gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask AI for bubbles, subtitles, character, audio FX..."
                disabled={isAssistantBusy}
                className="flex-1 px-3 py-2 text-xs bg-[#070B1A] border border-[#1E356B] rounded-lg text-[#F0F6FF] placeholder:text-[#647BA8] focus:outline-none focus:border-[#00E5FF]"
              />
              <button
                type="submit"
                disabled={isAssistantBusy || !chatInput.trim()}
                aria-label="Send instruction"
                className="w-9 h-9 rounded-lg bg-[#00E5FF] hover:bg-[#38EEFF] disabled:opacity-40 text-[#040B1A] flex items-center justify-center shrink-0 transition-colors shadow-[0_0_14px_rgba(0,229,255,0.35)]"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </aside>
    </div>
  );
}
