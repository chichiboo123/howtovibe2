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
  const count = (i, c, read) => i === 1 ? c[read]({}).rows.length : i === 4 ? c[read]().length : c[read]('5-1', '').cards.length;
  for (const [i, save, arg, read] of [
    [1, 'saveCheckin', { emotion: '기쁨', note: 'x' }, 'getDashboard'],
    [2, 'submitOpinion', { room: '5-1', content: '의견', color: 'blue', authorToken: 't1' }, 'getBoardData'],
    [4, 'saveWriting', { pen: '별', body: '글' }, 'getShelf']]) {
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
      const { context: c, state } = environment(i);
      if (i === 2) state.active = false;      // 실습 2는 시트에 연결된 프로젝트면 그 시트를 바로 쓰므로, 시트가 없는 웹앱 문맥을 흉내 냅니다
      assert.throws(() => count(i, c, read), /setup/);
    });
    await test(`m${i}: setup outside the spreadsheet editor fails with guidance`, () => {
      const { context: c, state } = environment(i, { active: false });
      if (i === 2) { c.setup(); assert.equal(state.created, 1); assert.equal(state.props.SPREADSHEET_ID, 'test-sheet-id'); return; }  // 실습 2는 새 시트를 만들어 연결
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
      const w = i === 2 ? L.lastIndexOf('setValues') : L.indexOf('append');
      assert.ok(w >= 0 && L.indexOf('flush') > w && L.indexOf('release') > L.indexOf('flush'), L.join(','));
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
      const a = i === 1 ? { ...arg, note: '0503 =1+1' } : i === 4 ? { ...arg, pen: '0503', body: '=1+1' } : { ...arg, room: '0503', content: '=1+1' };
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
  await test('m1: six emotions including 화남, same list on server, student page and dashboard', () => {
    const { context: c } = environment(1); c.setup();
    c.saveCheckin({ emotion: '화남', note: '' });
    assert.equal(c.getDashboard({}).summary.counts['화남'], 1);
    assert.ok(/name: '화남', icon: 'sentiment_extremely_dissatisfied'/.test(html(1)));
    assert.ok(/'화남': \{ icon: 'sentiment_extremely_dissatisfied'/.test(fs.readFileSync(source(1, 'dash'), 'utf8')));
  });
  await test('m1: "script function not found" is turned into setup guidance', async () => {
    const u = ui(1); await flush();
    assert.ok(/Code\.gs 가 이 화면과 맞지 않습니다/.test(u.ctx.serverError('다음 스크립트 함수(saveCheckin)를 찾을 수 없습니다.')));
    assert.equal(u.ctx.serverError('목록에 있는 감정을 골라 주세요.'), '목록에 있는 감정을 골라 주세요.');
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
  await test('m2: title/content written with a leading apostrophe; time stored as a Date', () => {
    const { context: c, state } = environment(2); c.setup();
    c.submitOpinion({ room: '5-1', title: '=SUM(A1)', content: '0503', authorToken: 't' });
    const row = state.sheets['의견보드_기록'].rows[1];
    assert.equal(row[3], '=SUM(A1)'); assert.equal(row[4], '0503'); assert.ok(row[1] instanceof Date);
    const sh = state.sheets['의견보드_기록'], seen = []; const orig = sh.getRange;
    sh.getRange = (...a) => { const r = orig(...a); const sv = r.setValues; r.setValues = v => { seen.push(v); return sv(v); }; return r; };
    c.submitOpinion({ room: '5-1', title: '=1', content: '=2', authorToken: 't' });
    assert.equal(seen.pop()[0][3], "'=1");
  });
  await test('m2: tokens are never sent to other clients; isMine only for the author', () => {
    const { context: c } = environment(2); c.setup();
    c.submitOpinion({ room: '5-1', content: 'a', authorToken: 'secret-token-1' });
    const other = c.getBoardData('5-1', 'someone-else');
    assert.ok(!JSON.stringify(other).includes('secret-token-1'));
    assert.equal(other.cards[0].isMine, false); assert.equal(c.getBoardData('5-1', 'secret-token-1').cards[0].isMine, true);
  });
  await test('m2: only the author (or teacher PIN) can edit or delete', () => {
    const { context: c } = environment(2); c.setup();
    const id = c.submitOpinion({ room: '5-1', content: 'a', authorToken: 'me' }).card.id;
    assert.throws(() => c.updateOpinion({ id, content: 'x', authorToken: 'you' }), /본인/);
    assert.throws(() => c.deleteOpinion(id, 'you', ''), /본인/);
    c.updateOpinion({ id, content: '고침', color: 'evil-class', authorToken: 'me' });
    assert.equal(c.getBoardData('5-1', '').cards[0].content, '고침'); assert.equal(c.getBoardData('5-1', '').cards[0].color, 'yellow');
    c.deleteOpinion(id, 'you', '1234'); assert.equal(c.getBoardData('5-1', '').cards.length, 0);
  });
  await test('m2: room reset deletes only that room, under the lock', () => {
    const { context: c, state } = environment(2); c.setup();
    c.submitOpinion({ room: '5-1', content: 'a' }); c.submitOpinion({ room: '5-2', content: 'b' }); c.submitOpinion({ room: '5-1', content: 'c' });
    state.log = []; c.clearRoomCards('5-1', '1234');
    assert.equal(c.getBoardData('5-1', '').cards.length, 0); assert.equal(c.getBoardData('5-2', '').cards.length, 1);
    assert.ok(state.log.indexOf('lock') < state.log.indexOf('deleteRow') && state.log.lastIndexOf('release') > state.log.lastIndexOf('deleteRow'), state.log.join(','));
  });
  await test('m2: teacher card order is saved and shown to students', () => {
    const { context: c } = environment(2); c.setup();
    const a = c.submitOpinion({ room: '5-1', content: 'A' }).card.id, b = c.submitOpinion({ room: '5-1', content: 'B' }).card.id;
    c.updateCardOrder('5-1', [a, b], '1234');
    const cards = c.getBoardData('5-1', '').cards.sort((x, y) => y.sortOrder - x.sortOrder);
    assert.equal(cards[0].id, a);
  });
  await test('m2: room question saved per room (teacher only) and returned with the board', () => {
    const { context: c } = environment(2); c.setup();
    c.saveRoomQuestion('5-1', '쉬는 시간에 무엇을 할까?', '1234'); c.saveRoomQuestion('5-1', '바뀐 질문', '1234');
    assert.equal(c.getBoardData('5-1', '').question, '바뀐 질문'); assert.equal(c.getBoardData('5-2', '').question, '');
  });
  await test('m2: dashboard PIN uses the PIN window, not prompt()', async () => {
    const u = ui(2); u.ctx.window.dispatchEvent(new u.ctx.window.Event('DOMContentLoaded')); await flush();
    assert.ok(!/\bprompt\(/.test(html(2)));
    u.ctx.openDashboardModal();
    assert.ok(u.el('pin-modal').classList.contains('open'));
    u.el('modal-pin-input').value = '1234'; u.ctx.confirmTeacherPin(); await flush(); await flush(); await flush();
    assert.ok(u.el('dashboard-modal').classList.contains('open'));
  });
  await test('m2: connection check shows OK through getAppStatus', async () => {
    const u = ui(2); u.ctx.window.dispatchEvent(new u.ctx.window.Event('DOMContentLoaded')); await flush(); await flush();
    assert.ok(u.el('setup-connection-status').textContent.includes('연결 정상'));
  });

  // ── 실습 3 ──
  const page = (o) => Object.assign({ pageid: 1, index: 1, title: '무지개', description: '', extract: '무지개는 빛의 띠이다.' }, o);
  await test('m3: no spreadsheet in practice 3 code', () => {
    assert.ok(!/SpreadsheetApp|PropertiesService\.getScriptProperties\(\)\.setProperty/.test(gs(3)));
  });
  await test('m3: one Action API call with intro extracts (no cut-off search excerpt)', () => {
    const { context: c, state } = environment(3); c.searchWikipedia('무지개');
    const u = new URL(state.lastUrl);
    assert.equal(u.searchParams.get('generator'), 'search'); assert.equal(u.searchParams.get('exintro'), '1');
    assert.equal(u.searchParams.get('explaintext'), '1'); assert.ok(u.searchParams.get('prop').includes('extracts'));
    assert.equal(state.fetches, 1);
  });
  await test('m3: summary stops at a sentence end, never mid-sentence', () => {
    const { context: c, state } = environment(3);
    const long = '블랙홀은 중력이 매우 강한 천체이다. ' + '빛조차 빠져나올 수 없는 영역을 사건의 지평선이라고 한다. '.repeat(10);
    state.pages = [page({ title: '블랙홀', extract: long })];
    const t = c.searchWikipedia('블랙홀').pages[0].summary;
    assert.ok(t.length <= 320 && /다\.$/.test(t), t);
  });
  await test('m3: disambiguation pages removed and search order kept', () => {
    const { context: c, state } = environment(3);
    state.pages = [page({ pageid: 3, index: 3, title: '셋째', extract: '셋째 문서이다.' }), page({ pageid: 1, index: 1, title: '첫째', extract: '첫째 문서이다.' }),
      page({ pageid: 2, index: 2, title: '동음', extract: '동음은 다음을 가리킨다.', pageprops: { disambiguation: '' } })];
    assert.deepEqual(c.searchWikipedia('순서').pages.map(p => p.title).join(','), '첫째,셋째');
  });
  await test('m3: translation failure does not break the search', () => {
    const { context: c, state } = environment(3); state.translateThrows = true;
    const r = c.searchWikipedia('무지개'); assert.equal(r.pages.length, 1); assert.equal(r.english, '');
  });
  await test('m3: class map counts found keywords only, most first, 6-hour cache', () => {
    const { context: c, state } = environment(3);
    c.searchWikipedia('사막'); c.searchWikipedia('무지개'); const r = c.searchWikipedia('무지개');
    state.pages = []; c.searchWikipedia('없는낱말');
    const map = c.getClassMap();
    assert.equal(JSON.stringify(map), JSON.stringify([{ word: '무지개', count: 2 }, { word: '사막', count: 1 }]));
    assert.equal(r.map[0].word, '무지개');
    const k = [...state.cache.keys()].find(k => k.startsWith('map_')); assert.equal(state.ttls[k], 21600);
    assert.equal(state.locks, state.releases);
  });
  await test('m3: class map keeps at most 40 words', () => {
    const { context: c } = environment(3);
    for (let i = 0; i < 45; i++) c.searchWikipedia('낱말' + i);
    assert.equal(c.getClassMap().length, 40);
  });
  await test('m3: only the teacher (editor run) can clear the class map', () => {
    const { context: c, state } = environment(3); c.searchWikipedia('무지개');
    state.activeEmail = ''; assert.throws(() => c.clearClassMap(), /선생님만/); assert.equal(c.getClassMap().length, 1);
    state.activeEmail = 'teacher@test'; c.clearClassMap(); assert.equal(c.getClassMap().length, 0);
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
  await test('m3: summary card, English bridge and class map on screen', async () => {
    const u = ui(3); await flush(); await flush();
    assert.ok(u.el('cloud').textContent.includes('첫 탐험가'));
    u.ctx.search('무지개'); await flush(); await flush();
    assert.ok(u.el('cards').querySelector('.summary').textContent.includes('햇빛이 물방울에서 굴절되어 생긴다.'));
    assert.ok(!u.el('cards').textContent.includes('…'));
    assert.ok(u.el('bridge').textContent.includes('rainbow'));
    assert.ok(u.el('bridge').querySelector('a').href.includes('en.wikipedia.org'));
    const chip = u.el('cloud').querySelector('.chip'); assert.equal(chip.textContent, '무지개'); assert.ok(chip.classList.contains('mine'));
    assert.ok(u.timers.some(t => t.ms === 30000));
  });

  // ── 실습 4 ──
  const studioEnv = () => { const e = environment(4); e.context.setup(); return e; };
  await test('m4: topic comes from the teacher (server), not from the student request', () => {
    const { context: d, state } = studioEnv();
    d.setTopic('  가을  하늘 '); d.saveWriting({ pen: '별', body: '글', topic: '해킹 글감' });
    assert.equal(d.getDesk().topic, '가을 하늘'); assert.equal(d.getShelf()[0].topic, '가을 하늘');
    assert.equal(state.props.TOPIC, '가을 하늘');
  });
  await test('m4: id is stored as text (a hex id like 1e234567 must not become a number)', () => {
    const { context: d, state } = studioEnv();
    const sh = state.sheets['원고'], raw = []; const orig = sh.appendRow; sh.appendRow = r => { raw.push(r); orig(r); };
    d.saveWriting({ pen: '별', body: '글' }); assert.ok(/^'[0-9a-f-]{8}$/.test(raw[0][0]), raw[0][0]);
  });
  await test('m4: anthology grouped by topic with a table of contents', () => {
    const { context: d, state } = studioEnv();
    d.setTopic('가을'); d.saveWriting({ pen: '별', body: '가' }); d.setTopic('친구'); d.saveWriting({ pen: '달', body: '나' });
    d.setTopic('가을'); d.saveWriting({ pen: '숲', body: '다' });
    const r = d.makeAnthology({ ids: d.getStudio().writings.map(w => w.id), order: 'topic' });
    const texts = state.docs[0].events.filter(e => e[0] === 'paragraph').map(e => e[1]);
    assert.equal(texts.filter(t => t === '가을').length, 1); assert.equal(texts.filter(t => t === '친구').length, 1);
    assert.ok(texts.includes('1. 가을 — 2편') && texts.includes('2. 친구 — 1편'), texts.join('|'));
    assert.equal(state.docs[0].events.filter(e => e[0] === 'rule').length, 3); assert.equal(r.chapters, 2);
  });
  await test('m4: only chosen writings go into the book; date order works', () => {
    const { context: d, state } = studioEnv();
    d.saveWriting({ pen: '별', body: '실을 글' }); d.saveWriting({ pen: '달', body: '뺄 글' });
    const keep = d.getStudio().writings.find(w => w.body === '실을 글').id;
    const r = d.makeAnthology({ ids: [keep], order: 'date', pdf: false });
    const texts = state.docs[0].events.filter(e => e[0] === 'paragraph').map(e => e[1]);
    assert.equal(r.count, 1); assert.ok(texts.includes('실을 글') && !texts.includes('뺄 글'));
    assert.equal(state.pdfs.length, 0); assert.equal(r.pdfUrl, '');
  });
  await test('m4: empty selection gives a clear error, no document', () => {
    const { context: d, state } = studioEnv(); d.saveWriting({ pen: '별', body: '글' });
    assert.throws(() => d.makeAnthology({ ids: [] }), /골라/); assert.equal(state.docs.length, 0);
  });
  await test('m4: PDF failure still returns the document link', () => {
    const { context: d, state } = studioEnv();
    d.saveWriting({ pen: '별', body: '가' }); state.failPdf = true;
    const r = d.makeAnthology({ ids: d.getStudio().writings.map(w => w.id) });
    assert.equal(state.docs.length, 1); assert.equal(state.pdfs.length, 0);
    assert.ok(/docs\.google\.com/.test(r.docUrl) && r.pdfFailed);
  });
  await test('m4: student context stops at getUi before reading the sheet or creating a doc', () => {
    const { context: d, state } = studioEnv();
    state.ui = false; state.opens = 0;
    assert.throws(() => d.makeAnthology({}), /메뉴/); assert.throws(() => d.openStudio(), /메뉴/);
    assert.equal(state.opens, 0); assert.equal(state.docs.length, 0);
  });
  await test('m4: menu opens the studio dialog', () => {
    const { context: d, state } = studioEnv(); d.openStudio(); assert.ok(state.dialog);
  });
  await test('m4: draft survives in sessionStorage, cleared after submit; failed submit keeps the text', async () => {
    const u = ui(4); await flush();
    u.el('pen').value = '별'; u.el('body').value = '쓰던 글'; u.el('body').dispatchEvent(new u.ctx.window.Event('input'));
    await new Promise(r => setTimeout(r, 450));
    assert.equal(u.session.get('draft:body'), '쓰던 글');
    u.fail(); u.ctx.submit(); await flush(); await flush();
    assert.equal(u.el('body').value, '쓰던 글'); assert.equal(u.el('writeErr').classList.contains('hide'), false);
    u.ctx.submit(); await flush(); await flush();
    assert.equal(u.session.get('draft:body'), undefined); assert.equal(u.session.get('draft:pen'), '별');
    u.el('newPiece').click(); assert.equal(u.el('body').value, ''); assert.equal(u.el('pen').value, '별');
    assert.equal(u.storage.size, 0);
  });
  await test('m4: studio lists writings, preselects the current topic, builds the book', async () => {
    const server = studioEnv(); const d = server.context;
    d.setTopic('봄'); d.saveWriting({ pen: '별', title: '<b>꽃</b>', body: '글1' }); d.setTopic('여름'); d.saveWriting({ pen: '달', body: '글2' });
    const u = ui(4, server, 'studio'); await flush(); await flush();
    assert.equal(u.el('list').querySelectorAll('.item').length, 1);          // 지금 글감(여름)으로 걸러 보여 줌
    assert.ok(u.el('makeTxt').textContent.includes('1편'));
    u.el('filter').children[0].selected = true; u.el('filter').dispatchEvent(new u.ctx.window.Event('change'));
    assert.equal(u.el('list').querySelectorAll('.item').length, 2);
    assert.ok(u.el('list').textContent.includes('<b>꽃</b>')); assert.equal(u.el('list').querySelector('b b'), null);
    u.el('make').click(); await flush(); await flush();
    assert.equal(server.state.docs.length, 1);
    assert.ok(u.el('result').querySelector('a').href.includes('docs.google.com'));
  });

  console.log(JSON.stringify({ pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length, results }, null, 2));
  if (results.some(r => r.status === 'FAIL')) process.exitCode = 1;
})();
