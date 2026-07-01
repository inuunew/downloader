// Vercel Serverless Function — proxies requests to the cuki.biz.id downloader API.
// Runs server-side, so there's no browser CORS restriction, and the API key
// never gets exposed in client-side JS.

const API_KEY = "cuki-x";
const AIO_ENDPOINT = "https://api.cuki.biz.id/api/downloader/aio";
const SNACKVIDEO_ENDPOINT = "https://api.cuki.biz.id/api/downloader/snackVideo";

export default async function handler(req, res) {
  const { url, platform } = req.query;

  if (!url) {
    res.status(400).json({ success: false, message: "Parameter 'url' wajib diisi." });
    return;
  }

  const base = platform === "snackvideo" ? SNACKVIDEO_ENDPOINT : AIO_ENDPOINT;
  const target = `${base}?apikey=${API_KEY}&url=${encodeURIComponent(url)}`;

  try {
    const upstream = await fetch(target);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({
      success: false,
      message: "Gagal menghubungi server downloader. Coba lagi sebentar lagi.",
    });
  }
}
