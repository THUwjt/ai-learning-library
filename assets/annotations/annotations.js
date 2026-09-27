/* Plain-script annotations with optional authenticated cloud synchronization. */
(() => {
  'use strict';
  const script = document.currentScript;
  const guide = script && script.dataset.guide;
  const main = document.querySelector('main');
  if (!guide || !main || document.getElementById('la-panel')) return;
  const KEY = 'learning-annotations:v1:' + guide;
  const DELETE_PREFIX = KEY + ':deleted:';
  let localBase = [], transientDeletes = Object.create(null);
  const excluded = '.la-ui,script,style,svg,math,.katex,.paper-equation,.paper-inline,input,textarea,button,select,output,[contenteditable]';
  const MAX_NOTES = 2000, MAX_QUOTE = 12000, MAX_COMMENT = 20000;
  let notes = [], pending = null, editing = null, editingVersion = null, active = null, locations = new Map();
  let storageOK = true, readFailure = false, toastTimer;
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(text, fn, cls) {
    const n = el('button', cls, text); n.type = 'button'; n.addEventListener('click', fn); return n;
  }
  function uid() { return 'n-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)); }
  const toggle = button('Notes (0)', () => setOpen(panel.hidden), 'la-ui la-primary');
  toggle.id = 'la-toggle'; toggle.setAttribute('aria-controls', 'la-panel'); toggle.setAttribute('aria-expanded', 'false');
  const panel = el('aside', 'la-ui'); panel.id = 'la-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Reading annotations');
  const headingRow = el('div', 'la-row la-head');
  const heading = el('h2', '', 'Reading notes'); heading.tabIndex = -1;
  const close = button('Close', () => setOpen(false)); close.setAttribute('aria-label', 'Close reading notes'); headingRow.append(heading, close);
  const help = el('p', 'la-help', 'Select a passage, then choose “Annotate”. Click a yellow highlight to read its notes. Select prose or table text; rendered equations are left intact. Comments stay in this browser; export a backup to keep or move them.');
  const status = el('p', 'la-status'); status.setAttribute('role', 'status');
  const backupRow = el('div', 'la-row');
  const exportButton = button('Export JSON', exportNotes);
  const importButton = button('Import JSON', () => fileInput.click());
  const fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
  backupRow.append(exportButton, importButton, fileInput);
  const storageHelp = el('p', 'la-help', 'Local-file storage can vary in Safari. Export before moving the HTML, clearing browser data, or switching browsers. Annotations do not modify the original HTML file.');
  const search = el('input'); search.id = 'la-search'; search.type = 'search'; search.placeholder = 'Search notes and quoted text'; search.setAttribute('aria-label', 'Search annotations');
  const editor = el('form'); editor.id = 'la-editor'; editor.hidden = true;
  const editorTitle = el('h3', '', 'New annotation');
  const editorQuote = el('blockquote', 'la-quote');
  const label = el('label', '', 'Your comment'); label.htmlFor = 'la-comment';
  const comment = el('textarea'); comment.id = 'la-comment'; comment.maxLength = MAX_COMMENT; comment.required = true; comment.placeholder = 'A question, explanation, or connection…';
  const editorActions = el('div', 'la-row');
  const save = el('button', 'la-primary', 'Save note'); save.type = 'submit';
  const cancel = button('Cancel', clearEditor); editorActions.append(save, cancel);
  editor.append(editorTitle, editorQuote, label, comment, editorActions);
  const list = el('div'); list.id = 'la-list';
  panel.append(headingRow, help, status, backupRow, storageHelp, editor, search, list);
  const toolbar = button('＋ Annotate', beginNote, 'la-ui la-primary'); toolbar.id = 'la-toolbar'; toolbar.hidden = true;
  // Keep the document selection when clicking the floating selection action.
  toolbar.addEventListener('mousedown', e => e.preventDefault());
  const toast = el('div', 'la-ui'); toast.id = 'la-toast'; toast.hidden = true; toast.setAttribute('role', 'status');
  document.body.append(toggle, panel, toolbar, toast);
  const intro = el('div', 'la-ui la-intro');
  intro.append(el('p', '', 'New: select text to highlight it and add a reading note. Your notes appear in the bottom-right “Notes” panel.'), button('Open reading notes', () => setOpen(true)));
  const masthead = main.querySelector('.masthead');
  if (masthead) masthead.after(intro); else main.prepend(intro);

  function notify(message) {
    toast.textContent = message; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 5500);
  }
  function setOpen(open) {
    panel.hidden = !open; toggle.hidden = open; toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('la-panel-open', open);
    toolbar.hidden = true;
    if (open) { renderList(); if (editor.hidden) heading.focus(); }
    else toggle.focus();
  }
  function storageStatus(message) {
    status.dataset.warning = String(!storageOK || readFailure);
    status.textContent = message || (readFailure ? 'Existing saved data could not be read. It has not been overwritten. Export your current notes before closing.' : storageOK ? 'Local saving is available. Saved notes are restored when this file is reopened here.' : 'Browser saving is unavailable. Notes are kept for this tab only—export JSON before closing.');
  }
  function validNote(n) {
    return n && typeof n.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(n.id) &&
      typeof n.comment === 'string' && n.comment.length <= MAX_COMMENT &&
      n.anchor && typeof n.anchor.exact === 'string' && n.anchor.exact.trim().length > 0 && n.anchor.exact.length <= MAX_QUOTE &&
      Number.isSafeInteger(n.anchor.start) && n.anchor.start >= 0 &&
      Number.isSafeInteger(n.anchor.end) && n.anchor.end === n.anchor.start + n.anchor.exact.length &&
      typeof n.anchor.prefix === 'string' && n.anchor.prefix.length <= 80 &&
      typeof n.anchor.suffix === 'string' && n.anchor.suffix.length <= 80 &&
      typeof n.created === 'string' && Number.isFinite(Date.parse(n.created)) &&
      typeof n.updated === 'string' && Number.isFinite(Date.parse(n.updated));
  }
  function cleanNote(n) { // Import only known data fields; never insert user text as HTML.
    return { id:n.id, comment:n.comment, anchor:{start:n.anchor.start,end:n.anchor.end,exact:n.anchor.exact,prefix:n.anchor.prefix,suffix:n.anchor.suffix}, created:n.created,updated:n.updated };
  }
  function parseBackup(raw) {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || data.guide !== guide || !Array.isArray(data.notes) || data.notes.length > MAX_NOTES || !data.notes.every(validNote) || new Set(data.notes.map(n=>n.id)).size !== data.notes.length) throw new Error('This is not a valid annotation backup for this guide.');
    return data.notes.map(cleanNote);
  }
  function payload() { return JSON.stringify({version:1,guide,title:document.title,exported:new Date().toISOString(),notes}, null, 2); }
  function sameNote(a,b) { return JSON.stringify(a ? cleanNote(a) : null) === JSON.stringify(b ? cleanNote(b) : null); }
  function deleteIntents() {
    const found=Object.assign(Object.create(null),transientDeletes);
    for(let i=0;i<localStorage.length;i++) {
      const key=localStorage.key(i);if(!key||!key.startsWith(DELETE_PREFIX))continue;
      const value=JSON.parse(localStorage.getItem(key));
      if(!value||typeof value.token!=='string'||!validNote(value.previous))throw new Error('Unreadable deletion metadata.');
      found[key.slice(DELETE_PREFIX.length)]=value;
    }
    return found;
  }
  function acknowledgeDelete(id,token) {
    const key=DELETE_PREFIX+id,raw=localStorage.getItem(key);
    if(raw&&JSON.parse(raw).token===token)localStorage.removeItem(key);
    if(transientDeletes[id]&&transientDeletes[id].token===token)delete transientDeletes[id];
  }
  function requestDelete(n) {
    const intent={token:uid(),previous:cleanNote(n)};
    transientDeletes[n.id]=intent;
    try {localStorage.setItem(DELETE_PREFIX+n.id,JSON.stringify(intent));}
    catch(_){storageOK=false;}
  }
  function refreshLocal() {
    const raw=localStorage.getItem(KEY);
    if(raw){notes=parseBackup(raw);localBase=notes.map(cleanNote);}
    return notes.map(cleanNote);
  }
  function persist() {
    if (!readFailure) {
      try {
        const raw=localStorage.getItem(KEY),latest=raw?parseBackup(raw):[];
        const merged=new Map(latest.map(n=>[n.id,n]));
        const deletions=deleteIntents();
        // Only explicit deletions remove a saved note. An absent stale-tab note is never a delete.
        for(const [id,intent] of Object.entries(deletions)) {
          const latestNote=merged.get(id);
          if(!latestNote||sameNote(latestNote,intent.previous))merged.delete(id);
        }
        for(const n of notes) {
          const old=localBase.find(x=>x.id===n.id),saved=merged.get(n.id);
          if(sameNote(n,old))continue;
          if(deletions[n.id])acknowledgeDelete(n.id,deletions[n.id].token);
          if(saved&&old&&!sameNote(saved,old)&&!sameNote(saved,n)){
            const copy=cleanNote(n);copy.id=uid();merged.set(copy.id,copy);
            notify('Another tab edited this note. Both versions were preserved.');
          }else merged.set(n.id,cleanNote(n));
        }
        if(merged.size>MAX_NOTES)throw new Error('Too many merged notes.');
        notes=[...merged.values()];localStorage.setItem(KEY, payload());localBase=notes.map(cleanNote);storageOK = true;
      }
      catch (_) { storageOK = false; }
    }
    storageStatus();
    if (window.LearningAnnotationCloud) window.LearningAnnotationCloud.changed();
  }
  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
      // Probe a separate key, never overwrite the existing annotation data.
      const probe = KEY + ':probe'; localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
    } catch (_) { storageOK = false; }
    if (raw) { try { notes = parseBackup(raw); } catch (_) { readFailure = true; } }
    localBase=notes.map(cleanNote);storageStatus();
  }
  function indexText() {
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode(node) { return node.parentElement && !node.parentElement.closest(excluded) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
    });
    const entries = []; let text = '', node;
    while ((node = walker.nextNode())) { const start = text.length; text += node.data; entries.push({node,start,end:text.length}); }
    return {text,entries};
  }
  function resolve(anchor, text) {
    if (text.slice(anchor.start, anchor.end) === anchor.exact &&
      (!anchor.prefix || text.slice(Math.max(0,anchor.start-anchor.prefix.length),anchor.start) === anchor.prefix) &&
      (!anchor.suffix || text.slice(anchor.end,anchor.end+anchor.suffix.length) === anchor.suffix)) return {start:anchor.start,end:anchor.end};
    // If text moved, require a unique quoted passage or unique matching context.
    const candidates = []; let pos = text.indexOf(anchor.exact);
    while (pos !== -1 && candidates.length < 1000) { candidates.push(pos); pos = text.indexOf(anchor.exact, pos + 1); }
    if (candidates.length === 1) return {start:candidates[0],end:candidates[0]+anchor.exact.length};
    const contextual = candidates.filter(p => (!anchor.prefix || text.slice(Math.max(0,p-anchor.prefix.length),p) === anchor.prefix) && (!anchor.suffix || text.slice(p+anchor.exact.length,p+anchor.exact.length+anchor.suffix.length) === anchor.suffix));
    if (contextual.length === 1) return {start:contextual[0],end:contextual[0]+anchor.exact.length};
    return null; // Keep unmatched notes in the sidebar; never guess a repeated passage.
  }
  function paint() {
    main.querySelectorAll('mark.la-highlight').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
    main.normalize();
    const {text,entries} = indexText(); locations = new Map(notes.map(n => [n.id,resolve(n.anchor,text)]));
    const ranges = notes.map(n=>({id:n.id,...locations.get(n.id)})).filter(r=>Number.isInteger(r.start));
    for (const e of entries) {
      const overlaps = ranges.filter(r=>r.start < e.end && r.end > e.start);
      if (!overlaps.length) continue;
      const cuts = [...new Set([0,e.node.length,...overlaps.flatMap(r=>[Math.max(0,r.start-e.start),Math.min(e.node.length,r.end-e.start)])])].sort((a,b)=>a-b);
      const fragment = document.createDocumentFragment();
      for (let i=0;i<cuts.length-1;i++) {
        const start=cuts[i],end=cuts[i+1]; if (start===end) continue;
        const ids=overlaps.filter(r=>r.start<e.start+end && r.end>e.start+start).map(r=>r.id);
        const value=e.node.data.slice(start,end);
        if (!ids.length) fragment.append(document.createTextNode(value));
        else {const m=el('mark','la-highlight',value);m.dataset.noteIds=ids.join(' ');m.title='Click to read annotation'+(ids.length>1?'s':'');if(ids.includes(active))m.classList.add('la-active');fragment.append(m);}
      }
      e.node.replaceWith(fragment);
    }
    toggle.textContent='Notes ('+notes.length+')';
  }
  function focusNote(id, jump) {
    active=id; search.value=''; setOpen(true); renderList();
    main.querySelectorAll('mark.la-highlight').forEach(m=>m.classList.toggle('la-active',m.dataset.noteIds.split(' ').includes(id)));
    const marks=[...main.querySelectorAll('mark.la-highlight')].filter(m=>m.dataset.noteIds.split(' ').includes(id));
    if (jump && marks.length) {
      for(let p=marks[0].parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
      marks[0].scrollIntoView({behavior:'smooth',block:'center'});
    }
    const card = [...list.children].find(c=>c.dataset.id===id);
    if (card) {card.scrollIntoView({block:'nearest'});card.focus({preventScroll:true});}
  }
  function renderList() {
    list.replaceChildren(); const query=search.value.toLocaleLowerCase().trim();
    const shown=notes.filter(n=>(n.comment+' '+n.anchor.exact).toLocaleLowerCase().includes(query)).sort((a,b)=>a.anchor.start-b.anchor.start);
    if(!shown.length)list.append(el('p','la-help',notes.length?'No matching notes.':'No notes yet. Select a passage in the guide, then click “Annotate”.'));
    for (const n of shown) {
      const card=el('article','la-note');card.dataset.id=n.id;card.dataset.active=String(n.id===active);card.tabIndex=-1;
      const quote=el('blockquote','la-quote',n.anchor.exact),body=el('p','la-comment',n.comment);
      const meta=el('p','la-meta',new Date(n.updated).toLocaleString());
      card.append(quote,body,meta);
      if(!locations.get(n.id))card.append(el('p','la-help','Passage not found in this version. Your comment is preserved.'));
      const actions=el('div','la-row');
      const jump=button('Go to text',()=>focusNote(n.id,true));jump.disabled=!locations.get(n.id);
      const edit=button('Edit',()=>{editing=n.id;editingVersion=cleanNote(n);pending=n.anchor;editorTitle.textContent='Edit annotation';editorQuote.textContent=n.anchor.exact;comment.value=n.comment;editor.hidden=false;editor.scrollIntoView({block:'nearest'});comment.focus();});
      const remove=button('Delete',()=>{
        actions.replaceChildren(el('span','','Delete this note?'),button('Delete',()=>{requestDelete(n);notes=notes.filter(x=>x.id!==n.id);if(editing===n.id)clearEditor();persist();paint();renderList();notify('Note deleted.');}),button('Keep',renderList));
      });
      actions.append(jump,edit,remove);card.append(actions);list.append(card);
    }
  }
  function clearEditor() { editor.hidden=true;comment.value='';editing=null;editingVersion=null;pending=null;toolbar.hidden=true; }
  function captureSelection() {
    if(!editor.hidden)return;
    const selection=window.getSelection();
    if(!selection || selection.isCollapsed || selection.rangeCount!==1){toolbar.hidden=true;pending=null;return;}
    const range=selection.getRangeAt(0);
    if(!main.contains(range.startContainer)||!main.contains(range.endContainer)){toolbar.hidden=true;pending=null;return;}
    const parent=n=>n.nodeType===1?n:n.parentElement;
    if(parent(range.startContainer).closest(excluded)||parent(range.endContainer).closest(excluded)){toolbar.hidden=true;pending=null;return;}
    const {text,entries}=indexText();let start=null,end=null;
    for(const e of entries){
      if(!range.intersectsNode(e.node))continue;
      let a=e.node===range.startContainer?range.startOffset:0,b=e.node===range.endContainer?range.endOffset:e.node.length;
      // A range can touch but not include a text-node boundary.
      if(a===b)continue;
      if(start===null)start=e.start+a;end=e.start+b;
    }
    if(start===null||end===null){toolbar.hidden=true;return;}
    while(start<end && /\s/.test(text[start]))start++;
    while(end>start && /\s/.test(text[end-1]))end--;
    if(end<=start||end-start>MAX_QUOTE){toolbar.hidden=true;return;}
    pending={start,end,exact:text.slice(start,end),prefix:text.slice(Math.max(0,start-64),start),suffix:text.slice(end,end+64)};
    toolbar.hidden=false;
    const rect=range.getBoundingClientRect();
    toolbar.style.left=Math.max(8,Math.min(innerWidth-toolbar.offsetWidth-8,rect.left))+'px';
    toolbar.style.top=Math.max(8,Math.min(innerHeight-toolbar.offsetHeight-8,rect.bottom+8))+'px';
  }
  function beginNote() {
    if(!pending)return;
    if(notes.length>=MAX_NOTES){notify('This guide has reached its 2,000-note limit. Export a backup before removing notes.');return;}
    const anchor=pending;setOpen(true);pending=anchor;editing=null;
    editorTitle.textContent='New annotation';editorQuote.textContent=anchor.exact;comment.value='';editor.hidden=false;toolbar.hidden=true;
    window.getSelection().removeAllRanges();comment.focus();
  }
  editor.addEventListener('submit',e=>{
    e.preventDefault();if(!pending||!comment.value.trim())return;
    const now=new Date().toISOString();
    if(editing){
      const n=notes.find(n=>n.id===editing);
      if(n&&sameNote(n,editingVersion)){n.comment=comment.value.trim();n.updated=now;active=n.id;}
      else {const copy={id:uid(),anchor:pending,comment:comment.value.trim(),created:editingVersion?editingVersion.created:now,updated:now};notes.push(copy);active=copy.id;notify('This note changed while you were editing. Your version was preserved as a separate note.');}
    }
    else {const n={id:uid(),anchor:pending,comment:comment.value.trim(),created:now,updated:now};notes.push(n);active=n.id;}
    clearEditor();persist();paint();renderList();notify(storageOK&&!readFailure?'Note saved locally.':'Note added to this tab. Export JSON to keep it.');
  });
  function exportNotes() {
    const blob=new Blob([payload()],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');
    a.href=url;a.download=guide+'-annotations-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    notify('Backup download requested. Keep the JSON file to restore your notes.');
  }
  fileInput.addEventListener('change',async()=>{
    const file=fileInput.files[0];if(!file)return;
    try {
      if(file.size>10*1024*1024)throw new Error('The backup is too large (maximum 10 MB).');
      const imported=parseBackup(await file.text());
      const merged=notes.map(cleanNote);let added=0;
      for(const n of imported){
        const old=merged.find(x=>x.id===n.id);
        if(!old){merged.push(n);added++;}
        else if(old.comment!==n.comment||JSON.stringify(old.anchor)!==JSON.stringify(n.anchor)){
          // Preserve both revisions instead of silently replacing a local comment.
          if(!merged.some(x=>x.comment===n.comment && JSON.stringify(x.anchor)===JSON.stringify(n.anchor))){merged.push({...n,id:uid()});added++;}
        }
      }
      if(merged.length>MAX_NOTES)throw new Error('Import would exceed 2,000 notes. Nothing was changed.');
      notes=merged;persist();paint();renderList();notify('Imported '+added+' note'+(added===1?'':'s')+'. Existing comments were preserved.');
    } catch(error){notify(error instanceof SyntaxError?'The selected file is not valid JSON. Nothing was changed.':error.message);}
    fileInput.value='';
  });
  main.addEventListener('click',e=>{
    const mark=e.target.closest('mark.la-highlight');
    if(mark && window.getSelection().isCollapsed){e.preventDefault();focusNote(mark.dataset.noteIds.split(' ')[0],false);}
  });
  document.addEventListener('mouseup',e=>{if(!e.target.closest('.la-ui'))setTimeout(captureSelection,0);});
  document.addEventListener('touchend',e=>{if(!e.target.closest('.la-ui'))setTimeout(captureSelection,120);},{passive:true});
  document.addEventListener('keyup',e=>{if(!e.target.closest('.la-ui'))captureSelection();});
  document.addEventListener('selectionchange',()=>{if(editor.hidden)setTimeout(captureSelection,30);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){toolbar.hidden=true;if(!panel.hidden)setOpen(false);}});
  window.addEventListener('scroll',()=>{toolbar.hidden=true;},{passive:true});
  window.addEventListener('resize',()=>{toolbar.hidden=true;});
  search.addEventListener('input',renderList);
  // Warn only if browser saving is unavailable or there is an unsaved typed comment.
  window.addEventListener('beforeunload',e=>{if(((!storageOK||readFailure)&&notes.length)||(!editor.hidden&&comment.value.trim())){e.preventDefault();e.returnValue='';}});
  window.addEventListener('storage',e=>{
    if(e.key===KEY){try{refreshLocal();paint();renderList();}catch(_){notify('Another tab saved unreadable annotation data. This tab’s notes were preserved.');}}
  });
  load();paint();renderList();
  // Load optional cloud support relative to this component, including on local files.
  const cloudHost = el('div', 'la-cloud');
  status.after(cloudHost);
  window.LearningAnnotationBridge = {
    guide, key:KEY, host:cloudHost, notify,
    read:refreshLocal, valid:validNote,
    deletions:deleteIntents, acknowledgeDelete,
    replace(incoming) {
      if (!Array.isArray(incoming) || incoming.length>MAX_NOTES || !incoming.every(validNote)) throw new Error('Cloud notes failed validation. Local notes were preserved.');
      if (readFailure) throw new Error('Existing local data could not be read; cloud sync is paused.');
      const previous=notes;notes=incoming.map(cleanNote);
      try { localStorage.setItem(KEY,payload());storageOK=true; } catch (_) {notes=previous;storageOK=false;throw new Error('Cannot save merged notes locally. Export a backup.');}
      localBase=notes.map(cleanNote);storageStatus();paint();renderList();
    },
    enableCloudHelp() {
      help.textContent='Select a passage, then choose “Annotate”. Click a highlight to read its notes. Sign in below to synchronize private comments across devices.';
      storageHelp.textContent='Notes are saved locally and, when signed in, synchronized to your account. JSON export is an optional backup. Existing notes in a local HTML file must be imported once into the hosted website.';
    },
    ready:()=>storageOK&&!readFailure
  };
  function loadCloudFile(name, done) {
    if(!script.src)return; // Inline/test embeddings keep the local component usable.
    const node=document.createElement('script');node.src=new URL(name,script.src).href;node.onload=done;document.head.append(node);
  }
  loadCloudFile('cloud-config.js',()=>loadCloudFile('cloud-sync.js',()=>{}));
})();
