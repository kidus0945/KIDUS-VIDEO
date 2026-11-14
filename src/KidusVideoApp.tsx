import { useEffect, useState } from "react";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import { ImageVideoStudio } from "./components/ImageVideoStudio";
import type { LibraryAudioClip } from "./types/mediaStudio";

type VideoTab = "editor" | "guide";

async function loadSharedLibraryClips(): Promise<LibraryAudioClip[]> {
  try {
    return await new Promise<LibraryAudioClip[]>((resolve) => {
      const request = indexedDB.open("zema_amharic_studio_db", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("takes")) {
          db.createObjectStore("takes", { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains("takes")) {
            resolve([]);
            return;
          }
          const tx = db.transaction("takes", "readonly");
          const req = tx.objectStore("takes").getAll();
          req.onsuccess = () => {
            const rows = (req.result as Array<LibraryAudioClip & { createdAt?: number }>) || [];
            rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
            resolve(rows);
          };
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      };
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export default function KidusVideoApp() {
  const [activeTab, setActiveTab] = useState<VideoTab>("editor");
  const [projectKey, setProjectKey] = useState<number>(1);
  const [libraryClips, setLibraryClips] = useState<LibraryAudioClip[]>([]);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadSharedLibraryClips().then((clips) => {
      if (mounted) setLibraryClips(clips);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleNewProject = () => {
    setActiveTab("editor");
    setProjectKey((k) => k + 1);
    setExportError(null);
  };

  const handleDownloadVideoAppZip = async () => {
    setExportError(null);
    setIsExportingZip(true);
    try {
      const res = await fetch("/api/export-kidus-video");
      if (!res.ok) {
        throw new Error("Could not package Kidus Video standalone files.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kidus-video-pc.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to download Kidus Video PC package."
      );
    } finally {
      setIsExportingZip(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col text-[#F0F6FF]">
      {/* Top Bar Contract: 3 zones */}
      <header className="bg-[#070C1F]/90 backdrop-blur-md border-b border-[#1A2B56] sticky top-0 z-20">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab("editor")}
            className="text-lg font-bold tracking-tight text-[#F0F6FF] whitespace-nowrap shrink-0 text-left focus-visible:outline-2 focus-visible:outline-[#00E5FF]"
          >
            Kidus <span className="text-[#00E5FF]">Video</span>
          </button>

          <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Primary">
            {(
              [
                { id: "editor", label: "Video Studio" },
                { id: "guide", label: "AI & Export Guide" },
              ] as const
            ).map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#00E5FF] ${
                    isActive
                      ? "border-[#00E5FF] text-[#00E5FF] drop-shadow-[0_0_8px_rgba(0,229,255,0.45)]"
                      : "border-transparent text-[#9FB3D9] hover:text-[#F0F6FF]"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleNewProject}
              className="px-4 py-2 text-xs font-medium text-[#E0F2FE] bg-[#0D1633] border border-[#243B73] hover:border-[#00E5FF] hover:text-[#00E5FF] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#00E5FF]"
            >
              New Project
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-8">
        <div className="mb-7 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#F0F6FF] text-balance">
              {activeTab === "editor" ? "Image & Audio Video Studio" : "AI Chat & Video Export Guide"}
            </h1>
            <p className="text-sm text-[#9FB3D9] mt-1">
              {activeTab === "editor"
                ? "Add one or many images, attach audio files or saved voice clips, edit via AI assistant chat, and export video."
                : "Tips for writing image edit instructions in the assistant chat, syncing slides to audio, and exporting desktop video."}
            </p>
          </div>

          <div className="text-xs text-[#60A5FA] flex items-center gap-2 whitespace-nowrap shrink-0">
            <span>Multi-Image</span>
            <span aria-hidden="true" className="text-[#243B73]">
              ·
            </span>
            <span>Audio Sync</span>
            <span aria-hidden="true" className="text-[#243B73]">
              ·
            </span>
            <span className="font-mono tabular-nums text-[#00E5FF]">WebM / MP4 Video</span>
          </div>
        </div>

        {exportError && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2 p-3 rounded-lg bg-[#2A0A14] border border-[#F43F5E]/40 text-xs text-[#FDA4AF]"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{exportError}</span>
          </div>
        )}

        {activeTab === "editor" ? (
          <ImageVideoStudio key={projectKey} libraryTakes={libraryClips} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <section className="bg-[#0B1124] border border-[#1A2B56] rounded-xl p-5 space-y-2.5">
              <h2 className="text-sm font-semibold text-[#00E5FF]">1. Build Your Image Sequence</h2>
              <p className="text-xs text-[#9FB3D9] leading-relaxed">
                Click <strong className="text-[#F0F6FF]">Add Images</strong> or drag and drop as
                many photos as you want onto the canvas. Use the filmstrip below to reorder slides,
                duplicate any frame, or set individual slide durations.
              </p>
            </section>

            <section className="bg-[#0B1124] border border-[#1A2B56] rounded-xl p-5 space-y-2.5">
              <h2 className="text-sm font-semibold text-[#38BDF8]">2. Attach & Sync Audio</h2>
              <p className="text-xs text-[#9FB3D9] leading-relaxed">
                Upload any MP3, WAV, M4A, or OGG track—or pick an Amharic voice take saved in your
                browser—then click <strong className="text-[#F0F6FF]">Fit Slides to Audio</strong>{" "}
                to match the full soundtrack length.
              </p>
            </section>

            <section className="bg-[#0B1124] border border-[#1A2B56] rounded-xl p-5 space-y-2.5">
              <h2 className="text-sm font-semibold text-[#60A5FA]">3. Edit with AI Chat</h2>
              <p className="text-xs text-[#9FB3D9] leading-relaxed">
                Ask the AI Assistant to brighten photos, warm tones, switch to 9:16 vertical or 1:1
                square, add English or Amharic captions (<span className="font-ethiopic">አማርኛ</span>
                ), zoom in, or switch transitions, then click{" "}
                <strong className="text-[#F0F6FF]">Export Video</strong>.
              </p>
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-[#1A2B56] bg-[#070C1F]/90">
        <div className="max-w-[1280px] mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-[#9FB3D9]">
            <span className="text-[#F0F6FF] font-medium">Kidus Video</span>
            <span className="mx-2 text-[#243B73]" aria-hidden="true">
              ·
            </span>
            <span>Windows PC bundle includes build-exe.bat for creating Kidus Video.exe</span>
          </div>

          {typeof navigator !== "undefined" && !navigator.userAgent.includes("Electron") && (
            <button
              type="button"
              disabled={isExportingZip}
              onClick={handleDownloadVideoAppZip}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#00E5FF] bg-[#0D1633] border border-[#00E5FF]/40 hover:border-[#00E5FF] hover:bg-[#00E5FF]/10 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto shadow-[0_0_14px_rgba(0,229,255,0.14)] focus-visible:outline-2 focus-visible:outline-[#00E5FF]"
            >
              {isExportingZip ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{isExportingZip ? "Preparing ZIP..." : "Download Kidus Video (.zip)"}</span>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
