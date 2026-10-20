(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const views = {
    calendar: ['カレンダー', 'ふたりの予定を、ひと目で。'],
    notes: ['メモ帳', '大切なことも、ふとしたことも。'],
    checklists: ['チェックリスト', '暮らしのやることを、いっしょに。']
  };
  let client;
  let session = null;
  let busy = false;
  const calendar = new window.FamilyCalendar();
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* 配色保存不可でも操作継続 */ } }
  };
  let theme = storage.get('family-theme') || 'auto';
  if (!['auto', 'light', 'dark'].includes(theme)) theme = 'auto';
  function applyTheme() {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    $('theme').textContent = `配色：${{ auto: '自動', light: 'ライト', dark: 'ダーク' }[theme]}`;
  }
  $('theme').addEventListener('click', () => {
    theme = ['auto', 'light', 'dark'][(['auto', 'light', 'dark'].indexOf(theme) + 1) % 3];
    storage.set('family-theme', theme);
    applyTheme();
  });
  applyTheme();
  function message(id, text = '') {
    $(id).textContent = text;
    $(id).hidden = !text;
  }
  function showSession(next) {
    const wasLoggedIn = !!session;
    session = next;
    calendar.setSession(client, next);
    $('loading').hidden = true;
    $('login').hidden = !!session;
    $('app').hidden = !session;
    $('account-email').textContent = session?.user?.email || '';
    if (!session) {
      $('password').value = '';
      $('password').type = 'password';
      $('show-password').textContent = '表示する';
      $('show-password').setAttribute('aria-pressed', 'false');
      if (wasLoggedIn) {
        message('app-error');
        selectView('calendar');
        $('email').focus();
      }
    } else if (!wasLoggedIn) {
      message('login-error');
      $('password').value = '';
      document.querySelector('[data-view="calendar"]').focus();
    }
  }
  function selectView(name) {
    if (!views[name]) return;
    Object.keys(views).forEach(view => { $(view).hidden = view !== name; });
    document.querySelectorAll('[data-view]').forEach(button => {
      if (button.dataset.view === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $('page-title').textContent = views[name][0];
    $('page-subtitle').textContent = views[name][1];
    document.title = `${views[name][0]} | Family`;
  }
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => selectView(button.dataset.view));
  });
  $('show-password').addEventListener('click', () => {
    const show = $('password').type === 'password';
    $('password').type = show ? 'text' : 'password';
    $('show-password').textContent = show ? '隠す' : '表示する';
    $('show-password').setAttribute('aria-pressed', String(show));
  });
  function updateConnection() {
    $('connection').hidden = navigator.onLine;

  }
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);

  updateConnection();
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || busy) return;
    message('login-error');
    if (!navigator.onLine) return message('login-error', 'インターネットに接続してから、もう一度お試しください。');
    busy = true;
    $('submit').disabled = true;
    $('submit').textContent = 'ログインしています…';
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
      if (error) {
        message('login-error', error.status === 429 ? '試行回数が多すぎます。時間をおいてお試しください。' : error.status === 400 || error.status === 422 ? 'メールアドレスまたはパスワードを確認してください。' : 'ログインできませんでした。接続情報と通信状況を確認してください。');
      } else showSession(data.session);
    } catch {
      message('login-error', '通信に失敗しました。接続を確認して、もう一度お試しください。');
    } finally {
      $('password').value = '';
      busy = false;
      $('submit').disabled = false;
      $('submit').textContent = 'ログイン →';
    }
  });
  $('logout').addEventListener('click', async () => {
    if (!client || busy) return;
    busy = true;
    $('logout').disabled = true;
    message('app-error');
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) message('app-error', 'ログアウトできませんでした。通信状況を確認して再度お試しください。');
      else showSession(null);
    } catch {
      message('app-error', 'ログアウトに失敗しました。通信状況を確認してください。');
    } finally {
      busy = false;
      $('logout').disabled = false;
    }
  });
  function validConfig(config) {
    try {
      const url = new URL(config.supabaseUrl);
      if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !['', '/'].includes(url.pathname)) return false;
      const key = config.supabaseKey;
      if (typeof key !== 'string') return false;
      if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
      const parts = key.split('.');
      if (parts.length !== 3) return false;
      const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).role === 'anon';
    } catch { return false; }
  }
  async function initialize() {
    if (!validConfig(window.FAMILY_CONFIG || {})) {
      showSession(null);
      $('submit').disabled = true;
      message('login-error', '接続情報が未設定、または形式が正しくありません。config.jsにSupabaseのProject URLと公開用publishable / anon keyを設定してください。');
      return;
    }
    try {
      client = window.supabase.createClient(window.FAMILY_CONFIG.supabaseUrl, window.FAMILY_CONFIG.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: `family-auth-${new URL(window.FAMILY_CONFIG.supabaseUrl).hostname}` }
      });
      // コールバック内では追加のSupabase通信を実行しない。
      client.auth.onAuthStateChange((_event, next) => showSession(next));
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      showSession(data.session);
    } catch {
      showSession(null);
      message('login-error', '認証を初期化できませんでした。接続情報、ブラウザの保存設定、通信状況を確認し、ページを再読み込みしてください。');
    }
  }
  initialize();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* オンラインでの利用は継続 */ });
  }
})();
