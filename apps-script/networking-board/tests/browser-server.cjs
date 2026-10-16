// Local-only bridge: run the real board UI against Code.gs with Google service adapters.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {createRuntime} = require('./runtime.cjs');
const bridge = `<script>
function rpcChain(ok,bad){return new Proxy({}, {get(_,name){
 if(name==='withSuccessHandler')return h=>rpcChain(h,bad);
 if(name==='withFailureHandler')return h=>rpcChain(ok,h);
 return(...args)=>fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})})
 .then(r=>r.json()).then(r=>{if(r.error){if(bad)bad(new Error(r.error));}else if(ok)ok(r.result);}).catch(e=>bad&&bad(e));
}});}
window.google={script:{run:rpcChain()}};
</script>`;
async function startServer() {
  const runtime = createRuntime();
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/rpc') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 20000) { res.writeHead(413).end(); return; } }
      res.setHeader('Content-Type', 'application/json');
      try {
        const {name, args} = JSON.parse(body);
        if (!['getConfig', 'listPosts', 'addPost', 'updatePost', 'deletePost'].includes(name)) throw new Error('Unknown method');
        res.end(JSON.stringify({result: runtime.api[name](...args)}));
      } catch (error) { res.end(JSON.stringify({error: error.message})); }
      return;
    }
    if (req.url !== '/') { res.writeHead(404).end(); return; }
    const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8')
      .replace('<?= theme ?>', 'light').replace("<?= embed ? 'embed' : '' ?>", '')
      .replace('<?!= JSON.stringify(!!embed) ?>', 'false').replace("<?!= JSON.stringify(parentOrigin || '') ?>", '""')
      .replace('<head>', '<head>' + bridge);
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {runtime, url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })};
}
module.exports = {startServer};
