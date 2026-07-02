// /api/download.js
import { gotScraping } from 'got-scraping';
import { CookieJar } from 'tough-cookie';
import readline from 'readline';

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
      return await handleYoutubeScraper(url, res);
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

// --- YouTube: Menggunakan Custom Scraper (Snapscooper) ---
async function handleYoutubeScraper(youtubeUrl, res) {
  const type = 'video';
  const quality = '720p';
  const cookieJar = new CookieJar();

  const baseHeaders = {
    'sec-ch-ua-platform': '"Android"',
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'accept': 'application/json',
    'origin': 'https://snapscooper.com',
    'referer': 'https://snapscooper.com/tools/youtube',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
  };

  const client = gotScraping.extend({ cookieJar, headers: baseHeaders, http2: true });

  try {
    // Step 0: Bypass Turnstile API
    const bypassApiUrl = 'https://zchat-1-zar-cfbypass.hf.space/solve?sitekey=0x4AAAAAADE4A2vZ35_4vI54&url=https://snapscooper.com';
    const responseBypass = await gotScraping.get(bypassApiUrl).json();
    
    if (!responseBypass.success) {
      return res.status(200).json({ success: false, message: "Gagal melewati sistem keamanan server." });
    }
    const turnstileToken = responseBypass.token;

    // Step 1: Challenge Platform
    const challengeUrl = 'https://snapscooper.com/cdn-cgi/challenge-platform/h/g/c/a1498ca01d39fdce';
    await client.post(challengeUrl, {
      json: { secondaryToken: turnstileToken, sitekey: '0x4AAAAAADE4A2vZ35_4vI54' }
    });

    // Step 2: Request Token
    await client.post('https://snapscooper.com/api/token/request', {
      json: { ct: turnstileToken }
    }).json();

    // Step 3: Verifikasi via SSE
    const verifyStream = client.stream('https://snapscooper.com/api/token/verify', {
      method: 'GET',
      headers: { 'accept': 'text/event-stream', 'cache-control': 'no-cache', 'pragma': 'no-cache' }
    });

    const rlVerify = readline.createInterface({ input: verifyStream, terminal: false });
    let isVerified = false;
    for await (const line of rlVerify) {
      if (line.includes('data: verified')) {
        isVerified = true;
        verifyStream.destroy();
        break;
      }
    }

    if (!isVerified) {
      return res.status(200).json({ success: false, message: "Gagal verifikasi token (SSE)." });
    }

    // Step 4: Dapatkan Info Post
    const resStep4 = await client.post('https://snapscooper.com/api/tool/post-info', {
      json: { toolId: 'youtube', url: youtubeUrl, highres: false }
    }).json();

    if (!resStep4.contents || !resStep4.contents[0]) {
      return res.status(200).json({ success: false, message: "Video tidak ditemukan atau tidak didukung." });
    }

    const mediaData = resStep4.contents[0];
    const targetList = mediaData.videos;

    if (!targetList || targetList.length === 0) {
      return res.status(200).json({ success: false, message: "Format video tidak ditemukan." });
    }

    let selectedMedia = targetList.find(item => item.label.toLowerCase().includes(quality.toLowerCase())) || targetList[0];
    let finalDownloadUrl = selectedMedia.url;

    // Step 5 & 6: Proses Render jika dibutuhkan
    if (selectedMedia.is_render !== false) {
      const renderTriggerRes = await client.get(selectedMedia.url).json();
      if (!renderTriggerRes.sseStatusUrl) {
        return res.status(200).json({ success: false, message: "Gagal memulai proses render di server asal." });
      }

      const renderStream = client.stream(renderTriggerRes.sseStatusUrl, {
        method: 'GET',
        headers: { 'accept': 'text/event-stream', 'cache-control': 'no-cache', 'pragma': 'no-cache' }
      });

      const rlRender = readline.createInterface({ input: renderStream, terminal: false });
      finalDownloadUrl = null;

      for await (const line of rlRender) {
        if (line.startsWith('data: ')) {
          try {
            const statusData = JSON.parse(line.replace('data: ', '').trim());
            if (statusData.status === 'done' && statusData.output && statusData.output.url) {
              finalDownloadUrl = statusData.output.url;
              renderStream.destroy();
              break;
            }
          } catch (err) {}
        }
      }
    }

    if (!finalDownloadUrl) {
      return res.status(200).json({ success: false, message: "Gagal memproses video matang dari server." });
    }

    // Kembalikan format JSON sesuai ekspektasi frontend app.jsx
    return res.status(200).json({
      success: true,
      data: {
        title: resStep4.title || "YouTube Video",
        thumbnail: resStep4.thumbnail || null, // Jika snapscooper mengembalikan thumbnail
        author: resStep4.author || null,
        source: 'youtube',
        duration: null,
        statistics: null,
        medias: [{
          type: type,
          url: finalDownloadUrl,
          quality: selectedMedia.label,
          extension: 'mp4'
        }]
      }
    });

  } catch (error) {
    console.error('[-] YouTube Scraper Error:', error.message);
    return res.status(200).json({ success: false, message: "Terjadi kesalahan internal saat menarik video YouTube." });
  }
}

// --- inuutyz-backed platforms ---
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

// --- SnackVideo ---
async function handleSnackVideo(url, res) {
  const upstreamUrl = `${CUKI_BASE}/snackVideo?apikey=${CUKI_API_KEY}&url=${encodeURIComponent(url)}`;
  const upstreamRes = await fetch(upstreamUrl, { headers: { Accept: "application/json" } });

  if (!upstreamRes.ok) return res.status(502).json({ success: false, message: `Server sumber merespons dengan status ${upstreamRes.status}.` });
  const json = await upstreamRes.json();

  if (!json.success || !json.data) return res.status(200).json({ success: false, message: json.message || "Tautan SnackVideo tidak valid." });
  return res.status(200).json({ success: true, data: json.data });
}

// --- Instagram ---
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
