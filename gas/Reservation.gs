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
