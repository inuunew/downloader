import React, { useState, useRef, useEffect } from "react";
import {
  Link2,
  Download,
  Loader2,
  AlertTriangle,
  Music2,
  Video,
  Image as ImageIcon,
  ExternalLink,
  Heart,
  MessageCircle,
  Repeat2,
  Zap,
  ChevronDown,
  Check,
} from "lucide-react";

// Points to our own Vercel serverless function (see /api/download.js),
// which proxies each platform's upstream API server-side to avoid browser
// CORS restrictions and to keep any API keys out of client-side code.
const PROXY_ENDPOINT = "/api/download";

// --- Per-platform normalizers -----------------------------------------
// Every upstream API returns a differently-shaped payload. Each normalize()
// function below turns that raw payload into the single shape the rest of
// the UI expects: { title, thumbnail, author, source, duration, statistics, medias[], description? }

// SnackVideo
function normalizeSnackVideo(data) {
  return {
    title: data.title || data.description || "Tanpa judul",
    thumbnail: data.thumbnail,
    author: data.creator?.name,
    source: "snackvideo",
    duration: parseDurationToSeconds(data.duration),
    statistics: {
      digg_count: data.interaction?.likes,
      share_count: data.interaction?.shares,
    },
    medias: data.videoUrl
      ? [{ type: "video", url: data.videoUrl, quality: "Original", extension: "mp4" }]
      : [],
  };
}

// TikTok (tiktok_v2) — counts arrive pre-formatted as strings like "156.9K"
// instead of raw numbers, and duration arrives in milliseconds as a string.
// Poster/cover intentionally omitted — see MediaGroup note below.
function normalizeTikTok(data) {
  return {
    title: data.text || "Tanpa judul",
    thumbnail: null, // poster dihilangkan sesuai permintaan
    author: data.author_nickname,
    source: "tiktok",
    duration: parseInt(data.duration, 10) || null,
    statistics: {
      digg_count: data.like_count,
      comment_count: data.comment_count,
      share_count: data.share_count,
    },
    medias: [
      data.no_watermark_link_hd || data.no_watermark_link
        ? {
            type: "video",
            url: data.no_watermark_link_hd || data.no_watermark_link,
            quality: "Tanpa watermark",
            extension: "mp4",
          }
        : null,
      data.watermark_link
        ? { type: "video", url: data.watermark_link, quality: "Dengan watermark", extension: "mp4" }
        : null,
      data.music_link
        ? { type: "audio", url: data.music_link, quality: "Musik original", extension: "mp3" }
        : null,
    ].filter(Boolean),
  };
}

// Douyin — no author/statistics/duration, just a title and a flat list of
// "Server N" download links. Poster/cover intentionally omitted.
function normalizeDouyin(data) {
  const downloads = data.downloads || [];
  return {
    title: data.title || "Tanpa judul",
    thumbnail: null, // poster dihilangkan sesuai permintaan
    author: null,
    source: "douyin",
    duration: null,
    statistics: null,
    medias: downloads.map((d) => ({
      type: "video",
      url: d.url,
      quality: d.quality || "Server",
      extension: "mp4",
    })),
  };
}

// X / Twitter — single video link only, no quality options, no statistics.
// The API splits title and caption into separate fields.
function normalizeTwitter(data) {
  return {
    title: data.videoTitle || "Tanpa judul",
    description: data.videoDescription || null,
    thumbnail: data.imgUrl,
    author: null,
    source: "x",
    duration: null,
    statistics: null,
    medias: data.downloadLink
      ? [{ type: "video", url: data.downloadLink, quality: "Original", extension: "mp4" }]
      : [],
  };
}

// CapCut — single video link, no statistics.
function normalizeCapcut(data) {
  return {
    title: data.title || "Tanpa judul",
    thumbnail: data.coverUrl,
    author: data.authorName,
    source: "capcut",
    duration: null,
    statistics: null,
    medias: data.originalVideoUrl
      ? [{ type: "video", url: data.originalVideoUrl, quality: "Original", extension: "mp4" }]
      : [],
  };
}

// Instagram — proxied server-side through fastvidl.com (see api/download.js).
// Only ever returns a single media item, no author/statistics.
function normalizeInstagram(data) {
  return {
    title: data.description || "Tanpa judul",
    thumbnail: data.preview,
    author: null,
    source: data.platform || "instagram",
    duration: null,
    statistics: null,
    medias: data.downloadUrl
      ? [
          {
            type: data.mediaType === "image" ? "image" : "video",
            url: data.downloadUrl,
            quality: data.quality || "HD",
            extension: data.mediaType === "image" ? "jpg" : "mp4",
          },
        ]
      : [],
  };
}

// YouTube — resolved server-side (see api/download.js), already returns data
// in the exact shape this UI expects, so no reshaping needed here.
function normalizeYoutube(data) {
  return data;
}

function formatBytes(bytes) {
  if (!bytes || Number.isNaN(bytes)) return null;
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(raw) {
  if (!raw) return null;
  let seconds = raw;
  if (seconds > 1000) seconds = seconds / 1000;
  seconds = Math.round(seconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Turns strings like "2 minutes 36 seconds" or "1 hour 4 minutes" into seconds.
function parseDurationToSeconds(text) {
  if (!text) return null;
  if (typeof text === "number") return text;
  const hourMatch = text.match(/(\d+)\s*hour/);
  const minMatch = text.match(/(\d+)\s*minute/);
  const secMatch = text.match(/(\d+)\s*second/);
  const h = hourMatch ? parseInt(hourMatch[1], 10) : 0;
  const m = minMatch ? parseInt(minMatch[1], 10) : 0;
  const s = secMatch ? parseInt(secMatch[1], 10) : 0;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

// Statistics can arrive as raw numbers (SnackVideo) or already-formatted
// strings like "156.9K" (TikTok) — format only if it's a number, otherwise
// pass the string straight through.
function formatCount(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value.toLocaleString("id-ID");
  return value;
}

function mediaIcon(type) {
  if (type === "audio") return Music2;
  if (type === "image") return ImageIcon;
  return Video;
}

function PillIcon({ mono }) {
  return (
    <span
      className="font-mono text-[10px] tracking-wider inline-flex items-center justify-center rounded-[4px] w-6 h-6 shrink-0"
      style={{ background: "rgba(255,255,255,0.12)" }}
    >
      {mono}
    </span>
  );
}

const PLATFORMS = [
  { id: "youtube", mono: "YT", label: "YouTube", placeholder: "https://youtube.com/shorts/...", queryPlatform: "youtube", normalize: normalizeYoutube },
  { id: "instagram", mono: "IG", label: "Instagram", placeholder: "https://instagram.com/p/...", queryPlatform: "instagram", normalize: normalizeInstagram },
  { id: "tiktok", mono: "TT", label: "TikTok", placeholder: "https://tiktok.com/@user/video/...", queryPlatform: "tiktok_v2", normalize: normalizeTikTok },
  { id: "douyin", mono: "DY", label: "Douyin", placeholder: "https://douyin.com/video/...", queryPlatform: "douyin", normalize: normalizeDouyin },
  { id: "x", mono: "X", label: "X / Twitter", placeholder: "https://twitter.com/user/status/...", queryPlatform: "twitter", normalize: normalizeTwitter },
  { id: "capcut", mono: "CC", label: "CapCut", placeholder: "https://capcut.com/tv2/...", queryPlatform: "capcut", normalize: normalizeCapcut },
  { id: "snackvideo", mono: "SV", label: "SnackVideo", placeholder: "https://snackvideo.com/@user/video/...", queryPlatform: "snackvideo", normalize: normalizeSnackVideo },
];

// Dropdown picker for choosing the active platform. Replaces the old
// horizontal pill rail — same dark rail styling, but as a single
// click-to-open menu so it also works cleanly as the anchor for the
// "clear everything on switch" behavior in TarikApp below.
function PlatformDropdown({ active, onSelect }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-sm font-medium f-display text-white"
        style={{ background: "var(--ink)" }}
      >
        <span className="flex items-center gap-2.5">
          <PillIcon mono={active.mono} />
          {active.label}
        </span>
        <ChevronDown
          size={18}
          className="text-white/60 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div
          className="tarik-rise absolute left-0 right-0 mt-2 rounded-xl overflow-hidden z-30 shadow-lg"
          style={{ background: "var(--ink)", animationDuration: "0.18s" }}
        >
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p.id);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2.5 px-3.5 py-3 text-sm f-display text-left"
              style={{
                color: p.id === active.id ? "#fff" : "rgba(255,255,255,0.6)",
                background: p.id === active.id ? "rgba(255,255,255,0.06)" : "transparent",
              }}
            >
              <span className="flex items-center gap-2.5">
                <PillIcon mono={p.mono} />
                {p.label}
              </span>
              {p.id === active.id && <Check size={15} style={{ color: "var(--signal)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TarikApp() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const active = PLATFORMS[activeIdx];

  // Switching platform wipes the pasted link + any previous result/error so
  // a YouTube link can't accidentally get submitted against SnackVideo (etc).
  function handlePlatformSelect(id) {
    const idx = PLATFORMS.findIndex((p) => p.id === id);
    if (idx === -1 || idx === activeIdx) return;
    setActiveIdx(idx);
    setUrl("");
    setResult(null);
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) {
      setError("Tempel tautannya dulu ya.");
      return;
    }
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch(
        `${PROXY_ENDPOINT}?platform=${active.queryPlatform}&url=${encodeURIComponent(url.trim())}`
      );
      if (!res.ok) throw new Error(`Server merespons dengan status ${res.status}`);
      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.message || "Tautan tidak bisa diproses. Cek lagi linknya.");
      }
      setResult(active.normalize(json.data));
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Tidak bisa menghubungi server. Coba lagi sebentar lagi."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  const medias = result?.medias || [];
  const videos = medias.filter((m) => m.type === "video");
  const audios = medias.filter((m) => m.type === "audio");
  const images = medias.filter((m) => m.type === "image");

  return (
    <div className="tarik-root min-h-screen" style={{ background: "var(--paper)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

        .tarik-root {
          --ink: #0B1220;
          --ink-soft: #1B2537;
          --paper: #F4F6F8;
          --paper-raised: #FFFFFF;
          --slate: #5B6472;
          --slate-light: #8B93A0;
          --line: #E2E5EA;
          --signal: #FF5A36;
          --signal-dim: #FFE4DB;
          --success: #16A34A;
          font-family: 'Inter', -apple-system, sans-serif;
          color: var(--ink);
        }
        .tarik-root .f-display { font-family: 'Space Grotesk', sans-serif; }
        .tarik-root .f-mono { font-family: 'JetBrains Mono', monospace; }

        .tarik-hairline { border-color: var(--line); }

        .tarik-input {
          border: 1.5px solid var(--line);
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .tarik-input:focus-within {
          border-color: var(--signal);
          box-shadow: 0 0 0 4px var(--signal-dim);
        }

        .tarik-btn-primary {
          background: var(--ink);
          color: #fff;
          transition: background 0.2s ease, transform 0.15s ease;
        }
        .tarik-btn-primary:hover:not(:disabled) { background: var(--signal); }
        .tarik-btn-primary:active:not(:disabled) { transform: scale(0.97); }
        .tarik-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

        .tarik-card {
          background: var(--paper-raised);
          border: 1px solid var(--line);
        }

        .tarik-chip {
          border: 1px solid var(--line);
          background: var(--paper);
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .tarik-chip:hover {
          border-color: var(--ink);
          background: #fff;
        }

        @keyframes tarik-rise {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .tarik-rise { animation: tarik-rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }

        @media (prefers-reduced-motion: reduce) {
          .tarik-btn-primary, .tarik-rise { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-20" style={{ background: "var(--paper)", borderBottom: "1px solid var(--line)" }}>
        <div className="max-w-5xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="f-display text-xl font-bold tracking-tight">NuuDown</span>
          </div>
          <nav className="hidden sm:flex items-center gap-8 text-sm text-[var(--slate)]">
            <a href="#platforms" className="hover:text-[var(--ink)] transition-colors">Platform</a>
            <a href="#cara" className="hover:text-[var(--ink)] transition-colors">Cara pakai</a>
          </nav>
          <a
            href="#unduh"
            className="tarik-btn-primary rounded-lg px-4 py-2 text-sm font-medium f-display"
          >
            Mulai unduh
          </a>
        </div>
      </header>

      {/* Hero / functional core */}
      <section id="unduh" className="max-w-5xl mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-10">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[var(--slate)] mb-5">
            <Zap size={13} strokeWidth={2.5} />
            <span>InuuTyzDev Downloader in one website</span>
          </div>
          <h1 className="f-display font-bold leading-[1.05] text-[2.5rem] sm:text-[3.25rem] tracking-tight">
            Tempel tautan.
            <br />
            Download hasilnya.
          </h1>
          <p className="text-[var(--slate)] text-base sm:text-lg mt-4 leading-relaxed">
            YouTube, Instagram, TikTok, Douyin, X/Twitter, CapCut, sampai
            SnackVideo — semua lewat satu kotak, tanpa watermark.
          </p>
        </div>

        {/* Platform dropdown */}
        <div id="platforms" className="mt-10 max-w-xs">
          <PlatformDropdown active={active} onSelect={handlePlatformSelect} />
        </div>

        {/* URL form */}
        <form onSubmit={handleSubmit} className="mt-4">
          <div className="tarik-input flex flex-col sm:flex-row items-stretch gap-2 rounded-xl p-2 bg-white">
            <div className="flex items-center gap-2.5 flex-1 px-3">
              <Link2 size={18} className="text-[var(--slate-light)] shrink-0" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={active.placeholder}
                className="f-mono text-sm w-full py-2.5 outline-none bg-transparent placeholder:text-[var(--slate-light)]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="tarik-btn-primary rounded-lg px-6 py-3 text-sm font-semibold f-display flex items-center justify-center gap-2 shrink-0"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Memproses
                </>
              ) : (
                <>
                  <Download size={16} />
                  Tarik
                </>
              )}
            </button>
          </div>
          <p className="text-xs text-[var(--slate-light)] mt-2.5 pl-1">
            Sedang menyasar <span className="text-[var(--ink)] font-medium">{active.label}</span> — ganti platform di dropdown kapan saja, tautan lama otomatis dihapus.
          </p>
        </form>

        {error && (
          <div className="tarik-rise mt-4 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "#FCA5A5", background: "#FEF2F2", color: "#B91C1C" }}>
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="tarik-rise tarik-card mt-8 rounded-2xl overflow-hidden">
            <div className="flex flex-col sm:flex-row gap-5 p-5 sm:p-6">
              {result.thumbnail && (
                <img
                  src={result.thumbnail}
                  alt=""
                  className="w-full sm:w-40 h-44 sm:h-40 object-cover rounded-lg shrink-0"
                  style={{ background: "var(--line)" }}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-[var(--slate)]">
                  <span className="tarik-chip rounded px-2 py-0.5">{result.source}</span>
                  {formatDuration(result.duration) && <span>{formatDuration(result.duration)}</span>}
                </div>
                <h3 className="f-display font-semibold text-lg mt-2 leading-snug line-clamp-2">
                  {result.title || "Tanpa judul"}
                </h3>
                {result.author && (
                  <p className="text-sm text-[var(--slate)] mt-1">oleh {result.author}</p>
                )}
                {result.description && (
                  <p className="text-sm text-[var(--slate)] mt-2 leading-relaxed line-clamp-3 whitespace-pre-line">
                    {result.description}
                  </p>
                )}
                {result.statistics && (
                  <div className="flex items-center gap-4 mt-3 text-xs text-[var(--slate)]">
                    {formatCount(result.statistics.digg_count) != null && (
                      <span className="flex items-center gap-1">
                        <Heart size={13} /> {formatCount(result.statistics.digg_count)}
                      </span>
                    )}
                    {formatCount(result.statistics.comment_count) != null && (
                      <span className="flex items-center gap-1">
                        <MessageCircle size={13} /> {formatCount(result.statistics.comment_count)}
                      </span>
                    )}
                    {formatCount(result.statistics.share_count) != null && (
                      <span className="flex items-center gap-1">
                        <Repeat2 size={13} /> {formatCount(result.statistics.share_count)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <MediaGroup title="Video" items={videos} />
            <MediaGroup title="Audio" items={audios} />
            <MediaGroup title="Gambar" items={images} />
          </div>
        )}
      </section>

      {/* How it works */}
      <section id="cara" className="max-w-5xl mx-auto px-5 sm:px-8 py-16 border-t" style={{ borderColor: "var(--line)" }}>
        <h2 className="f-display font-bold text-2xl mb-8">Cara pakai</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            { t: "Salin tautan", d: "Ambil link video dari aplikasi platform yang kamu mau." },
            { t: "Tempel di sini", d: "Pilih platformnya dari dropdown, lalu tempel link ke kotak di atas." },
            { t: "Pilih kualitas", d: "Tekan Tarik, lalu pilih format dan resolusi yang kamu perlu." },
          ].map((s, i) => (
            <div key={i} className="tarik-card rounded-xl p-5">
              <p className="f-display font-semibold">{s.t}</p>
              <p className="text-sm text-[var(--slate)] mt-1.5 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t" style={{ borderColor: "var(--line)" }}>
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--slate-light)]">
          <span className="f-display font-semibold text-[var(--ink)]">TARIK.</span>
          <span>Gunakan hanya untuk konten yang kamu berhak unduh.</span>
        </div>
      </footer>
    </div>
  );
}

function MediaGroup({ title, items }) {
  if (!items.length) return null;
  const Icon = mediaIcon(items[0].type);
  return (
    <div className="border-t px-5 sm:px-6 py-5" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-[var(--slate)] mb-3">
        <Icon size={13} />
        <span>{title}</span>
        <span className="text-[var(--slate-light)]">({items.length})</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((m, i) => {
          const label = m.quality || m.label || m.extension?.toUpperCase() || "File";
          const size = formatBytes(m.data_size);
          return (
            <a
              key={i}
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tarik-chip rounded-lg px-3.5 py-2.5 flex items-center gap-2.5 text-sm group"
            >
              <span className="f-mono font-medium">{label}</span>
              {size && <span className="f-mono text-xs text-[var(--slate-light)]">{size}</span>}
              <ExternalLink size={13} className="text-[var(--slate-light)] group-hover:text-[var(--ink)] transition-colors" />
            </a>
          );
        })}
      </div>
    </div>
  );
}
