/**
 * LINE予約デモ：GASに貼り付ける1ファイル版（gas/ フォルダの6ファイルを順番に結合したもの）
 * 元ファイルを変更したら、tools で作り直してください。
 */

/* ====================== Config.gs ====================== */

/**
 * 店舗・予約の設定
 * デモ用の架空店舗です。ここを書き換えるだけで、業種や営業時間を変更できます。
 */
const CONFIG = {
  SHOP_NAME: 'デモサロン（架空の店舗）',
  TZ: 'Asia/Tokyo',

  // 予約できる時間枠（1枠 = 1時間）
  SLOTS: ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'],
  // 定休日（0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土）
  CLOSED_WEEKDAYS: [2],
  // 1枠あたりの受付可能数
  CAPACITY_PER_SLOT: 1,
  // 何日先まで予約できるか（翌日から数える）
  BOOKING_DAYS_AHEAD: 30,

  MENUS: [
    { id: 'cut', name: 'カット', price: '4,400円', minutes: 60 },
    { id: 'color', name: 'カット＋カラー', price: '9,900円', minutes: 60 },
    { id: 'spa', name: 'ヘッドスパ', price: '5,500円', minutes: 60 },
    { id: 'counsel', name: '無料カウンセリング', price: '0円', minutes: 30 },
  ],

  BRAND_COLOR: '#0A7553',
};

/** シート名と列の定義 */
const SHEETS = {
  RESERVATIONS: '予約',
  FAQ: 'FAQ',
  LOG: 'ログ',
};

// 予約シートの列（0始まり）
const COL = {
  ID: 0, CREATED: 1, USER_ID: 2, DISPLAY_NAME: 3, DATE: 4, TIME: 5,
  MENU: 6, NAME: 7, NOTE: 8, STATUS: 9,
};
const RESERVATION_HEADERS = ['予約ID', '受付日時', 'LINEユーザーID', 'LINE表示名', '日付', '時間', 'メニュー', 'お名前', 'ご要望', 'ステータス'];

const STATUS = { BOOKED: '予約済', CANCELED: 'キャンセル' };

/** スクリプトプロパティ（setup 時に設定） */
const PROPS = PropertiesService.getScriptProperties();
function prop_(key) {
  return PROPS.getProperty(key) || '';
}

/* ====================== Line.gs ====================== */

/**
 * LINE API・通知・ログなどの共通処理
 */

function lineApi_(path, payload, method) {
  const options = {
    method: method || 'post',
    headers: { Authorization: 'Bearer ' + prop_('CHANNEL_ACCESS_TOKEN') },
    muteHttpExceptions: true,
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/' + path, options);
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 300) throw new Error('LINE API ' + path + ' (' + code + '): ' + body);
  return body ? JSON.parse(body) : {};
}

function reply_(replyToken, messages) {
  if (!replyToken || !messages || !messages.length) return null;
  return lineApi_('message/reply', { replyToken: replyToken, messages: messages });
}

function push_(userId, messages) {
  return lineApi_('message/push', { to: userId, messages: messages });
}

function getDisplayName_(userId) {
  if (!userId) return '';
  try {
    return lineApi_('profile/' + userId, null, 'get').displayName || '';
  } catch (err) {
    return '';
  }
}

/** LIFF から受け取った IDトークンを LINE で検証し、ユーザー情報を得る */
function verifyIdToken_(idToken) {
  if (!idToken) return null;
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: prop_('LOGIN_CHANNEL_ID') },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  return JSON.parse(res.getContentText()); // { sub: userId, name, ... }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function parseQuery_(s) {
  const out = {};
  String(s || '').split('&').forEach(function (pair) {
    if (!pair) return;
    const i = pair.indexOf('=');
    const k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
    out[k] = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1));
  });
  return out;
}

/** 管理者へのメール通知（ADMIN_EMAIL が未設定なら何もしない） */
function notifyAdmin_(subject, body) {
  const to = prop_('ADMIN_EMAIL');
  if (!to) return;
  try {
    MailApp.sendEmail(to, subject, body + '\n\n---\n' + CONFIG.SHOP_NAME + ' LINE予約デモ');
  } catch (err) {
    log_('ERROR', '管理者通知の送信に失敗: ' + err.message);
  }
}

function log_(level, message) {
  try {
    sheet_(SHEETS.LOG).appendRow([Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss'), level, message]);
  } catch (err) {
    console.error(message);
  }
}

function logError_(err, context) {
  log_('ERROR', (err && err.stack ? err.stack : String(err)) + '\n' + JSON.stringify(context || {}).slice(0, 500));
}

/* ====================== Reservation.gs ====================== */

/**
 * 予約データの読み書き（スプレッドシートを予約台帳として使う）
 */

function sheet_(name) {
  return SpreadsheetApp.openById(prop_('SPREADSHEET_ID')).getSheetByName(name);
}

/** 'yyyy-MM-dd' 形式の文字列 */
function ymd_(date) {
  return Utilities.formatDate(date, CONFIG.TZ, 'yyyy-MM-dd');
}

/** 予約できる期間（翌日〜BOOKING_DAYS_AHEAD 日後） */
function bookableRange_() {
  const from = new Date();
  from.setDate(from.getDate() + 1);
  const to = new Date();
  to.setDate(to.getDate() + CONFIG.BOOKING_DAYS_AHEAD);
  return { from: ymd_(from), to: ymd_(to) };
}

/** 曜日（暦日から計算するのでタイムゾーンの影響を受けない） */
function weekdayIndex_(dateStr) {
  const p = dateStr.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}
function weekdayJa_(dateStr) {
  return '日月火水木金土'.charAt(weekdayIndex_(dateStr));
}

function isValidDate_(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const p = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function readReservations_() {
  const sh = sheet_(SHEETS.RESERVATIONS);
  const values = sh.getDataRange().getDisplayValues();
  return values.slice(1).map(function (row, i) {
    return {
      rowNumber: i + 2,
      id: row[COL.ID], created: row[COL.CREATED], userId: row[COL.USER_ID], displayName: row[COL.DISPLAY_NAME],
      date: row[COL.DATE], time: row[COL.TIME], menu: row[COL.MENU], name: row[COL.NAME],
      note: row[COL.NOTE], status: row[COL.STATUS],
    };
  });
}

/** 指定日の空き状況 */
function getAvailableSlots_(dateStr) {
  const range = bookableRange_();
  if (!isValidDate_(dateStr) || dateStr < range.from || dateStr > range.to) return [];
  if (CONFIG.CLOSED_WEEKDAYS.indexOf(weekdayIndex_(dateStr)) >= 0) {
    return CONFIG.SLOTS.map(function (t) { return { time: t, available: false }; });
  }
  const counts = {};
  readReservations_().forEach(function (r) {
    if (r.date === dateStr && r.status === STATUS.BOOKED) counts[r.time] = (counts[r.time] || 0) + 1;
  });
  return CONFIG.SLOTS.map(function (t) {
    return { time: t, available: (counts[t] || 0) < CONFIG.CAPACITY_PER_SLOT };
  });
}

/** 予約を登録する。同時に同じ枠が埋まらないよう排他制御する */
function createReservation_(req) {
  const menu = CONFIG.MENUS.filter(function (m) { return m.id === req.menuId; })[0];
  if (!menu) return { ok: false, error: 'メニューを選択してください。' };
  if (!req.name) return { ok: false, error: 'お名前を入力してください。' };
  if (CONFIG.SLOTS.indexOf(req.time) < 0) return { ok: false, error: '時間を選択してください。' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    return { ok: false, error: 'ただいま混み合っています。少し時間をおいて、もう一度お試しください。' };
  }
  try {
    const slot = getAvailableSlots_(req.date).filter(function (s) { return s.time === req.time; })[0];
    if (!slot || !slot.available) {
      return { ok: false, error: 'この時間はちょうど埋まってしまいました。別の時間をお選びください。', code: 'SLOT_TAKEN' };
    }

    const now = new Date();
    const id = 'R' + Utilities.formatDate(now, CONFIG.TZ, 'yyMMdd') + '-' +
      Utilities.getUuid().replace(/-/g, '').slice(0, 4).toUpperCase();
    const row = [];
    row[COL.ID] = id;
    row[COL.CREATED] = Utilities.formatDate(now, CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss');
    row[COL.USER_ID] = req.userId;
    row[COL.DISPLAY_NAME] = req.displayName;
    row[COL.DATE] = req.date;
    row[COL.TIME] = req.time;
    row[COL.MENU] = menu.name;
    row[COL.NAME] = req.name;
    row[COL.NOTE] = req.note;
    row[COL.STATUS] = STATUS.BOOKED;
    sheet_(SHEETS.RESERVATIONS).appendRow(row);
    SpreadsheetApp.flush();

    return {
      ok: true,
      reservation: { id: id, date: req.date, time: req.time, menu: menu.name, price: menu.price, name: req.name, note: req.note },
    };
  } finally {
    lock.releaseLock();
  }
}

/** 今日以降の有効な予約（日時順） */
function getUpcomingReservations_(userId) {
  const today = ymd_(new Date());
  return readReservations_()
    .filter(function (r) { return r.userId === userId && r.status === STATUS.BOOKED && r.date >= today; })
    .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
}

/** 予約をキャンセル（本人の予約のみ） */
function cancelReservation_(userId, id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10 * 1000);
  try {
    const r = readReservations_().filter(function (x) {
      return x.id === id && x.userId === userId && x.status === STATUS.BOOKED;
    })[0];
    if (!r) return null;
    sheet_(SHEETS.RESERVATIONS).getRange(r.rowNumber, COL.STATUS + 1).setValue(STATUS.CANCELED);
    return r;
  } finally {
    lock.releaseLock();
  }
}

/** デモ用：自分の予約データをすべて削除 */
function resetDemoData_(userId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10 * 1000);
  try {
    const sh = sheet_(SHEETS.RESERVATIONS);
    const rows = readReservations_().filter(function (r) { return r.userId === userId; });
    // 下の行から消すことで行番号のずれを防ぐ
    rows.sort(function (a, b) { return b.rowNumber - a.rowNumber; })
      .forEach(function (r) { sh.deleteRow(r.rowNumber); });
    return rows.length;
  } finally {
    lock.releaseLock();
  }
}

function reservationText_(r) {
  return [
    '予約ID: ' + r.id,
    '日時: ' + r.date + '（' + weekdayJa_(r.date) + '）' + r.time + '〜',
    'メニュー: ' + r.menu,
    'お名前: ' + r.name,
    'ご要望: ' + (r.note || 'なし'),
  ].join('\n');
}

/* ---------- FAQ ---------- */

function readFaq_() {
  const values = sheet_(SHEETS.FAQ).getDataRange().getDisplayValues().slice(1);
  return values
    .filter(function (row) { return row[1] && row[2]; })
    .map(function (row) {
      return {
        keywords: row[0].split(/[,、，]/).map(function (k) { return k.trim(); }).filter(String),
        question: row[1],
        answer: row[2],
      };
    });
}

function findFaqByKeyword_(text) {
  return readFaq_().filter(function (f) {
    return f.keywords.some(function (k) { return text.indexOf(k) >= 0; });
  })[0] || null;
}

function getFaqByIndex_(i) {
  return readFaq_()[i] || null;
}

/* ====================== Messages.gs ====================== */

/**
 * LINE に送るメッセージ（テキスト・クイックリプライ・Flex Message）
 */

function liffUrl_() {
  return 'https://liff.line.me/' + prop_('LIFF_ID');
}

function text_(text, quickReply) {
  const m = { type: 'text', text: text };
  if (quickReply) m.quickReply = quickReply;
  return m;
}

function defaultQuickReply_() {
  return {
    items: [
      { type: 'action', action: { type: 'uri', label: '予約する', uri: liffUrl_() } },
      { type: 'action', action: { type: 'message', label: '予約確認', text: '予約確認' } },
      { type: 'action', action: { type: 'message', label: 'メニュー一覧', text: 'メニュー一覧' } },
      { type: 'action', action: { type: 'message', label: 'よくある質問', text: 'よくある質問' } },
      { type: 'action', action: { type: 'message', label: '担当者に相談', text: '担当者に相談' } },
    ],
  };
}

/* ---------- 部品 ---------- */

function t_(text, opts) {
  const o = { type: 'text', text: String(text), wrap: true };
  Object.keys(opts || {}).forEach(function (k) { o[k] = opts[k]; });
  return o;
}

function kv_(label, value) {
  return {
    type: 'box', layout: 'horizontal', spacing: 'md',
    contents: [
      t_(label, { size: 'sm', color: '#7A8A84', flex: 2 }),
      t_(value, { size: 'sm', color: '#13201B', flex: 5 }),
    ],
  };
}

function header_(eyebrow, title) {
  return {
    type: 'box', layout: 'vertical', backgroundColor: CONFIG.BRAND_COLOR, paddingAll: '18px', spacing: 'xs',
    contents: [
      t_(eyebrow, { size: 'xxs', color: '#CDE9DD' }),
      t_(title, { size: 'lg', weight: 'bold', color: '#FFFFFF' }),
    ],
  };
}

function button_(label, action, style) {
  action.label = label;
  return { type: 'button', style: style || 'primary', color: style === 'secondary' ? undefined : CONFIG.BRAND_COLOR, height: 'sm', action: action };
}

function flex_(altText, contents) {
  return { type: 'flex', altText: altText, contents: contents };
}

function bullet_(text) {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      t_('●', { size: 'xxs', color: CONFIG.BRAND_COLOR, flex: 0, gravity: 'center' }),
      t_(text, { size: 'sm', color: '#13201B' }),
    ],
  };
}

/* ---------- メッセージ ---------- */

function welcomeFlex_(name) {
  return flex_('友だち追加ありがとうございます', {
    type: 'bubble',
    header: header_('LINE予約デモ', (name ? name + 'さん、' : '') + 'ようこそ'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        t_('このアカウントは、LINE上で予約から確認・キャンセルまで完結する仕組みのデモです。架空の店舗「' + CONFIG.SHOP_NAME + '」として動いています。', { size: 'sm', color: '#3B4A44' }),
        { type: 'separator' },
        bullet_('LINEの中で開く予約フォーム'),
        bullet_('予約の確認・キャンセル'),
        bullet_('よくある質問への自動応答'),
        bullet_('タブで切り替わるリッチメニュー'),
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        button_('予約を試す', { type: 'uri', uri: liffUrl_() }),
        button_('このBotの仕組み', { type: 'message', text: '仕組み' }, 'secondary'),
      ],
    },
  });
}

function bookingFlex_() {
  return flex_('予約フォームを開く', {
    type: 'bubble', size: 'kilo',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        t_('ご予約', { weight: 'bold', size: 'lg' }),
        t_('メニュー、日時、お名前を選ぶだけで予約できます。空いている時間だけが表示されます。', { size: 'sm', color: '#3B4A44' }),
      ],
    },
    footer: { type: 'box', layout: 'vertical', contents: [button_('予約フォームを開く', { type: 'uri', uri: liffUrl_() })] },
  });
}

function reservationConfirmFlex_(r) {
  return flex_('ご予約を承りました：' + r.date + ' ' + r.time, {
    type: 'bubble',
    header: header_('ご予約完了', 'ご予約を承りました'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        kv_('日時', r.date + '（' + weekdayJa_(r.date) + '）' + r.time + '〜'),
        kv_('メニュー', r.menu),
        kv_('料金', r.price || '-'),
        kv_('お名前', r.name + ' 様'),
        kv_('ご要望', r.note || 'なし'),
        { type: 'separator' },
        t_('予約ID：' + r.id, { size: 'xs', color: '#7A8A84' }),
      ],
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [button_('予約を確認・キャンセル', { type: 'message', text: '予約確認' }, 'secondary')],
    },
  });
}

function reservationsMessage_(list) {
  if (!list.length) {
    return text_('現在、ご予約はありません。', defaultQuickReply_());
  }
  const bubbles = list.slice(0, 10).map(function (r) {
    return {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          t_(r.date + '（' + weekdayJa_(r.date) + '）', { size: 'xs', color: '#7A8A84' }),
          t_(r.time + '〜', { size: 'xxl', weight: 'bold', color: CONFIG.BRAND_COLOR }),
          t_(r.menu, { size: 'md', weight: 'bold' }),
          t_(r.name + ' 様', { size: 'sm', color: '#3B4A44' }),
          t_('予約ID：' + r.id, { size: 'xxs', color: '#7A8A84' }),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [button_('キャンセルする', {
          type: 'postback', data: 'action=cancel&id=' + encodeURIComponent(r.id), displayText: r.date + ' ' + r.time + ' の予約をキャンセルします',
        }, 'secondary')],
      },
    };
  });
  return flex_('現在のご予約（' + list.length + '件）', { type: 'carousel', contents: bubbles });
}

function menuListFlex_() {
  const rows = [];
  CONFIG.MENUS.forEach(function (m, i) {
    if (i) rows.push({ type: 'separator' });
    rows.push({
      type: 'box', layout: 'horizontal',
      contents: [
        { type: 'box', layout: 'vertical', flex: 5, contents: [
          t_(m.name, { size: 'sm', weight: 'bold' }),
          t_('約' + m.minutes + '分', { size: 'xs', color: '#7A8A84' }),
        ] },
        t_(m.price, { size: 'sm', weight: 'bold', align: 'end', flex: 3, gravity: 'center' }),
      ],
    });
  });
  return flex_('メニュー一覧', {
    type: 'bubble',
    header: header_(CONFIG.SHOP_NAME, 'メニュー・料金'),
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
    footer: { type: 'box', layout: 'vertical', contents: [button_('このメニューで予約する', { type: 'uri', uri: liffUrl_() })] },
  });
}

function faqMenuMessage_() {
  const items = readFaq_().slice(0, 13).map(function (f, i) {
    const label = f.question.length > 20 ? f.question.slice(0, 19) + '…' : f.question;
    return { type: 'action', action: { type: 'postback', label: label, data: 'action=faq&i=' + i, displayText: f.question } };
  });
  if (!items.length) return text_('よくある質問は準備中です。', defaultQuickReply_());
  return text_('知りたい内容を選んでください。「駐車場」「支払い」のように、キーワードを送っても回答します。', { items: items });
}

function flowStep_(title, sub, filled) {
  return {
    type: 'box', layout: 'vertical', paddingAll: '10px', cornerRadius: '6px',
    backgroundColor: filled ? CONFIG.BRAND_COLOR : '#EEF4F1',
    contents: [
      t_(title, { size: 'sm', weight: 'bold', color: filled ? '#FFFFFF' : '#13201B' }),
      t_(sub, { size: 'xxs', color: filled ? '#CDE9DD' : '#5A6B65' }),
    ],
  };
}
function arrow_() {
  return t_('↓', { size: 'xs', color: '#9AABA4', align: 'center' });
}

function architectureFlex_() {
  return flex_('このBotの仕組み', {
    type: 'bubble',
    header: header_('Architecture', 'このBotの仕組み'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'xs',
      contents: [
        flowStep_('LINEアプリ', 'メッセージ・リッチメニュー・予約フォーム（LIFF）'),
        arrow_(),
        flowStep_('Google Apps Script', 'Webhookで受信 → 内容に応じて処理を振り分け', true),
        arrow_(),
        flowStep_('スプレッドシート', '予約台帳・FAQ・ログ。社内の方がそのまま閲覧・編集'),
        arrow_(),
        flowStep_('通知', '利用者へ予約完了メッセージ、管理者へメール'),
        { type: 'separator', margin: 'lg' },
        t_('サーバー代のかからない構成です。FAQや営業時間は、スプレッドシートと設定ファイルから変更できます。', { size: 'xs', color: '#5A6B65', margin: 'md' }),
      ],
    },
  });
}

function techFlex_() {
  const items = [
    ['Messaging API', 'Webhook、応答、プッシュ通知'],
    ['リッチメニュー', 'エイリアスによるタブ切り替え'],
    ['LIFF', 'LINE内で開く予約フォーム、IDトークン検証'],
    ['Flex Message', '予約完了カード、予約一覧カルーセル'],
    ['Google Apps Script', 'Webhook受信、予約ロジック、排他制御'],
    ['スプレッドシート', '予約台帳、FAQ、実行ログ'],
  ];
  const rows = [];
  items.forEach(function (it, i) {
    if (i) rows.push({ type: 'separator' });
    rows.push(kv_(it[0], it[1]));
  });
  return flex_('使用技術', {
    type: 'bubble',
    header: header_('Tech Stack', '使用技術'),
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
  });
}

function featuresFlex_() {
  return flex_('機能一覧', {
    type: 'bubble',
    header: header_('Features', '機能一覧'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        bullet_('空き枠だけを表示する予約フォーム（LIFF）'),
        bullet_('同じ枠への同時予約を防ぐ排他制御'),
        bullet_('予約完了カードの自動送信'),
        bullet_('予約の確認・キャンセル（本人の予約のみ）'),
        bullet_('キーワードでFAQに自動回答'),
        bullet_('管理者へのメール通知'),
        bullet_('タブで切り替わるリッチメニュー'),
        bullet_('エラーをログシートに記録'),
      ],
    },
  });
}

function contactFlex_() {
  const buttons = [];
  const portfolio = prop_('PORTFOLIO_URL');
  if (/^https:\/\//.test(portfolio)) buttons.push(button_('実績を見る', { type: 'uri', uri: portfolio }));
  buttons.push(button_('担当者に相談', { type: 'message', text: '担当者に相談' }, 'secondary'));
  return flex_('LINEアプリ開発のご相談', {
    type: 'bubble',
    header: header_('Contact', '開発のご相談'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        t_('このデモと同じ仕組みを、貴社の業種・業務に合わせて構築します。', { size: 'sm' }),
        bullet_('予約・問い合わせの受付'),
        bullet_('会員証・ポイント・クーポン'),
        bullet_('スプレッドシートやkintoneとの連携'),
      ],
    },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
  });
}

/* ====================== Main.gs ====================== */

/**
 * LINE Messaging API の Webhook と、LIFF（予約フォーム）からのリクエストを受け付ける入口。
 * Webアプリとしてデプロイし、その URL を LINE Developers の Webhook URL に設定します。
 */

/** POST：LINE の Webhook、または LIFF からの予約送信 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'リクエストの形式が正しくありません。' });
  }

  // LINE プラットフォームからの Webhook
  if (Array.isArray(body.events)) {
    body.events.forEach(function (ev) {
      try {
        handleEvent_(ev);
      } catch (err) {
        logError_(err, ev);
      }
    });
    return json_({ ok: true });
  }

  // LIFF の予約フォームからの送信
  if (body.action === 'reserve') {
    try {
      return json_(handleReserveFromLiff_(body));
    } catch (err) {
      logError_(err, { action: 'reserve' });
      return json_({ ok: false, error: '予約の登録中にエラーが発生しました。時間をおいて再度お試しください。' });
    }
  }

  return json_({ ok: false, error: '不明なリクエストです。' });
}

/** GET：LIFF が空き枠や設定を取得する */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'config') {
    return json_({
      ok: true,
      shopName: CONFIG.SHOP_NAME,
      menus: CONFIG.MENUS,
      closedWeekdays: CONFIG.CLOSED_WEEKDAYS,
      dateRange: bookableRange_(),
    });
  }
  if (p.action === 'slots') {
    return json_({ ok: true, date: p.date, slots: getAvailableSlots_(p.date) });
  }
  return json_({ ok: true, service: 'LINE予約デモ' });
}

/** イベントの振り分け */
function handleEvent_(ev) {
  const userId = ev.source && ev.source.userId;
  switch (ev.type) {
    case 'follow':
      return reply_(ev.replyToken, [welcomeFlex_(getDisplayName_(userId))]);

    case 'message':
      if (ev.message.type !== 'text') {
        return reply_(ev.replyToken, [text_('メッセージありがとうございます。下のボタンからご用件をお選びください。', defaultQuickReply_())]);
      }
      return handleText_(ev, userId, ev.message.text.trim());

    case 'postback':
      return handlePostback_(ev, userId);

    default:
      return null; // unfollow など、応答不要のイベント
  }
}

/** テキストメッセージへの応答 */
function handleText_(ev, userId, text) {
  const routes = {
    '予約する': function () { return [bookingFlex_()]; },
    '予約確認': function () { return [reservationsMessage_(getUpcomingReservations_(userId))]; },
    'メニュー一覧': function () { return [menuListFlex_()]; },
    'よくある質問': function () { return [faqMenuMessage_()]; },
    '担当者に相談': function () {
      notifyAdmin_('【LINEデモ】担当者への相談リクエスト', 'LINE表示名: ' + getDisplayName_(userId) + '\nユーザーID: ' + userId);
      return [text_('担当者に通知しました。営業時間内に、このトークでご連絡します。\n（デモのため、実際の返信はありません）', defaultQuickReply_())];
    },
    '仕組み': function () { return [architectureFlex_()]; },
    '使用技術': function () { return [techFlex_()]; },
    '機能一覧': function () { return [featuresFlex_()]; },
    '開発の相談': function () { return [contactFlex_()]; },
    'デモをリセット': function () {
      const n = resetDemoData_(userId);
      return [text_('あなたの予約データ ' + n + ' 件を削除しました。最初から試せます。', defaultQuickReply_())];
    },
  };

  if (routes[text]) return reply_(ev.replyToken, routes[text]());

  // FAQ シートのキーワードに一致すれば回答
  const faq = findFaqByKeyword_(text);
  if (faq) return reply_(ev.replyToken, [text_(faq.answer, defaultQuickReply_())]);

  return reply_(ev.replyToken, [text_('ご用件を下のボタンからお選びください。「駐車場」「支払い」などのキーワードでも、よくある質問にお答えします。', defaultQuickReply_())]);
}

/** ボタン（ポストバック）への応答 */
function handlePostback_(ev, userId) {
  const data = parseQuery_(ev.postback.data);

  if (data.action === 'cancel') {
    const r = cancelReservation_(userId, data.id);
    const msg = r
      ? r.date + '（' + weekdayJa_(r.date) + '）' + r.time + '〜 ' + r.menu + ' のご予約をキャンセルしました。'
      : 'このご予約は見つからないか、すでにキャンセルされています。';
    if (r) notifyAdmin_('【LINEデモ】予約キャンセル', reservationText_(r));
    return reply_(ev.replyToken, [text_(msg, defaultQuickReply_())]);
  }

  if (data.action === 'faq') {
    const faq = getFaqByIndex_(Number(data.i));
    if (faq) return reply_(ev.replyToken, [text_('Q. ' + faq.question + '\n\n' + faq.answer, defaultQuickReply_())]);
  }

  // リッチメニューのタブ切り替え（tab=main / tab=info）は応答不要
  return null;
}

/** LIFF の予約フォームから送られた予約を登録する */
function handleReserveFromLiff_(body) {
  const profile = verifyIdToken_(body.idToken);
  if (!profile) {
    return { ok: false, error: 'LINEログインの確認に失敗しました。画面を閉じて、もう一度開いてください。' };
  }

  const result = createReservation_({
    userId: profile.sub,
    displayName: profile.name || '',
    date: String(body.date || ''),
    time: String(body.time || ''),
    menuId: String(body.menuId || ''),
    name: String(body.name || '').slice(0, 50),
    note: String(body.note || '').slice(0, 300),
  });
  if (!result.ok) return result;

  const r = result.reservation;
  try {
    push_(profile.sub, [reservationConfirmFlex_(r)]);
  } catch (err) {
    logError_(err, { action: 'push-confirm', id: r.id }); // 予約自体は成立しているので処理は続ける
  }
  notifyAdmin_('【LINEデモ】新しいご予約', reservationText_(r));
  return { ok: true, reservation: r };
}

/* ====================== Setup.gs ====================== */

/**
 * 初期設定用の関数（GASエディタから手動で1回ずつ実行します）
 *
 *  1. setupSheets        … 予約・FAQ・ログのシートを作成
 *  2. checkSettings      … スクリプトプロパティの設定漏れを確認
 *  3. setupRichMenus     … リッチメニュー（2タブ）を作成して全員に適用
 */

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PROPS.setProperty('SPREADSHEET_ID', ss.getId());

  const res = ensureSheet_(ss, SHEETS.RESERVATIONS, RESERVATION_HEADERS);
  // 日付・時間などが自動で日付型に変換されないよう、全列を文字列にする
  res.getRange(1, 1, res.getMaxRows(), RESERVATION_HEADERS.length).setNumberFormat('@');
  res.setColumnWidth(COL.USER_ID + 1, 120);

  const faq = ensureSheet_(ss, SHEETS.FAQ, ['キーワード（カンマ区切り）', '質問', '回答']);
  if (faq.getLastRow() < 2) {
    faq.getRange(2, 1, 5, 3).setValues([
      ['駐車場,車,パーキング', '駐車場はありますか？', '店舗の裏に2台分の駐車場があります。満車の場合は、近くのコインパーキングをご利用ください。'],
      ['支払い,カード,PayPay,現金', '支払い方法は？', '現金、クレジットカード、PayPayをご利用いただけます。'],
      ['キャンセル,変更', '予約の変更・キャンセルは？', 'メニューの「予約確認」から、いつでもキャンセルできます。変更の場合は、キャンセル後に改めてご予約ください。'],
      ['営業時間,定休日,何時', '営業時間と定休日は？', '営業時間は10:00〜18:00（最終受付17:00）、定休日は火曜日です。'],
      ['時間,所要,どのくらい', '施術時間はどのくらい？', 'カットは約60分、無料カウンセリングは約30分です。メニュー一覧もご覧ください。'],
    ]);
  }

  ensureSheet_(ss, SHEETS.LOG, ['日時', '種別', '内容']);
  Logger.log('シートの準備が完了しました: ' + ss.getUrl());
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#E1F0E9');
  sh.setFrozenRows(1);
  return sh;
}

function checkSettings() {
  const required = ['CHANNEL_ACCESS_TOKEN', 'LOGIN_CHANNEL_ID', 'LIFF_ID', 'SPREADSHEET_ID', 'RICHMENU_IMAGE_BASE_URL'];
  const optional = ['ADMIN_EMAIL', 'PORTFOLIO_URL'];
  const missing = required.filter(function (k) { return !prop_(k); });
  Logger.log(missing.length ? '未設定（必須）: ' + missing.join(', ') : '必須の設定はすべて完了しています。');
  optional.forEach(function (k) { Logger.log(k + ': ' + (prop_(k) || '（未設定・任意）')); });
}

/* ---------- リッチメニュー ---------- */

const RM = { W: 2500, H: 1686, TAB_H: 240 };

/** 下段 2行×3列のボタン領域 */
function gridAreas_(actions) {
  const top = RM.TAB_H;
  const rowH = (RM.H - top) / 2; // 723
  const cols = [0, 833, 1667];
  const widths = [833, 834, 833];
  return actions.map(function (action, i) {
    const r = Math.floor(i / 3), c = i % 3;
    return { bounds: { x: cols[c], y: top + r * rowH, width: widths[c], height: rowH }, action: action };
  });
}

function tabAreas_() {
  return [
    { bounds: { x: 0, y: 0, width: 1250, height: RM.TAB_H }, action: { type: 'richmenuswitch', richMenuAliasId: 'tab-main', data: 'tab=main' } },
    { bounds: { x: 1250, y: 0, width: 1250, height: RM.TAB_H }, action: { type: 'richmenuswitch', richMenuAliasId: 'tab-info', data: 'tab=info' } },
  ];
}

function setupRichMenus() {
  const base = prop_('RICHMENU_IMAGE_BASE_URL').replace(/\/$/, '');
  if (!base) throw new Error('RICHMENU_IMAGE_BASE_URL を設定してください（例: https://xxxx.netlify.app/richmenu）');
  const portfolio = prop_('PORTFOLIO_URL');

  const mainMenu = {
    size: { width: RM.W, height: RM.H }, selected: true, name: 'demo-main', chatBarText: 'メニュー',
    areas: tabAreas_().concat(gridAreas_([
      { type: 'uri', uri: liffUrl_() },
      { type: 'message', text: '予約確認' },
      { type: 'message', text: 'メニュー一覧' },
      { type: 'message', text: 'よくある質問' },
      { type: 'message', text: '担当者に相談' },
      { type: 'message', text: 'デモをリセット' },
    ])),
  };

  const infoMenu = {
    size: { width: RM.W, height: RM.H }, selected: true, name: 'demo-info', chatBarText: 'メニュー',
    areas: tabAreas_().concat(gridAreas_([
      { type: 'message', text: '仕組み' },
      { type: 'message', text: '使用技術' },
      { type: 'message', text: '機能一覧' },
      /^https:\/\//.test(portfolio) ? { type: 'uri', uri: portfolio } : { type: 'message', text: '開発の相談' },
      { type: 'message', text: '開発の相談' },
      { type: 'richmenuswitch', richMenuAliasId: 'tab-main', data: 'tab=main' },
    ])),
  };

  const mainId = lineApi_('richmenu', mainMenu).richMenuId;
  uploadRichMenuImage_(mainId, base + '/main.png');
  const infoId = lineApi_('richmenu', infoMenu).richMenuId;
  uploadRichMenuImage_(infoId, base + '/info.png');

  upsertAlias_('tab-main', mainId);
  upsertAlias_('tab-info', infoId);
  lineApi_('user/all/richmenu/' + mainId, null, 'post');

  Logger.log('リッチメニューを作成しました。main=' + mainId + ' / info=' + infoId);
}

function uploadRichMenuImage_(richMenuId, imageUrl) {
  const img = UrlFetchApp.fetch(imageUrl);
  const res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/richmenu/' + richMenuId + '/content', {
    method: 'post',
    contentType: 'image/png',
    headers: { Authorization: 'Bearer ' + prop_('CHANNEL_ACCESS_TOKEN') },
    payload: img.getBlob().getBytes(),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('画像アップロード失敗: ' + res.getContentText());
}

function upsertAlias_(aliasId, richMenuId) {
  try {
    lineApi_('richmenu/alias/' + aliasId, null, 'delete');
  } catch (err) {
    // 初回はエイリアスが存在しないので無視する
  }
  lineApi_('richmenu/alias', { richMenuAliasId: aliasId, richMenuId: richMenuId });
}

/** 作り直したいときに：既存のリッチメニューとエイリアスをすべて削除 */
function deleteAllRichMenus() {
  ['tab-main', 'tab-info'].forEach(function (a) {
    try { lineApi_('richmenu/alias/' + a, null, 'delete'); } catch (err) { /* 無ければ無視 */ }
  });
  (lineApi_('richmenu/list', null, 'get').richmenus || []).forEach(function (m) {
    lineApi_('richmenu/' + m.richMenuId, null, 'delete');
  });
  Logger.log('リッチメニューをすべて削除しました。');
}
