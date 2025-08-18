// ===== Pointer-only input (robust for iOS 18.6) =====
const drag = { active:false, pointerId:null, seedIndex:-1, targetColor:null, picked:[], timer:null };

function indexFromPointer(ev){
  const el = ev.target.closest?.('.block');
  if (el && el.parentElement === $row) return +el.dataset.index;
  const rect = $row.getBoundingClientRect();
  if (ev.clientX == null) return -1;
  if (ev.clientY < rect.top || ev.clientY > rect.bottom) return -1;
  const colW = rect.width / state.blockRow.length;
  const idx = Math.floor((ev.clientX - rect.left) / colW);
  return (idx < 0 || idx >= state.blockRow.length) ? -1 : idx;
}
function showPreview(indices, seedIndex){
  for (const el of $row.children) el.classList.remove('preview','preview-core');
  for (const i of indices) $row.children[i].classList.add('preview');
  if (seedIndex >= 0) $row.children[seedIndex].classList.add('preview-core');
}
function clearPreview(){ for (const el of $row.children) el.classList.remove('preview','preview-core'); }
function stopTimer(){ if (drag.timer){ clearTimeout(drag.timer); drag.timer=null; } }

function commitDrag(){
  if (!drag.active) return;
  stopTimer();
  clearPreview();

  if (state.running){
    for (const i of drag.picked){ state.blockRow[i] = null; renderBlock(i); }
    compactRow();
    castSkill(drag.targetColor, drag.picked.length);
    if (navigator.vibrate) try{ navigator.vibrate(8); }catch{}
  }

  drag.active=false; drag.pointerId=null; drag.seedIndex=-1; drag.picked=[];
}

// start
$row.addEventListener('pointerdown', (ev)=>{
  if (!state.running) return;
  if (drag.active) return; // ignore multi-finger
  drag.pointerId = ev.pointerId;

  const idx = indexFromPointer(ev);
  if (idx < 0 || !state.blockRow[idx]) return;

  drag.active = true;
  drag.seedIndex = idx;
  drag.targetColor = targetColorAtIndex(idx);
  drag.picked = buildComboFromSeed(idx, drag.targetColor, 3);
  showPreview(drag.picked, drag.seedIndex);

  // failsafe commit if no pointerup (Safari bug)
  stopTimer();
  drag.timer = setTimeout(commitDrag, 300);

  ev.preventDefault();
}, { passive:false });

// move
$row.addEventListener('pointermove', (ev)=>{
  if (!drag.active) return;
  if (!state.running) { clearPreview(); return; }
  if (!state.blockRow[drag.seedIndex]) { clearPreview(); return; }

  stopTimer(); drag.timer = setTimeout(commitDrag, 300);

  drag.targetColor = targetColorAtIndex(drag.seedIndex);
  drag.picked = buildComboFromSeed(drag.seedIndex, drag.targetColor, 3);
  showPreview(drag.picked, drag.seedIndex);

  ev.preventDefault();
}, { passive:false });

// end + fallbacks
$row.addEventListener('pointerup', commitDrag, { passive:false });
$row.addEventListener('pointerleave', commitDrag, { passive:true });
$row.addEventListener('pointerout', (ev)=>{
  if (!ev.relatedTarget || !ev.currentTarget.contains(ev.relatedTarget)) commitDrag();
}, { passive:true });
window.addEventListener('pointerup', commitDrag, { passive:true });
window.addEventListener('pointercancel', commitDrag, { passive:true });
