export type AspectRatioId = "16:9" | "9:16" | "1:1" | "4:5";
export type TransitionType = "crossfade" | "cut" | "ken-burns";
export type ImageFitMode = "cover" | "contain";
export type CaptionPosition = "top" | "center" | "bottom";

export type ShapeType =
  | "speech-bubble"
  | "thought-bubble"
  | "callout"
  | "rectangle"
  | "circle"
  | "arrow"
  | "star";

export type TailDirection = "bottom-left" | "bottom-right" | "top-left" | "top-right";

export interface ImageAdjustments {
  brightness: number; // 50 to 160 (default 100)
  contrast: number; // 50 to 160 (default 100)
  saturation: number; // 0 to 200 (default 100)
  warmth: number; // 0 to 100 sepia/warm tint (default 0)
  grayscale: number; // 0 to 100 (default 0)
  blur: number; // 0 to 12 px (default 0)
  vignette: number; // 0 to 100 (default 0)
  zoom: number; // 1 to 2.2 (default 1)
  rotation: number; // 0, 90, 180, 270
  offsetX: number; // -50 to 50 %
  offsetY: number; // -50 to 50 %
}

export interface SlideCaption {
  text: string;
  position: CaptionPosition;
  color: string;
  showBackdrop: boolean;
}

export interface SlideItem {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  durationSec: number;
  adjustments: ImageAdjustments;
  caption: SlideCaption;
}

export interface MediaAsset {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface BackgroundCue {
  id: string;
  assetId: string;
  startSec: number;
  endSec: number;
  adjustments: ImageAdjustments;
  caption: SlideCaption;
}

export interface CharacterCue {
  id: string;
  expressionId: string;
  startSec: number;
  endSec: number;
  x: number; // 0 to 100 %
  y: number; // 0 to 100 %
  scale: number; // 0.15 to 2.0
  flipX: boolean;
  rotation: number;
  opacity: number; // 0 to 100
}

export interface OverlayCue {
  id: string;
  assetId: string;
  startSec: number;
  endSec: number;
  mode: "overlay" | "fullscreen";
  x: number; // 0 to 100 %
  y: number; // 0 to 100 %
  scale: number; // 0.15 to 1.8
  rotation: number;
  opacity: number; // 0 to 100
  adjustments: ImageAdjustments;
  caption: SlideCaption;
}

export interface ShapeCue {
  id: string;
  kind: ShapeType;
  startSec: number;
  endSec: number;
  x: number; // 0 to 100 % center
  y: number; // 0 to 100 % center
  widthPct: number; // 8 to 80 % of canvas width
  heightPct: number; // 6 to 70 % of canvas height
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  text: string;
  textColor: string;
  tailDirection: TailDirection;
  rotation: number;
  opacity: number; // 10 to 100
}

export interface TextCue {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  x: number; // 0 to 100 %
  y: number; // 0 to 100 %
  fontSize: number; // 20 to 90 px at 720p reference
  color: string;
  bgColor: string;
  showBackdrop: boolean;
}

export interface DrawingStroke {
  id: string;
  points: Array<{ x: number; y: number }>; // normalized 0..100 %
  color: string;
  size: number; // 2 to 28 px
  tool: "pen" | "highlighter";
  startSec: number;
  endSec: number;
}

export interface AudioEffectSegment {
  id: string;
  label: string;
  startSec: number;
  endSec: number;
  speed: number; // 0.5 to 2.0
  pitchSemitones: number; // -12 to +12
}

export interface AudioEffectSettings {
  baseSpeed: number;
  basePitchSemitones: number;
  segments: AudioEffectSegment[];
}

export interface AudioTrack {
  id: string;
  title: string;
  sourceLabel: string;
  blobUrl: string;
  rawBuffer: AudioBuffer;
  processedBuffer: AudioBuffer;
  rawDurationSec: number;
  durationSec: number;
}

export interface LibraryAudioClip {
  id: string;
  title: string;
  voiceLabel: string;
  durationSec: number;
  audioBase64: string;
  mimeType: string;
}

export interface AssistantToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface StudioChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions?: string[];
}

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  grayscale: 0,
  blur: 0,
  vignette: 0,
  zoom: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
};

export const DEFAULT_CAPTION: SlideCaption = {
  text: "",
  position: "bottom",
  color: "#FFFFFF",
  showBackdrop: true,
};

export const DEFAULT_AUDIO_EFFECTS: AudioEffectSettings = {
  baseSpeed: 1,
  basePitchSemitones: 0,
  segments: [],
};

export const ASPECT_RATIO_DIMENSIONS: Record<
  AspectRatioId,
  { label: string; width: number; height: number }
> = {
  "16:9": { label: "16:9 Landscape", width: 1280, height: 720 },
  "9:16": { label: "9:16 Vertical", width: 720, height: 1280 },
  "1:1": { label: "1:1 Square", width: 1080, height: 1080 },
  "4:5": { label: "4:5 Portrait", width: 864, height: 1080 },
};
