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
    // 1. Bypass & Verifikasi (Sama seperti sebelumnya)
    const bypassApiUrl = 'https://zchat-1-zar-cfbypass.hf.space/solve?sitekey=0x4AAAAAADE4A2vZ35_4vI54&url=https://snapscooper.com';
    const responseBypass = await gotScraping.get(bypassApiUrl).json();
    if (!responseBypass.success) return res.status(200).json({ success: false, message: "Gagal bypass keamanan." });
    
    const turnstileToken = responseBypass.token;
    await client.post('https://snapscooper.com/cdn-cgi/challenge-platform/h/g/c/a1498ca01d39fdce', {
      json: { secondaryToken: turnstileToken, sitekey: '0x4AAAAAADE4A2vZ35_4vI54' }
    });
    await client.post('https://snapscooper.com/api/token/request', { json: { ct: turnstileToken } });

    // 2. Ambil data (Post Info)
    const resStep4 = await client.post('https://snapscooper.com/api/tool/post-info', {
      json: { toolId: 'youtube', url: youtubeUrl, highres: false }
    }).json();

    if (!resStep4.contents || !resStep4.contents[0]) {
      return res.status(200).json({ success: false, message: "Video tidak ditemukan." });
    }

    const mediaData = resStep4.contents[0];
    const allMedias = [];

    // Fungsi helper untuk memproses daftar (Video/Audio)
    // Kita ambil 1-2 opsi teratas saja agar proses render tidak berat/lama
    const processItems = async (items, typeLabel) => {
        if (!items || items.length === 0) return;
        // Ambil maksimal 2 item teratas (kualitas terbaik/menengah)
        const targets = items.slice(0, 2); 
        
        for (const item of targets) {
            let finalUrl = item.url;
            
            // Jika butuh render, panggil sseStatusUrl
            if (item.is_render !== false) {
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
            }

            allMedias.push({
                type: typeLabel, // 'video' atau 'audio'
                url: finalUrl,
                quality: item.label,
                extension: typeLabel === 'audio' ? 'mp3' : 'mp4'
            });
        }
    };

    // Jalankan pemrosesan video dan audio
    await processItems(mediaData.videos, 'video');
    await processItems(mediaData.audios, 'audio');

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
    return res.status(200).json({ success: false, message: "Gagal memproses YouTube." });
  }
}
