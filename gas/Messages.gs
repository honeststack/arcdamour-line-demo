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
