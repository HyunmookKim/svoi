// Свои 0.2 — 서버 함수 (서울 리전)
//  tr          : 누를 때만 번역 (로그인한 사람만, 결과는 trcache 에 저장)
//  newsToTg    : 소식이 공개되면 텔레그램 채널에 한 번 올린다
//  collectNews : 6시간마다 config/news 의 RSS 주소에서 새 소식을 「대기」로 모은다
//  housekeep   : 매일 1년 지난 처리 끝난 신고를 지운다 (개인정보처리방침 3항)
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { v2: { Translate } } = require('@google-cloud/translate');

admin.initializeApp();
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 5 });
const db = admin.firestore();
const translator = new Translate();
const TG_TOKEN = defineSecret('TG_TOKEN');
const TG_CHANNEL = defineString('TG_CHANNEL', { default: '' });
const APP_URL = 'https://hyunmookkim.github.io/svoi/';
const sha = s => crypto.createHash('sha1').update(s).digest('hex');

async function translateText(text, to){
  const key = sha(to + '|' + text);
  const ref = db.collection('trcache').doc(key);
  const hit = await ref.get();
  if(hit.exists) return hit.data().text;
  const [out] = await translator.translate(text, { to, format: 'text' });
  await ref.set({ text: out, to, at: admin.firestore.FieldValue.serverTimestamp() });
  return out;
}

exports.tr = onCall({ memory: '256MiB' }, async req => {
  if(!req.auth) throw new HttpsError('unauthenticated', 'login');
  const text = String((req.data && req.data.text) || '').slice(0, 4000);
  const to = (req.data && req.data.to) === 'ko' ? 'ko' : 'ru';
  if(!text.trim()) return { text: '' };
  return { text: await translateText(text, to) };
});

exports.newsToTg = onDocumentWritten({ document: 'news/{id}', secrets: [TG_TOKEN] }, async ev => {
  const after = ev.data && ev.data.after;
  if(!after || !after.exists) return;
  const n = after.data();
  if(n.status !== 'ok' || n.tg) return;
  const channel = TG_CHANNEL.value();
  const token = TG_TOKEN.value();
  if(!channel || !token) return;
  // 두 번 올리지 않게 먼저 표시한다
  const ok = await db.runTransaction(async tx => {
    const cur = await tx.get(after.ref);
    if(cur.data().tg) return false;
    tx.update(after.ref, { tg: true });
    return true;
  });
  if(!ok) return;
  const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const title = (n.title && (n.title.ru || n.title.ko)) || '';
  const body = ((n.body && (n.body.ru || n.body.ko)) || '').replace(/^##\s+/gm, '').slice(0, 700);
  const text = '<b>' + esc(title) + '</b>\n\n' + esc(body) +
    (n.url ? '\n\n<a href="' + esc(n.url) + '">' + esc(n.src || 'Источник') + '</a>' : '') +
    '\n\n<a href="' + APP_URL + '">Свои — жизнь в Корее</a>';
  const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: channel, text, parse_mode: 'HTML', disable_web_page_preview: false })
  });
  if(!r.ok){
    console.error('telegram', r.status, await r.text());
    await after.ref.update({ tg: false, tgError: r.status });
  }
});

function pickTag(xml, tag){
  const m = xml.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  if(!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
exports.collectNews = onSchedule({ schedule: 'every 6 hours', timeZone: 'Asia/Seoul', memory: '256MiB' }, async () => {
  const cfg = await db.collection('config').doc('news').get();
  const feeds = (cfg.exists && cfg.data().feeds) || [];   // [{ url, src }]
  for(const f of feeds){
    try{
      const r = await fetch(f.url, { headers: { 'user-agent': 'SvoiBot/1.0' } });
      if(!r.ok) continue;
      const xml = await r.text();
      const items = xml.split(/<item[\s>]/i).slice(1, 11);
      for(const it of items){
        const title = pickTag(it, 'title'), link = pickTag(it, 'link'), desc = pickTag(it, 'description').slice(0, 600);
        if(!title || !link) continue;
        const ref = db.collection('news').doc('rss_' + sha(link).slice(0, 20));
        if((await ref.get()).exists) continue;
        let ru = '', ko = '';
        try{ ru = await translateText(title, 'ru'); ko = await translateText(title, 'ko'); }catch(_){}
        let bru = '', bko = '';
        try{ if(desc){ bru = await translateText(desc, 'ru'); bko = await translateText(desc, 'ko'); } }catch(_){}
        await ref.set({ title: { ru, ko }, body: { ru: bru, ko: bko }, url: link, src: f.src || '',
          status: 'pending', tg: false, created: admin.firestore.FieldValue.serverTimestamp(), auto: true });
      }
    }catch(e){ console.error('feed', f.url, e.message); }
  }
});

exports.housekeep = onSchedule({ schedule: 'every day 04:00', timeZone: 'Asia/Seoul' }, async () => {
  const cut = admin.firestore.Timestamp.fromMillis(Date.now() - 365 * 86400000);
  const s = await db.collection('reports').where('open', '==', false).where('created', '<', cut).limit(400).get();
  const b = db.batch(); s.docs.forEach(d => b.delete(d.ref));
  if(s.size) await b.commit();
});
