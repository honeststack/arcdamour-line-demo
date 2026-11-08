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
