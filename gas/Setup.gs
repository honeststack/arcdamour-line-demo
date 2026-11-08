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
