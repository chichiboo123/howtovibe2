// 사이트(index.html)의 복사용 코드 블록을 '복사 버튼과 같은 방식(textContent)'으로 꺼내 테스트합니다.
// 사용: (이 폴더에서) npm install → npm test   [다른 파일을 검사하려면: node run.cjs 경로/index.html]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { parseHTML } = require('linkedom');
const page = process.argv[2] || path.join(__dirname, '..', '..', 'index.html');
const { document } = parseHTML(fs.readFileSync(page, 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'practices-'));
for (let i = 1; i <= 4; i++) for (const k of ['gs', 'html', 'prompt', ...(i === 1 ? ['dash'] : []), ...(i === 4 ? ['studio'] : [])]) {
  const el = document.getElementById(`m${i}_${k}`);
  if (!el) throw Error(`#m${i}_${k} 코드 블록이 없습니다`);
  fs.writeFileSync(path.join(dir, `m${i}_${k}.txt`), el.textContent);
}
let failed = false;
for (const [test, tz] of [['test-server.cjs'], ['test-ui.cjs'], ['test-extra.cjs', 'America/Los_Angeles']]) {
  const r = spawnSync(process.execPath, [path.join(__dirname, test)], { env: { ...process.env, SOURCE_DIR: dir, ...(tz ? { TZ: tz } : {}) }, encoding: 'utf8' });
  let line = test + ': ';
  try { const j = JSON.parse(r.stdout); line += `${j.pass} pass, ${j.fail} fail`; j.results.filter(x => x.status === 'FAIL').forEach(x => { line += `\n   FAIL ${x.name} :: ${x.error}`; }); }
  catch (e) { line += 'output could not be read\n' + (r.stdout || '') + (r.stderr || ''); }
  console.log(line);
  if (r.status !== 0) failed = true;
}
fs.rmSync(dir, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
