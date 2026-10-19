/* 读书馆 — 拆书笔记 + 国学经典 合并渲染器 */
const $ = s => document.querySelector(s);
const state = { lang: localStorage.getItem('rn-lang') || 'en', book: null, manifest: [], data: null, classic: false };

mermaid.initialize({
  startOnLoad: false, theme: 'dark', securityLevel: 'loose',
  themeVariables: {
    fontFamily: 'Inter, "Noto Sans SC", sans-serif',
    primaryColor: '#1d212c', primaryTextColor: '#e8eaf0', primaryBorderColor: '#7aa2ff',
    lineColor: '#7c8499', secondaryColor: '#1e2740', tertiaryColor: '#171a22',
    fontSize: '15px'
  },
  mindmap: { padding: 14 }, flowchart: { curve: 'basis', htmlLabels: true }
});

marked.setOptions({ breaks: false, gfm: true });

/* ---- helpers ---- */
function pick(obj){
  if(obj==null) return '';
  if(typeof obj==='string') return obj;
  return obj[state.lang] || obj.en || obj.zh || '';
}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

function sanitizeMermaid(code){
  const lines=code.split('\n');
  if(!(lines[0]||'').trim().toLowerCase().startsWith('mindmap')) return code;
  return lines.map(line=>{
    if(/root\s*\(\(/.test(line)) return line;
    if(/^\s*mindmap\s*$/i.test(line)) return line;
    if(/::icon|::class/.test(line)) return line;
    return line
      .replace(/->/g,'→').replace(/=>/g,'⇒')
      .replace(/&/g,'＆').replace(/[<>]/g,'')
      .replace(/[()\[\]{}]/g,m=>({'(':' ',')':'','[':' ',']':'','{':' ','}':''}[m]));
  }).join('\n');
}

let mmId = 0;
function renderMarkdown(md){
  if(!md) return '';
  const blocks=[];
  md = md.replace(/```mermaid\s*([\s\S]*?)```/g,(_,code)=>{
    const id='mm-'+(mmId++); blocks.push({id,code:sanitizeMermaid(code.trim())});
    return `\n\n@@MERMAID:${id}@@\n\n`;
  });
  let htmlStr = marked.parse(md);
  blocks.forEach(b=>{
    htmlStr = htmlStr.replace(new RegExp(`<p>@@MERMAID:${b.id}@@</p>|@@MERMAID:${b.id}@@`),
      `<div class="mermaid-wrap"><pre class="mermaid">${esc(b.code)}</pre></div>`);
  });
  return htmlStr;
}

async function runMermaid(scope){
  const nodes=[...(scope||document).querySelectorAll('.mermaid')];
  for(const node of nodes){
    if(node.dataset.done) continue;
    const code=node.textContent;
    try{
      const id='mmr-'+(mmId++);
      const {svg}=await mermaid.render(id,code);
      const wrap=node.closest('.mermaid-wrap')||node;
      wrap.innerHTML=svg;
      const s=wrap.querySelector('svg'); if(s) s.dataset.done='1';
    }catch(e){
      const wrap=node.closest('.mermaid-wrap')||node;
      wrap.innerHTML=`<pre style="font-family:var(--mono);font-size:12px;color:var(--ink-dim);white-space:pre-wrap;text-align:left;margin:0">${esc(code)}</pre>`;
      console.warn('mermaid render failed:',e.message);
    }
  }
}

/* ---- sidebar ---- */
async function loadManifest(){
  const res = await fetch('data/manifest.json');
  state.manifest = await res.json();
  buildSidebar();
  const nb=state.manifest.filter(b=>b.kind!=='classic').length;
  const nc=state.manifest.length-nb;
  $('#bookcount').textContent = `${nb} 本好书 · ${nc} 部国学经典`;
  const last = localStorage.getItem('rn-book');
  const start = state.manifest.find(b=>b.id===last) || state.manifest[0];
  if(start) selectBook(start.id);
}

function buildSidebar(filter=''){
  const list=$('#booklist'); list.innerHTML='';
  const f=filter.trim().toLowerCase();
  const groups={}; const order=[];
  state.manifest.forEach(b=>{
    const hay=(b.title.en+' '+b.title.zh+' '+(b.author||'')+' '+pick(b.category)).toLowerCase();
    if(f && !hay.includes(f)) return;
    const cat=b.category.zh||b.category.en||'其他';
    if(!groups[cat]){groups[cat]=[];order.push(cat);}
    groups[cat].push(b);
  });
  order.forEach(cat=>{
    const g=document.createElement('div'); g.className='cat-group';
    g.innerHTML=`<div class="cat-label">${esc(cat)}</div>`;
    groups[cat].forEach(b=>{
      const it=document.createElement('div');
      it.className='book-item'+(b.id===state.book?' active':'')+(b.kind==='classic'?' is-classic':'');
      it.dataset.id=b.id;
      it.innerHTML=`<span class="bi-emoji">${b.emoji||'📘'}</span>
        <span class="bi-text">
          <span class="bi-title bi-en">${esc(b.title.en)}</span>
          <span class="bi-title bi-zh">${esc(b.title.zh)}</span>
          <span class="bi-author">${esc(b.author||'')}</span>
        </span>`;
      it.onclick=()=>{selectBook(b.id); if(window.innerWidth<=820) $('#sidebar').classList.add('hidden');};
      g.appendChild(it);
    });
    list.appendChild(g);
  });
}

/* ---- select / route ---- */
async function selectBook(id){
  state.book=id; localStorage.setItem('rn-book',id);
  document.querySelectorAll('.book-item').forEach(e=>e.classList.toggle('active',e.dataset.id===id));
  const meta=state.manifest.find(b=>b.id===id);
  state.classic = !!(meta && meta.kind==='classic');
  $('#content').innerHTML=`<div class="loading"><div class="spinner"></div><div>载入「${esc(meta?meta.title.zh:'')}」…</div></div>`;
  $('#toc').innerHTML='';
  try{
    const res=await fetch(`data/${id}.json`);
    if(!res.ok) throw new Error('not found');
    state.data=await res.json();
    if(state.classic){
      state.data.bilingual=false;
      applyBilingualMode();
      renderClassic();
    }else{
      applyBilingualMode();
      renderBook();
    }
  }catch(e){
    $('#content').innerHTML=`<div class="empty"><div class="empty-emoji">🚧</div>
      <div>${state.classic?'此典籍尚在整理中…':'这本书的拆解还在路上…'}<br><span style="font-size:13px;color:var(--ink-dim)">${esc(e.message)}</span></div></div>`;
  }
}

function applyBilingualMode(){
  const tog=$('#langToggle');
  if(state.data && state.data.bilingual===false){
    state.lang='zh'; tog.classList.add('disabled');
    document.body.dataset.lang='zh'; updateLangButtons();
  }else{
    tog.classList.remove('disabled');
    document.body.dataset.lang=state.lang; updateLangButtons();
  }
}

/* ---- 拆书 book renderer ---- */
function renderBook(){
  const d=state.data, m=d.meta;
  let h=`<article class="article">`;
  h+=`<header class="bookhead">
      <span class="bh-cat">${esc(pick(m.category))}</span>
      <h1 class="bh-title">${esc(pick(m.title))}</h1>
      <div class="bh-meta">
        <span><b>${esc(pick(m.author))}</b></span>
        ${m.year?`<span>📅 ${esc(pick(m.year))}</span>`:''}
        ${m.reading_time?`<span>⏱️ ${esc(pick(m.reading_time))}</span>`:''}
        ${m.pages?`<span>📄 ${esc(pick(m.pages))}</span>`:''}
      </div>
      ${m.one_liner?`<div class="bh-oneliner">${renderMarkdown(pick(m.one_liner))}</div>`:''}
    </header>`;
  (d.sections||[]).forEach((s,i)=>{
    h+=`<section class="section" id="sec-${s.id||i}">
      <div class="sec-head">
        <span class="sec-icon">${s.icon||'▸'}</span>
        <h2 class="sec-h">${esc(pick(s.heading))}</h2>
        <span class="sec-num">${String(i+1).padStart(2,'0')}</span>
      </div>
      <div class="sec-body">${renderMarkdown(pick(s.body_md))}</div>
    </section>`;
  });
  h+=`</article>`;
  $('#content').innerHTML=h;
  $('#crumb').innerHTML=`<b>${esc(pick(m.title))}</b> &nbsp;·&nbsp; ${esc(pick(m.author))}`;
  buildToc(d.sections||[]);
  runMermaid($('#content'));
  $('#content').scrollTop=0;
}

function buildToc(sections){
  const toc=$('#toc');
  toc.innerHTML=`<div class="toc-title">本书目录</div>`+
    sections.map((s,i)=>`<a class="toc-link" data-target="sec-${s.id||i}">${s.icon||''} ${esc(pick(s.heading))}</a>`).join('');
  toc.querySelectorAll('.toc-link').forEach(a=>{
    a.onclick=()=>document.getElementById(a.dataset.target)?.scrollIntoView({behavior:'smooth',block:'start'});
  });
}

/* ---- 国学 classic renderer ---- */
let nodeSeq=0;
function renderNode(node, depth){
  const kids=node.children||[];
  const hasKids=kids.length>0;
  const uid='n'+(nodeSeq++);
  const tags=[];
  if(node.yuanwen) tags.push('原文');
  if(node.baihua) tags.push('白话');
  const tagHtml = hasKids ? `<span class="node-tag">${kids.length} 篇</span>`
    : (tags.length?`<span class="node-tag has">${tags.join(' · ')}</span>`:'');
  let h=`<div class="node ${hasKids?'node-branch':'node-leaf'}" id="${uid}">
    <div class="node-row"><span class="node-caret">▶</span><span class="node-title">${esc(node.title||'')}</span>${tagHtml}</div>`;
  if(hasKids){
    h+=`<div class="node-children">${kids.map(k=>renderNode(k,depth+1)).join('')}</div>`;
  }else{
    h+=`<div class="node-detail">${renderTabs(node,uid)}</div>`;
  }
  h+=`</div>`;
  return h;
}
function renderTabs(node,uid){
  const tabs=[];
  if(node.summary_md) tabs.push({k:'daodu',label:'📖 精华导读',html:`<div class="md">${renderMarkdown(node.summary_md)}</div>`});
  if(node.yuanwen) tabs.push({k:'yuanwen',label:'📜 原文',html:`<div class="yuanwen">${esc(node.yuanwen)}</div>`});
  if(node.baihua) tabs.push({k:'baihua',label:'💬 白话',html:`<div class="baihua">${esc(node.baihua)}</div>`});
  if(node.zhushi) tabs.push({k:'zhushi',label:'✏️ 注释',html:`<div class="zhushi">${esc(node.zhushi)}</div>`});
  if(!tabs.length) return '';
  const src = state.data.meta && state.data.meta.source_url;
  const bar=tabs.map((t,i)=>`<button class="tab-btn${i===0?' active':''}" data-tab="${uid}-${t.k}">${t.label}</button>`).join('');
  const panels=tabs.map((t,i)=>`<div class="tab-panel${i===0?' active':''}" id="${uid}-${t.k}">${t.html}${(t.k==='yuanwen'&&src)?`<div class="tab-src">全文查证：<a href="${esc(src)}" target="_blank" rel="noopener">${esc(src)}</a></div>`:''}</div>`).join('');
  return `<div class="tabs"><div class="tab-bar">${bar}</div>${panels}</div>`;
}
function renderClassic(){
  const d=state.data, m=d.meta||{};
  let h=`<article class="article classic">
    <header class="bookhead">
      ${m.category?`<span class="bh-cat">${esc(m.category)}</span>`:''}
      <h1 class="bh-title">${esc(m.title||'')}</h1>
      ${m.alt_title?`<div class="bh-alt">${esc(m.alt_title)}</div>`:''}
      <div class="bh-meta">
        ${m.author?`<span><b>${esc(m.author)}</b></span>`:''}
        ${m.dynasty?`<span>🏛️ ${esc(m.dynasty)}</span>`:''}
        ${m.words?`<span>📏 ${esc(m.words)}</span>`:''}
        ${m.source_url?`<span>🔗 <a href="${esc(m.source_url)}" target="_blank" rel="noopener">免费全文</a></span>`:''}
      </div>
      ${m.one_liner?`<div class="bh-oneliner">${renderMarkdown(m.one_liner)}</div>`:''}
    </header>`;
  if(d.essence_md){
    h+=`<div class="section-label"><h2 class="sl-h">📚 精华总述</h2><span class="sl-line"></span></div><div class="md">${renderMarkdown(d.essence_md)}</div>`;
  }
  if(d.mindmap){
    h+=`<div class="mermaid-wrap"><pre class="mermaid">${esc(sanitizeMermaid(d.mindmap.trim()))}</pre></div>`;
  }
  if(d.nodes&&d.nodes.length){
    nodeSeq=0;
    h+=`<div class="section-label"><h2 class="sl-h">🗂️ 逐层研读</h2><span class="sl-line"></span></div>
        <div class="tree">${d.nodes.map(n=>renderNode(n,0)).join('')}</div>`;
  }
  h+=`</article>`;
  $('#content').innerHTML=h;
  $('#crumb').innerHTML=`<b>${esc(m.title||'')}</b>${m.author?' · '+esc(m.author):''}`;
  bindTree();
  buildClassicToc();
  runMermaid($('#content'));
  $('#content').scrollTop=0;
}
function buildClassicToc(){
  const tops=[...document.querySelectorAll('#content .tree > .node')];
  const toc=$('#toc');
  if(!tops.length){ toc.innerHTML=''; return; }
  toc.innerHTML=`<div class="toc-title">篇目</div>`+
    tops.map(n=>{const t=n.querySelector('.node-title')?.textContent||'';return `<a class="toc-link" data-target="${n.id}">${esc(t)}</a>`;}).join('');
  toc.querySelectorAll('.toc-link').forEach(a=>{
    a.onclick=()=>{
      const n=document.getElementById(a.dataset.target);
      if(n){ n.classList.add('open'); runMermaid(n); n.scrollIntoView({behavior:'smooth',block:'start'}); }
    };
  });
}
function bindTree(){
  $('#content').querySelectorAll('.node-row').forEach(row=>{
    row.onclick=(e)=>{
      if(e.target.closest('.tab-bar')) return;
      const node=row.parentElement;
      node.classList.toggle('open');
      if(node.classList.contains('open')) runMermaid(node);
    };
  });
  $('#content').querySelectorAll('.tab-btn').forEach(btn=>{
    btn.onclick=(e)=>{
      e.stopPropagation();
      const tabs=btn.closest('.tabs');
      tabs.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      tabs.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      const panel=document.getElementById(btn.dataset.tab);
      panel.classList.add('active');
      runMermaid(panel);
    };
  });
}

/* scrollspy (books only) */
function initScrollSpy(){
  const c=$('#content');
  c.addEventListener('scroll',()=>{
    if(state.classic) return;
    const secs=[...c.querySelectorAll('.section')];
    let cur=secs[0];
    for(const s of secs){ if(s.getBoundingClientRect().top<160) cur=s; }
    document.querySelectorAll('.toc-link').forEach(a=>
      a.classList.toggle('active', cur && a.dataset.target===cur.id));
  },{passive:true});
}

/* ---- lang ---- */
function updateLangButtons(){
  document.querySelectorAll('#langToggle button').forEach(b=>
    b.classList.toggle('active',b.dataset.lang===state.lang));
}
function setLang(l){
  if(state.data && state.data.bilingual===false) return;
  state.lang=l; localStorage.setItem('rn-lang',l);
  document.body.dataset.lang=l; updateLangButtons();
  buildSidebar($('#search').value);
  if(state.data) renderBook();
}

/* ---- events ---- */
$('#langToggle').addEventListener('click',e=>{const b=e.target.closest('button');if(b)setLang(b.dataset.lang);});
$('#search').addEventListener('input',e=>buildSidebar(e.target.value));
$('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('hidden'));
$('#tocBtn').addEventListener('click',()=>{const t=$('#toc');t.style.display=t.style.display==='none'?'':'none';});

document.body.dataset.lang=state.lang;
updateLangButtons();
initScrollSpy();
loadManifest();
