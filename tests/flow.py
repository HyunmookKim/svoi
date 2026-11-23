# Свои 0.2 — 가짜 파이어베이스로 앱 흐름 전체를 눌러 본다
import re, sys, threading, http.server, functools, os
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..', 'www')
MOCK = open(os.path.join(os.path.dirname(__file__), 'mockfb.js')).read()
NAMES = {
  'app.js': ('fs', ['initializeApp']),
  'auth.js': ('au', ['getAuth','onAuthStateChanged','GoogleAuthProvider','signInWithPopup','signInWithEmailAndPassword',
                     'createUserWithEmailAndPassword','sendPasswordResetEmail','signOut','deleteUser']),
  'firestore.js': ('fs', ['initializeFirestore','getFirestore','persistentLocalCache','collection','doc','getDoc','getDocs','query',
                          'where','orderBy','limit','addDoc','setDoc','updateDoc','deleteDoc','writeBatch','serverTimestamp',
                          'increment','arrayUnion','arrayRemove']),
  'storage.js': ('st', ['getStorage','ref','uploadBytes','getDownloadURL']),
  'functions.js': ('fn', ['getFunctions','httpsCallable']),
}
def wrapper(name):
  if name == 'app.js': return 'export const initializeApp = () => ({});'
  obj, keys = NAMES[name]
  return "import { %s as M } from '/__mock.js';\n" % obj + ''.join('export const %s = M.%s;\n' % (k, k) for k in keys)

class H(http.server.SimpleHTTPRequestHandler):
  def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(H, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

fails = []
def check(cond, msg):
  print(('  ok  ' if cond else '  FAIL ') + msg)
  if not cond: fails.append(msg)

with sync_playwright() as p:
  b = p.chromium.launch()
  ctx = b.new_context(locale='ru-RU', viewport={'width': 390, 'height': 800})
  def route(r):
    u = r.request.url
    if u.endswith('/__mock.js'): return r.fulfill(body=MOCK, content_type='text/javascript')
    m = re.search(r'/firebase/(\w+\.js)$', u)
    if m and m.group(1) in NAMES: return r.fulfill(body=wrapper(m.group(1)), content_type='text/javascript')
    if u.endswith('/firebase-config.js'): return r.fulfill(body='export const firebaseConfig={};', content_type='text/javascript')
    return r.continue_()
  ctx.route('**/*', route)
  pg = ctx.new_page()
  errs = []
  pg.on('pageerror', lambda e: errs.append(str(e)))
  pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
  pg.goto('http://127.0.0.1:8765/index.html')
  S = lambda js: pg.evaluate(js)
  W = lambda ms=250: pg.wait_for_timeout(ms)
  # 운영자: 구글 로그인(uG)을 운영자로 미리 넣는다
  pg.wait_for_function('window.__MOCK', timeout=8000)
  S("__MOCK.store.set('admins/uG', {})")
  W(600)

  print('1. 홈·탭')
  check(pg.inner_text('#tabs').count('Вопросы') == 1, 'ru tab labels')
  check('Новости' in pg.inner_text('#s-home'), 'home news card')

  print('2. 질문 쓰기 → 로그인 → 동의 → 이어서 쓰기')
  pg.click('#tabs button[data-tab=qa]'); W()
  pg.click('#fab'); W()
  check('Продолжить с Google' in pg.inner_text('#sheetBox'), 'login sheet opens')
  pg.click('#lgG'); W(600)
  check('Перед началом' in pg.inner_text('#sheetBox'), 'consent sheet opens')
  pg.fill('#cName', 'Ан'); pg.click('#cGo'); W()
  check('Отметьте обязательные' in pg.inner_text('#toast'), 'consent required check')
  pg.check('#cAll'); pg.fill('#cName', 'Анна'); pg.click('#cGo'); W(600)
  u = S("JSON.stringify(__MOCK.store.get('users/uG'))")
  check('"name":"Анна"' in u and '"ver":1' in u, 'users doc saved with consent')
  check(pg.is_visible('#wTitle'), 'write screen continues after login')
  pg.fill('#wTitle', 'Как продлить визу F-6?'); pg.fill('#wBody', 'Сука, где продлить?')
  pg.click('#wGo'); W()
  check('Выберите раздел' in pg.inner_text('#toast'), 'category required')
  pg.click('#wCat'); W(); pg.click('#sheetBox .opt >> nth=0'); W()
  pg.click('#wGo'); W()
  check('оскорбления' in pg.inner_text('#toast'), 'profanity blocked')
  pg.fill('#wBody', 'Подскажите, где продлевать F-6 в Ансане? Употребляю слово «бля» в цитате нет.')
  pg.click('#wGo'); W()
  check('оскорбления' in pg.inner_text('#toast'), 'standalone бля blocked')
  pg.fill('#wBody', 'Подскажите, где продлевать F-6 в Ансане? Употребляю правильные слова.')
  pg.click('#wGo'); W(700)
  check('Как продлить визу F-6?' in pg.inner_text('#s-qa'), 'post in list after publish (употребляю allowed)')
  check(pg.is_visible('#fab'), 'fab back on qa tab')

  print('3. 답변·도움됨·번역·신고')
  pg.click('#qaList [data-pid]'); W(500)
  check('Ответов пока нет' in pg.inner_text('#s-page'), 'no answers yet')
  pg.fill('#aBody', 'В миграционной службе Сувона, запись через hikorea.go.kr'); pg.click('#aGo'); W(600)
  check('hikorea.go.kr' in pg.inner_text('#s-page') and 'Ответы 1' in pg.inner_text('#s-page'), 'answer shows')
  posts = S("JSON.stringify([...__MOCK.store.entries()].filter(([k])=>/^posts\\/[^/]+$/.test(k)).map(([,v])=>v.answers))")
  check(posts == '[1]', 'answers counter incremented')
  pg.click('[data-help]'); W(400)
  check('Полезно 1' in pg.inner_text('#s-page'), 'helpful +1')
  pg.click('[data-help]'); W(300)
  check('уже отметили' in pg.inner_text('#toast'), 'helpful once')
  pg.click('#pTr'); W(400)
  check('[ru]' in pg.inner_text('#pTrOut'), 'translate shows box')
  pg.click('#pSolve'); W(400)
  check('Решено' in pg.inner_text('#s-page'), 'mark solved')

  print('4. 운영자: 문서·소식')
  pg.go_back(); W(400)
  pg.click('#tabs button[data-tab=more]'); W(400)
  check(pg.is_visible('#mAdmin'), 'admin menu visible')
  pg.click('#mAdmin'); W(); pg.click('#adGuide'); W(400); pg.click('#ggNew'); W()
  pg.click('#geCat'); W(); pg.click('#sheetBox .opt >> nth=0'); W()
  pg.fill('#geTr', 'Продление визы F-6'); pg.fill('#geTk', 'F-6 비자 연장')
  pg.fill('#geBr', '## Куда идти\n- В офис миграционной службы\n- Запись на hikorea.go.kr\n\nВозьмите паспорт.')
  pg.fill('#geSrc', 'https://www.hikorea.go.kr'); pg.click('#geGo'); W(600)
  check('Продление визы F-6' in pg.inner_text('#s-page'), 'guide created in admin list')
  pg.go_back(); W(300)
  pg.click('#adNews'); W(400); pg.click('#nwNew'); W()
  pg.fill('#neTr', 'Новые правила продления'); pg.fill('#neTk', '연장 규칙 변경'); pg.fill('#neBr', 'Текст новости'); pg.fill('#neSrc', 'hikorea.go.kr')
  pg.click('#neGo'); W(600)
  pg.click('#tabs button[data-tab=guides]'); W(300)
  pg.click('.cat >> nth=0'); W(400)
  check('Продление визы F-6' in pg.inner_text('#s-page'), 'guide in category')
  pg.click('[data-gid]'); W(500)
  html = pg.inner_html('#s-page')
  check('<h3>Куда идти</h3>' in html and '<li>' in html, 'guide rich text')
  gv = S("JSON.stringify([...__MOCK.store.entries()].filter(([k])=>k.startsWith('guides/')).map(([,v])=>v.views))")
  check(gv == '[1]', 'guide view +1')
  pg.click('#tabs button[data-tab=home]'); W(600)
  home = pg.inner_text('#s-home')
  check('Новые правила продления' in home, 'news on home')
  check('Продление визы F-6' in home, 'guide in popular')

  print('5. 검색')
  pg.fill('#hSearch', 'F-6'); pg.press('#hSearch', 'Enter'); W(500)
  t = pg.inner_text('#s-page')
  check('Продление визы F-6' in t and 'Как продлить визу F-6?' in t, 'search finds guide and post')
  pg.go_back(); W(300)

  print('6. 업소 등록 → 심사 → 공개')
  pg.click('#tabs button[data-tab=biz]'); W(400)
  check('Мест пока нет' in pg.inner_text('#s-biz'), 'biz empty')
  pg.click('#fab'); W(300)
  pg.fill('#fName', 'Кафе Самарканд')
  pg.click('#fCat'); W(); pg.click('#sheetBox .opt >> nth=0'); W()
  pg.click('#fCity'); W(); pg.click('#sheetBox .opt >> nth=2'); W()
  pg.fill('#fPhone', '010-1234-5678'); pg.fill('#fNo', '1048100001'); pg.click('#fGo'); W()
  check('Неверный номер' in pg.inner_text('#toast'), 'bad business number rejected')
  pg.fill('#fNo', '104-81-00000'); pg.fill('#fDescRu', 'Плов и самса'); pg.click('#fGo'); W(600)
  bz = S("JSON.stringify([...__MOCK.store.entries()].filter(([k])=>k.startsWith('biz/')).map(([,v])=>v.status+'|'+v.bizNo+'|'+v.top))")
  check(bz == '["pending|1048100000|false"]', 'biz saved pending ' + bz)
  check('Мест пока нет' in pg.inner_text('#s-biz'), 'pending not public')
  pg.click('#tabs button[data-tab=more]'); W(300); pg.click('#mAdmin'); W(); pg.click('#adBiz'); W(400)
  pg.click('[data-ok]'); W(500)
  pg.click('#tabs button[data-tab=biz]'); W(500)
  check('Кафе Самарканд' in pg.inner_text('#s-biz') and 'Говорят по-русски' in pg.inner_text('#s-biz'), 'approved biz public with badge')
  pg.click('[data-bid]'); W(500)
  check(pg.locator('a[href^="tel:01012345678"]').count() == 1, 'call link')

  print('7. 신고 → 운영자 처리')
  pg.click('#tabs button[data-tab=qa]'); W(400); pg.click('#qaList [data-pid]'); W(500)
  # 자기 글이라 신고 단추 대신 자기 답변이 보인다 → 다른 사람 답변을 넣고 신고
  S("""(()=>{const k=[...__MOCK.store.keys()].find(k=>/^posts\\/[^/]+$/.test(k));
     __MOCK.store.set(k+'/answers/x1',{uid:'other',name:'Спамер',body:'Купи крипту',created:{toMillis:()=>Date.now()},helpfulBy:[],hidden:false,guide:''});})()""")
  pg.go_back(); W(300); pg.click('#qaList [data-pid]'); W(500)
  pg.click('[data-arep]'); W(); pg.click('#sheetBox .opt >> nth=0'); W(400)
  check('Жалоба отправлена' in pg.inner_text('#toast'), 'report sent')
  pg.click('[data-ablk]'); W(); pg.click('#sheetBox [data-v="1"]'); W(500)
  check('заблокированного' in pg.inner_text('#s-page'), 'blocked answer hidden')
  pg.click('#tabs button[data-tab=more]'); W(300); pg.click('#mAdmin'); W(); pg.click('#adRep'); W(400)
  check('Спам, реклама' in pg.inner_text('#s-page'), 'report in admin list')
  pg.click('[data-hide]'); W(500)
  hid = S("JSON.stringify([...__MOCK.store.entries()].filter(([k])=>k.endsWith('/answers/x1')).map(([,v])=>v.hidden))")
  check(hid == '[true]', 'answer hidden by admin')

  print('8. 단어 카드')
  pg.click('#tabs button[data-tab=home]'); W(400); pg.click('#hCards'); W(300)
  check('Корейский язык' in pg.inner_text('#s-page'), 'decks list (ru user sees korean first)')
  pg.click('[data-deck] >> nth=0'); W(300)
  check('안녕하세요' in pg.inner_text('#s-page'), 'first card')
  pg.click('#cdFlip'); W(); pg.click('[data-g="3"]'); W(300)
  check('감사합니다' in pg.inner_text('#s-page'), 'next card after grading')
  cs = S("localStorage.getItem('sv_cards')")
  check(cs and '"0"' in cs, 'card progress saved')

  print('9. 언어 바꾸기')
  pg.click('#langBtn'); W(); pg.click('#sheetBox .opt >> nth=1'); W(400)
  check(pg.inner_text('#tabs').count('질문') == 1, 'korean tabs')
  pg.click('#tabs button[data-tab=biz]'); W(400)
  check('러시아어 가능' in pg.inner_text('#s-biz') and '안산' in pg.inner_text('#s-biz'), 'korean biz labels')

  print('10. 뒤로 가기')
  pg.click('#tabs button[data-tab=guides]'); W(300); pg.click('.cat >> nth=0'); W(300); pg.click('[data-gid]'); W(400)
  pg.go_back(); W(300)
  check(pg.is_visible('#s-page') and 'F-6 비자 연장' in pg.inner_text('#s-page'), 'back to category list')
  pg.go_back(); W(300)
  check(pg.is_visible('#s-guides'), 'back to guides root')

  print('11. 탈퇴')
  pg.click('#tabs button[data-tab=more]'); W(300); pg.click('#mAcct'); W(300); pg.click('#acDel'); W(); pg.click('#sheetBox [data-v="1"]'); W(700)
  nm = S("JSON.stringify([...__MOCK.store.entries()].filter(([k])=>/^posts\\/[^/]+$/.test(k)).map(([,v])=>v.name))")
  check(nm == '["탈퇴한 회원"]', 'post author anonymized ' + nm)
  check(not S("__MOCK.store.has('users/uG')"), 'user doc deleted')

  print('12. 오류')
  real = [e for e in errs if 'favicon' not in e]
  check(not real, 'no page errors ' + repr(real[:3]))
  b.close()

# 13. 사전 빠짐: t('…') 안의 한국어가 러시아어 사전에 다 있는가
src = open(os.path.join(ROOT, 'index.html')).read()
keys = set(re.findall(r"t\('([^']+)'\)", src))
dict_part = src[src.index('const I18N'):src.index('function langFromDevice')]
missing = [k for k in sorted(keys) if ("'" + k + "':") not in dict_part and re.search('[가-힣]', k)]
check(not missing, 'ru dictionary complete ' + repr(missing))
srv.shutdown()
print('\nRESULT:', 'PASS' if not fails else 'FAIL %d' % len(fails))
sys.exit(1 if fails else 0)
