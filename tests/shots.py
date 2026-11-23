# 밝게·어둡게 화면 사진 (가짜 자료)
import json, sys, os, threading, http.server, functools, re
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), '..', 'www')
import importlib.util
MOCK = open(os.path.join(os.path.dirname(__file__), 'mockfb.js')).read()
spec = importlib.util.spec_from_file_location('flowmod', os.path.join(os.path.dirname(__file__), 'flow.py'))
src = open(os.path.join(os.path.dirname(__file__), 'flow.py')).read()
ns = {}; exec(src[src.index('NAMES = {'):src.index('class H(')], ns)
NAMES, wrapper = ns['NAMES'], ns['wrapper']
class H(http.server.SimpleHTTPRequestHandler):
  def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(H, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
guides = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'content', 'guides.json')))
seed = {}
for i, g in enumerate(guides):
  seed['guides/' + g['id']] = dict(cat=g['cat'], order=g.get('order', 9), title=g['title'], body=g['body'], src=g['src'],
                                   checked={'ru': '2026-11-23', 'ko': '2026-11-23'}, pub=True, views=50 - i)
seed['news/n1'] = dict(title={'ru': 'С 1 января минимальная зарплата — 10 700 вон', 'ko': '1월 1일부터 최저임금 10,700원'}, body={'ru': 'Текст', 'ko': '본문'}, src='moel.go.kr', status='ok')
seed['news/n2'] = dict(title={'ru': 'Продление виз F-6 теперь онлайн', 'ko': 'F-6 연장 온라인 신청'}, body={'ru': 'Текст', 'ko': '본문'}, src='hikorea.go.kr', status='ok')
seed['posts/p1'] = dict(uid='x', name='Анна', cat='stay', title='Куда идти продлевать F-6 в Ансане?', body='Подскажите, пожалуйста', answers=0, solved=False, hidden=False, photos=[])
seed['posts/p2'] = dict(uid='y', name='Дильноза', cat='health', title='Где найти педиатра, говорящего по-русски?', body='…', answers=0, solved=False, hidden=False, photos=[])
SEED = json.dumps(seed, ensure_ascii=False)
out = sys.argv[1]
with sync_playwright() as p:
  b = p.chromium.launch()
  for theme in ['light', 'dark']:
    for lang, loc in [('ru', 'ru-RU')]:
      ctx = b.new_context(locale=loc, viewport={'width': 390, 'height': 844}, device_scale_factor=2)
      def route(r):
        u = r.request.url
        if u.endswith('/__mock.js'): return r.fulfill(body=MOCK, content_type='text/javascript')
        m = re.search(r'/firebase/(\w+\.js)$', u)
        if m and m.group(1) in NAMES: return r.fulfill(body=wrapper(m.group(1)), content_type='text/javascript')
        if u.endswith('/firebase-config.js'): return r.fulfill(body='export const firebaseConfig={};', content_type='text/javascript')
        return r.continue_()
      ctx.route('**/*', route)
      ctx.add_init_script("localStorage.setItem('sv_theme','%s')" % theme)
      pg = ctx.new_page()
      pg.add_init_script("""(()=>{const s=%s; const store=new Map();
        for(const [k,v] of Object.entries(s)){ const ms=Date.now()-3600e3*5; v.created={toMillis:()=>ms}; store.set(k,v); }
        window.__MOCK={store, user:null, listeners:[], seq:0, calls:[]};})()""" % SEED)
      pg.goto('http://127.0.0.1:8766/index.html'); pg.wait_for_timeout(1200)
      pg.click('#tabs button[data-tab=guides]'); pg.wait_for_timeout(200); pg.click('#tabs button[data-tab=home]'); pg.wait_for_timeout(700)
      pg.screenshot(path=f'{out}/{theme}-1home.png')
      pg.click('#tabs button[data-tab=guides]'); pg.wait_for_timeout(500)
      pg.screenshot(path=f'{out}/{theme}-2guides.png')
      pg.click('.cat >> nth=0'); pg.wait_for_timeout(400); pg.click('[data-gid] >> nth=0'); pg.wait_for_timeout(500)
      pg.screenshot(path=f'{out}/{theme}-3doc.png')
      pg.click('#tabs button[data-tab=qa]'); pg.wait_for_timeout(500)
      pg.screenshot(path=f'{out}/{theme}-4qa.png')
      ctx.close()
  b.close()
srv.shutdown()
