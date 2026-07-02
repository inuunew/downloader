import { gotScraping } from 'got-scraping';

/**
 * ═══════════════════════════════════════════════════════════
 * YTDL — MULTI DOWNLOADER WRAPPER FOR VERCEL
 * Updated with ytdown.to Proxy & IP Spoofing for YouTube
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

// Fungsi pembantu untuk membuat IP palsu guna menghindari block/rate-limit
function generateRandomIP() {
    const ranges = [
        [1, 1], [2, 2], [5, 5], [23, 23], [27, 27], [31, 31], [36, 36], [37, 37], [39, 39], [42, 42],
        [46, 46], [49, 49], [50, 50], [60, 60], [114, 114], [117, 117], [118, 118], [119, 119], [120, 120],
        [121, 121], [122, 122], [123, 123], [124, 124], [125, 125], [126, 126], [180, 180], [182, 182], [183, 183]
    ];
    const range = ranges[Math.floor(Math.random() * ranges.length)];
    return [
        range[0],
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256)
    ].join('.');
}

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
// NEW YOUTUBE SCRAPER (Base: ytdown.to Proxy)
// ==========================================
async function handleYoutubeNewScraper(youtubeUrl, res) {
  const PROXY_API = 'https://app.ytdown.to/proxy.php';
  const spoofedIp = generateRandomIP();

  try {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'X-Forwarded-For': spoofedIp,
      'X-Real-IP': spoofedIp,
      'Client-IP': spoofedIp,
      'True-Client-IP': spoofedIp,
      'X-Originating-IP': spoofedIp,
      'X-Cluster-Client-IP': spoofedIp,
      'Forwarded': `for=${spoofedIp}`,
      'Accept': '*/*',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://ytdown.to/'
    };

    const body = new URLSearchParams();
    body.append('url', youtubeUrl);

    // Menggunakan fetch bawaan Node.js (Vercel) untuk menembak proxy target
    const response = await fetch(PROXY_API, {
      method: "POST",
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      return res.status(502).json({ 
        success: false, 
        message: `Server ytdown merespons dengan kode status ${response.status}` 
      });
    }

    const rawText = await response.text();
    let parsedData;

    try {
      parsedData = JSON.parse(rawText);
    } catch (e) {
      return res.status(200).json({ 
        success: false, 
        message: "Gagal memproses struktur data dari server bypass.", 
        debug: rawText 
      });
    }

    if (parsedData.status === false || parsedData.error) {
      return res.status(200).json({ 
        success: false, 
        message: parsedData.error || "Gagal mengambil data video YouTube." 
      });
    }

    // 💡 NORMALISASI DATA (Sesuaikan properti ini jika struktur links dari ytdown berbeda)
    const mappedMedias = [];
    
    // Asumsi ytdown mengembalikan array media di properti `links` atau `media`
    const rawMedias = parsedData.links || parsedData.media || [];
    
    if (Array.isArray(rawMedias)) {
      rawMedias.forEach(m => {
        mappedMedias.push({
          type: m.type || 'video', // 'video' atau 'audio'
          url: m.url || m.download_url,
          quality: m.quality || 'Original',
          extension: m.extension || m.format || 'mp4',
          data_size: m.size || m.data_size || null
        });
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        title: parsedData.title || "YouTube Video",
        thumbnail: parsedData.thumbnail || parsedData.cover || null,
        author: parsedData.author || null,
        source: 'youtube',
        duration: parsedData.duration || null,
        statistics: {
          digg_count: parsedData.likes || 0,
          comment_count: 0
        },
        medias: mappedMedias
      }
    });

  } catch (error) {
    console.error('[-] ytdown Proxy Error:', error.message);
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
