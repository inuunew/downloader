// api/download.js
import { gotScraping } from 'got-scraping';

/**
 * ═══════════════════════════════════════════════════════════
 * YTDL — YOUTUBE DOWNLOADER WRAPPER FOR VERCEL
 * Base: vidssave.com (Scraper Logic by DEFAN)
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

const YTDL_CONFIG = {
  apiUrl: 'https://api.vidssave.com/api/contentsite_api/media/parse',
  websiteUrl: 'https://vidssave.com',
  domain: 'api-ak.vidssave.com',
};

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
      return await handleYoutubeNewScraper(url, res);
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
// NEW YOUTUBE SCRAPER (Base: Vidssave)
// ==========================================
async function handleYoutubeNewScraper(youtubeUrl, res) {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  try {
    // 1. Ekstrak Auth Token dari Vidssave HTML
    const htmlResponse = await gotScraping.get(YTDL_CONFIG.websiteUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }).text();

    const patterns = [
      /auth['":\s]+['"](\d{8}[a-z]{7})['"]/i,
      /auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i,
      /['"]auth['"]\s*:\s*['"](\d{8}[a-z]{7})['"]/i,
      /data-auth=['"](\d{8}[a-z]{7})['"]/i,
      /var\s+auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i
    ];

    let authToken = null;
    for (const pattern of patterns) {
      const match = htmlResponse.match(pattern);
      if (match && match[1]) {
        authToken = match[1];
        break;
      }
    }

    // Jika gagal di HTML utama, coba cari di file JS internal mereka
    if (!authToken) {
      const jsFiles = htmlResponse.match(/src=['"]([^'"]*\.js[^'"]*)['"]/gi) || [];
      for (const jsFile of jsFiles) {
        const jsUrl = jsFile.match(/src=['"]([^'"]+)['"]/i)?.[1];
        if (jsUrl) {
          try {
            const fullUrl = jsUrl.startsWith('http') ? jsUrl : `${YTDL_CONFIG.websiteUrl}${jsUrl}`;
            const jsContent = await gotScraping.get(fullUrl, { headers: { 'User-Agent': userAgent } }).text();
            for (const pattern of patterns) {
              const match = jsContent.match(pattern);
              if (match && match[1]) {
                authToken = match[1];
                break;
              }
            }
            if (authToken) break;
          } catch {}
        }
      }
    }

    if (!authToken) {
      return res.status(200).json({ success: false, message: "Gagal mendapatkan kunci akses bypass YouTube." });
    }

    // 2. Kirim Request Parse ke Api Vidssave
    const searchParams = new URLSearchParams({
      auth: authToken,
      domain: YTDL_CONFIG.domain,
      origin: 'source',
      link: youtubeUrl
    });

    const parseResponse = await gotScraping.post(YTDL_CONFIG.apiUrl, {
      body: searchParams.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
        'Origin': YTDL_CONFIG.websiteUrl,
        'Referer': `${YTDL_CONFIG.websiteUrl}/`,
        'Accept': 'application/json, text/plain, */*'
      }
    }).json();

    if (!parseResponse || parseResponse.status !== 1 || !parseResponse.data) {
      return res.status(200).json({ 
        success: false, 
        message: parseResponse.msg || parseResponse.message || "Gagal memproses video YouTube dari server baru." 
      });
    }

    const rawData = parseResponse.data;
    const mappedMedias = [];

    // 3. Normalisasi data media agar pas dengan App.jsx Frontend
    if (rawData.media && Array.isArray(rawData.media)) {
      rawData.media.forEach(m => {
        if ((m.type === 'video' || m.type === 'audio') && m.resources) {
          m.resources.forEach(r => {
            if (r.download_url) {
              mappedMedias.push({
                type: m.type,
                url: r.download_url,
                quality: r.quality || (m.type === 'audio' ? '128kbps' : 'Original'),
                extension: (r.format || (m.type === 'audio' ? 'mp3' : 'mp4')).toLowerCase(),
                data_size: r.size || null // Otomatis dihitung formatBytes() di frontend kamu
              });
            }
          });
        }
      });
    }

    // Sort kualitas video dari yang paling tinggi
    const videos = mappedMedias.filter(m => m.type === 'video').sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));
    const audios = mappedMedias.filter(m => m.type === 'audio');

    return res.status(200).json({
      success: true,
      data: {
        title: rawData.title || "YouTube Video",
        thumbnail: rawData.thumbnail || null,
        author: null,
        source: 'youtube',
        duration: rawData.duration ? parseInt(rawData.duration, 10) : null,
        statistics: {
          digg_count: rawData.like_count || 0,
          comment_count: rawData.comment_count || 0
        },
        medias: [...videos, ...audios]
      }
    });

  } catch (error) {
    console.error('[-] New YouTube Scraper Error:', error.message);
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
