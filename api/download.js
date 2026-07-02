// /api/download.js
// Vercel serverless function. Single entry point the frontend calls as
// `/api/download?platform=<id>&url=<encoded video url>`.
//
// Responsibilities:
//  1. Proxy/resolve each request server-side (avoids browser CORS issues and
//     keeps upstream hosts / logic out of client-side code).
//  2. Normalize every source's response into one consistent envelope:
//       { success: true,  data: <raw platform payload> }
//       { success: false, message: <human-readable error> }
//     The frontend's per-platform `normalize()` functions take it from there.
//
// Requires: `npm install @distube/ytdl-core` (used for YouTube — see
// handleYoutube below).

import ytdl from "@distube/ytdl-core";

const INUUTYZ_BASE = "https://api.inuutyz.web.id/api/download";

// Maps our internal `platform` query param to the upstream inuutyz path.
const INUUTYZ_PATHS = {
  tiktok_v2: "tiktok_v2",
  douyin: "douyin",
  twitter: "twitter",
  capcut: "capcut",
};

// SnackVideo is served by a different provider than the rest — cuki.biz.id,
// which requires an apikey query param.
const CUKI_BASE = "https://api.cuki.biz.id/api/downloader";
const CUKI_API_KEY = "cuki-x";

export default async function handler(req, res) {
  const { platform, url } = req.query;

  if (!platform || !url) {
    return res.status(400).json({ success: false, message: "Parameter 'platform' dan 'url' wajib diisi." });
  }

  try {
    if (platform === "instagram") {
      return await handleInstagram(url, res);
    }

    if (platform === "youtube") {
      return await handleYoutube(url, res);
    }

    if (platform === "snackvideo") {
      return await handleSnackVideo(url, res);
    }

    if (INUUTYZ_PATHS[platform]) {
      return await handleInuutyz(platform, url, res);
    }

    return res.status(400).json({ success: false, message: `Platform '${platform}' tidak dikenali.` });
  } catch (err) {
    console.error(`[download.js] ${platform} error:`, err);
    return res.status(502).json({
      success: false,
      message: "Gagal menghubungi server sumber. Coba lagi sebentar lagi.",
    });
  }
};

// --- inuutyz-backed platforms (snackvideo, tiktok, douyin, twitter, capcut, aio/youtube) ---
async function handleInuutyz(platform, url, res) {
  const upstreamPath = INUUTYZ_PATHS[platform];
  const upstreamUrl = `${INUUTYZ_BASE}/${upstreamPath}?url=${encodeURIComponent(url)}`;

  const upstreamRes = await fetch(upstreamUrl, {
    headers: { Accept: "application/json" },
  });

  if (!upstreamRes.ok) {
    return res.status(502).json({
      success: false,
      message: `Server sumber merespons dengan status ${upstreamRes.status}.`,
    });
  }

  const json = await upstreamRes.json();

  // inuutyz responses use `status` (bool) at the top level and nest the
  // actual payload under `result`. A few endpoints (e.g. a raw "aio" style
  // response) may already put the payload under `data` instead — handle both.
  const success = json.status === true || json.success === true;
  const payload = json.result || json.data || json;

  if (!success || !payload) {
    return res.status(200).json({
      success: false,
      message: json.message || "Tautan tidak valid atau video tidak ditemukan.",
    });
  }

  return res.status(200).json({ success: true, data: payload });
}

// --- SnackVideo, served by cuki.biz.id (separate provider + apikey) ---
async function handleSnackVideo(url, res) {
  const upstreamUrl = `${CUKI_BASE}/snackVideo?apikey=${CUKI_API_KEY}&url=${encodeURIComponent(url)}`;

  const upstreamRes = await fetch(upstreamUrl, {
    headers: { Accept: "application/json" },
  });

  if (!upstreamRes.ok) {
    return res.status(502).json({
      success: false,
      message: `Server sumber merespons dengan status ${upstreamRes.status}.`,
    });
  }

  const json = await upstreamRes.json();

  if (!json.success || !json.data) {
    return res.status(200).json({
      success: false,
      message: json.message || "Tautan SnackVideo tidak valid atau video tidak ditemukan.",
    });
  }

  return res.status(200).json({ success: true, data: json.data });
}

// --- YouTube, resolved directly with ytdl-core (no third-party site, no
// CAPTCHA-bypass — this talks to YouTube's own player endpoints). ---
async function handleYoutube(url, res) {
  if (!ytdl.validateURL(url)) {
    return res.status(200).json({ success: false, message: "Tautan YouTube tidak valid." });
  }

  let info;
  try {
    info = await ytdl.getInfo(url);
  } catch (err) {
    console.error("[download.js] ytdl.getInfo error:", err);
    return res.status(200).json({
      success: false,
      message: "Video tidak bisa diakses (private, dihapus, atau dibatasi usia).",
    });
  }

  const details = info.videoDetails;

  // Formats that already bundle video+audio in one file (safe default, but
  // YouTube usually only offers these up to 360p).
  const combined = ytdl
    .filterFormats(info.formats, "videoandaudio")
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  // Higher-resolution video is normally video-only (adaptive streaming) —
  // offer a couple of these too, clearly labeled as having no audio track.
  const videoOnly = ytdl
    .filterFormats(info.formats, "videoonly")
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .slice(0, 3);

  const bestAudio = ytdl
    .filterFormats(info.formats, "audioonly")
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];

  const medias = [
    ...combined.map((f) => ({
      type: "video",
      url: f.url,
      quality: f.qualityLabel || "Default",
      extension: f.container || "mp4",
      data_size: f.contentLength ? Number(f.contentLength) : null,
    })),
    ...videoOnly.map((f) => ({
      type: "video",
      url: f.url,
      quality: `${f.qualityLabel || "?"} (tanpa audio)`,
      extension: f.container || "mp4",
      data_size: f.contentLength ? Number(f.contentLength) : null,
    })),
    bestAudio
      ? {
          type: "audio",
          url: bestAudio.url,
          quality: bestAudio.audioBitrate ? `${bestAudio.audioBitrate}kbps` : "Audio",
          extension: bestAudio.container || "m4a",
          data_size: bestAudio.contentLength ? Number(bestAudio.contentLength) : null,
        }
      : null,
  ].filter(Boolean);

  if (!medias.length) {
    return res.status(200).json({
      success: false,
      message: "Tidak ada format unduhan yang tersedia untuk video ini.",
    });
  }

  const data = {
    title: details.title,
    thumbnail: details.thumbnails?.[details.thumbnails.length - 1]?.url,
    author: details.author?.name,
    source: "youtube",
    duration: Number(details.lengthSeconds) || null,
    // YouTube doesn't reliably expose public like/comment/share counts via
    // ytdl-core — omit rather than guess. `digg_count` is filled only when present.
    statistics: {
      digg_count: details.likes ?? null,
      comment_count: null,
      share_count: null,
    },
    medias,
  };

  return res.status(200).json({ success: true, data });
}

// --- Instagram, proxied through fastvidl.com (no official/public API, so we
// forward the request server-side exactly like the reference Node script) ---
async function handleInstagram(url, res) {
  const upstreamRes = await fetch("https://fastvidl.com/api/lookup", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://fastvidl.com",
      Referer: "https://fastvidl.com/",
    },
    body: JSON.stringify({ url }),
  });

  let json;
  try {
    json = await upstreamRes.json();
  } catch (err) {
    return res.status(502).json({ success: false, message: "Respons server Instagram tidak valid." });
  }

  if (!json.ok) {
    return res.status(200).json({
      success: false,
      message: json.message || "Gagal memproses tautan Instagram.",
    });
  }

  const mediaList = json.media || [];
  const selected = mediaList[0] || {};

  const data = {
    platform: json.source || "instagram",
    downloadUrl: selected.url || json.url || "",
    preview: selected.thumbnail || json.thumbnail || "",
    mediaType: selected.type || json.type || "image",
    quality: selected.quality || json.quality || "HD",
    description: selected.label || "",
  };

  if (!data.downloadUrl) {
    return res.status(200).json({ success: false, message: "Media tidak ditemukan untuk tautan ini." });
  }

  return res.status(200).json({ success: true, data });
}
