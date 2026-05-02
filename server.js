
const express = require('express');
const cors = require('cors');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Dosya yolları ───────────────────────────────────────────────────────────
const DATA_DIR = process.env.STEAM_IDLER_DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { }
const TOKENS_FILE = path.join(DATA_DIR, '.steam_tokens.json');
const HISTORY_FILE = path.join(DATA_DIR, '.idle_history.json');
const SETTINGS_FILE = path.join(DATA_DIR, '.settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            return {
                rememberMe: Boolean(parsed?.rememberMe),
            };
        }
    } catch (e) { }
    return { rememberMe: false };
}

function saveSettings(next) {
    const safe = {
        rememberMe: Boolean(next?.rememberMe),
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(safe, null, 2));
    return safe;
}

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) { }
    return [];
}

function saveHistory(entry) {
    const history = loadHistory();
    history.unshift(entry); // en yenisi başa
    // max 200 kayıt tut
    if (history.length > 200) history.length = 200;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function loadTokens() {
    if (!loadSettings().rememberMe) return {};
    try {
        if (fs.existsSync(TOKENS_FILE)) {
            return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
        }
    } catch (e) { }
    return {};
}

function saveToken(username, refreshToken, displayName) {
    if (!loadSettings().rememberMe) return;
    const tokens = loadTokens();
    tokens[username] = { refreshToken, displayName, savedAt: Date.now() };
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function deleteToken(username) {
    const tokens = loadTokens();
    delete tokens[username];
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// ─── State ────────────────────────────────────────────────────────────────────
let client = null;
let currentState = {
    loggedIn: false,
    username: '',
    steamId: '',
    displayName: '',
    avatarUrl: '',
    idlingGames: [],
    totalIdleTime: 0,
    startTime: null,
    status: 'disconnected',
    errorMessage: '',
    games: [],
    steamGuardRequired: false,
    steamGuardType: null,
    qrCodeImage: null,   // base64 PNG
};

let idleTimer = null;
let steamGuardCallback = null;

function resetClient() {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    if (client) {
        try { client.logOff(); } catch (e) { }
        client.removeAllListeners();
        client = null;
    }
    currentState = {
        loggedIn: false,
        username: '',
        steamId: '',
        displayName: '',
        avatarUrl: '',
        idlingGames: [],
        totalIdleTime: 0,
        startTime: null,
        status: 'disconnected',
        errorMessage: '',
        games: [],
        steamGuardRequired: false,
        steamGuardType: null,
    };
    steamGuardCallback = null;
}

function setupClientEvents(c) {
    c.on('loggedOn', () => {
        currentState.status = 'connected';
        currentState.loggedIn = true;
        currentState.steamGuardRequired = false;
        currentState.steamId = c.steamID.toString();
        c.setPersona(SteamUser.EPersonaState.Online);

        // Avatar + görünen adı getPersonas ile çek
        try {
            c.getPersonas([c.steamID], (err, personas) => {
                if (!err && personas) {
                    const sid64 = c.steamID.getSteamID64();
                    const persona = personas[sid64];
                    if (persona) {
                        if (persona.player_name) currentState.displayName = persona.player_name;
                        if (persona.avatar_hash) {
                            const hash = Buffer.isBuffer(persona.avatar_hash)
                                ? persona.avatar_hash.toString('hex')
                                : String(persona.avatar_hash);
                            if (!/^0+$/.test(hash)) {
                                currentState.avatarUrl = `https://avatars.steamstatic.com/${hash}_full.jpg`;
                                console.log('🖼️ Avatar:', currentState.avatarUrl);
                            }
                        }
                    }
                } else {
                    console.log('getPersonas hatası:', err?.message);
                }
            });
        } catch (e) {
            console.error('getPersonas hatası:', e.message);
        }

        // Sahip olunan oyunları çek
        try {
            c.getUserOwnedApps(c.steamID, { includePlayedFreeGames: true }, (err, res) => {
                if (!err && res && res.apps) {
                    currentState.games = res.apps.map(a => ({
                        appid: a.appid,
                        name: a.name || `App ${a.appid}`,
                        playtime: a.playtime_forever || 0,  // dakika cinsinden
                    }));
                    console.log(`✅ ${currentState.games.length} oyun yüklendi.`);
                } else {
                    console.log('Oyun listesi alınamadı:', err?.message || 'boş yanıt');
                }
            });
        } catch (e) {
            console.error('getOwnedApps hatası:', e.message);
        }
    });

    // Refresh token'ı kaydet
    c.on('refreshToken', (token) => {
        if (currentState.username) {
            saveToken(currentState.username, token, currentState.displayName);
            console.log(`✅ Refresh token kaydedildi: ${currentState.username}`);
        }
    });

    c.on('accountInfo', (name) => {
        currentState.displayName = name;
        // token'daki displayName'i güncelle
        if (currentState.username) {
            const tokens = loadTokens();
            if (tokens[currentState.username]) {
                tokens[currentState.username].displayName = name;
                fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
            }
        }
    });

    c.on('steamID', (steamId) => {
        // loggedOn'da zaten set ediliyor, yedek olarak burada da güncelle
        currentState.steamId = steamId.toString();
    });

    c.on('error', (err) => {
        console.error('Steam error:', err.eresult, err.message);
        let msg = err.message || 'Bilinmeyen hata';
        if (err.eresult === 5) msg = 'Kullanıcı adı veya şifre hatalı!';
        else if (err.eresult === 84) msg = 'Çok fazla giriş denemesi. Lütfen birkaç saat bekleyin.';
        else if (err.eresult === 65) msg = 'Steam Guard doğrulaması başarısız.';
        else if (err.eresult === 11 || msg.includes('refreshToken')) {
            // Token geçersiz olmuş, sil
            if (currentState.username) deleteToken(currentState.username);
            msg = 'Kayıtlı oturum süresi dolmuş. Lütfen tekrar giriş yapın.';
        }
        currentState.status = 'error';
        currentState.errorMessage = msg;
        currentState.loggedIn = false;
        if (idleTimer) clearInterval(idleTimer);
    });

    c.on('disconnected', (eresult, msg) => {
        console.log('Disconnected:', eresult, msg);
        if (currentState.status === 'connected') {
            currentState.status = 'disconnected';
            currentState.loggedIn = false;
            if (idleTimer) clearInterval(idleTimer);
        }
    });

    c.on('steamGuard', (domain, callback, lastCodeWrong) => {
        console.log('Steam Guard required, domain:', domain);
        currentState.steamGuardRequired = true;
        currentState.steamGuardType = domain ? 'email' : 'mobile';
        currentState.status = 'steamguard';
        steamGuardCallback = callback;
    });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Settings (kalıcı)
app.get('/api/settings', (req, res) => {
    res.json(loadSettings());
});

app.put('/api/settings', (req, res) => {
    const { rememberMe } = req.body || {};
    const saved = saveSettings({ rememberMe });
    res.json(saved);
});

// Mevcut state
app.get('/api/state', (req, res) => {
    res.json(currentState);
});

// Kayıtlı hesapları listele
app.get('/api/saved-accounts', (req, res) => {
    if (!loadSettings().rememberMe) return res.json([]);
    const tokens = loadTokens();
    const accounts = Object.entries(tokens).map(([username, data]) => ({
        username,
        displayName: data.displayName || username,
        savedAt: data.savedAt,
    }));
    res.json(accounts);
});

// Kayıtlı hesabı sil
app.delete('/api/saved-accounts/:username', (req, res) => {
    deleteToken(req.params.username);
    res.json({ success: true });
});

// QR Kod ile giriş
let qrSession = null;
app.post('/api/login/qr', async (req, res) => {
    if (client) resetClient();
    client = new SteamUser({ enablePicsCache: false });
    setupClientEvents(client);

    currentState.status = 'qr';
    currentState.qrCodeImage = null;

    try {
        if (qrSession) {
            try { qrSession.cancelLoginAttempt(); } catch (e) { }
        }

        qrSession = new LoginSession(EAuthTokenPlatformType.SteamClient);

        qrSession.on('authenticated', async () => {
            console.log(`✅ QR okundu. Giriş yapılıyor: ${qrSession.accountName}`);
            currentState.username = qrSession.accountName;
            currentState.status = 'connecting';
            // Alınan refresh token ile steam-user'a gerçek login yapılıyor
            client.logOn({ refreshToken: qrSession.refreshToken });
        });

        qrSession.on('timeout', () => {
            console.log('⏳ QR kodu zaman aşımına uğradı');
            if (currentState.status === 'qr') {
                currentState.status = 'error';
                currentState.errorMessage = 'QR kod süresi doldu. Lütfen yeniden deneyin.';
            }
        });

        qrSession.on('error', (err) => {
            console.log('❌ QR hata:', err.message);
            currentState.status = 'error';
            currentState.errorMessage = err.message;
        });

        const result = await qrSession.startWithQR();

        currentState.qrCodeImage = await QRCode.toDataURL(result.qrChallengeUrl, {
            width: 240,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
        });

        console.log('✅ Yeni QR kod oluşturuldu.');
        res.json({ success: true, message: 'QR kod hazır' });
    } catch (e) {
        console.error('QR Başlatma Hatası:', e.message);
        currentState.status = 'error';
        currentState.errorMessage = e.message;
        res.status(500).json({ error: e.message });
    }
});

// Token ile giriş (şifre olmadan)
app.post('/api/login/token', (req, res) => {
    if (!loadSettings().rememberMe) {
        return res.status(403).json({ error: 'Beni hatırla kapalıyken kayıtlı oturum kullanılamaz.' });
    }
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });

    const tokens = loadTokens();
    const saved = tokens[username];
    if (!saved || !saved.refreshToken) {
        return res.status(404).json({ error: 'Bu hesap için kayıtlı oturum bulunamadı.' });
    }

    if (client) resetClient();
    client = new SteamUser({ enablePicsCache: false });
    setupClientEvents(client);
    currentState.status = 'connecting';
    currentState.username = username;
    currentState.displayName = saved.displayName || username;

    try {
        client.logOn({ refreshToken: saved.refreshToken });
        res.json({ success: true, message: 'Token ile giriş deneniyor...' });
    } catch (e) {
        currentState.status = 'error';
        currentState.errorMessage = e.message;
        res.status(500).json({ error: e.message });
    }
});

// Normal giriş (kullanıcı adı + şifre)
app.post('/api/login', (req, res) => {
    const { username, password, sharedSecret } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
    }

    if (client) resetClient();
    client = new SteamUser({ enablePicsCache: false });
    setupClientEvents(client);
    currentState.status = 'connecting';
    currentState.username = username;

    const loginDetails = { accountName: username, password };

    if (sharedSecret && sharedSecret.trim()) {
        try {
            loginDetails.twoFactorCode = SteamTotp.generateAuthCode(sharedSecret.trim());
        } catch (e) {
            console.error('TOTP error:', e);
        }
    }

    try {
        client.logOn(loginDetails);
        res.json({ success: true, message: 'Giriş isteği gönderildi.' });
    } catch (e) {
        currentState.status = 'error';
        currentState.errorMessage = e.message;
        res.status(500).json({ error: e.message });
    }
});

// Steam Guard kodu gönder
app.post('/api/steamguard', (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Kod gerekli.' });
    if (!steamGuardCallback) return res.status(400).json({ error: 'Steam Guard beklemiyor.' });
    steamGuardCallback(code);
    steamGuardCallback = null;
    currentState.steamGuardRequired = false;
    currentState.status = 'connecting';
    res.json({ success: true });
});

// Saat kasımını başlat
app.post('/api/idle/start', (req, res) => {
    const { appids } = req.body;
    if (!client || !currentState.loggedIn) {
        return res.status(400).json({ error: 'Steam\'e giriş yapılmamış.' });
    }
    if (!appids || !appids.length) {
        return res.status(400).json({ error: 'En az bir oyun seçin.' });
    }

    const games = appids.map(id => parseInt(id));
    client.gamesPlayed(games);
    currentState.idlingGames = games;
    currentState.startTime = Date.now();

    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(() => {
        if (currentState.startTime) {
            currentState.totalIdleTime = Math.floor((Date.now() - currentState.startTime) / 1000);
        }
    }, 1000);

    res.json({ success: true, idling: games });
});

// Saat kasımını durdur
app.post('/api/idle/stop', (req, res) => {
    if (!client || !currentState.loggedIn) {
        return res.status(400).json({ error: 'Steam\'e giriş yapılmamış.' });
    }

    // Oturumu geçmişe kaydet (en az 10 saniye süreli)
    if (currentState.idlingGames.length > 0 && currentState.totalIdleTime >= 10) {
        const gameDetails = currentState.idlingGames.map(id => {
            const g = currentState.games.find(g => g.appid === id);
            return { appid: id, name: g ? g.name : `App ${id}` };
        });
        saveHistory({
            id: Date.now(),
            date: new Date().toISOString(),
            username: currentState.username,
            displayName: currentState.displayName,
            games: gameDetails,
            durationSeconds: currentState.totalIdleTime,
            startTime: currentState.startTime,
        });
        console.log(`📋 Geçmiş kaydedildi: ${gameDetails.map(g => g.name).join(', ')} — ${currentState.totalIdleTime}s`);
    }

    client.gamesPlayed([]);
    currentState.idlingGames = [];
    currentState.startTime = null;
    currentState.totalIdleTime = 0;
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    res.json({ success: true });
});

// Çıkış yap
app.post('/api/logout', (req, res) => {
    resetClient();
    res.json({ success: true });
});

// Manuel oyun ekle
app.post('/api/games/add', (req, res) => {
    const { appid, name } = req.body;
    if (!appid) return res.status(400).json({ error: 'AppID gerekli.' });
    const id = parseInt(appid);
    const exists = currentState.games.find(g => g.appid === id);
    if (!exists) {
        currentState.games.push({ appid: id, name: name || `App ${id}`, playtime: 0 });
    }
    res.json({ success: true });
});

// Oyun listesini Steam'den yenile (playtime dahil)
app.post('/api/games/refresh', (req, res) => {
    if (!client || !currentState.loggedIn) {
        return res.status(400).json({ error: 'Steam\'e giriş yapılmamış.' });
    }
    try {
        client.getUserOwnedApps(client.steamID, { includePlayedFreeGames: true }, (err, result) => {
            if (!err && result && result.apps) {
                currentState.games = result.apps.map(a => ({
                    appid: a.appid,
                    name: a.name || `App ${a.appid}`,
                    playtime: a.playtime_forever || 0,
                }));
                console.log(`🔄 Oyun listesi yenilendi: ${currentState.games.length} oyun.`);
            }
        });
        res.json({ success: true, message: 'Oyun listesi yenileniyor...' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Geçmişi getir
app.get('/api/history', (req, res) => {
    res.json(loadHistory());
});

// Geçmişi temizle
app.delete('/api/history', (req, res) => {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
    res.json({ success: true });
});

// Tek geçmiş kaydını sil
app.delete('/api/history/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const history = loadHistory().filter(h => h.id !== id);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    res.json({ success: true });
});

// ─── UI (Vite build) serve ────────────────────────────────────────────────────
// EXE paketinde frontend'i aynı sunucudan servis eder (http://localhost:3001).
// Dev modda `npm run dev` zaten Vite ile çalışır; burada sadece dist varsa devreye girer.
const DIST_DIR = path.join(__dirname, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');
if (fs.existsSync(DIST_INDEX)) {
    app.use(express.static(DIST_DIR));
    // Express 5: '*' path pattern crashes (path-to-regexp). Use a regexp catch-all.
    app.get(/.*/, (req, res) => {
        res.sendFile(DIST_INDEX);
    });
}

const PORT = parseInt(process.env.PORT || '3001', 10);
function startServer(port = PORT) {
    return app.listen(port, () => {
        console.log(`✅ Steam Idler Backend çalışıyor: http://localhost:${port}`);
        const tokens = loadTokens();
        const count = Object.keys(tokens).length;
        if (count > 0) {
            console.log(`💾 ${count} kayıtlı hesap bulundu.`);
        }
    });
}

module.exports = { startServer };

if (require.main === module) {
    startServer();
}

// Crash'leri yakala, backend durmasın
process.on('uncaughtException', (err) => {
    console.error('⚠️  Yakalanmamış hata (backend çalışmaya devam ediyor):', err.message);
    currentState.status = 'error';
    currentState.errorMessage = 'Sunucu hatası: ' + err.message;
    currentState.loggedIn = false;
});

process.on('unhandledRejection', (reason) => {
    console.error('⚠️  İşlenmeyen Promise hatası:', reason?.message || reason);
});
=======
const express = require('express');
const cors = require('cors');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Dosya yolları ───────────────────────────────────────────────────────────
const DATA_DIR = process.env.STEAM_IDLER_DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { }
const TOKENS_FILE = path.join(DATA_DIR, '.steam_tokens.json');
const HISTORY_FILE = path.join(DATA_DIR, '.idle_history.json');
const SETTINGS_FILE = path.join(DATA_DIR, '.settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            return {
                rememberMe: Boolean(parsed?.rememberMe),
            };
        }
    } catch (e) { }
    return { rememberMe: false };
}

function saveSettings(next) {
    const safe = {
        rememberMe: Boolean(next?.rememberMe),
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(safe, null, 2));
    return safe;
}

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) { }
    return [];
}

function saveHistory(entry) {
    const history = loadHistory();
    history.unshift(entry); // en yenisi başa
    // max 200 kayıt tut
    if (history.length > 200) history.length = 200;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function loadTokens() {
    if (!loadSettings().rememberMe) return {};
    try {
        if (fs.existsSync(TOKENS_FILE)) {
            return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
        }
    } catch (e) { }
    return {};
}

function saveToken(username, refreshToken, displayName) {
    if (!loadSettings().rememberMe) return;
    const tokens = loadTokens();
    tokens[username] = { refreshToken, displayName, savedAt: Date.now() };
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function deleteToken(username) {
    const tokens = loadTokens();
    delete tokens[username];
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// ─── State ────────────────────────────────────────────────────────────────────
let client = null;
let currentState = {
    loggedIn: false,
    username: '',
    steamId: '',
    displayName: '',
    avatarUrl: '',
    idlingGames: [],
    totalIdleTime: 0,
    startTime: null,
    status: 'disconnected',
    errorMessage: '',
    games: [],
    steamGuardRequired: false,
    steamGuardType: null,
    qrCodeImage: null,   // base64 PNG
};

let idleTimer = null;
let steamGuardCallback = null;

function resetClient() {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    if (client) {
        try { client.logOff(); } catch (e) { }
        client.removeAllListeners();
        client = null;
    }
    currentState = {
        loggedIn: false,
        username: '',
        steamId: '',
        displayName: '',
        avatarUrl: '',
        idlingGames: [],
        totalIdleTime: 0,
        startTime: null,
        status: 'disconnected',
        errorMessage: '',
        games: [],
        steamGuardRequired: false,
        steamGuardType: null,
    };
    steamGuardCallback = null;
}

function setupClientEvents(c) {
    c.on('loggedOn', () => {
        currentState.status = 'connected';
        currentState.loggedIn = true;
        currentState.steamGuardRequired = false;
        currentState.steamId = c.steamID.toString();
        c.setPersona(SteamUser.EPersonaState.Online);

        // Avatar + görünen adı getPersonas ile çek
        try {
            c.getPersonas([c.steamID], (err, personas) => {
                if (!err && personas) {
                    const sid64 = c.steamID.getSteamID64();
                    const persona = personas[sid64];
                    if (persona) {
                        if (persona.player_name) currentState.displayName = persona.player_name;
                        if (persona.avatar_hash) {
                            const hash = Buffer.isBuffer(persona.avatar_hash)
                                ? persona.avatar_hash.toString('hex')
                                : String(persona.avatar_hash);
                            if (!/^0+$/.test(hash)) {
                                currentState.avatarUrl = `https://avatars.steamstatic.com/${hash}_full.jpg`;
                                console.log('🖼️ Avatar:', currentState.avatarUrl);
                            }
                        }
                    }
                } else {
                    console.log('getPersonas hatası:', err?.message);
                }
            });
        } catch (e) {
            console.error('getPersonas hatası:', e.message);
        }

        // Sahip olunan oyunları çek
        try {
            c.getUserOwnedApps(c.steamID, { includePlayedFreeGames: true }, (err, res) => {
                if (!err && res && res.apps) {
                    currentState.games = res.apps.map(a => ({
                        appid: a.appid,
                        name: a.name || `App ${a.appid}`,
                        playtime: a.playtime_forever || 0,  // dakika cinsinden
                    }));
                    console.log(`✅ ${currentState.games.length} oyun yüklendi.`);
                } else {
                    console.log('Oyun listesi alınamadı:', err?.message || 'boş yanıt');
                }
            });
        } catch (e) {
            console.error('getOwnedApps hatası:', e.message);
        }
    });

    // Refresh token'ı kaydet
    c.on('refreshToken', (token) => {
        if (currentState.username) {
            saveToken(currentState.username, token, currentState.displayName);
            console.log(`✅ Refresh token kaydedildi: ${currentState.username}`);
        }
    });

    c.on('accountInfo', (name) => {
        currentState.displayName = name;
        // token'daki displayName'i güncelle
        if (currentState.username) {
            const tokens = loadTokens();
            if (tokens[currentState.username]) {
                tokens[currentState.username].displayName = name;
                fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
            }
        }
    });

    c.on('steamID', (steamId) => {
        // loggedOn'da zaten set ediliyor, yedek olarak burada da güncelle
        currentState.steamId = steamId.toString();
    });

    c.on('error', (err) => {
        console.error('Steam error:', err.eresult, err.message);
        let msg = err.message || 'Bilinmeyen hata';
        if (err.eresult === 5) msg = 'Kullanıcı adı veya şifre hatalı!';
        else if (err.eresult === 84) msg = 'Çok fazla giriş denemesi. Lütfen birkaç saat bekleyin.';
        else if (err.eresult === 65) msg = 'Steam Guard doğrulaması başarısız.';
        else if (err.eresult === 11 || msg.includes('refreshToken')) {
            // Token geçersiz olmuş, sil
            if (currentState.username) deleteToken(currentState.username);
            msg = 'Kayıtlı oturum süresi dolmuş. Lütfen tekrar giriş yapın.';
        }
        currentState.status = 'error';
        currentState.errorMessage = msg;
        currentState.loggedIn = false;
        if (idleTimer) clearInterval(idleTimer);
    });

    c.on('disconnected', (eresult, msg) => {
        console.log('Disconnected:', eresult, msg);
        if (currentState.status === 'connected') {
            currentState.status = 'disconnected';
            currentState.loggedIn = false;
            if (idleTimer) clearInterval(idleTimer);
        }
    });

    c.on('steamGuard', (domain, callback, lastCodeWrong) => {
        console.log('Steam Guard required, domain:', domain);
        currentState.steamGuardRequired = true;
        currentState.steamGuardType = domain ? 'email' : 'mobile';
        currentState.status = 'steamguard';
        steamGuardCallback = callback;
    });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Settings (kalıcı)
app.get('/api/settings', (req, res) => {
    res.json(loadSettings());
});

app.put('/api/settings', (req, res) => {
    const { rememberMe } = req.body || {};
    const saved = saveSettings({ rememberMe });
    res.json(saved);
});

// Mevcut state
app.get('/api/state', (req, res) => {
    res.json(currentState);
});

// Kayıtlı hesapları listele
app.get('/api/saved-accounts', (req, res) => {
    if (!loadSettings().rememberMe) return res.json([]);
    const tokens = loadTokens();
    const accounts = Object.entries(tokens).map(([username, data]) => ({
        username,
        displayName: data.displayName || username,
        savedAt: data.savedAt,
    }));
    res.json(accounts);
});

// Kayıtlı hesabı sil
app.delete('/api/saved-accounts/:username', (req, res) => {
    deleteToken(req.params.username);
    res.json({ success: true });
});

// QR Kod ile giriş
let qrSession = null;
app.post('/api/login/qr', async (req, res) => {
    if (client) resetClient();
    client = new SteamUser({ enablePicsCache: false });
    setupClientEvents(client);

    currentState.status = 'qr';
    currentState.qrCodeImage = null;

    try {
        if (qrSession) {
            try { qrSession.cancelLoginAttempt(); } catch (e) { }
        }

        qrSession = new LoginSession(EAuthTokenPlatformType.SteamClient);

        qrSession.on('authenticated', async () => {
            console.log(`✅ QR okundu. Giriş yapılıyor: ${qrSession.accountName}`);
            currentState.username = qrSession.accountName;
            currentState.status = 'connecting';
            // Alınan refresh token ile steam-user'a gerçek login yapılıyor
            client.logOn({ refreshToken: qrSession.refreshToken });
        });

        qrSession.on('timeout', () => {
            console.log('⏳ QR kodu zaman aşımına uğradı');
            if (currentState.status === 'qr') {
                currentState.status = 'error';
                currentState.errorMessage = 'QR kod süresi doldu. Lütfen yeniden deneyin.';
            }
        });

        qrSession.on('error', (err) => {
            console.log('❌ QR hata:', err.message);
            currentState.status = 'error';
            currentState.errorMessage = err.message;
        });

        const result = await qrSession.startWithQR();

        currentState.qrCodeImage = await QRCode.toDataURL(result.qrChallengeUrl, {
            width: 240,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
        });

        console.log('✅ Yeni QR kod oluşturuldu.');
        res.json({ success: true, message: 'QR kod hazır' });
    } catch (e) {
        console.error('QR Başlatma Hatası:', e.message);
        currentState.status = 'error';
        currentState.errorMessage = e.message;
        res.status(500).json({ error: e.message });
    }
});

// Token ile giriş (şifre olmadan)
app.post('/api/login/token', (req, res) => {
    if (!loadSettings().rememberMe) {
        return res.status(403).json({ error: 'Beni hatırla kapalıyken kayıtlı oturum kullanılamaz.' });
    }
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });

    const tokens = loadTokens();
    const saved = tokens[username];
    if (!saved || !saved.refreshToken) {
        return res.status(404).json({ error: 'Bu hesap için kayıtlı oturum bulunamadı.' });
    }

    if (client) resetClient();
    client = new SteamUser({ enablePicsCache: false });
    setupClientEvents(client);
    currentState.status = 'connecting';
    currentState.username = username;
    currentState.displayName = saved.displayName || username;

    try {
        client.logOn({ refreshToken: saved.refreshToken });
        res.json({ success: true, message: 'Token ile giriş deneniyor...' });
    } catch (e) {
        currentState.status = 'error';
        currentState.errorMessage = e.message;
        res.status(500).json({ error: e.message });
    }
});

// Normal giriş (kullanıcı adı + şifre)
app.post('/api/login', (req, res) => {
    const { username, password, sharedSecret } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
    }

    if (client) resetClient();
    client = new SteamUser({ enablePicsCache: false });
    setupClientEvents(client);
    currentState.status = 'connecting';
    currentState.username = username;

    const loginDetails = { accountName: username, password };

    if (sharedSecret && sharedSecret.trim()) {
        try {
            loginDetails.twoFactorCode = SteamTotp.generateAuthCode(sharedSecret.trim());
        } catch (e) {
            console.error('TOTP error:', e);
        }
    }

    try {
        client.logOn(loginDetails);
        res.json({ success: true, message: 'Giriş isteği gönderildi.' });
    } catch (e) {
        currentState.status = 'error';
        currentState.errorMessage = e.message;
        res.status(500).json({ error: e.message });
    }
});

// Steam Guard kodu gönder
app.post('/api/steamguard', (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Kod gerekli.' });
    if (!steamGuardCallback) return res.status(400).json({ error: 'Steam Guard beklemiyor.' });
    steamGuardCallback(code);
    steamGuardCallback = null;
    currentState.steamGuardRequired = false;
    currentState.status = 'connecting';
    res.json({ success: true });
});

// Saat kasımını başlat
app.post('/api/idle/start', (req, res) => {
    const { appids } = req.body;
    if (!client || !currentState.loggedIn) {
        return res.status(400).json({ error: 'Steam\'e giriş yapılmamış.' });
    }
    if (!appids || !appids.length) {
        return res.status(400).json({ error: 'En az bir oyun seçin.' });
    }

    const games = appids.map(id => parseInt(id));
    client.gamesPlayed(games);
    currentState.idlingGames = games;
    currentState.startTime = Date.now();

    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(() => {
        if (currentState.startTime) {
            currentState.totalIdleTime = Math.floor((Date.now() - currentState.startTime) / 1000);
        }
    }, 1000);

    res.json({ success: true, idling: games });
});

// Saat kasımını durdur
app.post('/api/idle/stop', (req, res) => {
    if (!client || !currentState.loggedIn) {
        return res.status(400).json({ error: 'Steam\'e giriş yapılmamış.' });
    }

    // Oturumu geçmişe kaydet (en az 10 saniye süreli)
    if (currentState.idlingGames.length > 0 && currentState.totalIdleTime >= 10) {
        const gameDetails = currentState.idlingGames.map(id => {
            const g = currentState.games.find(g => g.appid === id);
            return { appid: id, name: g ? g.name : `App ${id}` };
        });
        saveHistory({
            id: Date.now(),
            date: new Date().toISOString(),
            username: currentState.username,
            displayName: currentState.displayName,
            games: gameDetails,
            durationSeconds: currentState.totalIdleTime,
            startTime: currentState.startTime,
        });
        console.log(`📋 Geçmiş kaydedildi: ${gameDetails.map(g => g.name).join(', ')} — ${currentState.totalIdleTime}s`);
    }

    client.gamesPlayed([]);
    currentState.idlingGames = [];
    currentState.startTime = null;
    currentState.totalIdleTime = 0;
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    res.json({ success: true });
});

// Çıkış yap
app.post('/api/logout', (req, res) => {
    resetClient();
    res.json({ success: true });
});

// Manuel oyun ekle
app.post('/api/games/add', (req, res) => {
    const { appid, name } = req.body;
    if (!appid) return res.status(400).json({ error: 'AppID gerekli.' });
    const id = parseInt(appid);
    const exists = currentState.games.find(g => g.appid === id);
    if (!exists) {
        currentState.games.push({ appid: id, name: name || `App ${id}`, playtime: 0 });
    }
    res.json({ success: true });
});

// Oyun listesini Steam'den yenile (playtime dahil)
app.post('/api/games/refresh', (req, res) => {
    if (!client || !currentState.loggedIn) {
        return res.status(400).json({ error: 'Steam\'e giriş yapılmamış.' });
    }
    try {
        client.getUserOwnedApps(client.steamID, { includePlayedFreeGames: true }, (err, result) => {
            if (!err && result && result.apps) {
                currentState.games = result.apps.map(a => ({
                    appid: a.appid,
                    name: a.name || `App ${a.appid}`,
                    playtime: a.playtime_forever || 0,
                }));
                console.log(`🔄 Oyun listesi yenilendi: ${currentState.games.length} oyun.`);
            }
        });
        res.json({ success: true, message: 'Oyun listesi yenileniyor...' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Geçmişi getir
app.get('/api/history', (req, res) => {
    res.json(loadHistory());
});

// Geçmişi temizle
app.delete('/api/history', (req, res) => {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
    res.json({ success: true });
});

// Tek geçmiş kaydını sil
app.delete('/api/history/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const history = loadHistory().filter(h => h.id !== id);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    res.json({ success: true });
});

// ─── UI (Vite build) serve ────────────────────────────────────────────────────
// EXE paketinde frontend'i aynı sunucudan servis eder (http://localhost:3001).
// Dev modda `npm run dev` zaten Vite ile çalışır; burada sadece dist varsa devreye girer.
const DIST_DIR = path.join(__dirname, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');
if (fs.existsSync(DIST_INDEX)) {
    app.use(express.static(DIST_DIR));
    // Express 5: '*' path pattern crashes (path-to-regexp). Use a regexp catch-all.
    app.get(/.*/, (req, res) => {
        res.sendFile(DIST_INDEX);
    });
}

const PORT = parseInt(process.env.PORT || '3001', 10);
function startServer(port = PORT) {
    return app.listen(port, () => {
        console.log(`✅ Steam Idler Backend çalışıyor: http://localhost:${port}`);
        const tokens = loadTokens();
        const count = Object.keys(tokens).length;
        if (count > 0) {
            console.log(`💾 ${count} kayıtlı hesap bulundu.`);
        }
    });
}

module.exports = { startServer };

if (require.main === module) {
    startServer();
}

// Crash'leri yakala, backend durmasın
process.on('uncaughtException', (err) => {
    console.error('⚠️  Yakalanmamış hata (backend çalışmaya devam ediyor):', err.message);
    currentState.status = 'error';
    currentState.errorMessage = 'Sunucu hatası: ' + err.message;
    currentState.loggedIn = false;
});

process.on('unhandledRejection', (reason) => {
    console.error('⚠️  İşlenmeyen Promise hatası:', reason?.message || reason);
});
>>>>>>> 574898003af52a298657ea6ae633aa6996776ea6
=======
const express = require('express');
const cors = require('cors');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Dosya yolları ───────────────────────────────────────────────────────────
const DATA_DIR = process.env.STEAM_IDLER_DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { }
const TOKENS_FILE = path.join(DATA_DIR, '.steam_tokens.json');
const HISTORY_FILE = path.join(DATA_DIR, '.idle_history.json');
const SETTINGS_FILE = path.join(DATA_DIR, '.settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            return {
                rememberMe: Boolean(parsed?.rememberMe),
            };
        }
    } catch (e) { }
    return { rememberMe: false };
}

function saveSettings(next) {
    const safe = {
        rememberMe: Boolean(next?.rememberMe),
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(safe, null, 2));
    return safe;
}

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) { }
    return [];
}

function saveHistory(entry) {
    const history = loadHistory();
    history.unshift(entry); // en yenisi başa
    // max 200 kayıt tut
    if (history.length > 200) history.length = 200;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function loadTokens() {
    if (!loadSettings().rememberMe) return {};
    try {
        if (fs.existsSync(TOKENS_FILE)) {
            return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
        }
    } catch (e) { }
    return {};
}

function saveToken(username, refreshToken, displayName) {
    if (!loadSettings().rememberMe) return;
    const tokens = loadTokens();
    tokens[username] = { refreshToken, displayName, savedAt: Date.now() };
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function deleteToken(username) {
    const tokens = loadTokens();
    delete tokens[username];
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// ─── State ────────────────────────────────────────────────────────────────────
let client = null;
let currentState = {
    loggedIn: false,
    username: '',
    steamId: '',
    displayName: '',
    avatarUrl: '',
    idlingGames: [],
    totalIdleTime: 0,
    startTime: null,
    status: 'disconnected',
    errorMessage: '',
    games: [],
    steamGuardRequired: false,
    steamGuardType: null,
    qrCodeImage: null,   // base64 PNG
};

let idleTimer = null;
let steamGuardCallback = null;

function resetClient() {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    if (client) {
        try { client.logOff(); } catch (e) { }
        client.removeAllListeners();
        client = null;
    }
    currentState = {
        loggedIn: false,
        username: '',
        steamId: '',
        displayName: '',
        avatarUrl: '',
        idlingGames: [],
        totalIdleTime: 0,
        startTime: null,
        status: 'disconnected',
        errorMessage: '',
        games: [],
        steamGuardRequired: false,
        steamGuardType: null,
    };
    steamGuardCallback = null;
}

function setupClientEvents(c) {
    c.on('loggedOn', () => {
        currentState.status = 'connected';
        currentState.loggedIn = true;
        currentState.steamGuardRequired = false;
        currentState.steamId = c.steamID.toString();
        c.setPersona(SteamUser.EPersonaState.Online);

        // Avatar + görünen adı getPersonas ile çek
        try {
            c.getPersonas([c.steamID], (err, personas) => {
                if (!err && personas) {
                    const sid64 = c.steamID.getSteamID64();
                    const persona = personas[sid64];
                    if (persona) {
                        if (persona.player_name) currentState.displayName = persona.player_name;
                        if (persona.avatar_hash) {
                            const hash = Buffer.isBuffer(persona.avatar_hash)
                                ? persona.avatar_hash.toString('hex')
                                : String(persona.avatar_hash);
                            if (!/^0+$/.test(hash)) {
                                currentState.avatarUrl = `https://avatars.steamstatic.com/${hash}_full.jpg`;
                                console.log('🖼️ Avatar:', currentState.avatarUrl);
                            }
                        }
                    }
                } else {
                    console.log('getPersonas hatası:', err?.message);
                }
            });
        } catch (e) {
            console.error('getPersonas hatası:', e.message);
        }

        // Sahip olunan oyunları çek
        try {
            c.getUserOwnedApps(c.steamID, { includePlayedFreeGames: true }, (err, res) => {
                if (!err && res && res.apps) {
                    currentState.games = res.apps.map(a => ({
                        appid: a.appid,
                        name: a.name || `App ${a.appid}`,
                        playtime: a.playtime_forever || 0,  // dakika cinsinden
                    }));
                    console.log(`✅ ${currentState.games.length} oyun yüklendi.`);
                } else {
                    console.log('Oyun listesi alınamadı:', err?.message || 'boş yanıt');
                }
            });
        } catch (e) {
            console.error('getOwnedApps hatası:', e.message);
        }
    });

    // Refresh token'ı kaydet
    c.on('refreshToken', (token) => {
        if (currentState.username) {
            saveToken(currentState.username, token, currentState.displayName);
            console.log(`✅ Refresh token kaydedildi: ${currentState.username}`);
        }
    });

    c.on('accountInfo', (name) => {
        currentState.displayName = name;
        // token'daki displayName'i güncelle
        if (currentState.username) {
            const tokens = loadTokens();
            if (tokens[currentState.username]) {
                tokens[currentState.username].displayName = name;
                fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
            }
        }
    });

    c.on('steamID', (steamId) => {
        // loggedOn'da zaten set ediliyor, yedek olarak burada da güncelle
        currentState.steamId = steamId.toString();
    });

    c.on('error', (err) => {
        console.error('Steam error:', err.eresult, err.message);
        let msg = err.message || 'Bilinmeyen hata';
        if (err.eresult === 5) msg = 'Kullanıcı adı veya şifre hatalı!';
        else if (err.eresult === 84) msg = 'Çok fazla giriş denemesi. Lütfen birkaç saat bekleyin.';
        else if (err.eresult === 65) msg = 'Steam Guard doğrulaması başarısız.';
        else if (err.eresult === 11 || msg.includes('refreshToken')) {
            // Token geçersiz olmuş, sil
            if (currentState.username) deleteToken(currentState.username);
            msg = 'Kayıtlı oturum süresi dolmuş. Lütfen tekrar giriş yapın.';
        }
        currentState.status = 'error';
        currentState.errorMessage = msg;
        currentState.loggedIn = false;
        if (idleTimer) clearInterval(idleTimer);
    });

    c.on('disconnected', (eresult, msg) => {
        console.log('Disconnected:', eresult, msg);
        if (currentState.status === 'connected') {
            currentState.status = 'disconnected';
            currentState.loggedIn = false;
            if (idleTimer) clearInterval(idleTimer);
        }
    });

    c.on('steamGuard', (domain, callback, lastCodeWrong) => {
        console.log('Steam Guard required, domain:', domain);
        currentState.steamGuardRequired = true;
        currentState.steamGuardType = domain ? 'email' : 'mobile';
        currentState.status = 'steamguard';
        steamGuardCallback = callback;
    });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// Settings (kalıcı)
app.get('/api/settings', (req, res) => {
    res.json(loadSettings());
});

app.put('/api/settings', (req, res) => {
    const { rememberMe } = req.body || {};
    const saved = saveSettings({ rememberMe });
    res.json(saved);
});

// Mevcut state
app.get('/api/state', (req, res) => {
    res.json(currentState);
});

// Kayıtlı hesapları listele
app.get('/api/saved-accounts', (req, res) => {
    if (!loadSettings().rememberMe) return res.json([]);
    const tokens = loadTokens();
    const accounts = Object.entries(tokens).map(([username, data]) => ({
        username,
        displayName: data.displayName || username,
        savedAt: data.savedAt,
    }));
    res.json(accounts);
});

// Kayıtlı hesabı sil
app.delete('/api/saved-accounts/:username', (req, res) => {
    deleteToken(req.params.username);
    res.json({ success: true });
});

// QR Kod ile giriş
let qrSession = null;
app.post('/api/login/qr', async (req, res) => {
    if (client) resetClient();
    client = new SteamUser({ enablePicsCache: false });
    setupClientEvents(client);

    currentState.status = 'qr';
    currentState.qrCodeImage = null;

    try {
        if (qrSession) {
            try { qrSession.cancelLoginAttempt(); } catch (e) { }
        }

        qrSession = new LoginSession(EAuthTokenPlatformType.SteamClient);

        qrSession.on('authenticated', async () => {
            console.log(`✅ QR okundu. Giriş yapılıyor: ${qrSession.accountName}`);
            currentState.username = qrSession.accountName;
            currentState.status = 'connecting';
            // Alınan refresh token ile steam-user'a gerçek login yapılıyor
            client.logOn({ refreshToken: qrSession.refreshToken });
        });

        qrSession.on('timeout', () => {
            console.log('⏳ QR kodu zaman aşımına uğradı');
            if (currentState.status === 'qr') {
                currentState.status = 'error';
                currentState.errorMessage = 'QR kod süresi doldu. Lütfen yeniden deneyin.';
            }
        });

        qrSession.on('error', (err) => {
            console.log('❌ QR hata:', err.message);
            currentState.status = 'error';
            currentState.errorMessage = err.message;
        });

        const result = await qrSession.startWithQR();

        currentState.qrCodeImage = await QRCode.toDataURL(result.qrChallengeUrl, {
            width: 240,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
        });

        console.log('✅ Yeni QR kod oluşturuldu.');
        res.json({ success: true, message: 'QR kod hazır' });
    } catch (e) {
        console.error('QR Başlatma Hatası:', e.message);
        currentState.status = 'error';
        currentState.errorMessage = e.message;
        res.status(500).json({ error: e.message });
    }
});

// Token ile giriş (şifre olmadan)
app.post('/api/login/token', (req, res) => {
    if (!loadSettings().rememberMe) {
        return res.status(403).json({ error: 'Beni hatırla kapalıyken kayıtlı oturum kullanılamaz.' });
    }
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });

    const tokens = loadTokens();
    const saved = tokens[username];
    if (!saved || !saved.refreshToken) {
        return res.status(404).json({ error: 'Bu hesap için kayıtlı oturum bulunamadı.' });
    }

    if (client) resetClient();
    client = new SteamUser({ enablePicsCache: false });
    setupClientEvents(client);
    currentState.status = 'connecting';
    currentState.username = username;
    currentState.displayName = saved.displayName || username;

    try {
        client.logOn({ refreshToken: saved.refreshToken });
        res.json({ success: true, message: 'Token ile giriş deneniyor...' });
    } catch (e) {
        currentState.status = 'error';
        currentState.errorMessage = e.message;
        res.status(500).json({ error: e.message });
    }
});

// Normal giriş (kullanıcı adı + şifre)
app.post('/api/login', (req, res) => {
    const { username, password, sharedSecret } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
    }

    if (client) resetClient();
    client = new SteamUser({ enablePicsCache: false });
    setupClientEvents(client);
    currentState.status = 'connecting';
    currentState.username = username;

    const loginDetails = { accountName: username, password };

    if (sharedSecret && sharedSecret.trim()) {
        try {
            loginDetails.twoFactorCode = SteamTotp.generateAuthCode(sharedSecret.trim());
        } catch (e) {
            console.error('TOTP error:', e);
        }
    }

    try {
        client.logOn(loginDetails);
        res.json({ success: true, message: 'Giriş isteği gönderildi.' });
    } catch (e) {
        currentState.status = 'error';
        currentState.errorMessage = e.message;
        res.status(500).json({ error: e.message });
    }
});

// Steam Guard kodu gönder
app.post('/api/steamguard', (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Kod gerekli.' });
    if (!steamGuardCallback) return res.status(400).json({ error: 'Steam Guard beklemiyor.' });
    steamGuardCallback(code);
    steamGuardCallback = null;
    currentState.steamGuardRequired = false;
    currentState.status = 'connecting';
    res.json({ success: true });
});

// Saat kasımını başlat
app.post('/api/idle/start', (req, res) => {
    const { appids } = req.body;
    if (!client || !currentState.loggedIn) {
        return res.status(400).json({ error: 'Steam\'e giriş yapılmamış.' });
    }
    if (!appids || !appids.length) {
        return res.status(400).json({ error: 'En az bir oyun seçin.' });
    }

    const games = appids.map(id => parseInt(id));
    client.gamesPlayed(games);
    currentState.idlingGames = games;
    currentState.startTime = Date.now();

    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(() => {
        if (currentState.startTime) {
            currentState.totalIdleTime = Math.floor((Date.now() - currentState.startTime) / 1000);
        }
    }, 1000);

    res.json({ success: true, idling: games });
});

// Saat kasımını durdur
app.post('/api/idle/stop', (req, res) => {
    if (!client || !currentState.loggedIn) {
        return res.status(400).json({ error: 'Steam\'e giriş yapılmamış.' });
    }

    // Oturumu geçmişe kaydet (en az 10 saniye süreli)
    if (currentState.idlingGames.length > 0 && currentState.totalIdleTime >= 10) {
        const gameDetails = currentState.idlingGames.map(id => {
            const g = currentState.games.find(g => g.appid === id);
            return { appid: id, name: g ? g.name : `App ${id}` };
        });
        saveHistory({
            id: Date.now(),
            date: new Date().toISOString(),
            username: currentState.username,
            displayName: currentState.displayName,
            games: gameDetails,
            durationSeconds: currentState.totalIdleTime,
            startTime: currentState.startTime,
        });
        console.log(`📋 Geçmiş kaydedildi: ${gameDetails.map(g => g.name).join(', ')} — ${currentState.totalIdleTime}s`);
    }

    client.gamesPlayed([]);
    currentState.idlingGames = [];
    currentState.startTime = null;
    currentState.totalIdleTime = 0;
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    res.json({ success: true });
});

// Çıkış yap
app.post('/api/logout', (req, res) => {
    resetClient();
    res.json({ success: true });
});

// Manuel oyun ekle
app.post('/api/games/add', (req, res) => {
    const { appid, name } = req.body;
    if (!appid) return res.status(400).json({ error: 'AppID gerekli.' });
    const id = parseInt(appid);
    const exists = currentState.games.find(g => g.appid === id);
    if (!exists) {
        currentState.games.push({ appid: id, name: name || `App ${id}`, playtime: 0 });
    }
    res.json({ success: true });
});

// Oyun listesini Steam'den yenile (playtime dahil)
app.post('/api/games/refresh', (req, res) => {
    if (!client || !currentState.loggedIn) {
        return res.status(400).json({ error: 'Steam\'e giriş yapılmamış.' });
    }
    try {
        client.getUserOwnedApps(client.steamID, { includePlayedFreeGames: true }, (err, result) => {
            if (!err && result && result.apps) {
                currentState.games = result.apps.map(a => ({
                    appid: a.appid,
                    name: a.name || `App ${a.appid}`,
                    playtime: a.playtime_forever || 0,
                }));
                console.log(`🔄 Oyun listesi yenilendi: ${currentState.games.length} oyun.`);
            }
        });
        res.json({ success: true, message: 'Oyun listesi yenileniyor...' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Geçmişi getir
app.get('/api/history', (req, res) => {
    res.json(loadHistory());
});

// Geçmişi temizle
app.delete('/api/history', (req, res) => {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
    res.json({ success: true });
});

// Tek geçmiş kaydını sil
app.delete('/api/history/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const history = loadHistory().filter(h => h.id !== id);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    res.json({ success: true });
});

// ─── UI (Vite build) serve ────────────────────────────────────────────────────
// EXE paketinde frontend'i aynı sunucudan servis eder (http://localhost:3001).
// Dev modda `npm run dev` zaten Vite ile çalışır; burada sadece dist varsa devreye girer.
const DIST_DIR = path.join(__dirname, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');
if (fs.existsSync(DIST_INDEX)) {
    app.use(express.static(DIST_DIR));
    // Express 5: '*' path pattern crashes (path-to-regexp). Use a regexp catch-all.
    app.get(/.*/, (req, res) => {
        res.sendFile(DIST_INDEX);
    });
}

const PORT = parseInt(process.env.PORT || '3001', 10);
function startServer(port = PORT) {
    return app.listen(port, () => {
        console.log(`✅ Steam Idler Backend çalışıyor: http://localhost:${port}`);
        const tokens = loadTokens();
        const count = Object.keys(tokens).length;
        if (count > 0) {
            console.log(`💾 ${count} kayıtlı hesap bulundu.`);
        }
    });
}

module.exports = { startServer };

if (require.main === module) {
    startServer();
}

// Crash'leri yakala, backend durmasın
process.on('uncaughtException', (err) => {
    console.error('⚠️  Yakalanmamış hata (backend çalışmaya devam ediyor):', err.message);
    currentState.status = 'error';
    currentState.errorMessage = 'Sunucu hatası: ' + err.message;
    currentState.loggedIn = false;
});

process.on('unhandledRejection', (reason) => {
    console.error('⚠️  İşlenmeyen Promise hatası:', reason?.message || reason);
});
>>>>>>> 574898003af52a298657ea6ae633aa6996776ea6
