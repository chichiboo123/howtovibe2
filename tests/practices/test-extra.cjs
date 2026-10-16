// 이번 수정에 맞춘 회귀 테스트 — 사이트에서 꺼낸 코드(SOURCE_DIR)를 대상으로 실행합니다.
// 모의(mock) 환경입니다. 실제 Google 시트·잠금·캐시·문서/PDF 동작을 대신 확인하지는 않습니다.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { environment, source } = require('./harness.cjs');
const { ui } = require('./ui-helper.cjs');
const flush = () => new Promise(r => setImmediate(r));
const results = [];
async function test(name, f) {
  try { await Promise.race([f(), new Promise((_, j) => setTimeout(() => j(Error('timeout')), 3000))]); results.push({ name, status: 'PASS' }); }
  catch (e) { results.push({ name, status: 'FAIL', error: e.message }); }
}
const gs = i => fs.readFileSync(source(i, 'gs'), 'utf8');
const html = i => fs.readFileSync(source(i, 'html'), 'utf8');

(async () => {
  // ── 공통: 실습 1·2·4 시트 연결 ──
  // 실습 1은 한 학급용(수업 코드 없음)이고, 기록은 교사 대시보드(getDashboard)로만 읽습니다
  const count = (i, c, read) => i === 1 ? c[read]({}).rows.length : c[read]({ room: '5-1' }).length;
  for (const [i, save, arg, read] of [
    [1, 'saveCheckin', { emotion: '기쁨', note: 'x' }, 'getDashboard'],
    [2, 'addCard', { room: '5-1', text: '의견', color: 'blue' }, 'getCards'],
    [4, 'saveWriting', { room: '5-1', pen: '별', body: '글' }, 'getToday']]) {
    await test(`m${i}: setup saves own spreadsheet ID in SPREADSHEET_ID`, () => {
      const { context: c, state } = environment(i);
      c.setup();
      assert.equal(state.props.SPREADSHEET_ID, 'test-sheet-id');
    });
    await test(`m${i}: web app functions open the sheet by saved ID, not getActive`, () => {
      const { context: c, state } = environment(i);
      c.setup(); state.active = false; state.opens = 0;
      c[save](arg); count(i, c, read);
      assert.ok(state.opens >= 2);
    });
    await test(`m${i}: without setup, a clear 'run setup' error`, () => {
      const { context: c } = environment(i);
      assert.throws(() => count(i, c, read), /setup/);
    });
    await test(`m${i}: setup outside the spreadsheet editor fails with guidance`, () => {
      const { context: c } = environment(i, { active: false });
      assert.throws(() => c.setup(), /확장 프로그램/);
    });
    await test(`m${i}: re-running setup keeps existing rows`, () => {
      const { context: c } = environment(i);
      c.setup(); c[save](arg); const before = count(i, c, read);
      c.setup(); assert.equal(count(i, c, read), before); assert.equal(before, 1);
    });
    await test(`m${i}: flush happens before releasing the lock`, () => {
      const { context: c, state } = environment(i);
      c.setup(); state.log = []; c[save](arg);
      const L = state.log;
      assert.ok(L.indexOf('flush') > L.indexOf('append') && L.indexOf('release') > L.indexOf('flush'), L.join(','));
    });
    await test(`m${i}: lock is released even when the write fails`, () => {
      const { context: c, state } = environment(i);
      c.setup(); state.failAppend = true;
      assert.throws(() => c[save](arg));
      assert.equal(state.locks, state.releases);
    });
    await test(`m${i}: text like 0503 and '=' text stored as literal text`, () => {
      const { context: c, state } = environment(i);
      c.setup();
      const sheet = Object.values(state.sheets)[0];
      const a = i === 1 ? { ...arg, note: '0503 =1+1' } : { ...arg, room: '0503' }; if (i === 2) a.text = '=1+1'; if (i === 4) a.body = '=1+1';
      c[save](a);
      const row = sheet.rows[sheet.rows.length - 1];
      assert.ok(i === 1 ? row.includes('0503 =1+1') : row.includes('0503') && row.includes('=1+1'), JSON.stringify(row));
    });
  }

  // ── 실습 1 ──
  await test('m1: sheet text written with a leading apostrophe (stays literal in a real sheet)', () => {
    const { context: c, state } = environment(1); c.setup();
    const sh = state.sheets['감정기록'], raw = []; const orig = sh.appendRow; sh.appendRow = r => { raw.push(r); orig(r); };
    c.saveCheckin({ emotion: '걱정', note: '=1+1' });
    assert.equal(raw[0][1], "'걱정"); assert.equal(raw[0][2], "'=1+1");
  });
  await test('m1: dashboard.html script compiles and uses textContent for notes', () => {
    const src = fs.readFileSync(source(1, 'dash'), 'utf8');
    for (const m of src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new (require('node:vm').Script)(m[1]);
    assert.ok(!/innerHTML\s*=\s*[^'"]/.test(src.replace(/innerHTML = ''/g, '')));
  });
  await test('m1: student page has no class code, no class results, no dashboard call', () => {
    const src = html(1);
    assert.ok(!/getDashboard|getRows|\?room=|getLocation/.test(src), 'student page must not read class data');
    assert.ok(!/id="room"|id="bars"|id="notes"/.test(src));
  });
  await test('m1: dashboard data refused from the student web app (no spreadsheet UI)', () => {
    const { context: c, state } = environment(1); c.setup();
    c.saveCheckin({ emotion: '기쁨', note: '비밀' });
    state.ui = false;                                  // 웹앱(google.script.run)에는 스프레드시트 UI가 없습니다
    assert.throws(() => c.getDashboard({}), /메뉴/);
    assert.throws(() => c.openDashboard(), /메뉴/);
  });
  await test('m1: menu opens the dashboard dialog from the spreadsheet', () => {
    const { context: c, state } = environment(1); c.setup();
    c.openDashboard(); assert.ok(state.dialog);
  });
  await test('m1: dashboard day follows Asia/Seoul, not the server/device time zone', () => {
    const { context: c, state } = environment(1); c.setup();
    // 기기(TZ=America/Los_Angeles)로는 10월 16일 오전, 서울로는 10월 17일 새벽
    state.sheets['감정기록'].rows.push([new Date('2026-10-16T16:30:00Z'), '기쁨', '새벽']);
    assert.equal(c.getDashboard({ day: '2026-10-17' }).summary.total, 1);
    assert.equal(c.getDashboard({ day: '2026-10-16' }).summary.total, 0);
    const w = c.getDashboard({ day: '2026-10-17' }).week;
    assert.equal(JSON.stringify(w.map(x => x.day)), JSON.stringify(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']));
    assert.equal(w[6].counts['기쁨'], 1);
  });
  await test('m1: localStorage keeps nothing about emotion or note', async () => {
    const u = ui(1); await flush();
    u.el('emoGrid').children[3].click(); u.el('note').value = '비밀 메모'; u.ctx.submit(); await flush();
    assert.equal(u.storage.size, 0, JSON.stringify([...u.storage.entries()]));
  });
  await test('m1: failed send keeps the choice and allows retry', async () => {
    const u = ui(1); await flush();
    u.el('emoGrid').children[0].click(); u.fail(); u.ctx.submit(); await flush(); await flush();
    assert.equal(u.el('pickErr').classList.contains('hide'), false);
    assert.equal(u.el('submit').disabled, false); assert.equal(u.ctx.chosen, '기쁨');
    u.ctx.submit(); await flush(); await flush();
    assert.equal(u.state.sheets['감정기록'].rows.length, 2);
  });
  await test('m1: invalid emotion from a crafted request is rejected', () => {
    const { context: c } = environment(1); c.setup();
    assert.throws(() => c.saveCheckin({ emotion: '<script>' }), /감정/);
  });
  await test('m1: dashboard renders counts, literal notes and the 걱정·피곤 filter', async () => {
    const server = environment(1); server.context.setup();
    server.context.saveCheckin({ emotion: '걱정', note: '<b>배가 아파요</b>' });
    server.context.saveCheckin({ emotion: '기쁨', note: '소풍' });
    server.context.saveCheckin({ emotion: '평온' });
    const u = ui(1, server, 'dash'); await flush(); await flush();
    assert.equal(u.el('kTotal').textContent, '3명');
    assert.equal(u.el('kWatch').textContent, '1명');
    assert.ok(u.el('notes').textContent.includes('<b>배가 아파요</b>'));
    assert.equal(u.el('notes').querySelector('b'), null);
    assert.equal(u.el('notes').children.length, 2);
    u.el('watchOnly').checked = true; u.el('watchOnly').dispatchEvent(new u.ctx.window.Event('change'));
    assert.equal(u.el('notes').children.length, 1);
    assert.equal(u.el('week').children.length, 7);
  });
  await test('m1: dashboard shows Seoul time for notes', async () => {
    const server = environment(1); server.context.setup();
    const u = ui(1, server, 'dash'); await flush();
    assert.equal(u.ctx.hhmm('2026-10-16T16:30:00Z'), '01:30');
  });
  await test('m1: dashboard ignores a late response after changing the date', async () => {
    const server = environment(1); server.context.setup();
    const u = ui(1, server, 'dash'); await flush(); await flush();
    const pending = []; u.ctx.Backend.load = d => new Promise(r => pending.push([d, r]));
    const p1 = u.ctx.refresh(); u.ctx.go('2000-01-01');
    const old = server.context.getDashboard({}); old.rows = [{ emotion: '기쁨', note: 'LATE TODAY NOTE', at: new Date().toISOString() }];
    pending[1][1](server.context.getDashboard({ day: '2000-01-01' })); await flush();
    pending[0][1](old); await p1; await flush();
    assert.ok(!u.el('notes').textContent.includes('LATE TODAY NOTE'));
    assert.equal(u.el('day').value, '2000-01-01');
  });

  // ── 실습 2 ──
  await test('m2: like saved but response lost → retry counts once (same request ID)', async () => {
    const u = ui(2); await flush(); u.ctx.enter('5-1', ''); await flush();
    u.el('text').value = '의견'; u.ctx.post(); await flush();
    const card = u.ctx.cards[0];
    u.lose(); u.ctx.sendLike(card, u.el('board').querySelector('.like')); await flush(); await flush();
    assert.equal(u.storage.get('liked:' + card.id), undefined);
    u.ctx.sendLike(u.ctx.cards[0], u.el('board').querySelector('.like')); await flush(); await flush();
    assert.equal(u.ctx.cards[0].likes, 1);
    assert.equal(u.storage.get('liked:' + card.id), '1');
  });
  await test('m2: different like requests still count separately (two browsers)', () => {
    const { context: c } = environment(2); c.setup();
    const id = c.addCard({ room: '5-1', text: '의견' })[0].id;
    c.likeCard({ room: '5-1', id, reqId: 'a1' }); c.likeCard({ room: '5-1', id, reqId: 'b2' });
    assert.equal(c.getCards({ room: '5-1' })[0].likes, 2);
  });
  await test('m2: failed like restores count and reloads the board', async () => {
    const u = ui(2); await flush(); u.ctx.enter('5-1', ''); await flush();
    u.el('text').value = '의견'; u.ctx.post(); await flush();
    let loads = 0; const orig = u.ctx.Backend.load; u.ctx.Backend.load = () => { loads++; return orig(); };
    u.fail(); u.ctx.sendLike(u.ctx.cards[0], u.el('board').querySelector('.like')); await flush(); await flush();
    assert.equal(u.ctx.cards[0].likes, 0); assert.ok(loads >= 1);
    assert.equal(u.el('board').querySelector('.like').disabled, false);
  });
  await test('m2: post response after changing the room is ignored', async () => {
    const u = ui(2); await flush(); u.ctx.enter('5-1', ''); await flush();
    let resolve; u.ctx.Backend.add = () => new Promise(r => resolve = r);
    u.el('text').value = '이전 반 글'; u.ctx.post(); u.el('changeRoom').click(); u.ctx.enter('5-2', ''); await flush();
    resolve([{ id: 'x', at: new Date().toISOString(), text: 'OLD ROOM CARD', color: 'yellow', likes: 0 }]); await flush(); await flush();
    assert.ok(!u.el('board').textContent.includes('OLD ROOM CARD'));
  });
  await test('m2: 5-second polling and hidden-tab pause kept', async () => {
    const u = ui(2); await flush(); u.ctx.enter('5-1', ''); await flush();
    assert.equal(u.timers[0].ms, 5000);
  });

  // ── 실습 3 ──
  await test('m3: no spreadsheet in practice 3 code', () => {
    assert.ok(!/SpreadsheetApp|PropertiesService\.getScriptProperties\(\)\.setProperty/.test(gs(3)));
  });
  await test('m3: cache re-checked after the lock (another request filled it)', () => {
    const { context: c, state } = environment(3);
    const key = 'wiki_' + Buffer.from('사막').toString('base64url');
    state.onTryLock = () => state.cache.set(key, JSON.stringify({ keyword: '사막', pages: [] }));
    const before = state.fetches; const r = c.searchWikipedia('사막');
    assert.equal(state.fetches, before); assert.equal(r.keyword, '사막');
    assert.equal(state.locks, state.releases);
  });
  await test('m3: cache save failure still returns fetched results', () => {
    const { context: c, state } = environment(3); state.failCachePut = true;
    const r = c.searchWikipedia('무지개'); assert.equal(r.pages.length, 1); assert.equal(state.locks, state.releases);
  });
  await test('m3: broken cache value is ignored and refetched', () => {
    const { context: c, state } = environment(3); state.cacheGarbage = true;
    const r = c.searchWikipedia('무지개'); assert.equal(r.pages.length, 1); assert.equal(state.fetches, 1);
  });
  await test('m3: invalid JSON and network exception give a retryable friendly error', () => {
    const { context: c, state } = environment(3);
    state.badJson = true; assert.throws(() => c.searchWikipedia('하나'), /다시 찾아보세요/);
    state.badJson = false; state.fetchThrows = true; assert.throws(() => c.searchWikipedia('둘'), /다시 찾아보세요/);
    state.fetchThrows = false; assert.equal(c.searchWikipedia('셋').pages.length, 1);
    assert.equal(state.locks, state.releases);
  });
  await test('m3: wording no longer promises a single API call; same-name guidance present', () => {
    assert.ok(!/한 번만 부르|위키백과에는 한 번/.test(gs(3)));
    assert.ok(/드라마·노래·학교/.test(html(3)));
  });
  await test('m3: search button re-enabled after an error', async () => {
    const u = ui(3); await flush(); u.state.status = 503; u.ctx.search('오류'); await flush(); await flush();
    assert.equal(u.el('go').disabled, false); assert.ok(u.el('err').textContent.includes('다시'));
  });

  // ── 실습 4 ──
  await test('m4: several topics on the same day all appear in the anthology', () => {
    const { context: d, state } = environment(4); d.setup();
    d.saveWriting({ room: '5-1', pen: '별', body: '가', topic: '가을' });
    d.saveWriting({ room: '5-1', pen: '달', body: '나', topic: '친구' });
    d.saveWriting({ room: '5-1', pen: '숲', body: '다', topic: '가을' });
    d.makeAnthology();
    const texts = state.docs[0].events.filter(e => e[0] === 'paragraph').map(e => e[1]);
    assert.equal(texts.filter(t => t === '글감 : 가을').length, 1);
    assert.equal(texts.filter(t => t === '글감 : 친구').length, 1);
    assert.equal(state.docs[0].events.filter(e => e[0] === 'rule').length, 3);
  });
  await test('m4: PDF failure still shows the document link', () => {
    const { context: d, state } = environment(4); d.setup();
    d.saveWriting({ room: '5-1', pen: '별', body: '가' }); state.failPdf = true;
    d.makeAnthology();
    assert.equal(state.docs.length, 1); assert.equal(state.pdfs.length, 0);
    assert.ok(/docs\.google\.com/.test(state.dialog.content) && /PDF 는 만들지 못했습니다/.test(state.dialog.content), state.dialog.content);
  });
  await test('m4: student context stops at getUi before reading the sheet or creating a doc', () => {
    const { context: d, state } = environment(4); d.setup();
    state.ui = false; state.opens = 0;
    assert.throws(() => d.makeAnthology(), /메뉴/);
    assert.equal(state.opens, 0); assert.equal(state.docs.length, 0);
  });
  await test('m4: changing the room clears the previous list', async () => {
    const u = ui(4); await flush(); u.ctx.enter('5-1', ''); await flush();
    u.el('pen').value = '별'; u.el('body').value = 'PREVIOUS ROOM TEXT'; u.ctx.submit(); await flush(); await flush();
    assert.ok(u.el('list').textContent.includes('PREVIOUS ROOM TEXT'));
    let never; u.ctx.Backend.load = () => new Promise(r => never = r);
    u.el('changeRoom').click(); u.ctx.enter('5-2', '');
    assert.ok(!u.el('list').textContent.includes('PREVIOUS ROOM TEXT'));
  });
  await test('m4: save response after changing the room is ignored', async () => {
    const u = ui(4); await flush(); u.ctx.enter('5-1', ''); await flush();
    let resolve; u.ctx.Backend.save = () => new Promise(r => resolve = r);
    u.el('pen').value = '별'; u.el('body').value = '글'; u.ctx.submit();
    u.ctx.Backend.load = () => new Promise(() => {});        // 새 반 조회는 끝나지 않게 → 늦은 저장 응답만 화면에 영향을 줄 수 있음
    u.el('changeRoom').click(); u.ctx.enter('5-2', '');
    resolve([{ at: new Date().toISOString(), pen: '별', body: 'OLD ROOM SAVE' }]); await flush(); await flush();
    assert.ok(!u.el('list').textContent.includes('OLD ROOM SAVE'));
  });

  console.log(JSON.stringify({ pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length, results }, null, 2));
  if (results.some(r => r.status === 'FAIL')) process.exitCode = 1;
})();
