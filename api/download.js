// api/download.js
import handleYoutubeScraper from '../lib/youtubeScraper.js';

export default async function handler(req, res) {
  // Ambil query parameter dari frontend
  const { platform, url } = req.query;

  if (!url) {
    return res.status(200).json({ 
      success: false, 
      message: "Tautan/URL tidak boleh kosong." 
    });
  }

  try {
    // Router berdasarkan query 'platform' yang dikirim frontend
    switch (platform) {
      case 'youtube':
        return await handleYoutubeScraper(url, res);
      
      // Placeholder untuk platform lain
      case 'instagram':
      case 'tiktok_v2':
      case 'douyin':
      case 'twitter':
      case 'capcut':
      case 'snackvideo':
        return res.status(200).json({ 
          success: false, 
          message: `Fitur untuk platform ${platform} sedang dalam perbaikan/belum dihubungkan.` 
        });

      default:
        return res.status(200).json({ 
          success: false, 
          message: "Platform tidak didukung atau tidak dikenali." 
        });
    }
  } catch (globalError) {
    console.error("Global API Error:", globalError);
    return res.status(200).json({ 
      success: false, 
      message: `Terjadi kesalahan internal server: ${globalError.message}` 
    });
  }
}
