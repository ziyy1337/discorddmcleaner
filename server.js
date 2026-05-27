const express = require('express');
const bodyParser = require('body-parser');
const chalk = require('chalk');
const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ANALYTICS_FILE = path.join(__dirname, 'analytics.json');
const RATE_LIMIT_DELAY = 1200; // ms between individual deletes

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let liveSession = null; // object updated while a cleaning run is active
let stopRequested = false; // flag set by /stop endpoint or process exit

// ── helper functions ────────────────────────────────────────────────────────
function loadAnalytics(){
  try{ return JSON.parse(fs.readFileSync(ANALYTICS_FILE,'utf8')); }catch{ return []; }
}
function saveAnalytics(data){
  fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2));
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

// delete only our own messages in a DM channel.
async function deleteAllMessages(channel, onProgress){
  let lastId = null;
  let deleted = 0;
  let failed = 0;
  while(true){
    if(stopRequested) break;
    const opts = { limit: 100 };
    if(lastId) opts.before = lastId;
    let msgs;
    try{ msgs = await channel.messages.fetch(opts); }
    catch(e){ console.log(chalk.red('fetch error:'), e.message); break; }
    if(!msgs || msgs.size===0) break;
    const all = [...msgs.values()];
    lastId = all[all.length-1].id;
    
    // Filter to only our own messages since we can't delete other users' messages in a DM
    const ownMessages = all.filter(m => m.author.id === client.user.id);
    
    for(const m of ownMessages){
      if(stopRequested) break;
      try{
        await m.delete();
        deleted++;
      }catch(e){
        failed++;
      }
      onProgress && onProgress(deleted, failed);
      await sleep(RATE_LIMIT_DELAY);
    }
    await sleep(200);
  }
  return { deleted, failed };
}

// ── routes ────────────────────────────────────────────────────────────────
// UI – start/stop buttons, textarea for IDs
app.get('/', (req,res)=>{
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DM Cleaner</title>
<style>
*{box-sizing:border-box}
body{font-family:sans-serif;background:#111;color:#ddd;padding:30px;max-width:700px;margin:auto}
h2{color:#4fc3f7}
textarea{width:100%;height:150px;background:#1a1a1a;color:#eee;border:1px solid #333;padding:10px;font-size:14px;border-radius:4px;resize:vertical}
button{margin:5px 5px 0 0;padding:8px 16px;background:#4fc3f7;color:#111;border:none;border-radius:4px;cursor:pointer;font-weight:bold}
button:disabled{opacity:.5;cursor:default}
#out{margin-top:15px;background:#1a1a2e;padding:12px;white-space:pre-wrap;word-break:break-all;border-radius:4px;font-size:13px}
a{color:#4fc3f7}
</style>
</head>
<body>
<h2>🧹 Discord DM Cleaner</h2>
<p>Logged in as <strong>${process.env.DISCORD_TOKEN?'[connected]':''}</strong> | <a href="/dashboard">📊 Dashboard</a></p>
<form id="form">
<label>User IDs – one per line, commas or spaces:</label><br/><br/>
<textarea id="ids" placeholder="123456789012345678\n987654321098765432"></textarea><br/>
<button type="button" id="startBtn">🗑 Delete DMs</button>
<button type="button" id="stopBtn" disabled>✋ Stop</button>
</form>
<div id="out"></div>
<script>
const startBtn=document.getElementById('startBtn');
const stopBtn=document.getElementById('stopBtn');
const out=document.getElementById('out');
startBtn.addEventListener('click', async () => {
  // e.preventDefault();
  startBtn.disabled=true; stopBtn.disabled=false;
  out.textContent='⏳ Running – watch live dashboard';
  try{
    const r=await fetch('/clean',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:document.getElementById('ids').value})});
    const d=await r.json();
    out.textContent='✅ Done!\\n'+JSON.stringify(d,null,2);
  }catch(err){ out.textContent='❌ '+err.message; }
  startBtn.disabled=false; stopBtn.disabled=true;
});
stopBtn.addEventListener('click', async()=>{
  stopBtn.disabled=true; out.textContent='🛑 Stop requested…';
  await fetch('/stop',{method:'POST'});
});
</script>
</body>
</html>`);
});

// start cleaning
app.post('/clean', async (req,res)=>{
  const raw=req.body.ids||'';
  const ids=raw.split(/[\s,\n]+/).map(s=>s.trim()).filter(id=>id.length>=15);
  if(ids.length===0) return res.json({error:'No valid IDs'});
  stopRequested=false;
  liveSession={timestamp:new Date().toISOString(),running:true,totalDeleted:0,totalFailed:0,reports:[]};
  console.log(chalk.cyan(`Starting cleaning for ${ids.length} IDs concurrently`));

  const promises = ids.map(async (userId) => {
    const entry={userId,username:'',displayName:'',deleted:0,failed:0,status:'processing'};
    liveSession.reports.push(entry);
    let channel;
    try{ 
      const user=await client.users.fetch(userId); 
      entry.username = user.username;
      entry.displayName = user.globalName || user.username;
      channel=await user.createDM(); 
    } catch(e) { 
      entry.status='error'; 
      entry.error=e.message; 
      return; 
    }
    const {deleted,failed}=await deleteAllMessages(channel,(del,fail)=>{ 
      entry.deleted=del; 
      entry.failed=fail; 
    });
    entry.deleted=deleted; 
    entry.failed=failed; 
    entry.status=stopRequested ? 'stopped' : 'done';
  });

  await Promise.all(promises);
  liveSession.running=false;

  // Calculate final totals
  liveSession.totalDeleted = liveSession.reports.reduce((sum, r) => sum + (r.deleted || 0), 0);
  liveSession.totalFailed = liveSession.reports.reduce((sum, r) => sum + (r.failed || 0), 0);

  // persist session (including if stopped early)
  const analytics=loadAnalytics();
  analytics.push({
    timestamp:liveSession.timestamp,
    totalDeleted:liveSession.totalDeleted,
    totalFailed:liveSession.totalFailed,
    reports:liveSession.reports,
    stopped:!!stopRequested
  });
  saveAnalytics(analytics);
  res.json({message:'Finished',totalDeleted:liveSession.totalDeleted,totalFailed:liveSession.totalFailed,session:liveSession});
});

// stop endpoint
app.post('/stop',(req,res)=>{ stopRequested=true; if(liveSession && liveSession.running){ liveSession.running=false; liveSession.stopped=true; } res.json({message:'Stop signal received'}); });

// status for live dashboard
app.get('/status',(req,res)=>{
  if (liveSession && liveSession.reports) {
    liveSession.totalDeleted = liveSession.reports.reduce((sum, r) => sum + (r.deleted || 0), 0);
    liveSession.totalFailed = liveSession.reports.reduce((sum, r) => sum + (r.failed || 0), 0);
  }
  res.json(liveSession||{running:false});
});

// clear logs endpoint
app.post('/clear-logs', (req, res) => {
  try {
    saveAnalytics([]);
    res.json({ success: true, message: 'Logs cleared successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// dashboard page with live polling and past sessions
app.get('/dashboard',(req,res)=>{
  const analytics=loadAnalytics();
  let html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Dashboard</title>
  <style>*{box-sizing:border-box}body{font-family:sans-serif;background:#111;color:#ddd;padding:30px;max-width:900px;margin:auto}h2{color:#4fc3f7}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #333;padding:6px 10px}th{background:#1a1a2a}tr:nth-child(even){background:#1a1a1a}.badge{display:inline-block;padding:2px 6px;border-radius:3px;font-size:12px;font-weight:bold}.processing{background:#442;color:#fa0}.done{background:#042;color:#4f8}.error{background:#400;color:#f44}a{color:#4fc3f7}button.clear-btn{margin-left: 15px; padding: 4px 8px; background: #e53935; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;}</style></head><body>
  <h2>📊 DM Cleaner Dashboard</h2>
  <p><a href="/">← Back to cleaner</a></p>
  <div id="liveBox" class="badge processing">No active session</div>
  <div id="liveContent"></div>
  <h3>Past Sessions <button type="button" id="clearBtn" class="clear-btn">🗑 Clear Logs</button></h3>`;
  if(analytics.length===0){ html+='<p style="color:#777">No past sessions recorded.</p>'; }
  else{ analytics.slice().reverse().forEach((s,i)=>{ html+=`<h4>Session ${analytics.length-i} – ${new Date(s.timestamp).toLocaleString()} ${s.stopped?'(stopped)':''}</h4>`; html+=`<table><tr><th>User</th><th>Deleted</th><th>Failed</th><th>Status</th></tr>`; (s.reports||[]).forEach(r=>{ const badgeClass=r.status==='error'?'error':r.status==='done'?'done':'processing'; const statusTxt=r.status||'done'; const userLabel = r.displayName ? `${r.displayName} (@${r.username}) [${r.userId}]` : r.userId; html+=`<tr><td>${userLabel}</td><td>${r.deleted||0}</td><td>${r.failed||0}</td><td><span class="badge ${badgeClass}">${statusTxt}</span></td></tr>`; }); html+='</table>'; }); }
  html+=`<script>
    async function poll(){
      const resp=await fetch('/status');
      const data=await resp.json();
      const box=document.getElementById('liveBox');
      const content=document.getElementById('liveContent');
      if(!data||(!data.running && !data.stopped)){ box.textContent='No active session'; content.innerHTML=''; return; }
      box.textContent='Live Session';
      let html='<p>Started: '+new Date(data.timestamp).toLocaleTimeString()+'</p>';
      html+='<p>Total deleted: '+(data.totalDeleted||0)+' | Failed: '+(data.totalFailed||0)+'</p>';
      html+='<table><tr><th>User</th><th>Deleted</th><th>Failed</th><th>Status</th></tr>';
      (data.reports||[]).forEach(r=>{ const cls=r.status==='error'?'error':r.status==='done'?'done':'processing'; const txt=r.status||'processing'; const label = r.displayName ? (r.displayName + ' (@' + r.username + ') [' + r.userId + ']') : r.userId; html+='<tr><td>'+label+'</td><td>'+ (r.deleted||0) +'</td><td>'+ (r.failed||0) +'</td><td><span class="badge '+cls+'">'+txt+'</span></td></tr>'; });
      html+='</table>'; content.innerHTML=html;
    }
    setInterval(poll,2000); poll();

    document.getElementById('clearBtn')?.addEventListener('click', async () => {
      if(!confirm('Are you sure you want to clear all past sessions log?')) return;
      try {
        const resp = await fetch('/clear-logs', { method: 'POST' });
        const data = await resp.json();
        if(data.success) {
          location.reload();
        } else {
          alert('Error: ' + data.error);
        }
      } catch(e) {
        alert('Error: ' + e.message);
      }
    });
  </script></body></html>`;
  res.send(html);
});

// ── start server ───────────────────────────────────────────────────────
let client=null;
async function start(){
  const token=process.env.DISCORD_TOKEN;
  if(!token){ console.log(chalk.red('DISCORD_TOKEN env var required')); process.exit(1); }
  client=new Client();
  try{ await client.login(token); }
  catch(e){ console.log(chalk.red('Login failed:'),e.message); process.exit(1); }
  console.log(chalk.green(`Logged in as ${client.user.tag}`));
  app.listen(PORT,()=>{ console.log(chalk.blue(`Server: http://localhost:${PORT}`)); console.log(chalk.blue(`Dashboard: http://localhost:${PORT}/dashboard`)); });
  // graceful shutdown persistence
  function persist(){
    if(liveSession && liveSession.running){ console.log(chalk.yellow('Persisting incomplete session on exit')); const analytics=loadAnalytics(); analytics.push({timestamp:liveSession.timestamp,totalDeleted:liveSession.totalDeleted,totalFailed:liveSession.totalFailed,reports:liveSession.reports,stopped:true}); saveAnalytics(analytics); }
  }
  process.on('SIGINT',()=>{ persist(); process.exit(); });
  process.on('SIGTERM',()=>{ persist(); process.exit(); });
}
start();
