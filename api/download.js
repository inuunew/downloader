/**
 * ═══════════════════════════════════════════════════════════
 * YTDL — MULTI DOWNLOADER WRAPPER FOR VERCEL
 * Powered by Cobalt.tools API for YouTube (Supports MP4 & MP3)
 * ═══════════════════════════════════════════════════════════
 */

const INUUTYZ_BASE = "https://api.inuutyz.web.id/api/download";
const INUUTYZ_PATHS = {
  tiktok_v2: "tiktok_v2",
  douyin: "douyin",
  twitter: "twitter",
  capcut: "capcut",
};

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
      return await handleYoutubeCobalt(url, res);
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
}

// ==========================================
// YOUTUBE SCRAPER (Base: Cobalt API)
// ==========================================
async function handleYoutubeCobalt(youtubeUrl, res) {
  try {
    const mappedMedias = [];
    let videoTitle = "YouTube Video";

    // Request 1: Ambil Video (MP4 - 720p)
    try {
      const resVideo = await fetch("https://api.cobalt.tools/api/json", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          url: youtubeUrl,
          videoQuality: "720",
          downloadMode: "auto", // Video + Audio menyatu
          filenamePattern: "basic"
        })
      });
      if (resVideo.ok) {
        const jsonVideo = await resVideo.json();
        if (jsonVideo.status !== "error" && jsonVideo.url) {
          videoTitle = jsonVideo.filename || videoTitle;
          mappedMedias.push({
            type: 'video',
            url: jsonVideo.url,
            quality: '720p',
            extension: 'mp4',
            data_size: null
          });
        }
      }
    } catch (e) {
      console.error("Gagal mengambil format video dari Cobalt:", e.message);
    }

    // Request 2: Ambil Audio Saja (MP3)
    try {
      const resAudio = await fetch("https://api.cobalt.tools/api/json", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          url: youtubeUrl,
          downloadMode: "audio", // Mode audio murni
          audioFormat: "mp3",    // Format MP3
          filenamePattern: "basic"
        })
      });
      if (resAudio.ok) {
        const jsonAudio = await resAudio.json();
        if (jsonAudio.status !== "error" && jsonAudio.url) {
          mappedMedias.push({
            type: 'audio',
            url: jsonAudio.url,
            quality: '128kbps',
            extension: 'mp3',
            data_size: null
          });
        }
      }
    } catch (e) {
      console.error("Gagal mengambil format audio dari Cobalt:", e.message);
    }

    // Jika kedua request gagal dan tidak ada media yang didapat
    if (mappedMedias.length === 0) {
      return res.status(200).json({ 
        success: false, 
        message: "Gagal mengambil video/audio YouTube. Server Cobalt kemungkinan sedang limit." 
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        title: videoTitle,
        thumbnail: null, // Cobalt tidak menyediakan thumbnail di response dasarnya
        source: 'youtube',
        duration: null,
        statistics: { digg_count: 0, comment_count: 0 },
        medias: mappedMedias // Berisi MP4 dan MP3 yang siap dibaca frontend
      }
    });

  } catch (error) {
    console.error('[-] handleYoutubeCobalt Error:', error.message);
    return res.status(200).json({ success: false, message: `Terjadi kesalahan internal: ${error.message}` });
  }
}

// ==========================================
// TIKTOK, DOUYIN, TWITTER, CAPCUT (Inuutyz)
// ==========================================
async function handleInuutyz(platform, url, res) {
  const upstreamPath = INUUTYZ_PATHS[platform];
  const upstreamUrl = `${INUUTYZ_BASE}/${upstreamPath}?url=${encodeURIComponent(url)}`;
  const upstreamRes = await fetch(upstreamUrl, { headers: { Accept: "application/json" } });

  if (!upstreamRes.ok) return res.status(502).json({ success: false, message: `Server sumber merespons dengan status ${upstreamRes.status}.` });
  const json = await upstreamRes.json();
  const success = json.status === true || json.success === true;
  const payload = json.result || json.data || json;

  if (!success || !payload) return res.status(200).json({ success: false, message: json.message || "Tautan tidak valid atau video tidak ditemukan." });
  return res.status(200).json({ success: true, data: payload });
}

// ==========================================
// SNACKVIDEO (Cuki)
// ==========================================
async function handleSnackVideo(url, res) {
  const upstreamUrl = `${CUKI_BASE}/snackVideo?apikey=${CUKI_API_KEY}&url=${encodeURIComponent(url)}`;
  const upstreamRes = await fetch(upstreamUrl, { headers: { Accept: "application/json" } });

  if (!upstreamRes.ok) return res.status(502).json({ success: false, message: `Server sumber merespons dengan status ${upstreamRes.status}.` });
  const json = await upstreamRes.json();

  if (!json.success || !json.data) return res.status(200).json({ success: false, message: json.message || "Tautan SnackVideo tidak valid." });
  return res.status(200).json({ success: true, data: json.data });
}

// ==========================================
// INSTAGRAM (Fastvidl)
// ==========================================
async function handleInstagram(url, res) {
  const upstreamRes = await fetch("https://fastvidl.com/api/lookup", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Accept: "application/json", "Content-Type": "application/json",
      Origin: "https://fastvidl.com", Referer: "https://fastvidl.com/",
    },
    body: JSON.stringify({ url }),
  });

  let json;
  try { json = await upstreamRes.json(); } catch (err) { return res.status(502).json({ success: false, message: "Respons server Instagram tidak valid." }); }

  if (!json.ok) return res.status(200).json({ success: false, message: json.message || "Gagal memproses tautan Instagram." });
  
  const selected = (json.media || [])[0] || {};
  const data = {
    platform: json.source || "instagram",
    downloadUrl: selected.url || json.url || "",
    preview: selected.thumbnail || json.thumbnail || "",
    mediaType: selected.type || json.type || "image",
    quality: selected.quality || json.quality || "HD",
    description: selected.label || "",
  };

  if (!data.downloadUrl) return res.status(200).json({ success: false, message: "Media tidak ditemukan untuk tautan ini." });
  return res.status(200).json({ success: true, data });
}
