// Свои — Cloud Shell 에서 운영자 지정·문서 넣기
//   node tools/admin.js make-admin <email>
//   node tools/admin.js import-guides
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'svoi-kr' });
const db = admin.firestore();
(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if(cmd === 'make-admin'){
    const u = await admin.auth().getUserByEmail(arg);
    await db.collection('admins').doc(u.uid).set({ email: arg, at: admin.firestore.FieldValue.serverTimestamp() });
    const prof = await db.collection('users').doc(u.uid).get();
    console.log('ADMIN OK', u.uid.slice(0, 6), prof.exists ? 'profile ok' : 'NO PROFILE YET');
  } else if(cmd === 'import-guides'){
    const list = require('../content/guides.json');
    const today = new Date().toISOString().slice(0, 10);
    for(const g of list){
      const ref = db.collection('guides').doc(g.id);
      const cur = await ref.get();
      await ref.set({ cat: g.cat, order: g.order || 99, title: g.title, body: g.body, src: g.src || '',
        checked: { ru: g.checked || '2026-11-23', ko: g.checked || '2026-11-23' }, pub: true,
        views: cur.exists ? (cur.data().views || 0) : 0,
        updated: admin.firestore.FieldValue.serverTimestamp(),
        created: cur.exists ? cur.data().created : admin.firestore.FieldValue.serverTimestamp() });
    }
    console.log('GUIDES OK', list.length);
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
