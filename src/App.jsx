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
} from "lucide-react";

// These now point to our own Vercel serverless function (see /api/download.js),
// which proxies the request server-side to avoid browser CORS restrictions
// and to keep the API key out of client-side code.
const PROXY_ENDPOINT = "/api/download";

const PLATFORMS = [
  { id: "youtube", mono: "YT", label: "YouTube", placeholder: "https://youtube.com/shorts/..." },
  { id: "instagram", mono: "IG", label: "Instagram", placeholder: "https://instagram.com/p/..." },
  { id: "tiktok", mono: "TT", label: "TikTok", placeholder: "https://tiktok.com/@user/video/..." },
  { id: "capcut", mono: "CC", label: "CapCut", placeholder: "https://capcut.com/tv2/..." },
  { id: "douyin", mono: "DY", label: "Douyin", placeholder: "https://douyin.com/video/..." },
  { id: "facebook", mono: "FB", label: "Facebook", placeholder: "https://facebook.com/reel/..." },
  { id: "x", mono: "X", label: "X / Twitter", placeholder: "https://twitter.com/user/status/..." },
  { id: "snackvideo", mono: "SV", label: "SnackVideo", placeholder: "https://snackvideo.com/@user/video/..." },
];

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

// SnackVideo's endpoint returns a differently-shaped payload than the AIO
// endpoint, so we normalize it into the same shape the rest of the UI expects
// (title, thumbnail, author, source, duration, statistics, medias[]).
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
      ? [
          {
            type: "video",
            url: data.videoUrl,
            quality: "Original",
            extension: "mp4",
          },
        ]
      : [],
  };
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

export default function TarikApp() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const pillRefs = useRef([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const railRef = useRef(null);

  const active = PLATFORMS[activeIdx];

  useEffect(() => {
    const el = pillRefs.current[activeIdx];
    const rail = railRef.current;
    if (el && rail) {
      const railBox = rail.getBoundingClientRect();
      const elBox = el.getBoundingClientRect();
      setIndicator({
        left: elBox.left - railBox.left + rail.scrollLeft,
        width: elBox.width,
      });
    }
  }, [activeIdx]);

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
      const isSnackVideo = active.id === "snackvideo";
      const platformParam = isSnackVideo ? "snackvideo" : "aio";
      const res = await fetch(
        `${PROXY_ENDPOINT}?platform=${platformParam}&url=${encodeURIComponent(url.trim())}`
      );
      if (!res.ok) throw new Error(`Server merespons dengan status ${res.status}`);
      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.message || "Tautan tidak bisa diproses. Cek lagi linknya.");
      }
      const normalized = isSnackVideo ? normalizeSnackVideo(json.data) : json.data;
      setResult(normalized);
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

        .tarik-pill {
          transition: color 0.25s ease;
          color: rgba(255,255,255,0.55);
        }
        .tarik-pill.is-active { color: #fff; }

        .tarik-indicator {
          position: absolute;
          bottom: -1px;
          height: 2px;
          background: var(--signal);
          transition: left 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .tarik-plug {
          position: absolute;
          bottom: -9px;
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--signal);
          transition: left 0.35s cubic-bezier(0.4, 0, 0.2, 1);
          transform: translateX(-50%);
          box-shadow: 0 0 0 4px var(--paper);
        }

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
          .tarik-indicator, .tarik-plug, .tarik-btn-primary, .tarik-rise { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-20" style={{ background: "var(--paper)", borderBottom: "1px solid var(--line)" }}>
        <div className="max-w-5xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="f-display text-xl font-bold tracking-tight">TARIK.</span>
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
            <span>Satu API, delapan platform</span>
          </div>
          <h1 className="f-display font-bold leading-[1.05] text-[2.5rem] sm:text-[3.25rem] tracking-tight">
            Tempel tautan.
            <br />
            Tarik videonya.
          </h1>
          <p className="text-[var(--slate)] text-base sm:text-lg mt-4 leading-relaxed">
            YouTube, Instagram, TikTok, CapCut, Douyin, Facebook, X, sampai
            SnackVideo — semua lewat satu kotak, tanpa watermark kalau
            sumbernya tersedia.
          </p>
        </div>

        {/* Platform rail */}
        <div id="platforms" className="mt-10 relative">
          <div
            ref={railRef}
            className="relative flex gap-1 overflow-x-auto whitespace-nowrap pb-4 rounded-xl p-2"
            style={{ background: "var(--ink)" }}
          >
            {PLATFORMS.map((p, i) => (
              <button
                key={p.id}
                ref={(el) => (pillRefs.current[i] = el)}
                onClick={() => setActiveIdx(i)}
                className={`tarik-pill relative shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium f-display ${
                  i === activeIdx ? "is-active" : ""
                }`}
              >
                <PillIcon mono={p.mono} />
                {p.label}
              </button>
            ))}
            <span
              className="tarik-indicator"
              style={{ left: indicator.left, width: indicator.width }}
            />
          </div>
          {/* connector plug dropping into the input */}
          <span
            className="tarik-plug hidden sm:block"
            style={{ left: indicator.left + indicator.width / 2 }}
          />
        </div>

        {/* URL form */}
        <form onSubmit={handleSubmit} className="mt-6">
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
            Sedang menyasar <span className="text-[var(--ink)] font-medium">{active.label}</span> — pilih platform lain di atas kapan saja.
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
                {result.statistics && (
                  <div className="flex items-center gap-4 mt-3 text-xs text-[var(--slate)]">
                    {typeof result.statistics.digg_count === "number" && (
                      <span className="flex items-center gap-1">
                        <Heart size={13} /> {result.statistics.digg_count.toLocaleString("id-ID")}
                      </span>
                    )}
                    {typeof result.statistics.comment_count === "number" && (
                      <span className="flex items-center gap-1">
                        <MessageCircle size={13} /> {result.statistics.comment_count.toLocaleString("id-ID")}
                      </span>
                    )}
                    {typeof result.statistics.share_count === "number" && (
                      <span className="flex items-center gap-1">
                        <Repeat2 size={13} /> {result.statistics.share_count.toLocaleString("id-ID")}
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
            { t: "Tempel di sini", d: "Pilih platformnya, lalu tempel link ke kotak di atas." },
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
