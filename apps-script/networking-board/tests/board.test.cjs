const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createRuntime} = require('./runtime.cjs');
const PLAN = '[앱 이름] 우리 반 독서장\n[누가] 5학년\n[아쉬운 점] 기록을 찾기 어려워요.\n[학생 경험] 날짜별로 다시 봐요.\n[기능 블록] 1 기록\n[넓어지는 쪽] 지난 기록 돌아보기';
test('structured plans retain their formatted fields', () => {
  const {api} = createRuntime(); const {post} = api.addPost(PLAN, '');
  assert.equal(post.appName, '우리 반 독서장'); assert.equal(post.experience, '날짜별로 다시 봐요.');
  assert.equal(api.listPosts()[0].raw, PLAN);
});
test('free writing and an optional app link survive add, list, edit and delete', () => {
  const {api, locks} = createRuntime();
  const {post, key} = api.addPost('완성한 독서 앱을 나눕니다.\n친구들과 써 보고 알려 주세요.', '', 'https://example.com/app?room=5-3#start');
  assert.equal(post.kind, 'text'); assert.equal(post.appUrl, 'https://example.com/app?room=5-3#start');
  assert.equal(api.listPosts()[0].appUrl, post.appUrl);
  const changed = api.updatePost(post.id, key, '글을 고쳤어요.', 'https://example.com/new');
  assert.equal(changed.raw, '글을 고쳤어요.'); assert.equal(changed.appUrl, 'https://example.com/new');
  assert.equal(api.updatePost(post.id, key, '링크를 뺐어요.', '').appUrl, '');
  api.deletePost(post.id, key); assert.equal(api.listPosts().length, 0); assert.equal(locks.active, 0);
});
test('plan links are saved separately and older edit clients preserve existing links', () => {
  const {api} = createRuntime(); const {post, key} = api.addPost(PLAN, '', 'https://example.com');
  assert.equal(post.kind, 'plan');
  assert.equal(api.updatePost(post.id, key, PLAN + '\n[입력] 책 제목').appUrl, 'https://example.com');
});
test('posts can change between structured plans and free writing without stale fields', () => {
  const {api} = createRuntime(); const {post, key} = api.addPost(PLAN, '', 'https://example.com');
  const free = api.updatePost(post.id, key, '사용해 본 이야기를 나눠요.');
  assert.equal(free.kind, 'text'); assert.equal(free.experience, ''); assert.equal(free.who, '');
  const plan = api.updatePost(post.id, key, PLAN);
  assert.equal(plan.kind, 'plan'); assert.equal(plan.experience, '날짜별로 다시 봐요.');
  assert.equal(api.listPosts()[0].appUrl, 'https://example.com');
});
test('only safe HTTP(S) app links are accepted on add and update', () => {
  const {api} = createRuntime();
  for (const appUrl of ['javascript:alert(1)', 'data:text/html,bad', '//example.com', 'https://user:pass@example.com', 'https://example.com\\evil', 'https://example.com\n.evil', 'https://example.com/' + 'a'.repeat(2000)]) {
    assert.throws(() => api.addPost('글', '', appUrl), /주소|링크/);
  }
  const {post, key} = api.addPost('안전한 글', '', 'http://example.com:8080/app');
  assert.throws(() => api.updatePost(post.id, key, '변경', 'javascript:alert(1)'), /주소|링크/);
  assert.equal(api.listPosts()[0].appUrl, post.appUrl);
});
test('duplicate detection includes links while preserving no-link plan hashes', () => {
  const {api} = createRuntime(); api.addPost(PLAN, '');
  assert.throws(() => api.addPost(PLAN.replace(/\n/g, '\r\n'), ''), /이미/);
  const {post, key} = api.addPost(PLAN, '', 'https://example.com/one');
  api.addPost(PLAN, '', 'https://example.com/two');
  assert.throws(() => api.updatePost(post.id, key, PLAN, 'https://example.com/two'), /이미/);
});
test('original 13-column rows migrate without losing keys, visibility or fields', () => {
  const initial = createRuntime(); const {post, key} = initial.api.addPost(PLAN, '');
  const oldRows = initial.rows.map(row => row.slice(0, 13));
  const {api, rows} = createRuntime({rows: oldRows}); api.setup();
  assert.equal(rows[0][13], 'appUrl'); assert.equal(api.listPosts()[0].appUrl, '');
  assert.equal(api.listPosts()[0].appName, post.appName);
  assert.equal(api.updatePost(post.id, key, PLAN, 'https://example.com/new').appUrl, 'https://example.com/new');
  rows[1][9] = '숨김'; assert.equal(api.listPosts().length, 0);
  assert.throws(() => api.updatePost(post.id, key, PLAN, ''), /내려간/);
});
test('posting codes, edit keys and input limits still apply to free writing', () => {
  const {api, rows, locks} = createRuntime({postCode: 'class-code'});
  assert.throws(() => api.addPost('글', 'wrong'), /게시 코드/);
  assert.throws(() => api.addPost(' \n ', 'class-code'), /내용|글/);
  assert.throws(() => api.addPost('a'.repeat(3001), 'class-code'), /3000/);
  const {post, key} = api.addPost('=IMPORTXML("test")', 'class-code', 'https://example.com');
  assert(rows[1][8].startsWith("'="), 'spreadsheet formula text remains escaped');
  assert.throws(() => api.updatePost(post.id, 'bad-key', '고침', ''), /권한/);
  assert.throws(() => api.deletePost(post.id, 'bad-key'), /권한/);
  assert(!('keyHash' in api.listPosts()[0])); assert(!('hash' in api.listPosts()[0]));
  api.deletePost(post.id, key); assert.equal(locks.active, 0);
});
test('manually inserted unsafe sheet links never reach clients as clickable links', () => {
  const {api, rows} = createRuntime(); api.addPost(PLAN, ''); rows[1][13] = 'javascript:alert(1)';
  assert.equal(api.listPosts()[0].appUrl, '');
});
test('optional author names round-trip and can be edited or cleared', () => {
  const {api} = createRuntime();
  const anonymous = api.addPost('이름 없이 나눕니다.', ''); assert.equal(anonymous.post.author, '');
  const {post, key} = api.addPost(PLAN, '', '', '  책친구  '); assert.equal(post.author, '책친구');
  assert.equal(api.listPosts().find(p => p.id === post.id).author, '책친구');
  assert.equal(api.updatePost(post.id, key, PLAN + '\n[입력] 책 제목').author, '책친구');
  assert.equal(api.updatePost(post.id, key, PLAN, '', '구름').author, '구름');
  assert.equal(api.updatePost(post.id, key, PLAN, '', '').author, '');
});
test('existing 14-column rows gain an empty author without losing links or ownership', () => {
  const initial = createRuntime(); const {post, key} = initial.api.addPost(PLAN, '', 'https://example.com');
  const {api, rows} = createRuntime({rows: initial.rows.map(row => row.slice(0, 14))}); api.setup();
  assert.equal(rows[0][14], 'author'); assert.equal(api.listPosts()[0].author, '');
  const edited = api.updatePost(post.id, key, PLAN, undefined, '별명');
  assert.equal(edited.author, '별명'); assert.equal(edited.appUrl, 'https://example.com');
});
test('author limits, safe text storage, duplicate detection and edit keys apply', () => {
  const {api, rows} = createRuntime();
  assert.throws(() => api.addPost('글', '', '', '가'.repeat(41)), /작성자|40/);
  const {post, key} = api.addPost('글', '', '', '=별명'); assert.equal(post.author, '=별명');
  assert(rows[1][14].startsWith("'="));
  assert.throws(() => api.addPost('글', '', '', '다른 이름'), /이미/);
  assert.throws(() => api.updatePost(post.id, 'wrong-key', '글', '', '위조'), /권한/);
  assert.throws(() => api.updatePost(post.id, key, '글', '', '가'.repeat(41)), /작성자|40/);
  assert.equal(api.listPosts()[0].author, '=별명');
});
