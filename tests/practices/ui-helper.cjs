const fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require(process.env.TEST_DOM_MODULE||'linkedom');
const {environment,ROOT,source}=require('./harness.cjs');
function ui(i,server){
 const html=fs.readFileSync(source(i,'html'),'utf8');const {window:w}=parseHTML(html);const {context:c,state}=server||environment(i);if(i!==3)c.setup();const storage=new Map(),timers=[];let failNext=false,loseNext=false;
 const ctx={window:w,document:w.document,console,Date,Promise,URL,URLSearchParams,Error,history:{replaceState(){}},location:{href:'https://test.invalid'},navigator:{clipboard:{writeText:async t=>ctx.clipboard=t}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setInterval:(f,ms)=>{timers.push({f,ms});return timers.length},clearInterval(){},setTimeout,clearTimeout};
 w.document.hidden=false;w.document.execCommand=()=>true;
 const rpc=new Proxy({},{get(_,key){if(key==='withSuccessHandler'||key==='withFailureHandler')return handler=>runner(key,handler);}});
 function runner(key,handler,good,bad){if(key==='withSuccessHandler')good=handler;else bad=handler;return new Proxy({},{get(_,k){if(k==='withSuccessHandler'||k==='withFailureHandler')return h=>runner(k,h,good,bad);return arg=>Promise.resolve().then(()=>{if(failNext){failNext=false;throw Error('test connection failure')}const out=JSON.parse(JSON.stringify(c[k](arg)));if(loseNext){loseNext=false;throw Error('response lost')}return out}).then(good,bad)}})}
 ctx.google=w.google={script:{run:rpc,url:{getLocation:cb=>cb({parameter:{}})}}};vm.createContext(ctx);
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],ctx);
 return {ctx,state,storage,timers,fail:()=>failNext=true,lose:()=>loseNext=true,el:id=>w.document.getElementById(id)};
}

module.exports={ui};
