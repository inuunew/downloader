// api/download.js
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

// ==========================================
// 1. YOUTUBE SCRAPER (Snapscooper)
// ==========================================
async function handleYoutubeScraper(youtubeUrl, res) {
  const cookieJar = new CookieJar();
  const baseHeaders = {
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    'accept': 'application/json',
    'origin': 'https://snapscooper.com',
    'referer': 'https://snapscooper.com/tools/youtube',
  };

  const client = gotScraping.extend({ cookieJar, headers: baseHeaders, http2: true });

  try {
    const bypassApiUrl = 'https://zchat-1-zar-cfbypass.hf.space/solve?sitekey=0x4AAAAAADE4A2vZ35_4vI54&url=https://snapscooper.com';
    const responseBypass = await gotScraping.get(bypassApiUrl).json();
    
    if (!responseBypass.success) {
      return res.status(200).json({ success: false, message: "Gagal menembus proteksi keamanan upstream." });
    }
    
    const turnstileToken = responseBypass.token;
    await client.post('https://snapscooper.com/cdn-cgi/challenge-platform/h/g/c/a1498ca01d39fdce', {
      json: { secondaryToken: turnstileToken, sitekey: '0x4AAAAAADE4A2vZ35_4vI54' }
    });
    await client.post('https://snapscooper.com/api/token/request', { json: { ct: turnstileToken } });

    const resStep4 = await client.post('https://snapscooper.com/api/tool/post-info', {
      json: { toolId: 'youtube', url: youtubeUrl, highres: false }
    }).json();

    if (!resStep4 || !resStep4.contents || !resStep4.contents[0]) {
      return res.status(200).json({ success: false, message: "Video tidak ditemukan atau link tidak valid." });
    }

    const mediaData = resStep4.contents[0];
    const allMedias = [];

    const processSingleItem = async (items, typeLabel) => {
      if (!items || items.length === 0) return [];
      const item = items[0]; 
      let finalUrl = item.url;
      
      if (item.is_render !== false) {
        try {
          const renderTriggerRes = await client.get(item.url).json();
          if (renderTriggerRes.sseStatusUrl) {
            const stream = client.stream(renderTriggerRes.sseStatusUrl);
            const rl = readline.createInterface({ input: stream, terminal: false });
            
            for await (const line of rl) {
              if (line.includes('"status":"done"')) {
                const data = JSON.parse(line.replace('data: ', ''));
                finalUrl = data.output.url;
                stream.destroy();
                break;
              }
            }
          }
        } catch (renderError) {
          console.error(`[Render Error] Gagal memproses ${typeLabel}:`, renderError.message);
          finalUrl = item.url; 
        }
      }
      return [{
        type: typeLabel,
        url: finalUrl,
        quality: item.label || (typeLabel === 'audio' ? '128kbps' : 'Original'),
        extension: typeLabel === 'audio' ? 'mp3' : 'mp4'
      }];
    };

    const [videoResults, audioResults] = await Promise.all([
      processSingleItem(mediaData.videos, 'video'),
      processSingleItem(mediaData.audios, 'audio')
    ]);

    allMedias.push(...videoResults, ...audioResults);

    if (allMedias.length === 0 && mediaData.videos?.[0]) {
      allMedias.push({ type: 'video', url: mediaData.videos[0].url, quality: mediaData.videos[0].label || 'Default', extension: 'mp4' });
    }

    return res.status(200).json({
      success: true,
      data: {
        title: resStep4.title || "YouTube Video",
        thumbnail: resStep4.thumbnail || null,
        author: resStep4.author || null,
        source: 'youtube',
        medias: allMedias
      }
    });

  } catch (error) {
    console.error("Scraper Crash Error:", error);
    return res.status(200).json({ success: false, message: `Gagal memproses YouTube: ${error.message}` });
  }
}

// ==========================================
// 2. TIKTOK, DOUYIN, TWITTER, CAPCUT (Inuutyz)
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
// 3. SNACKVIDEO (Cuki)
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
// 4. INSTAGRAM (Fastvidl)
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
  try { 
    json = await upstreamRes.json(); 
  } catch (err) { 
    return res.status(502).json({ success: false, message: "Respons server Instagram tidak valid." }); 
  }

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
