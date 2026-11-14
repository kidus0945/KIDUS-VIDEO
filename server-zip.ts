import fs from "fs";
import path from "path";
import zlib from "zlib";

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  data: Buffer;
}

export function createZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const rawData = entry.data;
    const compressed = zlib.deflateRawSync(rawData);
    const crc = crc32(rawData);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x5421, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localParts.push(localHeader, nameBuf, compressed);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

const EXCLUDED_DIRS = new Set(["node_modules", "dist", "dist-exe", ".git", ".aistudio"]);
const EXCLUDED_FILES = new Set([".env", ".DS_Store"]);

export function collectProjectFiles(rootDir: string, relBase = ""): ZipEntryInput[] {
  const results: ZipEntryInput[] = [];
  const dirPath = relBase ? path.join(rootDir, relBase) : rootDir;
  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    if (item.isDirectory()) {
      if (EXCLUDED_DIRS.has(item.name)) continue;
      const nextRel = relBase ? path.join(relBase, item.name) : item.name;
      results.push(...collectProjectFiles(rootDir, nextRel));
    } else if (item.isFile()) {
      if (EXCLUDED_FILES.has(item.name)) continue;
      const nextRel = relBase ? path.join(relBase, item.name) : item.name;
      const fullPath = path.join(rootDir, nextRel);
      results.push({
        name: `kidus-studio/${nextRel}`,
        data: fs.readFileSync(fullPath),
      });
    }
  }
  return results;
}

export function collectKidusVideoFiles(rootDir: string): ZipEntryInput[] {
  const entries: ZipEntryInput[] = [];
  const addText = (relPath: string, content: string) => {
    entries.push({
      name: `kidus-video/${relPath}`,
      data: Buffer.from(content, "utf8"),
    });
  };
  const copyExisting = (srcRel: string, destRel = srcRel) => {
    const full = path.join(rootDir, srcRel);
    if (fs.existsSync(full)) {
      entries.push({
        name: `kidus-video/${destRel}`,
        data: fs.readFileSync(full),
      });
    }
  };

  // Copy core shared config & Kidus Video frontend modules
  copyExisting(".env.example");
  copyExisting("tsconfig.json");
  copyExisting("server-media-assistant.ts");
  copyExisting("src/index.css");
  copyExisting("src/types/mediaStudio.ts");
  copyExisting("src/utils/audioDecoder.ts");
  copyExisting("src/utils/audioEffects.ts");
  copyExisting("src/utils/canvasRenderer.ts");
  copyExisting("src/components/ImageVideoStudio.tsx");
  copyExisting("src/KidusVideoApp.tsx");
  copyExisting("src/main.tsx");

  // Standalone package.json for Kidus Video
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  addText(
    "package.json",
    JSON.stringify(
      {
        name: "kidus-video",
        private: true,
        version: "1.0.0",
        type: "module",
        scripts: {
          dev: "tsx server.ts",
          start: "node server.ts",
          build: "vite build",
          preview: "vite preview",
          lint: "tsc --noEmit",
        },
        dependencies: rootPkg.dependencies ?? {},
        devDependencies: rootPkg.devDependencies ?? {},
      },
      null,
      2
    )
  );

  // Standalone index.html
  addText(
    "index.html",
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kidus Video — Image & Audio Video Studio</title>
    <meta name="description" content="Combine images and audio, edit with AI assistant chat, and export video." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+Ethiopic:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body class="bg-[#050816] text-[#F0F6FF] antialiased selection:bg-[#00E5FF]/25 selection:text-[#00E5FF]">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
  );

  // Standalone vite.config.ts
  addText(
    "vite.config.ts",
    `import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
`
  );

  // Standalone server.ts
  addText(
    "server.ts",
    `import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { registerMediaAssistantRoute } from "./server-media-assistant.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  registerMediaAssistantRoute(app);

  if (process.env.NODE_ENV === "production") {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(\`Kidus Video listening on http://0.0.0.0:\${PORT}\`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start Kidus Video server:", err);
  process.exit(1);
});
`
  );

  // Standalone Electron desktop wrapper for Kidus Video.exe
  addText(
    "electron-main.cjs",
    `const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

let serverProc = null;
const PORT = "3457";

function waitForServer(url, retries = 40) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts += 1;
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (attempts >= retries) {
          reject(new Error("Kidus Video server did not start in time."));
        } else {
          setTimeout(check, 250);
        }
      });
    };
    check();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: "Kidus Video",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(\`http://127.0.0.1:\${PORT}\`);
}

app.whenReady().then(async () => {
  const appRoot = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  const envPath = path.join(appRoot, ".env");

  if (!process.env.GEMINI_API_KEY && !fs.existsSync(envPath)) {
    dialog.showMessageBoxSync({
      type: "info",
      title: "Kidus Video Setup",
      message:
        'Place a .env file with GEMINI_API_KEY="your_key" in the same folder as Kidus Video.exe to enable AI Assistant Chat.',
    });
  }

  const serverEntry = path.join(__dirname, "server.ts");
  serverProc = spawn(process.execPath, [serverEntry], {
    cwd: __dirname,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT,
    },
    stdio: "inherit",
  });

  try {
    await waitForServer(\`http://127.0.0.1:\${PORT}/api/health\`);
    createWindow();
  } catch (err) {
    dialog.showErrorBox("Kidus Video Error", String(err));
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
  app.quit();
});
`
  );

  addText(
    "electron-builder.json",
    JSON.stringify(
      {
        appId: "com.kidus.video",
        productName: "Kidus Video",
        directories: { output: "dist-exe" },
        files: [
          "dist/**/*",
          "server.ts",
          "server-media-assistant.ts",
          "electron-main.cjs",
          "package.json",
          "node_modules/**/*",
        ],
        extraMetadata: { main: "electron-main.cjs" },
        win: {
          target: [{ target: "portable", arch: ["x64"] }],
          artifactName: "Kidus Video.exe",
        },
      },
      null,
      2
    )
  );

  addText(
    "build-exe.bat",
    `@echo off
title Build Kidus Video Windows EXE
echo ============================================
echo   Kidus Video - Windows EXE Builder
echo ============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js 22+ is required. Download from https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".env" (
  echo Creating .env from .env.example...
  copy .env.example .env >nul
  echo Please edit .env and paste your GEMINI_API_KEY before running Kidus Video.exe!
)

echo [1/4] Installing app dependencies...
call npm install
if %errorlevel% neq 0 goto :error

echo [2/4] Installing Electron packager...
call npm install --no-save electron electron-builder
if %errorlevel% neq 0 goto :error

echo [3/4] Building web assets...
call npm run build
if %errorlevel% neq 0 goto :error

echo [4/4] Packaging Kidus Video.exe...
call npx electron-builder --config electron-builder.json --win portable
if %errorlevel% neq 0 goto :error

echo.
echo Done! Your Windows app is ready at: dist-exe\\Kidus Video.exe
echo Make sure your .env file with GEMINI_API_KEY is in the same folder as Kidus Video.exe.
pause
exit /b 0

:error
echo.
echo Build failed. Check the messages above.
pause
exit /b 1
`
  );

  return entries;
}

