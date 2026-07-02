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

// YouTube is served by keyrafara.com.
const KEYRAFARA_BASE = "https://keyrafara.com/downloaders/youtube";

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

// --- YouTube, served by keyrafara.com. Returns many duplicate-quality
// entries (same resolution in both mp4/webm) — we dedupe by quality label,
// preferring mp4 for broader compatibility, and keep audio-only options
// as-is since there are only a handful. ---
async function handleYoutube(url, res) {
  const upstreamUrl = `${KEYRAFARA_BASE}?url=${encodeURIComponent(url)}`;

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
  const result = json.result;

  if (!json.status || !result) {
    return res.status(200).json({
      success: false,
      message: json.message || "Video tidak ditemukan atau tautan YouTube tidak valid.",
    });
  }

  const videoByQuality = new Map();
  for (const f of result.formats || []) {
    const existing = videoByQuality.get(f.quality);
    // Prefer mp4 over webm when the same quality label appears in both.
    if (!existing || (existing.ext !== "mp4" && f.ext === "mp4")) {
      videoByQuality.set(f.quality, f);
    }
  }

  const medias = [
    ...Array.from(videoByQuality.values()).map((f) => ({
      type: "video",
      url: f.url,
      quality: f.quality,
      extension: f.ext,
      data_size: f.filesize || null,
    })),
    ...(result.audio || []).map((a) => ({
      type: "audio",
      url: a.url,
      quality: a.quality,
      extension: a.ext,
      data_size: a.filesize || null,
    })),
  ];

  if (!medias.length) {
    return res.status(200).json({
      success: false,
      message: "Tidak ada format unduhan yang tersedia untuk video ini.",
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      title: result.title || "YouTube Video",
      thumbnail: result.thumbnail || null,
      author: result.uploader || null,
      source: "youtube",
      duration: result.duration || null,
      // keyrafara doesn't expose likes/comments/shares — leave statistics
      // unset rather than showing a zeroed-out stat row.
      statistics: null,
      medias,
    },
  });
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
