// lib/youtubeScraper.js
import { CookieJar } from 'tough-cookie';
import { gotScraping } from 'got-scraping';
import readline from 'readline';

export default async function handleYoutubeScraper(youtubeUrl, res) {
  const cookieJar = new CookieJar();
  const baseHeaders = {
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    'accept': 'application/json',
    'origin': 'https://snapscooper.com',
    'referer': 'https://snapscooper.com/tools/youtube',
  };

  const client = gotScraping.extend({ cookieJar, headers: baseHeaders, http2: true });

  try {
    // 1. Bypass & Verifikasi Cloudflare / Turnstile
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

    // 2. Ambil Meta Data & Info Video
    const resStep4 = await client.post('https://snapscooper.com/api/tool/post-info', {
      json: { toolId: 'youtube', url: youtubeUrl, highres: false }
    }).json();

    if (!resStep4 || !resStep4.contents || !resStep4.contents[0]) {
      return res.status(200).json({ success: false, message: "Video tidak ditemukan atau link tidak valid." });
    }

    const mediaData = resStep4.contents[0];
    const allMedias = [];

    // Helper Fungsi Terisolasi untuk memproses 1 jenis media (Video / Audio)
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

    // 3. Eksekusi Video & Audio secara PARALEL
    const [videoResults, audioResults] = await Promise.all([
      processSingleItem(mediaData.videos, 'video'),
      processSingleItem(mediaData.audios, 'audio')
    ]);

    allMedias.push(...videoResults, ...audioResults);

    if (allMedias.length === 0 && mediaData.videos?.[0]) {
      allMedias.push({
        type: 'video',
        url: mediaData.videos[0].url,
        quality: mediaData.videos[0].label || 'Default',
        extension: 'mp4'
      });
    }

    // 4. Kirim Data Sukses Kembali ke Frontend NuuDown
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
    return res.status(200).json({ 
      success: false, 
      message: `Gagal memproses YouTube: ${error.message || "Upstream server error"}` 
    });
  }
}
