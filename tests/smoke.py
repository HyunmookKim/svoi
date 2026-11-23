# 뼈대 검사: 탭 5개, 언어 전환, 분류 열기·뒤로, 검사에서 먼저 실패시키기 위한 기대값을 분명히 적는다
import sys, http.server, threading, functools
from playwright.sync_api import sync_playwright
root = sys.argv[1]
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, m):
    if not c: fails.append(m)
with sync_playwright() as p:
    b = p.chromium.launch()
    for loc, want in (('ru-RU', 'Главная'), ('ko-KR', '홈')):
        pg = b.new_page(locale=loc, viewport={'width':390,'height':844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:8765/index.html')
        ok(pg.locator('#tabs button').count() == 5, loc + ' 탭 5개')
        ok(pg.locator('#tabs button').first.inner_text().find(want) >= 0, loc + ' 첫 탭 글자 ' + want)
        pg.click('#tabs button[data-tab=guides]')
        ok(pg.locator('.cat').count() == 9, loc + ' 분류 9개')
        pg.locator('.cat').first.click()
        ok(pg.locator('#top').get_attribute('class').find('sub') >= 0, loc + ' 깊은 화면에서 뒤로 단추')
        ok(pg.locator('#s-guideList .empty').count() == 1, loc + ' 빈 분류 안내')
        pg.click('#backBtn'); pg.wait_for_timeout(200)
        ok(pg.locator('#s-guides').is_visible(), loc + ' 뒤로 가면 분류 화면')
        pg.click('#langBtn'); pg.locator('#sheet .opt').nth(1 if loc=='ru-RU' else 0).click()
        flip = '홈' if loc=='ru-RU' else 'Главная'
        ok(pg.locator('#tabs button').first.inner_text().find(flip) >= 0, loc + ' 언어 바꾸면 탭 글자 바뀜')
        pg.screenshot(path='/home/claude/svoi/tests/shot-' + loc + '.png')
        ok(not errs, loc + ' 화면 오류 없음: ' + ';'.join(errs))
        pg.close()
    b.close()
srv.shutdown()
print('FAIL\n' + '\n'.join(fails) if fails else 'PASS')
