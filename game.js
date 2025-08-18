/* Rogue Blocks – Clean HUD (Bugfix: no click double-fire, pointer-only input)
   - Tap & drag handled with pointer events only
   - No click handler at all (prevents iOS double-consume)
   - Stable contiguous combos (wild doesn't bridge)
   - Multi-wave + rewards unchanged
*/
(() => {
  // ===== Data =====
  const HEROES = {
    knight:{ color:'knight', name:'Knight',
      skills:{
        1:(ctx)=>({type:'dmg', value:scale(ctx,100), text:'Slash'}),
        2:(ctx)=>({type:'dmg_stun', value:scale(ctx,140), stun:2, text:'Shield Bash'}),
        3:(ctx)=>({type:'aoe', value:scale(ctx,180), text:'Whirlwind'}),
      }, hp:320
    },
    mage:{ color:'mage', name:'Mage',
      skills:{
        1:(ctx)=>({type:'dmg', value:scale(ctx,120), text:'Fireball'}),
        2:(ctx)=>({type:'slow', value:scale(ctx,90), duration:4, text:'Ice Spike'}),
        3:(ctx)=>({type:'aoe', value:scale(ctx,220), text:'Meteor'}),
      }, hp:260
    },
    priest:{ color:'priest', name:'Priest',
      skills:{
        1:(ctx)=>({type:'heal_one', value:0.25, text:'Heal'}),
        2:(ctx)=>({type:'heal_all', value:0.15, text:'Group Heal'}),
        3:(ctx)=>({type:'revive', value:0.5, text:'Revive'}),
      }, hp:280
    }
  };
  function scale(ctx, base){ return Math.round(base * ctx.damageAmp); }
  const WAVES = 6;

  // ===== State =====
  const state = {
    blockRow: Array(8).fill(null),   // {kind:'hero'|'wild', heroKey?}
    heroes: [
      { key:'knight', hp:HEROES.knight.hp, max:HEROES.knight.hp },
      { key:'mage',   hp:HEROES.mage.hp,   max:HEROES.mage.hp   },
      { key:'priest', hp:HEROES.priest.hp, max:HEROES.priest.hp },
    ],
    enemy: null,
    wave: 1,
    damageAmp: 1.0,
    spawnEvery: 900,
    pWild: 0.10,
    lastTs: performance.now(),
    blockTimer: 0,
    running: false,
    pendingReward: null
  };

  // ===== DOM =====
  const $hud = document.getElementById('hud');
  const $row = document.getElementById('blockRow');
  const $tpl = document.getElementById('blockTpl');
  const $arena = document.getElementById('arena');
  const $waveLbl = document.getElementById('waveLbl');
  const $enemyName = document.getElementById('enemyName');

  const $startOverlay = document.getElementById('startOverlay');
  const $rewardOverlay = document.getElementById('rewardOverlay');
  const $endOverlay = document.getElementById('endOverlay');
  const $endTitle = document.getElementById('endTitle');
  const $endText = document.getElementById('endText');

  const $btnStart = document.getElementById('btnStart');
  const $btnNextWave = document.getElementById('btnNextWave');
  const $btnRestart = document.getElementById('btnRestart');

  // Settings
  const $drawer = document.getElementById('drawer');
  const $btnSettings = document.getElementById('btnSettings');
  const $btnCloseDrawer = document.getElementById('btnCloseDrawer');
  const $rate = document.getElementById('rate');
  const $rateOut = document.getElementById('rateOut');
  const $pWild = document.getElementById('pWild');
  const $pWildOut = document.getElementById('pWildOut');

  // Tips
  const $tipOverlay = document.getElementById('tipOverlay');
  const $btnTip = document.getElementById('btnTip');
  const $btnCloseTip = document.getElementById('btnCloseTip');

  // ===== Build row (no click listeners at all) =====
  for (let i=0;i<state.blockRow.length;i++){
    const node = $tpl.content.firstElementChild.cloneNode(true);
    node.dataset.index = i;
    // we’ll handle taps & drags via pointer events on the row
    $row.appendChild(node);
  }

  // ===== Init UI =====
  for (const h of document.querySelectorAll('.hero')) setHeroHP(h.dataset.hero,1);
  setEnemyHP(1);
  linkSettings();
  updateWaveUI();

  // ===== Overlay & Drawer =====
  $btnStart.addEventListener('click', startRun);
  $btnRestart.addEventListener('click', ()=>{ hide($endOverlay); show($startOverlay); showHUD(false); });
  $btnNextWave.addEventListener('click', ()=>{
    if (state.pendingReward) applyReward(state.pendingReward);
    state.pendingReward = null;
    hide($rewardOverlay); showHUD(true); nextWave();
  });
  document.querySelectorAll('.reward').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.reward').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      state.pendingReward = btn.dataset.reward;
    });
  });

  $btnSettings.addEventListener('click', ()=> $drawer.classList.add('open'));
  $btnCloseDrawer.addEventListener('click', ()=> $drawer.classList.remove('open'));
  $btnTip.addEventListener('click', ()=> show($tipOverlay));
  $btnCloseTip.addEventListener('click', ()=> hide($tipOverlay));

  function linkSettings(){
    $rateOut.textContent = String(state.spawnEvery);
    $pWildOut.textContent = `${Math.round(state.pWild*100)}%`;
    $rate.value = state.spawnEvery;
    $pWild.value = Math.round(state.pWild*100);
    $rate.addEventListener('input', e=>{
      state.spawnEvery = +e.target.value;
      $rateOut.textContent = String(state.spawnEvery);
    });
    $pWild.addEventListener('input', e=>{
      state.pWild = (+e.target.value)/100;
      $pWildOut.textContent = `${e.target.value}%`;
    });
  }

  // ===== Run lifecycle =====
  function startRun(){
    resetRun();
    hide($startOverlay); hide($endOverlay); hide($rewardOverlay); hide($tipOverlay);
    showHUD(true);
    state.running = true;
  }
  function resetRun(){
    state.heroes = [
      { key:'knight', hp:HEROES.knight.hp, max:HEROES.knight.hp },
      { key:'mage',   hp:HEROES.mage.hp,   max:HEROES.mage.hp   },
      { key:'priest', hp:HEROES.priest.hp, max:HEROES.priest.hp },
    ];
    for (const h of state.heroes) setHeroHP(h.key, h.hp/h.max);
    state.blockRow = Array(8).fill(null);
    for (let i=0;i<$row.children.length;i++) renderBlock(i);
    for (let i=0;i<5;i++) spawnOneBlock();

    state.wave = 1; state.damageAmp = 1.0;
    state.enemy = makeEnemy(state.wave); updateWaveUI(); setEnemyHP(1);
    state.blockTimer = 0; state.lastTs = performance.now();
  }
  function nextWave(){
    state.wave++;
    if (state.wave>WAVES){ win(); return; }
    state.enemy = makeEnemy(state.wave); updateWaveUI(); setEnemyHP(1);
    state.blockTimer = 0; state.running = true;
  }
  function win(){
    state.running = false; showHUD(false);
    $endTitle.textContent = 'Victory!';
    $endText.textContent = 'You cleared all waves. GG!';
    show($endOverlay);
  }
  function lose(){
    state.running = false; showHUD(false);
    $endTitle.textContent = 'Defeat';
    $endText.textContent = `You reached Wave ${state.wave}. Try a different reward path!`;
    show($endOverlay);
  }
  function showHUD(flag){ document.getElementById('hud').classList.toggle('hidden', !flag); }

  // ===== Enemy model/UI =====
  function makeEnemy(wave){
    const baseHP = 1400 + (wave-1)*320;
    const atk = 34 + Math.floor((wave-1)*4.5);
    const names = ['Training Dummy','Forest Brute','Sand Golem','Wraith Captain','Warlock','Dragon Whelp'];
    return { name:names[(wave-1)%names.length], hp:baseHP, max:baseHP, atk, stunned:0, slow:0, _atkTimer:0 };
  }
  function updateWaveUI(){ $waveLbl.textContent=`Wave ${Math.min(state.wave,WAVES)}/${WAVES}`; $enemyName.textContent=state.enemy.name; }

  // ===== Blocks =====
  function spawnOneBlock(){
    const idx = state.blockRow.findIndex(x=>x===null);
    if (idx===-1) return false;
    const r = Math.random();
    const item = r < state.pWild
      ? { kind:'wild' }
      : { kind:'hero', heroKey: randomHeroKey() };
    state.blockRow[idx] = item; renderBlock(idx); return true;
  }
  function randomHeroKey(){ const ks = Object.keys(HEROES); return ks[Math.floor(Math.random()*ks.length)]; }

  function renderBlock(i){
    const btn = $row.children[i];
    const item = state.blockRow[i];
    if (!item){ btn.className='block empty'; btn.dataset.type=''; btn.dataset.color=''; btn.querySelector('.glyph').textContent=''; return; }
    btn.className='block'; btn.dataset.type=item.kind; btn.dataset.color=item.heroKey||'';
    btn.querySelector('.glyph').textContent = item.kind==='wild' ? '★' : '';
  }
  function compactRow(){
    const filtered = state.blockRow.filter(Boolean);
    while (filtered.length < state.blockRow.length) filtered.push(null);
    state.blockRow = filtered;
    for (let i=0;i<state.blockRow.length;i++) renderBlock(i);
  }

  // ===== Combo logic (strict contiguous) =====
  function nearestColorForWild(idx){
    const L = state.blockRow[idx-1]; if (L && L.kind==='hero') return L.heroKey;
    const R = state.blockRow[idx+1]; if (R && R.kind==='hero') return R.heroKey;
    // fallback: most common color in row; else knight
    const counts={}; for (const it of state.blockRow) if (it?.kind==='hero') counts[it.heroKey]=(counts[it.heroKey]||0)+1;
    let best=null,max=-1; for (const k in counts) if (counts[k]>max){max=counts[k];best=k;}
    return best || 'knight';
  }
  function canJoin(targetColor, it){
    if (!it) return false;
    if (it.kind==='wild') return true;
    return it.kind==='hero' && it.heroKey===targetColor;
  }
  function buildComboFromSeed(seedIndex, targetColor, maxN=3){
    const arr = state.blockRow;
    const picked = [seedIndex];

    // Expand LEFT
    let l = seedIndex-1;
    while (l>=0 && picked.length<maxN && canJoin(targetColor, arr[l])) { picked.unshift(l); l--; }
    // Expand RIGHT
    let r = seedIndex+1;
    while (r<arr.length && picked.length<maxN && canJoin(targetColor, arr[r])) { picked.push(r); r++; }

    // NOTE: We never skip over mismatches and wilds don't bridge gaps.
    return picked;
  }
  function targetColorAtIndex(idx){
    const it = state.blockRow[idx]; if (!it) return null;
    return it.kind==='hero' ? it.heroKey : nearestColorForWild(idx);
  }

  // ===== Pointer-only input (tap & drag) =====
  const drag={active:false, pointerId:null, seedIndex:-1, targetColor:null, picked:[]};

  function indexFromPointer(ev){
    const el = ev.target.closest?.('.block');
    if (el && el.parentElement===$row) return +el.dataset.index;
    const rect = $row.getBoundingClientRect();
    if (ev.clientX==null) return -1;
    if (ev.clientY<rect.top || ev.clientY>rect.bottom) return -1;
    const colW = rect.width/state.blockRow.length;
    const idx = Math.floor((ev.clientX-rect.left)/colW);
    return (idx<0||idx>=state.blockRow.length)?-1:idx;
  }
  function showPreview(indices, seedIndex){
    for (const el of $row.children) el.classList.remove('preview','preview-core');
    for (const i of indices) $row.children[i].classList.add('preview');
    if (seedIndex>=0) $row.children[seedIndex].classList.add('preview-core');
  }
  function clearPreview(){
    for (const el of $row.children) el.classList.remove('preview','preview-core');
  }

  // Start pointer
  $row.addEventListener('pointerdown', (ev)=>{
    if (!state.running) return;
    // block multitouch / second finger
    if (drag.active) return;
    drag.pointerId = ev.pointerId;

    const idx = indexFromPointer(ev); if (idx<0 || !state.blockRow[idx]) return;

    drag.active=true; drag.seedIndex=idx; drag.targetColor=targetColorAtIndex(idx);
    drag.picked = buildComboFromSeed(idx, drag.targetColor, 3);
    showPreview(drag.picked, drag.seedIndex);

    ev.preventDefault();
    $row.setPointerCapture?.(ev.pointerId);
  });

  // Move pointer
  $row.addEventListener('pointermove', (ev)=>{
    if (!drag.active || ev.pointerId!==drag.pointerId) return;
    if (!state.running) { clearPreview(); return; }
    if (!state.blockRow[drag.seedIndex]) { clearPreview(); return; }

    // keep seed fixed for consistent UX
    drag.targetColor = targetColorAtIndex(drag.seedIndex);
    drag.picked = buildComboFromSeed(drag.seedIndex, drag.targetColor, 3);
    showPreview(drag.picked, drag.seedIndex);
  });

  // End pointer (commit tap/drag)
  $row.addEventListener('pointerup', (ev)=>{
    if (!drag.active || ev.pointerId!==drag.pointerId) return;
    clearPreview();

    if (state.running){
      for (const i of drag.picked){ state.blockRow[i]=null; renderBlock(i); }
      compactRow(); castSkill(drag.targetColor, drag.picked.length);
      if (navigator.vibrate) try{ navigator.vibrate(8); }catch{}
    }

    drag.active=false; drag.pointerId=null; drag.seedIndex=-1; drag.picked=[];
  });

  // Cancel (pointercancel / leaving the row)
  $row.addEventListener('pointercancel', ()=>{
    clearPreview(); drag.active=false; drag.pointerId=null; drag.seedIndex=-1; drag.picked=[];
  });

  // ===== Combat =====
  function castSkill(heroKey, count){
    const hero = HEROES[heroKey];
    const ctx = { damageAmp: state.damageAmp };
    const skill = hero.skills[count](ctx);

    switch(skill.type){
      case 'dmg': applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value})`); break;
      case 'dmg_stun':
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value}, stun)`);
        state.enemy.stunned = Math.max(state.enemy.stunned, skill.stun||0); break;
      case 'aoe': applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value} AoE)`); break;
      case 'slow':
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value}, slow)`);
        state.enemy.slow = Math.max(state.enemy.slow, skill.duration||3); break;
      case 'heal_one': {
        const idx = lowestAllyIndex(); if (idx>=0){
          const ally = state.heroes[idx]; const healAmt = Math.round(ally.max*skill.value);
          ally.hp = Math.min(ally.max, ally.hp+healAmt); setHeroHP(ally.key, ally.hp/ally.max);
          floatText(`+${healAmt} heal`, '#7affc3');
        } break;
      }
      case 'heal_all':
        for (const ally of state.heroes){
          const healAmt=Math.round(ally.max*skill.value); ally.hp=Math.min(ally.max, ally.hp+healAmt);
          setHeroHP(ally.key, ally.hp/ally.max);
        }
        floatText('Group Heal','#7affc3'); break;
      case 'revive': floatText('Revive ready','#7affc3'); break;
    }
  }
  function lowestAllyIndex(){
    let idx=-1, frac=1e9;
    for (let i=0;i<state.heroes.length;i++){
      const h=state.heroes[i], f=h.hp/h.max; if (f<frac){ frac=f; idx=i; }
    }
    return idx;
  }
  function applyEnemyDamage(amount,label){
    state.enemy.hp = Math.max(0, state.enemy.hp - amount);
    setEnemyHP(state.enemy.hp/state.enemy.max);
    floatText(label, '#ffd166');
    if (state.enemy.hp<=0) onEnemyDefeated();
  }
  function onEnemyDefeated(){
    state.running=false; showHUD(false);
    if (state.wave>=WAVES) { win(); return; }
    state.pendingReward=null;
    document.querySelectorAll('.reward').forEach(b=>b.classList.remove('selected'));
    show($rewardOverlay);
  }

  // enemy tick
  function enemyTick(dt){
    if (!state.running) return;
    const e = state.enemy;
    if (e.stunned>0){ e.stunned-=dt; return; }
    if (e.slow>0) e.slow-=dt;

    const interval = 1.8 * (e.slow>0 ? 1.6 : 1.0);
    e._atkTimer += dt;
    if (e._atkTimer >= interval){
      e._atkTimer = 0;
      const idx = lowestAllyIndex(); if (idx<0) return;
      const t = state.heroes[idx];
      t.hp = Math.max(0, t.hp - e.atk);
      setHeroHP(t.key, t.hp/t.max);
      floatText(`-${e.atk}`, '#ff5a78');
      if (!state.heroes.some(h=>h.hp>0)) lose();
    }
  }

  // rewards
  function applyReward(key){
    switch(key){
      case 'heal':
        for (const a of state.heroes){ a.hp=Math.min(a.max, Math.round(a.hp+a.max*0.25)); setHeroHP(a.key, a.hp/a.max); }
        break;
      case 'amp': state.damageAmp = +(state.damageAmp*1.10).toFixed(3); break;
      case 'rate':
        state.spawnEvery = Math.max(250, Math.round(state.spawnEvery*0.85));
        document.getElementById('rate').value = state.spawnEvery;
        document.getElementById('rateOut').textContent = String(state.spawnEvery);
        break;
    }
  }

  // ===== UI helpers =====
  function setHeroHP(key, frac){
    const el = document.querySelector(`.hero[data-hero="${key}"] .hp .fill`);
    if (!el) return; el.style.width = `${Math.max(0,Math.min(1,frac))*100}%`;
  }
  function setEnemyHP(frac){
    const el = document.querySelector('.enemy .fill');
    el.style.width = `${Math.max(0,Math.min(1,frac))*100}%`;
  }
  function floatText(text, color='#fff'){
    const fx=document.createElement('div'); fx.className='ftext'; fx.textContent=text; fx.style.color=color;
    $arena.appendChild(fx); setTimeout(()=>fx.remove(),900);
  }
  function show(el){ el.classList.add('show'); }
  function hide(el){ el.classList.remove('show'); }

  // ===== Main loop =====
  function tick(ts){
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000);
    state.lastTs = ts;

    if (state.running){
      state.blockTimer += dt*1000;
      if (state.blockTimer >= state.spawnEvery){ state.blockTimer=0; spawnOneBlock(); }
    }

    enemyTick(dt);
    requestAnimationFrame(tick);
  }

  // seed & start RAF
  for (let i=0;i<5;i++) spawnOneBlock();
  requestAnimationFrame(tick);
})();
