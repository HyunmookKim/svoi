// Свои 0.2 — 서버 함수 (서울 리전)
//  tr          : 누를 때만 번역 (로그인한 사람만, 결과는 trcache 에 저장)
//  newsToTg    : 소식이 공개되면 텔레그램 채널에 한 번 올린다
//  collectNews : 6시간마다 config/news 의 RSS 주소에서 새 소식을 「대기」로 모은다
//  housekeep   : 매일 1년 지난 처리 끝난 신고를 지운다 (개인정보처리방침 3항)
//  explain     : 서류 사진을 받아 러시아어(또는 한국어)로 풀어 준다. 사진은 저장하지 않는다. 하루 횟수 제한.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { v2: { Translate } } = require('@google-cloud/translate');
const { GoogleGenAI, Type } = require('@google/genai');

admin.initializeApp();
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 5 });
const db = admin.firestore();
const translator = new Translate();
// 텔레그램 봇 토큰·채널은 운영자가 앱의 운영자 화면에서 config/telegram 에 넣는다 (운영자만 읽고 쓸 수 있다)
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

exports.newsToTg = onDocumentWritten({ document: 'news/{id}' }, async ev => {
  const after = ev.data && ev.data.after;
  if(!after || !after.exists) return;
  const n = after.data();
  if(n.status !== 'ok' || n.tg) return;
  const cfg = await db.collection('config').doc('telegram').get();
  const channel = cfg.exists ? String(cfg.data().channel || '').trim() : '';
  const token = cfg.exists ? String(cfg.data().token || '').trim() : '';
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


// ── 서류 사진 풀이 ───────────────────────────────────────────────
let genai = null;
const AI_DEFAULT = { model: 'gemini-3.5-flash', dailyLimit: 5 };
const S = Type;
const EXPLAIN_SCHEMA = {
  type: S.OBJECT,
  properties: {
    isDocument: { type: S.BOOLEAN },
    docType:    { type: S.STRING },
    from:       { type: S.STRING },
    summary:    { type: S.STRING },
    actions:    { type: S.ARRAY, items: { type: S.STRING } },
    deadline:   { type: S.STRING },
    amount:     { type: S.STRING },
    contact:    { type: S.STRING },
    warnings:   { type: S.ARRAY, items: { type: S.STRING } },
    urgency:    { type: S.STRING, enum: ['high', 'medium', 'low'] },
    fullText:   { type: S.STRING },
    unsure:     { type: S.STRING }
  },
  required: ['isDocument', 'docType', 'summary', 'actions', 'deadline', 'amount', 'contact', 'warnings', 'urgency', 'fullText', 'unsure']
};
function explainPrompt(to){
  const L = to === 'ko' ? 'Korean' : 'Russian';
  return [
    'You help Russian-speaking immigrants living in South Korea and their Korean family members understand paperwork.',
    'The images are pages of ONE document, letter, bill, notice, contract, SMS screenshot or sign. Read them carefully.',
    'Write EVERY field in ' + L + ', in plain everyday language for a non-expert. Keep Korean proper names, office names and phone numbers as written, and add a short explanation in ' + L + ' where useful.',
    'Fields:',
    '- isDocument: false if the image is not a readable document (then explain briefly in summary and leave other fields empty).',
    '- docType: what this is (e.g. health insurance premium bill, immigration office notice, traffic fine, employment contract, lease contract, school notice, hospital receipt).',
    '- from: who sent or issued it.',
    '- summary: 2-4 sentences: what it says and what it means for the person.',
    '- actions: concrete steps the person must take, in order. Empty if nothing is required.',
    '- deadline: exact date or period if stated, otherwise empty. Do not invent dates.',
    '- amount: money to pay or received, with currency, if stated. Do not invent amounts.',
    '- contact: where to call or go, with phone numbers exactly as printed. If none printed, suggest 1345 (Foreigner Information Center) only when it is relevant to immigration, otherwise empty.',
    '- warnings: penalties for missing the deadline, risks, or signs of fraud/phishing (e.g. requests to transfer money to a personal account, suspicious links). Empty if none.',
    '- urgency: high if there is a deadline within ~2 weeks, a penalty, a legal or immigration consequence, or possible fraud; low if it is just information.',
    '- fullText: a faithful full translation of the readable text, keeping the structure with line breaks.',
    '- unsure: anything you could not read or are not sure about. Empty if confident.',
    'Never give definitive legal advice. Do not invent facts that are not in the document. If the document asks to pay money, remind to check that the account belongs to the official organization.'
  ].join('\n');
}
exports.explain = onCall({ memory: '512MiB', timeoutSeconds: 120 }, async req => {
  if(!req.auth) throw new HttpsError('unauthenticated', 'login');
  const uid = req.auth.uid;
  const to = (req.data && req.data.to) === 'ko' ? 'ko' : 'ru';
  const images = ((req.data && req.data.images) || []).filter(x => typeof x === 'string' && x.length > 100 && x.length < 3500000).slice(0, 3);
  if(!images.length) throw new HttpsError('invalid-argument', 'no-image');
  const cfgDoc = await db.collection('config').doc('ai').get();
  const cfg = Object.assign({}, AI_DEFAULT, cfgDoc.exists ? cfgDoc.data() : {});
  const isAdmin = (await db.collection('admins').doc(uid).get()).exists;
  // 하루 횟수 (서울 날짜 기준)
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const uref = db.collection('usage').doc(uid);
  const left = await db.runTransaction(async tx => {
    const cur = await tx.get(uref);
    const d = cur.exists && cur.data().day === day ? cur.data().n || 0 : 0;
    if(!isAdmin && d >= cfg.dailyLimit) return -1;
    tx.set(uref, { day, n: d + 1 }, { merge: true });
    return cfg.dailyLimit - d - 1;
  });
  if(left < 0) throw new HttpsError('resource-exhausted', 'limit');
  genai = genai || new GoogleGenAI({ vertexai: true, project: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT, location: 'global' });
  const parts = images.map(b => ({ inlineData: { mimeType: 'image/jpeg', data: b } }));
  parts.push({ text: explainPrompt(to) });
  try{
    const r = await genai.models.generateContent({
      model: cfg.model,
      contents: [{ role: 'user', parts }],
      config: { responseMimeType: 'application/json', responseSchema: EXPLAIN_SCHEMA, temperature: 0.2 }
    });
    const out = JSON.parse(r.text);
    return { result: out, left: isAdmin ? 99 : Math.max(0, left) };
  }catch(e){
    console.error('explain', e.message);
    // 실패하면 횟수를 돌려준다
    await uref.set({ n: admin.firestore.FieldValue.increment(-1) }, { merge: true }).catch(() => {});
    throw new HttpsError('internal', 'ai');
  }
});
