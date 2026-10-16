const {environment,ROOT,source}=require('./harness.cjs'),fs=require('fs'),assert=require('node:assert/strict'),vm=require('vm');
const results=[];
function test(name,f){try{f();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}}
for(let i=1;i<=4;i++){
 test(`m${i}: server and browser scripts compile`,()=>{new vm.Script(fs.readFileSync(source(i,'gs'),'utf8'));for(const m of fs.readFileSync(source(i,'html'),'utf8').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);});
 test(`m${i}: setup and doGet`,()=>{const {context:c}=environment(i);assert.equal(c.setup(),'ok');assert.ok(c.doGet());});
}
const {context:a,state:sa}=environment(1);a.setup();
test('m1: save 20 anonymous checkins; teacher dashboard counts and date filter',()=>{for(let n=0;n<20;n++)a.saveCheckin({emotion:['기쁨','평온','설렘','걱정','피곤'][n%5],note:'기록'+n});const d=a.getDashboard({});assert.equal(d.summary.total,20);assert.equal(d.rows.length,20);assert.equal(d.summary.counts['걱정'],4);assert.equal(d.week.length,7);assert.equal(d.week[6].day,d.today);assert.equal(a.getDashboard({day:'2000-01-01'}).summary.total,0);assert.equal(sa.locks,sa.releases);});
test('m1: blank emotion rejected',()=>{assert.throws(()=>a.saveCheckin({}));assert.throws(()=>a.saveCheckin({note:'메모만'}));});
test('m1: formula-like note stays literal; save returns no class data',()=>{const r=a.saveCheckin({emotion:'기쁨',note:'=1+1'});assert.deepEqual(Object.keys(r).sort(),['at','ok']);assert.equal(typeof r.at,'string');const d=a.getDashboard({});assert.equal(d.rows[0].note,'=1+1');assert.equal(typeof d.rows[0].at,'string');JSON.stringify(d);});
test('m1: only five allowed emotions accepted [requirement probe]',()=>assert.throws(()=>a.saveCheckin({room:'5-1',emotion:'없는감정'})));
const {context:b,state:sb}=environment(2);b.setup();
test('m2: 20 cards, room isolation, max length, color fallback',()=>{for(let n=0;n<20;n++)b.addCard({room:'5-1',text:'의견'+n,color:'blue'});b.addCard({room:'5-2',text:'다른 반'});let r=b.addCard({room:'5-1',text:'x'.repeat(151),color:'invalid'});assert.equal(r.length,21);assert.equal(r[0].text.length,150);assert.equal(r[0].color,'yellow');});
test('m2: likes update same card; other room cannot like',()=>{let card=b.getCards({room:'5-1'})[0];for(let j=0;j<20;j++)b.likeCard({room:'5-1',id:card.id});b.likeCard({room:'5-2',id:card.id});assert.equal(b.getCards({room:'5-1'})[0].likes,20);assert.equal(sb.locks,sb.releases);});
test('m2: blank opinion rejected',()=>assert.throws(()=>b.addCard({room:'5-1',text:'  '})));
const {context:c,state:sc}=environment(3);
test('m3: complete summary without markup, HTTPS thumbnail, encoded original URL, English word',()=>{const r=c.searchWikipedia('무지개');assert.equal(r.pages[0].summary,'무지개는 하늘에 보이는 빛 & 색의 띠이다. 햇빛이 물방울에서 굴절되어 생긴다.');assert.equal(r.pages[0].thumb,'https://upload.wikimedia.org/test.png');assert.ok(r.pages[0].url.endsWith(encodeURIComponent('무지개')));assert.equal(r.english,'rainbow');});
test('m3: same keyword sequential cache hit; 1800-second TTL',()=>{const before=sc.fetches;c.searchWikipedia('무지개');assert.equal(sc.fetches,before);const k=[...sc.cache.keys()].find(k=>k.startsWith('wiki_'));assert.equal(sc.ttls[k],1800);});
test('m3: blank keyword rejected',()=>assert.throws(()=>c.searchWikipedia('  ')));
test('m3: no results and HTTP failure',()=>{sc.pages=[];assert.equal(c.searchWikipedia('없는결과').pages.length,0);sc.status=503;assert.throws(()=>c.searchWikipedia('서버오류'),/연결/);});
test('m3: 50-character Korean cache key stays within 250',()=>{sc.status=200;c.searchWikipedia('가'.repeat(50));assert.ok([...sc.cache.keys()].every(k=>k.length<=250));});
const {context:d,state:sd}=environment(4);d.setup();
test('m4: save to the teacher topic, title optional, 2000-character cap',()=>{sd.props.TOPIC='반티';d.saveWriting({pen:'별',body:'첫 줄\n둘째 줄'});let r=d.saveWriting({pen:'숲',body:'가'.repeat(2001)});assert.equal(r.topic,'반티');assert.equal(typeof r.at,'string');const shelf=d.getShelf();assert.equal(shelf.length,2);assert.equal(shelf[0].body.length,2000);assert.equal(shelf[1].title,'');assert.equal(d.getDesk().count,2);assert.equal(sd.locks,sd.releases);});
test('m4: required fields reject blank',()=>{assert.throws(()=>d.saveWriting({body:'글'}));assert.throws(()=>d.saveWriting({pen:'별'}));});
test('m4: studio creates document + PDF with chosen writings',()=>{const ids=d.getStudio().writings.map(w=>w.id);const r=d.makeAnthology({ids,title:'봄 문집',pdf:true});assert.equal(sd.docs.length,1);assert.equal(sd.pdfs.length,1);assert.ok(sd.closed);assert.equal(sd.docs[0].events.filter(e=>e[0]==='rule').length,2);assert.equal(r.count,2);assert.ok(/docs\.google\.com/.test(r.docUrl));assert.ok(r.pdfUrl);});
test('m4: student RPC context cannot invoke document generation or studio data',()=>{sd.ui=false;assert.throws(()=>d.makeAnthology({}),/메뉴/);assert.throws(()=>d.getStudio(),/메뉴/);assert.throws(()=>d.setTopic('x'),/메뉴/);assert.equal(sd.docs.length,1);sd.ui=true;});
for(let i of [1,2,4])test(`m${i}: deployed context without active spreadsheet [deployment probe]`,()=>{const {context:c,state}=environment(i);c.setup();state.active=false;if(i===1){c.saveCheckin({emotion:'기쁨'});return;}if(i===4){c.saveWriting({pen:'별',body:'글'});c.getShelf();return;}c.getCards({room:'5-1'});});
console.log(JSON.stringify({pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,results},null,2));

if(results.some(r=>r.status==='FAIL')) process.exitCode=1;
