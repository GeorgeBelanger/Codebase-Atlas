// View projection only: original graph, measured counts and journeys stay intact.
let collapsedGroups=new Set(),reviewScope=review?'changes':'whole',showContext=true;
let layoutMode='auto',scopeIds=null;
let layoutScene=[],layoutCache=new Map();
function componentChange(n){
  if(!review)return null;
  if(n.memberIds){const statuses=n.memberIds.map(id=>review.nodes[id]?.status);return statuses.some(Boolean)?(statuses.every(s=>s===statuses[0])?statuses[0]:'modified'):null;}
  return review.nodes[n.id]?.status||n.reviewStatus||null;
}
function scopeIncludes(id){return !scopeIds||scopeIds.has(id);}
function rebuildView(refit=true){
  const changed=new Set(Object.keys(review?.nodes||{}));
  for(const e of review?.edges||[]){changed.add(e.from);changed.add(e.to);}
  for(const e of review?.evidence||[]){if(e.type==='node')changed.add(e.node);else{changed.add(e.from);changed.add(e.to);}}
  scopeIds=null;
  if(review&&reviewScope==='changes'){
    scopeIds=new Set(changed);
    if(showContext)for(const e of sourceEdges){if(changed.has(e[0]))scopeIds.add(e[1]);if(changed.has(e[1]))scopeIds.add(e[0]);}
  }
  const key=JSON.stringify([layoutMode,[...collapsedGroups].sort()]);
  let full=layoutCache.get(key);
  if(!full){const projected=AtlasGraph.collapse(sourceNodes,sourceEdges,[...collapsedGroups]);
    const nodes=layoutMode==='auto'?AtlasGraph.layout(projected.nodes,projected.edges):projected.nodes;
    full={nodes,edges:AtlasGraph.route(nodes,projected.edges)};layoutCache.set(key,full);}
  layoutScene=full.nodes;
  const nodes=full.nodes.filter(n=>n.memberIds?n.memberIds.some(scopeIncludes):scopeIncludes(n.id));
  const ids=new Set(nodes.map(n=>n.id));
  const projected={nodes,edges:full.edges.filter(e=>ids.has(e[0])&&ids.has(e[1]))};
  for(const n of projected.nodes)if(n.memberIds){n.n=G[n.g].n;n.d=G[n.g].s;n.c=String(n.memberIds.length);n.t=n.memberIds.length+' components · click to expand';}
  const positioned=projected.nodes;
  N.splice(0,N.length,...positioned);E.splice(0,E.length,...projected.edges.map(e=>Object.assign([...e],e,{t:0})));
  for(const id of Object.keys(byId))delete byId[id];for(const n of N)byId[n.id]=n;
  if(sel&&!byId[sel])sel=null;
  hov=null;hoverEdge=null;selectedEdge=null;liveEdge=null;
  const mode=document.getElementById('review-scope');if(mode)mode.value=reviewScope;
  rail.querySelectorAll('.group-toggle').forEach(b=>{
    const closed=collapsedGroups.has(b.dataset.g);b.setAttribute('aria-expanded',String(!closed));
    b.setAttribute('aria-label',(closed?'Expand ':'Collapse ')+G[b.dataset.g].n);
    b.lastElementChild.textContent=sourceNodes.filter(n=>n.g===b.dataset.g&&scopeIncludes(n.id)).length+(closed?' ▸':' ▾');
  });
  filterBlocks();
  rail.querySelectorAll('.item').forEach(b=>{if(collapsedGroups.has(b.dataset.g))b.style.display='none';});
  document.getElementById('focus-node').disabled=!sel;
  document.getElementById('view-empty').hidden=N.length>0;
  const routeWarning=document.getElementById('route-warning');routeWarning.hidden=!E.some(e=>e.unroutable);routeWarning.textContent='Some connections cannot be routed in this layout. Try Automatic layout.';
  if(refit)fit();showEdge();
}
function expandGroup(g){collapsedGroups.delete(g);rebuildView();render();}
function revealNode(id){
  if(byId[id])return;
  const n=sourceNodes.find(n=>n.id===id);if(!n)return;
  collapsedGroups.delete(n.g);if(!scopeIncludes(id))reviewScope='whole';rebuildView(false);
}
function resetExplorer(){stop();step=-1;complete=false;active=new Set();visited={};sel=null;cap.classList.remove('on');syncJourney();}
function reviewURL(){
  try{const u=new URL(review?.prUrl);if(u.protocol==='https:'&&!u.username&&!u.password&&u.hostname==='github.com'&&/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(u.pathname))return u.href.replace(/\/$/,'')+'/files';}catch{}
  return null;
}
function reviewSummaryHTML(){
  if(!review)return '';
  const files=review.files||[],url=reviewURL();
  return `<section class="review-summary"><div class="eyebrow">PULL REQUEST REVIEW</div><h2>What changed</h2>
    <p>${files.length} changed files · ${Object.keys(review.nodes).length} affected components</p>
    <div class="sub">${esc(review.mergeBase.slice(0,8))} → ${esc(review.head.slice(0,8))}</div>
    <p class="change-key"><span style="color:#218763">＋ Added</span> &nbsp; <span style="color:#AD7519">~ Modified</span> &nbsp; <span style="color:#C74764">− Removed</span><br>Unmarked blocks provide dependency context.</p>
    ${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open pull request diff ↗</a>`:''}
    <div class="review-components">${Object.entries(review.nodes).map(([id,entry])=>`<button class="link" data-review-node="${esc(id)}"><span class="change-chip ${esc(entry.status)}">${esc(entry.status)}</span>${esc(sourceNodes.find(n=>n.id===id)?.n||id)}</button>`).join('')}</div>
    <details><summary>All changed files (${files.length})</summary>${reviewFilesHTML(files)}</details>
    ${reviewEvidenceHTML(review.evidence||[])}
    ${review.edges?.length?`<details open><summary>Changed connections (${review.edges.length})</summary>${review.edges.map(e=>`<div class="review-file">${esc(e.status)} · ${esc(e.from)} → ${esc(e.to)}</div>`).join('')}</details>`:''}
    ${review.unmapped?.length?`<details open><summary>${review.unmapped.length} unmapped files</summary><p>These changes are not assigned to an atlas component.</p>${review.unmapped.map(p=>`<div class="review-file">${esc(p)}</div>`).join('')}</details>`:''}
    <p class="sub">File impact is measured by Git. Connection changes require a baseline atlas. Verify architectural claims against the diff.</p></section>`;
}
function reviewFilesHTML(files){return files.map(f=>`<div class="review-file"><b>${esc(f.status)}</b> ${f.oldPath?esc(f.oldPath)+' → ':''}${esc(f.path)}<span>${f.additions===null?'binary':`+${Number(f.additions)} −${Number(f.deletions)}`}</span></div>`).join('');}
function reviewNodeHTML(n){
  const status=componentChange(n),hits=(review?.evidence||[]).filter(e=>e.node===n.id||e.from===n.id||e.to===n.id);if(!status&&!hits.length)return '';
  const paths=new Set(review.nodes[n.id]?.files||[]),files=review.files.filter(f=>paths.has(f.path)||paths.has(f.oldPath));
  return `<section class="review-summary">${status?`<span class="change-chip ${esc(status)}">${esc(status)}</span>`:''}
    <p>${status==='removed'?'Historical component from the baseline atlas.':files.length?'Changed-file ownership: files mapped to this component changed.':'This component has a cited connection touched by changed lines.'}</p>${reviewFilesHTML(files)}${reviewEvidenceHTML(hits)}</section>`;
}
function reviewEvidenceHTML(hits){
  if(!review)return '';
  const availability=review.evidenceStatus||{};
  const availabilityText=['head','base'].map(side=>`${side==='head'?'Head':'Baseline'} citations: ${availability[side]==='available'?'checked':'not checked (no matching versioned atlas)'}`).join(' · ');
  return `<details class="review-evidence" ${hits.length?'open':''}><summary>${hits.length?hits.length+' cited ranges touched':'Changed-line evidence'}</summary>
    <p class="sub">${esc(availabilityText)}</p>${hits.length?hits.map(e=>`<div class="review-file"><b>${e.type==='edge'?'Connection '+esc(e.from)+' → '+esc(e.to):'Component '+esc(e.node)}</b><br>${esc(e.path)}:${e.startLine}${e.endLine?'-'+e.endLine:''} · ${esc(e.side)}${e.symbol?' · '+esc(e.symbol):''}</div>`).join(''):'<p>No overlap found in the available versioned citations. File ownership alone does not establish that a cited function changed.</p>'}
    ${hits.length?'<p class="sub">Changed lines overlap these citations; this flags evidence to review, not a proven behavioral change.</p>':''}</details>`;
}
function bindReviewLinks(){pbody.querySelectorAll('[data-review-node]').forEach(b=>b.addEventListener('click',()=>inspect(b.dataset.reviewNode)));}
function initExplorer(){
  const controls=document.createElement('div');controls.className='explorer-controls';controls.innerHTML=`
    <label>Layout <select id="layout-mode" aria-label="Map layout"><option value="auto">Automatic</option><option value="authored">Authored</option></select></label>
    <button class="rbtn" id="collapse-groups">System overview</button><button class="rbtn" id="expand-groups">All components</button>
    ${review?`<label>Review <select id="review-scope" aria-label="Review scope"><option value="changes">PR changes</option><option value="whole">Whole codebase</option></select></label><label><input id="review-context" type="checkbox" checked> Dependency context</label><button class="rbtn" id="review-summary">Review summary</button>`:''}`;
  document.querySelector('.stage').prepend(controls);
  const empty=document.createElement('div');empty.id='view-empty';empty.hidden=true;empty.textContent='No mapped component changes. Open the review summary to inspect unmapped files.';document.querySelector('.stage').append(empty);
  const warning=document.createElement('div');warning.id='route-warning';warning.hidden=true;document.querySelector('.stage').append(warning);
  document.getElementById('layout-mode').addEventListener('change',e=>{resetExplorer();layoutMode=e.target.value;rebuildView();render();});
  document.getElementById('collapse-groups').addEventListener('click',()=>{resetExplorer();collapsedGroups=new Set(groups);rebuildView();render();});
  document.getElementById('expand-groups').addEventListener('click',()=>{resetExplorer();collapsedGroups.clear();rebuildView();render();});
  rail.querySelectorAll('.group-toggle').forEach(b=>b.addEventListener('click',()=>{resetExplorer();const g=b.dataset.g;collapsedGroups.has(g)?collapsedGroups.delete(g):collapsedGroups.add(g);rebuildView();render();}));
  document.getElementById('review-scope')?.addEventListener('change',e=>{resetExplorer();reviewScope=e.target.value;rebuildView(false);render();});
  document.getElementById('review-context')?.addEventListener('change',e=>{resetExplorer();showContext=e.target.checked;rebuildView(false);render();});
  document.getElementById('review-summary')?.addEventListener('click',()=>{sel=null;render();});
  rebuildView(false);
}
