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
