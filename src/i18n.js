const STORAGE_KEY = 'steam_idler_lang';

const dict = {
  tr: {
    remember_me: 'Beni hatırla',
    remember_me_desc: 'Açık olursa oturum tokeni bu cihazda saklanır ve sonraki açılışlarda tek tıkla giriş yapabilirsiniz.',
    remember_me_off_note: 'Kapalıyken kayıtlı oturum tutulmaz.',
    language: 'Dil',
    turkish: 'Türkçe',
    english: 'English',

    // Header / status
    appSubtitle: 'Saat Kasma Aracı',
    status_idling: 'Saat Kasılıyor',
    status_connected: 'Bağlı',
    status_connecting: 'Bağlanıyor...',
    status_steamguard: 'Steam Guard Bekleniyor',
    status_qr: 'QR Bekleniyor',
    status_error: 'Hata',
    status_disconnected: 'Bağlı Değil',

    // Time ago
    time_saved_days: '{days} gün önce kaydedildi',
    time_saved_hours: '{hours} saat önce kaydedildi',
    time_saved_now: 'Az önce kaydedildi',

    // Common
    back: '← Geri Dön',
    loading: 'Yükleniyor...',

    // QR panel
    qr_scan_title: 'Steam Mobil Uygulaması ile Tara',
    qr_scan_steps: 'Steam app → Sağ üst profil → Oturum Aç → QR tara',
    qr_alt: 'QR Kod',
    qr_generating: 'QR kod oluşturuluyor...',
    qr_hint: 'Kod her 30 saniyede yenilenir. Tarayıcıyı yenilemenize gerek yok.',
    qr_login_title: 'QR ile Giriş',
    qr_show_button: 'QR Kodu Göster',
    qr_login_headline: 'QR Kod ile Giriş Yap',
    qr_login_desc_1: 'Kullanıcı adı veya şifre gerekmez.',
    qr_login_desc_2: 'Steam mobil uygulamasıyla QR taratarak giriş yapın.',

    // Saved accounts
    saved_accounts: '💾 Kayıtlı Hesaplar',
    login: '▶ Giriş Yap',
    logging_in: 'Giriliyor...',
    delete_saved_account_title: 'Kayıtlı hesabı sil',
    new_login: '+ Farklı Hesapla Giriş Yap',

    // Login form
    pw_not_saved: 'Şifreniz kaydedilmez.',
    token_saved_local: "Steam’in verdiği oturum tokeni sadece bu cihazda saklanır.",
    username_password_required: 'Kullanıcı adı ve şifre gereklidir.',
    login_failed: 'Giriş başarısız.',
    cannot_reach_backend: 'Sunucuya bağlanılamadı. Backend çalışıyor mu?',
    steam_username: 'Steam Kullanıcı Adı',
    steam_password: 'Şifre',
    shared_secret: 'Shared Secret',
    optional: 'OPSİYONEL',
    shared_secret_placeholder: 'Mobile Authenticator otomatik kodu',
    shared_secret_hint: 'Boş bırakırsanız Steam Guard ekranı açılır.',
    connecting: 'Bağlanıyor...',
    login_first_time: "Steam'e Giriş Yap",
    warn_pw_not_saved: "Şifreniz bu cihaza kaydedilmez. Sadece Steam'in verdiği oturum tokeni yerel olarak saklanır.",

    // Steam guard
    steamguard_title: 'Steam Guard Doğrulaması',
    steamguard_email_hint: "Steam'in gönderdiği e-postadaki 5 haneli kodu girin.",
    steamguard_mobile_hint: 'Steam Authenticator uygulamasındaki kodu girin.',
    steamguard_one_time: 'Bu işlemi bir kez yapmanız yeterli — sonraki açılışlarda otomatik giriş olur.',
    verification_code: 'Doğrulama Kodu',
    code_required: 'Kod boş olamaz.',
    code_send_failed: 'Kod gönderilemedi.',
    sending: 'Gönderiliyor...',
    verify: 'Doğrula',

    // Games
    appid: 'AppID',
    playtime_hours: '{h} saat',
    playtime_minutes: '{m} dk',
    playtime_hours_minutes: '{h}s {m}dk',
    search_games_placeholder: 'Oyun adı veya AppID ile ara...',
    no_games_found: 'Oyun bulunamadı',
    try_another_term: 'Farklı bir terim deneyin veya manuel AppID ekleyin.',
    add_game_manual: 'Manuel Oyun Ekle (AppID)',
    example_730: 'Örn: 730',
    game_name_optional: 'Oyun adı (opsiyonel)',
    add: '+ Ekle',
    appid_help_prefix: 'AppID:',
    appid_help_suffix: "→ oyun → URL'deki sayı",

    // History
    history_sessions: 'Geçmiş Oturumlar',
    clear_all: '🗑 Tümünü Sil',
    no_history_title: 'Henüz geçmiş yok',
    no_history_desc: 'Saat kasımını durdurunca oturumlar burada görünecek.',
    delete_record_title: 'Kaydı sil',

    // Idle panel
    elapsed: 'Geçen Süre',
    total_hours: 'Toplam Saat',
    game_count: 'Oyun Sayısı',
    pick_games_then_start: 'Sağ taraftan oyun seçin, ardından başlatın.',
    selected_games_count: '{n} oyun seçildi.',
    start: 'Başlat',
    stop: 'Durdur',

    // Main cards
    connecting_title: 'Bağlanıyor',
    connecting_desc: "Steam'e bağlanılıyor, lütfen bekleyin...",
    account: 'Hesap',
    online: '● Çevrimiçi',
    logging_out: 'Çıkış yapılıyor...',
    logout: '🚪 Çıkış Yap',
    stop_first: 'Önce kasımı durdurun.',
    unknown_error: 'Bilinmeyen hata oluştu.',
    idle_status: 'Saat Kasma Durumu',
    active: 'AKTİF',
    game_list: 'Oyun Listesi',
    selected: 'seçili',
    games_loading: 'Oyun listesi yükleniyor...',
    games_loading_desc: "Hesabınızdaki oyunlar Steam'den alınıyor.",
    choose_account_or_login: 'Hesabınızı seçin veya yeni giriş yapın',
    login_to_account: 'Steam Hesabınıza Giriş Yapın',
    security_notice: 'Güvenlik Bilgilendirmesi',
    security_line1: 'Bu uygulama Steam ile arka planda bağlantı kurar; bunun dışında herhangi bir sunucu ile bağlantısı yoktur.',
    security_line2: 'Uygulama kapandığında tüm bağlantı tamamen kopar.',
    security_line3: 'Oyunlarda saat kasmak için uygulamanın açık olması gerekir; uygulamayı alta alabilirsiniz.',
    saved_account_one_click: 'Sol taraftan kayıtlı hesabınıza tek tıkla giriş yapabilirsiniz.',
    qr_open_hint: 'Sol taraftaki buton ile QR kodu açıp giriş yapabilirsiniz.',

    // Footer
    developed_with: 'Developed with',
  },
  en: {
    remember_me: 'Remember me',
    remember_me_desc: 'When enabled, a session token is stored on this device so you can sign in with one click next time.',
    remember_me_off_note: 'When disabled, no saved session is kept.',
    language: 'Language',
    turkish: 'Türkçe',
    english: 'English',

    // Header / status
    appSubtitle: 'Idle Time Booster',
    status_idling: 'Idling',
    status_connected: 'Connected',
    status_connecting: 'Connecting...',
    status_steamguard: 'Steam Guard Required',
    status_qr: 'Waiting for QR',
    status_error: 'Error',
    status_disconnected: 'Disconnected',

    // Time ago
    time_saved_days: 'Saved {days} days ago',
    time_saved_hours: 'Saved {hours} hours ago',
    time_saved_now: 'Saved just now',

    // Common
    back: '← Back',
    loading: 'Loading...',

    // QR panel
    qr_scan_title: 'Scan with Steam Mobile App',
    qr_scan_steps: 'Steam app → Profile (top right) → Sign in → Scan QR',
    qr_alt: 'QR Code',
    qr_generating: 'Generating QR code...',
    qr_hint: 'The code refreshes every 30 seconds. No need to refresh the page.',
    qr_login_title: 'QR Login',
    qr_show_button: 'Show QR Code',
    qr_login_headline: 'Sign in with QR Code',
    qr_login_desc_1: 'No username or password required.',
    qr_login_desc_2: 'Scan the QR with the Steam mobile app to sign in.',

    // Saved accounts
    saved_accounts: '💾 Saved Accounts',
    login: '▶ Sign in',
    logging_in: 'Signing in...',
    delete_saved_account_title: 'Delete saved account',
    new_login: '+ Sign in with another account',

    // Login form
    pw_not_saved: 'Your password is not stored.',
    token_saved_local: "A session token from Steam is stored only on this device.",
    username_password_required: 'Username and password are required.',
    login_failed: 'Login failed.',
    cannot_reach_backend: 'Cannot reach the backend. Is it running?',
    steam_username: 'Steam Username',
    steam_password: 'Password',
    shared_secret: 'Shared Secret',
    optional: 'OPTIONAL',
    shared_secret_placeholder: 'Mobile Authenticator auto code',
    shared_secret_hint: 'Leave empty to use the Steam Guard screen.',
    connecting: 'Connecting...',
    login_first_time: 'Sign in to Steam',
    warn_pw_not_saved: 'Your password is not saved. Only a local session token from Steam is stored.',

    // Steam guard
    steamguard_title: 'Steam Guard Verification',
    steamguard_email_hint: 'Enter the 5-character code from Steam’s email.',
    steamguard_mobile_hint: 'Enter the code from Steam Authenticator.',
    steamguard_one_time: 'You only need to do this once — future launches can sign in automatically.',
    verification_code: 'Verification Code',
    code_required: 'Code cannot be empty.',
    code_send_failed: 'Failed to send code.',
    sending: 'Sending...',
    verify: 'Verify',

    // Games
    appid: 'AppID',
    playtime_hours: '{h} hr',
    playtime_minutes: '{m} min',
    playtime_hours_minutes: '{h}h {m}m',
    search_games_placeholder: 'Search by game name or AppID...',
    no_games_found: 'No games found',
    try_another_term: 'Try a different search term or add an AppID manually.',
    add_game_manual: 'Add Game Manually (AppID)',
    example_730: 'e.g. 730',
    game_name_optional: 'Game name (optional)',
    add: '+ Add',
    appid_help_prefix: 'AppID:',
    appid_help_suffix: '→ game → number in the URL',

    // History
    history_sessions: 'Session History',
    clear_all: '🗑 Clear all',
    no_history_title: 'No history yet',
    no_history_desc: 'Your sessions will appear here after you stop idling.',
    delete_record_title: 'Delete record',

    // Idle panel
    elapsed: 'Elapsed',
    total_hours: 'Total Hours',
    game_count: 'Games',
    pick_games_then_start: 'Select games on the right, then start.',
    selected_games_count: '{n} games selected.',
    start: 'Start',
    stop: 'Stop',

    // Main cards
    connecting_title: 'Connecting',
    connecting_desc: 'Connecting to Steam, please wait...',
    account: 'Account',
    online: '● Online',
    logging_out: 'Signing out...',
    logout: '🚪 Sign out',
    stop_first: 'Stop idling first.',
    unknown_error: 'An unknown error occurred.',
    idle_status: 'Idling Status',
    active: 'ACTIVE',
    game_list: 'Game List',
    selected: 'selected',
    games_loading: 'Loading games...',
    games_loading_desc: 'Fetching your games from Steam.',
    choose_account_or_login: 'Pick an account or sign in',
    login_to_account: 'Sign in to your Steam account',
    security_notice: 'Security Notice',
    security_line1: 'This app connects to Steam in the background; it does not connect to any other server.',
    security_line2: 'When you close the app, all connections are fully terminated.',
    security_line3: 'To idle game time, the app must remain open; you can minimize it.',
    saved_account_one_click: 'Use the left panel to sign in with one click.',
    qr_open_hint: 'Use the left button to open the QR code and sign in.',

    // Footer
    developed_with: 'Developed with',
  },
};

export function detectInitialLang() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'tr' || saved === 'en') return saved;
  const nav = (navigator.language || '').toLowerCase();
  return nav.startsWith('tr') ? 'tr' : 'en';
}

export function setLang(lang) {
  localStorage.setItem(STORAGE_KEY, lang);
}

function format(str, vars) {
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (_m, k) => (vars[k] ?? `{${k}}`));
}

export function t(lang, key, vars) {
  const raw = dict[lang]?.[key] ?? dict.en[key] ?? key;
  return format(raw, vars);
}

