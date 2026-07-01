import axios from 'axios';

// Konfigurasi API Lama (Khusus SnackVideo)
const API_KEY = "cuki-x";
const SNACKVIDEO_ENDPOINT = "https://api.cuki.biz.id/api/downloader/snackVideo";

// =========================================================================
// SETUP SCRAPER VIDSSAVE
// =========================================================================
const kz = "DEFAN", dk = "dipastebin.web.id", ch = "0029Vb89qIx1XquQoXgzdd2m";
const config = {
    apiUrl: 'https://api.vidssave.com/api/contentsite_api/media/parse',
    websiteUrl: 'https://vidssave.com',
    domain: 'api-ak.vidssave.com',
    meta: { kz, dk, ch }
};

const utils = {
    randomUserAgent: () => {
        const agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        return agents[Math.floor(Math.random() * agents.length)];
    },

    formatSize: (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
    },

    getMeta: () => config.meta
};

class vidssaveClient {
    constructor() {
        this.userAgent = utils.randomUserAgent();
        this.auth = null;
        this._meta = utils.getMeta();
    }

    _getHeaders() {
        return {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': this.userAgent,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Origin': config.websiteUrl,
            'Referer': `${config.websiteUrl}/`
        };
    }

    async extractAuth() {
        try {
            const response = await axios.get(config.websiteUrl, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                timeout: 30000
            });

            const html = response.data;
            const patterns = [
                /auth['":\s]+['"](\d{8}[a-z]{7})['"]/i,
                /auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i,
                /['"]auth['"]\s*:\s*['"](\d{8}[a-z]{7})['"]/i,
                /data-auth=['"](\d{8}[a-z]{7})['"]/i,
                /var\s+auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i,
                /let\s+auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i,
                /const\s+auth\s*=\s*['"](\d{8}[a-z]{7})['"]/i
            ];

            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }

            const jsFiles = html.match(/src=['"]([^'"]*\.js[^'"]*)['"]/gi) || [];
            for (const jsFile of jsFiles) {
                const jsUrl = jsFile.match(/src=['"]([^'"]+)['"]/i)?.[1];
                if (jsUrl) {
                    try {
                        const fullUrl = jsUrl.startsWith('http') ? jsUrl : `${config.websiteUrl}${jsUrl}`;
                        const jsResponse = await axios.get(fullUrl, {
                            headers: { 'User-Agent': this.userAgent },
                            timeout: 15000
                        });

                        for (const pattern of patterns) {
                            const match = jsResponse.data.match(pattern);
                            if (match && match[1]) {
                                return match[1];
                            }
                        }
                    } catch {}
                }
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async parse(url) {
        if (!this.auth) {
            this.auth = await this.extractAuth();
            if (!this.auth) {
                return {
                    success: false,
                    error: 'Gagal mengekstrak token otentikasi dari Vidssave'
                };
            }
        }

        try {
            const params = new URLSearchParams();
            params.append('auth', this.auth);
            params.append('domain', config.domain);
            params.append('origin', 'source');
            params.append('link', url);

            const response = await axios.post(config.apiUrl, params.toString(), {
                headers: this._getHeaders(),
                timeout: 60000,
                maxRedirects: 5
            });

            if (response.data && response.data.status === 1) {
                return { success: true, data: response.data.data, auth: this.auth };
            } else {
                return {
                    success: false,
                    error: response.data?.msg || response.data?.message || 'Gagal memproses tautan dari server sumber.',
                    raw: response.data,
                    auth: this.auth
                };
            }
        } catch (error) {
            if (error.response) {
                return {
                    success: false,
                    error: `Terjadi kendala jaringan (HTTP ${error.response.status}). Coba lagi.`,
                    raw: error.response.data,
                    auth: this.auth
                };
            }
            return { success: false, error: error.message, auth: this.auth };
        }
    }

    formatResult(result, originalUrl) {
        const output = {
            success: result.success,
            auth: result.auth || this.auth,
            user_agent: this.userAgent,
            original_url: originalUrl,
            timestamp: new Date().toISOString()
        };

        if (!result.success) {
            output.error = result.error;
            if (result.raw) output.raw = result.raw;
            return output;
        }

        const data = result.data;
        output.id = data.id;
        output.title = data.title;
        output.thumbnail = data.thumbnail;
        output.duration = data.duration;
        output.publish_ts = data.publish_ts;
        output.like_count = data.like_count || 0;
        output.comment_count = data.comment_count || 0;
        
        output.videos = [];
        output.audios = [];
        output.images = []; // Ditambahkan untuk dukungan carousel Instagram/TikTok

        if (data.media && Array.isArray(data.media)) {
            data.media.forEach(m => {
                if (m.type === 'video' && m.resources) {
                    m.resources.forEach(r => {
                        if (r.download_url) {
                            output.videos.push({
                                quality: r.quality || 'unknown',
                                format: r.format || 'MP4',
                                size: r.size || 0,
                                size_human: utils.formatSize(r.size),
                                download_url: r.download_url
                            });
                        }
                    });
                } else if (m.type === 'audio' && m.resources) {
                    m.resources.forEach(r => {
                        if (r.download_url) {
                            output.audios.push({
                                quality: r.quality || 'unknown',
                                format: r.format || 'MP3',
                                size: r.size || 0,
                                size_human: utils.formatSize(r.size),
                                download_url: r.download_url
                            });
                        }
                    });
                } else if (m.type === 'image' && m.resources) {
                    m.resources.forEach(r => {
                        if (r.download_url) {
                            output.images.push({
                                quality: r.quality || 'unknown',
                                format: r.format || 'JPG',
                                size: r.size || 0,
                                size_human: utils.formatSize(r.size),
                                download_url: r.download_url
                            });
                        }
                    });
                }
            });
        }

        output.videos.sort((a, b) => {
            const qA = parseInt(a.quality) || 0;
            const qB = parseInt(b.quality) || 0;
            return qB - qA;
        });

        return output;
    }
}
// =========================================================================

export default async function handler(req, res) {
    const { url, platform } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, message: "Parameter 'url' wajib diisi." });
    }

    // --- 1. Logika Khusus SnackVideo (Menggunakan cuki.biz.id) ---
    if (platform === "snackvideo") {
        const target = `${SNACKVIDEO_ENDPOINT}?apikey=${API_KEY}&url=${encodeURIComponent(url)}`;
        try {
            // Menggunakan fetch bawaan (tersedia di Node 18+)
            const upstream = await fetch(target);
            const data = await upstream.json();
            return res.status(upstream.status).json(data);
        } catch (err) {
            return res.status(502).json({
                success: false,
                message: "Gagal menghubungi server downloader SnackVideo. Coba lagi sebentar lagi.",
            });
        }
    }

    // --- 2. Logika Platform Lainnya (Menggunakan Vidssave) ---
    try {
        const client = new vidssaveClient();
        const result = await client.parse(url);
        const output = client.formatResult(result, url);

        if (!output.success) {
            return res.status(500).json({ 
                success: false, 
                message: output.error || "Gagal mengambil data dari Vidssave." 
            });
        }

        return res.status(200).json(output);

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Terjadi kesalahan internal pada sistem server.",
            error: err.message
        });
    }
}
