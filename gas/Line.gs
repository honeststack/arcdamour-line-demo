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
