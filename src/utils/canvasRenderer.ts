import type {
  BackgroundCue,
  CharacterCue,
  DrawingStroke,
  ImageAdjustments,
  ImageFitMode,
  OverlayCue,
  ShapeCue,
  SlideCaption,
  TextCue,
  TransitionType,
} from "../types/mediaStudio";

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image."));
    img.src = src;
  });
}

export function buildFilterString(adj: ImageAdjustments): string {
  const parts = [
    `brightness(${adj.brightness}%)`,
    `contrast(${adj.contrast}%)`,
    `saturate(${adj.saturation}%)`,
  ];
  if (adj.warmth > 0) parts.push(`sepia(${adj.warmth}%)`);
  if (adj.grayscale > 0) parts.push(`grayscale(${adj.grayscale}%)`);
  if (adj.blur > 0) parts.push(`blur(${adj.blur}px)`);
  return parts.join(" ");
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxLineW: number
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let currentLine = "";
    for (const w of words) {
      const test = currentLine ? `${currentLine} ${w}` : w;
      if (ctx.measureText(test).width > maxLineW && currentLine) {
        lines.push(currentLine);
        currentLine = w;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

function drawFullFrameLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  adj: ImageAdjustments,
  canvasW: number,
  canvasH: number,
  imageFit: ImageFitMode,
  alpha: number,
  kenBurnsProgress: number,
  enableKenBurns: boolean
) {
  if (alpha <= 0.001) return;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  const rotRad = (adj.rotation * Math.PI) / 180;
  const rotatedDims = adj.rotation % 180 !== 0;
  const srcW = rotatedDims ? img.naturalHeight || img.height : img.naturalWidth || img.width;
  const srcH = rotatedDims ? img.naturalWidth || img.width : img.naturalHeight || img.height;

  if (imageFit === "contain") {
    ctx.save();
    ctx.filter = "blur(26px) brightness(50%)";
    const bgScale = Math.max(canvasW / srcW, canvasH / srcH) * 1.1;
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.rotate(rotRad);
    ctx.drawImage(
      img,
      (-img.naturalWidth * bgScale) / 2,
      (-img.naturalHeight * bgScale) / 2,
      img.naturalWidth * bgScale,
      img.naturalHeight * bgScale
    );
    ctx.restore();
  }

  ctx.save();
  ctx.filter = buildFilterString(adj);

  const baseScale =
    imageFit === "cover"
      ? Math.max(canvasW / srcW, canvasH / srcH)
      : Math.min(canvasW / srcW, canvasH / srcH);

  const dynamicZoom = enableKenBurns ? 1 + 0.08 * kenBurnsProgress : 1;
  const finalScale = baseScale * adj.zoom * dynamicZoom;

  const panX = (adj.offsetX / 100) * canvasW;
  const panY = (adj.offsetY / 100) * canvasH;

  ctx.translate(canvasW / 2 + panX, canvasH / 2 + panY);
  ctx.rotate(rotRad);
  ctx.drawImage(
    img,
    (-img.naturalWidth * finalScale) / 2,
    (-img.naturalHeight * finalScale) / 2,
    img.naturalWidth * finalScale,
    img.naturalHeight * finalScale
  );
  ctx.restore();

  if (adj.vignette > 0) {
    const strength = (adj.vignette / 100) * 0.78;
    const grad = ctx.createRadialGradient(
      canvasW / 2,
      canvasH / 2,
      Math.min(canvasW, canvasH) * 0.28,
      canvasW / 2,
      canvasH / 2,
      Math.max(canvasW, canvasH) * 0.72
    );
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  ctx.restore();
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  caption: SlideCaption,
  canvasW: number,
  canvasH: number
) {
  const captionText = caption.text.trim();
  if (!captionText) return;

  ctx.save();
  const fontSize = Math.round(Math.max(24, Math.min(canvasW, canvasH) * 0.052));
  ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", "Noto Sans Ethiopic", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapTextLines(ctx, captionText, canvasW * 0.84);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const lineHeight = fontSize * 1.35;
  const blockH = lines.length * lineHeight + fontSize * 0.7;
  let centerY = canvasH * 0.85;
  if (caption.position === "top") centerY = canvasH * 0.14;
  if (caption.position === "center") centerY = canvasH * 0.5;

  if (caption.showBackdrop) {
    const boxW = Math.min(
      canvasW * 0.9,
      Math.max(...lines.map((l) => ctx.measureText(l).width)) + fontSize * 1.4
    );
    const boxX = (canvasW - boxW) / 2;
    const boxY = centerY - blockH / 2;
    ctx.fillStyle = "rgba(5, 8, 22, 0.78)";
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, blockH, 12);
    ctx.fill();
  }

  ctx.fillStyle = caption.color || "#FFFFFF";
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 8;
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, idx) => {
    ctx.fillText(line, canvasW / 2, startY + idx * lineHeight);
  });
  ctx.restore();
}

function drawPositionedSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  opts: {
    xPct: number;
    yPct: number;
    scale: number;
    flipX?: boolean;
    rotation?: number;
    opacity?: number;
    filterStr?: string;
    isSelected?: boolean;
  },
  canvasW: number,
  canvasH: number
) {
  const natW = img.naturalWidth || img.width || 400;
  const natH = img.naturalHeight || img.height || 400;
  const targetH = canvasH * opts.scale;
  const targetW = targetH * (natW / natH);
  const cx = (opts.xPct / 100) * canvasW;
  const cy = (opts.yPct / 100) * canvasH;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, (opts.opacity ?? 100) / 100));
  if (opts.filterStr) {
    ctx.filter = opts.filterStr;
  }
  ctx.translate(cx, cy);
  if (opts.rotation) {
    ctx.rotate((opts.rotation * Math.PI) / 180);
  }
  if (opts.flipX) {
    ctx.scale(-1, 1);
  }

  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 18;
  ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
  ctx.restore();

  if (opts.isSelected) {
    ctx.save();
    ctx.translate(cx, cy);
    if (opts.rotation) {
      ctx.rotate((opts.rotation * Math.PI) / 180);
    }
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = Math.max(2, Math.round(canvasW * 0.003));
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(-targetW / 2 - 4, -targetH / 2 - 4, targetW + 8, targetH + 8);
    ctx.restore();
  }
}

function drawDrawingStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: DrawingStroke[],
  timeSec: number,
  canvasW: number,
  canvasH: number
) {
  const active = strokes.filter(
    (s) => timeSec >= s.startSec && timeSec < s.endSec && s.points.length > 0
  );
  if (active.length === 0) return;

  const scaleFactor = canvasW / 1280;
  for (const s of active) {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, s.size * scaleFactor);
    ctx.globalAlpha = s.tool === "highlighter" ? 0.42 : 0.96;

    if (s.points.length === 1) {
      const px = (s.points[0].x / 100) * canvasW;
      const py = (s.points[0].y / 100) * canvasH;
      ctx.beginPath();
      ctx.arc(px, py, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    ctx.beginPath();
    const firstX = (s.points[0].x / 100) * canvasW;
    const firstY = (s.points[0].y / 100) * canvasH;
    ctx.moveTo(firstX, firstY);

    for (let i = 1; i < s.points.length - 1; i++) {
      const curX = (s.points[i].x / 100) * canvasW;
      const curY = (s.points[i].y / 100) * canvasH;
      const nextX = (s.points[i + 1].x / 100) * canvasW;
      const nextY = (s.points[i + 1].y / 100) * canvasH;
      ctx.quadraticCurveTo(curX, curY, (curX + nextX) / 2, (curY + nextY) / 2);
    }

    const lastPt = s.points[s.points.length - 1];
    ctx.lineTo((lastPt.x / 100) * canvasW, (lastPt.y / 100) * canvasH);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSpeechBubblePath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tailDirection: ShapeCue["tailDirection"]
) {
  const left = -w / 2;
  const top = -h / 2;
  const right = w / 2;
  const bottom = h / 2;
  const r = Math.min(24, w * 0.14, h * 0.24);
  const tailW = Math.min(28, w * 0.16);
  const tailH = Math.min(30, h * 0.34);

  ctx.beginPath();
  // Start top-left corner after radius
  ctx.moveTo(left + r, top);

  if (tailDirection === "top-left") {
    ctx.lineTo(left + r + w * 0.12, top);
    ctx.lineTo(left + r + w * 0.04, top - tailH);
    ctx.lineTo(left + r + w * 0.12 + tailW, top);
  } else if (tailDirection === "top-right") {
    ctx.lineTo(right - r - w * 0.12 - tailW, top);
    ctx.lineTo(right - r - w * 0.04, top - tailH);
    ctx.lineTo(right - r - w * 0.12, top);
  }

  ctx.lineTo(right - r, top);
  ctx.quadraticCurveTo(right, top, right, top + r);
  ctx.lineTo(right, bottom - r);
  ctx.quadraticCurveTo(right, bottom, right - r, bottom);

  if (tailDirection === "bottom-right") {
    ctx.lineTo(right - r - w * 0.1, bottom);
    ctx.lineTo(right - r - w * 0.02, bottom + tailH);
    ctx.lineTo(right - r - w * 0.1 - tailW, bottom);
  } else if (tailDirection === "bottom-left") {
    ctx.lineTo(left + r + w * 0.1 + tailW, bottom);
    ctx.lineTo(left + r + w * 0.02, bottom + tailH);
    ctx.lineTo(left + r + w * 0.1, bottom);
  }

  ctx.lineTo(left + r, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - r);
  ctx.lineTo(left, top + r);
  ctx.quadraticCurveTo(left, top, left + r, top);
  ctx.closePath();
}

function drawShapeCue(
  ctx: CanvasRenderingContext2D,
  cue: ShapeCue,
  canvasW: number,
  canvasH: number,
  isSelected: boolean
) {
  const cx = (cue.x / 100) * canvasW;
  const cy = (cue.y / 100) * canvasH;
  const w = Math.max(40, (cue.widthPct / 100) * canvasW);
  const h = Math.max(32, (cue.heightPct / 100) * canvasH);
  const strokeW = Math.max(1, cue.strokeWidth * (canvasW / 1280));

  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, cue.opacity / 100));
  ctx.translate(cx, cy);
  if (cue.rotation) {
    ctx.rotate((cue.rotation * Math.PI) / 180);
  }

  ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
  ctx.shadowBlur = 14;
  ctx.fillStyle = cue.fillColor;
  ctx.strokeStyle = cue.strokeColor;
  ctx.lineWidth = strokeW;

  if (cue.kind === "speech-bubble") {
    drawSpeechBubblePath(ctx, w, h, cue.tailDirection);
    ctx.fill();
    if (strokeW > 0) ctx.stroke();
  } else if (cue.kind === "thought-bubble") {
    const lobes = [
      { x: -w * 0.25, y: -h * 0.14, rx: w * 0.28, ry: h * 0.34 },
      { x: 0, y: -h * 0.24, rx: w * 0.32, ry: h * 0.36 },
      { x: w * 0.25, y: -h * 0.12, rx: w * 0.26, ry: h * 0.32 },
      { x: w * 0.22, y: h * 0.18, rx: w * 0.26, ry: h * 0.3 },
      { x: -w * 0.2, y: h * 0.18, rx: w * 0.28, ry: h * 0.3 },
      { x: 0, y: h * 0.12, rx: w * 0.34, ry: h * 0.34 },
    ];
    // Stroke pass then clean fill pass so lobes merge seamlessly
    if (strokeW > 0) {
      for (const lb of lobes) {
        ctx.beginPath();
        ctx.ellipse(lb.x, lb.y, lb.rx + strokeW, lb.ry + strokeW, 0, 0, Math.PI * 2);
        ctx.fillStyle = cue.strokeColor;
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = cue.fillColor;
    for (const lb of lobes) {
      ctx.beginPath();
      ctx.ellipse(lb.x, lb.y, lb.rx, lb.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Trailing thought dots
    const isBottom = cue.tailDirection.startsWith("bottom");
    const isLeft = cue.tailDirection.endsWith("left");
    const signX = isLeft ? -1 : 1;
    const signY = isBottom ? 1 : -1;
    const dots = [
      { x: signX * w * 0.28, y: signY * (h * 0.56), r: Math.max(6, Math.min(w, h) * 0.085) },
      { x: signX * w * 0.38, y: signY * (h * 0.74), r: Math.max(4, Math.min(w, h) * 0.055) },
    ];
    for (const d of dots) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      if (strokeW > 0) ctx.stroke();
    }
  } else if (cue.kind === "callout") {
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 14);
    ctx.fill();
    if (strokeW > 0) ctx.stroke();
    // Accent bar on left edge
    ctx.fillStyle = cue.strokeColor;
    ctx.beginPath();
    ctx.roundRect(-w / 2 + 6, -h / 2 + 8, 6, Math.max(12, h - 16), 3);
    ctx.fill();
  } else if (cue.kind === "circle") {
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (strokeW > 0) ctx.stroke();
  } else if (cue.kind === "arrow") {
    const shaftH = h * 0.36;
    const headX = w * 0.14;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -shaftH / 2);
    ctx.lineTo(headX, -shaftH / 2);
    ctx.lineTo(headX, -h / 2);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(headX, h / 2);
    ctx.lineTo(headX, shaftH / 2);
    ctx.lineTo(-w / 2, shaftH / 2);
    ctx.closePath();
    ctx.fill();
    if (strokeW > 0) ctx.stroke();
  } else if (cue.kind === "star") {
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR * 0.45;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    if (strokeW > 0) ctx.stroke();
  } else {
    // Rectangle
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 10);
    ctx.fill();
    if (strokeW > 0) ctx.stroke();
  }

  // Optional Text Inside Bubble / Shape
  const innerText = cue.text.trim();
  if (innerText) {
    ctx.shadowBlur = 0;
    const textMaxW = Math.max(30, w * 0.78);
    let fontSize = Math.max(15, Math.min(40, Math.round(h * 0.25)));
    ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", "Noto Sans Ethiopic", sans-serif`;
    let lines = wrapTextLines(ctx, innerText, textMaxW);
    while (lines.length * fontSize * 1.2 > h * 0.76 && fontSize > 13) {
      fontSize -= 2;
      ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", "Noto Sans Ethiopic", sans-serif`;
      lines = wrapTextLines(ctx, innerText, textMaxW);
    }
    ctx.fillStyle = cue.textColor || "#050816";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lineH = fontSize * 1.22;
    const startY = -((lines.length - 1) * lineH) / 2;
    lines.forEach((line, idx) => {
      ctx.fillText(line, 0, startY + idx * lineH);
    });
  }

  ctx.restore();

  if (isSelected) {
    ctx.save();
    ctx.translate(cx, cy);
    if (cue.rotation) {
      ctx.rotate((cue.rotation * Math.PI) / 180);
    }
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = Math.max(2, Math.round(canvasW * 0.003));
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
    ctx.restore();
  }
}

function drawTextCue(
  ctx: CanvasRenderingContext2D,
  cue: TextCue,
  canvasW: number,
  canvasH: number,
  isSelected: boolean
) {
  const txt = cue.text.trim();
  if (!txt) return;

  ctx.save();
  const fontSize = Math.max(18, Math.round(cue.fontSize * (canvasH / 720)));
  ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", "Noto Sans Ethiopic", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapTextLines(ctx, txt, canvasW * 0.86);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const lineHeight = fontSize * 1.3;
  const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = Math.min(canvasW * 0.92, maxLineWidth + fontSize * 1.1);
  const boxH = lines.length * lineHeight + fontSize * 0.65;
  const cx = (cue.x / 100) * canvasW;
  const cy = (cue.y / 100) * canvasH;

  if (cue.showBackdrop) {
    ctx.save();
    ctx.globalAlpha = 0.84;
    ctx.fillStyle = cue.bgColor || "#050816";
    ctx.beginPath();
    ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 12);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = Math.max(1, Math.round(canvasW * 0.0015));
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = cue.color || "#FFFFFF";
  ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
  ctx.shadowBlur = 10;
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, idx) => {
    ctx.fillText(line, cx, startY + idx * lineHeight);
  });

  if (isSelected) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = Math.max(2, Math.round(canvasW * 0.003));
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(cx - boxW / 2 - 4, cy - boxH / 2 - 4, boxW + 8, boxH + 8);
  }

  ctx.restore();
}

export interface CompositeRenderInput {
  bgCues: BackgroundCue[];
  charCues: CharacterCue[];
  overlayCues: OverlayCue[];
  shapeCues?: ShapeCue[];
  textCues?: TextCue[];
  drawingStrokes?: DrawingStroke[];
  imageCache: Map<string, HTMLImageElement>;
  timeSec: number;
  canvasW: number;
  canvasH: number;
  transition: TransitionType;
  imageFit: ImageFitMode;
  selectedCharCueId?: string | null;
  selectedOverlayCueId?: string | null;
  selectedShapeCueId?: string | null;
  selectedTextCueId?: string | null;
  showSelectionGuides?: boolean;
}

export function renderCompositeToCanvas(
  ctx: CanvasRenderingContext2D,
  input: CompositeRenderInput
): void {
  const {
    bgCues,
    charCues,
    overlayCues,
    shapeCues = [],
    textCues = [],
    drawingStrokes = [],
    imageCache,
    timeSec,
    canvasW,
    canvasH,
    transition,
    imageFit,
    selectedCharCueId,
    selectedOverlayCueId,
    selectedShapeCueId,
    selectedTextCueId,
    showSelectionGuides = false,
  } = input;

  ctx.fillStyle = "#03050F";
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 1. Background Layer
  const sortedBg = [...bgCues].sort((a, b) => a.startSec - b.startSec);
  let activeBgIndex = -1;
  for (let i = 0; i < sortedBg.length; i++) {
    if (timeSec >= sortedBg[i].startSec && timeSec < sortedBg[i].endSec) {
      activeBgIndex = i;
    }
  }
  if (activeBgIndex === -1 && sortedBg.length > 0) {
    const started = sortedBg.filter((c) => c.startSec <= timeSec);
    activeBgIndex = started.length > 0 ? sortedBg.indexOf(started[started.length - 1]) : 0;
  }

  let activeCaption: SlideCaption | null = null;

  if (activeBgIndex >= 0) {
    const curBg = sortedBg[activeBgIndex];
    const curDur = Math.max(0.5, curBg.endSec - curBg.startSec);
    const localTime = Math.max(0, timeSec - curBg.startSec);
    const progress = Math.min(1, localTime / curDur);
    const curImg = imageCache.get(curBg.assetId);
    const fadeWindow = transition === "cut" ? 0 : Math.min(0.6, curDur * 0.25);

    if (transition !== "cut" && activeBgIndex > 0 && localTime < fadeWindow) {
      const prevBg = sortedBg[activeBgIndex - 1];
      const prevImg = imageCache.get(prevBg.assetId);
      const fadeRatio = localTime / fadeWindow;
      if (prevImg) {
        drawFullFrameLayer(
          ctx,
          prevImg,
          prevBg.adjustments,
          canvasW,
          canvasH,
          imageFit,
          1 - fadeRatio,
          1,
          transition === "ken-burns"
        );
      }
      if (curImg) {
        drawFullFrameLayer(
          ctx,
          curImg,
          curBg.adjustments,
          canvasW,
          canvasH,
          imageFit,
          fadeRatio,
          progress,
          transition === "ken-burns"
        );
      }
    } else if (curImg) {
      drawFullFrameLayer(
        ctx,
        curImg,
        curBg.adjustments,
        canvasW,
        canvasH,
        imageFit,
        1,
        progress,
        transition === "ken-burns"
      );
    }

    if (curBg.caption.text.trim()) {
      activeCaption = curBg.caption;
    }
  }

  // 2. Character & Expressions Layer
  const activeChars = charCues.filter((c) => timeSec >= c.startSec && timeSec < c.endSec);
  const charToRender =
    activeChars.length > 0
      ? [activeChars[activeChars.length - 1]]
      : charCues.length > 0 && sortedBg.length === 0
        ? [charCues[0]]
        : [];

  for (const cue of charToRender) {
    const img = imageCache.get(cue.expressionId);
    if (!img) continue;
    drawPositionedSprite(
      ctx,
      img,
      {
        xPct: cue.x,
        yPct: cue.y,
        scale: cue.scale,
        flipX: cue.flipX,
        rotation: cue.rotation,
        opacity: cue.opacity,
        isSelected: showSelectionGuides && cue.id === selectedCharCueId,
      },
      canvasW,
      canvasH
    );
  }

  // 3. Timed Extra Images / Overlays Layer
  const activeOverlays = overlayCues.filter((o) => timeSec >= o.startSec && timeSec < o.endSec);
  for (const ov of activeOverlays) {
    const img = imageCache.get(ov.assetId);
    if (!img) continue;
    if (ov.mode === "fullscreen") {
      drawFullFrameLayer(
        ctx,
        img,
        ov.adjustments,
        canvasW,
        canvasH,
        imageFit,
        ov.opacity / 100,
        0.5,
        false
      );
    } else {
      drawPositionedSprite(
        ctx,
        img,
        {
          xPct: ov.x,
          yPct: ov.y,
          scale: ov.scale,
          rotation: ov.rotation,
          opacity: ov.opacity,
          filterStr: buildFilterString(ov.adjustments),
          isSelected: showSelectionGuides && ov.id === selectedOverlayCueId,
        },
        canvasW,
        canvasH
      );
    }
    if (ov.caption.text.trim()) {
      activeCaption = ov.caption;
    }
  }

  // 4. Freehand Drawing Strokes Layer
  drawDrawingStrokes(ctx, drawingStrokes, timeSec, canvasW, canvasH);

  // 5. Shapes & Text Bubbles Layer
  const activeShapes = shapeCues.filter((s) => timeSec >= s.startSec && timeSec < s.endSec);
  for (const shape of activeShapes) {
    drawShapeCue(
      ctx,
      shape,
      canvasW,
      canvasH,
      Boolean(showSelectionGuides && shape.id === selectedShapeCueId)
    );
  }

  // 6. Timed Text / Audio-Matched Subtitles Layer
  const activeTexts = textCues.filter((t) => timeSec >= t.startSec && timeSec < t.endSec);
  for (const textCue of activeTexts) {
    drawTextCue(
      ctx,
      textCue,
      canvasW,
      canvasH,
      Boolean(showSelectionGuides && textCue.id === selectedTextCueId)
    );
  }

  // Legacy Scene Caption Layer (if user typed one on a background)
  if (activeCaption) {
    drawCaption(ctx, activeCaption, canvasW, canvasH);
  }
}

export function createSampleSlideDataUrl(
  title: string,
  subtitle: string,
  bgStart: string,
  bgEnd: string,
  accent: string
): { dataUrl: string; width: number; height: number } {
  const width = 1280;
  const height = 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, bgStart);
    grad.addColorStop(1, bgEnd);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(width * 0.82, height * 0.25, 240, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(width * 0.18, height * 0.82, 180, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#F0F6FF";
    ctx.font = '700 58px "Plus Jakarta Sans", "Noto Sans Ethiopic", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, width / 2, height * 0.44);

    ctx.fillStyle = "rgba(191,219,254,0.88)";
    ctx.font = '500 28px "Plus Jakarta Sans", "Noto Sans Ethiopic", sans-serif';
    ctx.fillText(subtitle, width / 2, height * 0.56);
  }

  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

export function createDemoExpressionDataUrl(
  mood: "happy" | "surprised" | "cool",
  accentColor = "#00E5FF"
): { dataUrl: string; width: number; height: number } {
  const width = 480;
  const height = 560;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#1D4ED8";
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(90, 340, 300, 210, 75);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0B1536";
    ctx.beginPath();
    ctx.arc(240, 200, 125, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accentColor;
    if (mood === "cool") {
      ctx.beginPath();
      ctx.roundRect(150, 165, 180, 46, 14);
      ctx.fill();
      ctx.strokeStyle = "#F0F6FF";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(240, 240, 42, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else if (mood === "surprised") {
      ctx.beginPath();
      ctx.arc(192, 182, 18, 0, Math.PI * 2);
      ctx.arc(288, 182, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#F0F6FF";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(240, 255, 24, 30, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(192, 182, 14, 0, Math.PI * 2);
      ctx.arc(288, 182, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#F0F6FF";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(240, 232, 50, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    }
  }

  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

export async function exportCompositeVideo(options: {
  bgCues: BackgroundCue[];
  charCues: CharacterCue[];
  overlayCues: OverlayCue[];
  shapeCues?: ShapeCue[];
  textCues?: TextCue[];
  drawingStrokes?: DrawingStroke[];
  assetList: Array<{ id: string; dataUrl: string }>;
  processedAudioBuffer: AudioBuffer | null;
  totalDurationSec: number;
  canvasW: number;
  canvasH: number;
  transition: TransitionType;
  imageFit: ImageFitMode;
  onProgress: (pct: number) => void;
}): Promise<{ blob: Blob; mimeType: string; extension: string }> {
  const {
    bgCues,
    charCues,
    overlayCues,
    shapeCues = [],
    textCues = [],
    drawingStrokes = [],
    assetList,
    processedAudioBuffer,
    totalDurationSec,
    canvasW,
    canvasH,
    transition,
    imageFit,
    onProgress,
  } = options;

  const imageCache = new Map<string, HTMLImageElement>();
  for (const asset of assetList) {
    try {
      const img = await loadImageElement(asset.dataUrl);
      imageCache.set(asset.id, img);
    } catch {
      // Skip invalid asset
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable in this browser.");

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream(canvasStream.getVideoTracks());

  let audioCtx: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;

  if (processedAudioBuffer) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioCtx();
    const dest = audioCtx.createMediaStreamDestination();
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = processedAudioBuffer;
    audioSource.connect(dest);
    for (const track of dest.stream.getAudioTracks()) {
      combinedStream.addTrack(track);
    }
  }

  const mimeCandidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  const selectedMime =
    mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";

  const recorder = new MediaRecorder(combinedStream, {
    mimeType: selectedMime,
    videoBitsPerSecond: 3_500_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  return await new Promise((resolve, reject) => {
    let rafId = 0;
    let stopped = false;

    recorder.onerror = () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      audioCtx?.close().catch(() => {});
      reject(new Error("Video recording failed in this browser."));
    };

    recorder.onstop = () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      audioCtx?.close().catch(() => {});
      const ext = selectedMime.includes("mp4") ? "mp4" : "webm";
      resolve({
        blob: new Blob(chunks, { type: selectedMime }),
        mimeType: selectedMime,
        extension: ext,
      });
    };

    const renderAt = (t: number) => {
      renderCompositeToCanvas(ctx, {
        bgCues,
        charCues,
        overlayCues,
        shapeCues,
        textCues,
        drawingStrokes,
        imageCache,
        timeSec: t,
        canvasW,
        canvasH,
        transition,
        imageFit,
        showSelectionGuides: false,
      });
    };

    const startTime = performance.now();
    renderAt(0);
    recorder.start(250);
    if (audioSource) {
      audioSource.start(0);
    }

    const tick = () => {
      if (stopped) return;
      const elapsedSec = (performance.now() - startTime) / 1000;
      const clamped = Math.min(totalDurationSec, elapsedSec);
      renderAt(clamped);
      onProgress(Math.min(99, Math.round((clamped / totalDurationSec) * 100)));

      if (elapsedSec >= totalTimelineSecSafe(totalDurationSec)) {
        onProgress(100);
        try {
          audioSource?.stop();
        } catch {
          // Ignore if already stopped
        }
        recorder.stop();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  });
}

function totalTimelineSecSafe(sec: number): number {
  return Math.max(0.5, sec);
}
