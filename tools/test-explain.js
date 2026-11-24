// Cloud Shell 에서 실제 Gemini 로 서류 풀이를 시험한다: node tools/test-explain.js
const fs = require('fs');
process.env.GCLOUD_PROJECT = 'svoi-kr';
const { GoogleGenAI } = require('../functions/node_modules/@google/genai');
const src = fs.readFileSync(__dirname + '/../functions/index.js', 'utf8');
const m = {}; new Function('module', 'Type', src.slice(src.indexOf('const S = Type;'), src.indexOf('exports.explain')) + '\nmodule.S=EXPLAIN_SCHEMA; module.P=explainPrompt;')(m, require('../functions/node_modules/@google/genai').Type);
(async () => {
  const ai = new GoogleGenAI({ vertexai: true, project: 'svoi-kr', location: 'global' });
  const img = fs.readFileSync(__dirname + '/../tests/fixtures/nhis.jpg').toString('base64');
  const r = await ai.models.generateContent({ model: process.argv[2] || 'gemini-3.5-flash',
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: img } }, { text: m.P('ru') }] }],
    config: { responseMimeType: 'application/json', responseSchema: m.S, temperature: 0.2 } });
  const o = JSON.parse(r.text); delete o.fullText; console.log(JSON.stringify(o, null, 1));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
