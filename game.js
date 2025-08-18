/* Rogue Blocks – Waves + Rewards (Wild only)
   - Stable combos: seed + immediate neighbors if SAME color or WILD; wild doesn't bridge across colors.
   - Drag preview; release = cast. Tap also works.
   - Multi-wave loop with rewards between waves.
*/
(() => {
  // ---------- Data ----------
  const HEROES = {
    knight: {
      color: 'knight',
      name: 'Knight',
      skills: {
        1: (ctx) => ({ type: 'dmg', value: scale(ctx, 100), text: 'Slash' }),
        2: (ctx) => ({ type: 'dmg_stun', value: scale(ctx, 140), stun: 2, text: 'Shield Bash' }),
        3: (ctx) => ({ type: 'aoe', value: scale(ctx, 180), text: 'Whirlwind' }),
      },
      atk: 30, hp: 320
    },
    mage: {
      color: 'mage',
      name: 'Mage',
      skills: {
        1: (ctx) => ({ type: 'dmg', value: scale(ctx, 120), text: 'Fireball' }),
        2: (ctx) => ({ type: 'slow', value: scale(ctx, 90), duration: 4, text: 'Ice Spike' }),
        3: (ctx) => ({ type: 'aoe', value: scale(ctx, 220), text: 'Meteor' }),
      },
      atk: 35, hp: 260
    },
    priest: {
      color: 'priest',
      name: 'Priest',
      skills: {
        1: (ctx) => ({ type: 'heal_one', value: 0.25, text: 'Heal' }),
        2: (ctx) => ({ type: 'heal_all', value: 0.15, text: 'Group Heal' }),
        3: (ctx) => ({ type: 'revive', value: 0.5, text: 'Revive' }),
      },
      atk: 20, hp: 280
    }
  };
  function scale(ctx, base) { return Math.round(base * ctx.damageAmp); }

  // ---------- State ----------
  const WAVES = 6;
  const state = {
    blockRow: Array(8).fill(null),          // item: { kind:'hero'|'wild', heroKey? }
    heroes: [
      { key: 'knight', hp: HEROES.knight.hp, max: HEROES.knight.hp },
      { key: 'mage',   hp: HEROES.mage.hp,   max: HEROES.mage.hp },
      { key: 'priest', hp: HEROES.priest.hp, max: HEROES.priest.hp },
    ],
    enemy: makeEnemy(1),
    wave: 1,
    damageAmp: 1.0,
    rng: Math.random,
    blockTimer: 0,
    spawnEvery: 900,    // ms baseline (smaller = faster)
    lastTs: performance.now(),
    pWild: 0.10,
    running: false,
    pendingReward: null
  };

  // ---------- DOM ----------
  const $row = document.getElementById('blockRow');
  const $tpl = document.getElementById('blockTpl');
  const $arena = document.getElementById('arena');
  const $rate = document.getElementById('rate');
  const $pWild = document.getElementById('pWild');

  const $overlay = document.getElementById('overlay');
  const $btnStart = document.getElementById('btnStart');

  const $rewardOverlay = document.getElementById('rewardOverlay');
  const $btnNextWave = document.getElementById('btnNextWave');
  const $endOverlay = document.getElementById('endOverlay');
  const $endTitle = document.getElementById('endTitle');
  const $endText = document.getElementById('endText');
  const $btnRestart = document.getElementById('btnRestart');

  const $waveLbl = document.getElementById('waveLbl');
  const $enemyName = document.getElementById('enemyName');

  // Controls
  $rate.addEventListener('input', e => state.spawnEvery = +e.target.value);
  $pWild.addEventListener('input', e => state.pWild = (+e.target.value)/100);

  // Build row buttons
  for (let i = 0; i < state.blockRow.length; i++) {
    const node = $tpl.content.firstElementChild.cloneNode(true);
    node.dataset.index = i;
    node.addEventListener('click', onBlockClick, { passive: true });
    node.addEventListener('pointerdown', (e) => e.currentTarget.setPointerCapture?.(e.pointerId));
    $row.appendChild(node);
  }

  // UI init
  for (const h of document.querySelectorAll('.hero')) setHeroHP(h.dataset.hero, 1);
  setEnemyHP(1);
  updateWaveUI();

  // Start / Restart
  $btnStart.addEventListener('click', startRun);
  $btnRestart.addEventListener('click', () => { hide($endOverlay); resetRun(); show($overlay); });
  $btnNextWave.addEventListener('click', () => { if (state.pendingReward) applyReward(state.pendingReward); hide($rewardOverlay); nextWave(); });

  // Reward selection
  document.querySelectorAll('.reward').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.reward').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.pendingReward = btn.dataset.reward;
    });
  });

  function startRun() {
    hide($overlay);
    resetRun();
    state.running = true;
  }

  function resetRun() {
    // reset heroes
    for (const h of state.heroes) { const base = HEROES[h.key]; h.max = base.hp; h.hp = base.hp; setHeroHP(h.key, 1); }
    // reset blocks
    state.blockRow = Array(8).fill(null);
    for (let i = 0; i < $row.children.length; i++) renderBlock(i);
    for (let i = 0; i < 5; i++) spawnOneBlock();
    // reset meta
    state.wave = 1;
    state.damageAmp = 1.0;
    state.spawnEvery = +$rate.value;
    state.pWild = (+$pWild.value)/100;
    state.enemy = makeEnemy(state.wave);
    state.running = true;
    updateWaveUI();
    setEnemyHP(1);
  }

  function nextWave() {
    state.wave++;
    if (state.wave > WAVES) {
      win();
      return;
    }
    state.enemy = makeEnemy(state.wave);
    updateWaveUI();
    setEnemyHP(1);
    state.running = true;
  }

  function win() {
    state.running = false;
    $endTitle.textContent = 'Victory!';
    $endText.textContent = 'You cleared all waves. GG!';
    show($endOverlay);
  }
  function lose() {
    state.running = false;
    $endTitle.textContent = 'Defeat';
    $endText.textContent = `You reached Wave ${state.wave}. Try a different reward path!`;
    show($endOverlay);
  }

  function makeEnemy(wave) {
    // scale HP/ATK per wave, add simple label
    const baseHP = 1400 + (wave-1) * 320;
    const baseATK = 34 + Math.floor((wave-1) * 4.5);
    const names = ['Training Dummy', 'Forest Brute', 'Sand Golem', 'Wraith Captain', 'Warlock', 'Dragon Whelp'];
    return { name: names[(wave-1) % names.length], hp: baseHP, max: baseHP, atk: baseATK, stunned:0, slow:0, _atkTimer:0 };
  }

  function updateWaveUI() {
    $waveLbl.textContent = `Wave ${Math.min(state.wave, WAVES)}/${WAVES}`;
    $enemyName.textContent = state.enemy.name;
  }

  // ---------- Block spawning ----------
  function spawnOneBlock() {
    const idx = state.blockRow.findIndex(x => x === null);
    if (idx === -1) return false;

    const r = state.rng();
    let item;
    if (r < state.pWild) item = { kind: 'wild' };
    else {
      const keys = Object.keys(HEROES);
      item = { kind: 'hero', heroKey: keys[Math.floor(state.rng() * keys.length)] };
    }
    state.blockRow[idx] = item;
    renderBlock(idx);
    return true;
  }

  function renderBlock(i) {
    const btn = $row.children[i];
    const item = state.blockRow[i];
    if (!item) {
      btn.className = 'block empty';
      btn.dataset.type = '';
      btn.dataset.color = '';
      btn.querySelector('.glyph').textContent = '';
      return;
    }
    btn.className = 'block';
    btn.dataset.type = item.kind;
    btn.dataset.color = item.heroKey || '';
    btn.querySelector('.glyph').textContent = item.kind === 'wild' ? '★' : '';
  }

  function compactRow() {
    const filtered = state.blockRow.filter(x => x !== null);
    while (filtered.length < state.blockRow.length) filtered.push(null);
    state.blockRow = filtered;
    for (let i = 0; i < state.blockRow.length; i++) renderBlock(i);
  }

  // ---------- Combo rules (STRICT & STABLE) ----------
  function nearestColorForWild(idx) {
    const L = state.blockRow[idx-1];
    if (L && L.kind === 'hero') return L.heroKey;
    const R = state.blockRow[idx+1];
    if (R && R.kind === 'hero') return R.heroKey;
    // fallback = most common hero color in row, else knight
    const counts = {};
    for (const it of state.blockRow) if (it?.kind === 'hero') counts[it.heroKey] = (counts[it.heroKey]||0)+1;
    let best = null, max = -1;
    for (const k in counts) if (counts[k] > max) { max = counts[k]; best = k; }
    return best || 'knight';
  }
  function canJoin(targetColor, it) {
    if (!it) return false;
    if (it.kind === 'wild') return true;
    return it.kind === 'hero' && it.heroKey === targetColor;
  }
  function buildComboFromSeed(seedIndex, targetColor, maxN=3) {
    const arr = state.blockRow;
    const picked = [seedIndex];

    // Expand LEFT
    let l = seedIndex - 1;
    while (l >= 0 && picked.length < maxN && canJoin(targetColor, arr[l])) {
      picked.unshift(l); l--;
    }
    // Expand RIGHT
    let r = seedIndex + 1;
    while (r < arr.length && picked.length < maxN && canJoin(targetColor, arr[r])) {
      picked.push(r); r++;
    }

    // IMPORTANT: Do not "skip over" mismatches, and wilds do NOT connect across mismatched colors:
    // Our expansion stops the moment a non-joinable tile is encountered.
    return picked;
  }
  function targetColorAtIndex(idx) {
    const it = state.blockRow[idx];
    if (!it) return null;
    return it.kind === 'hero' ? it.heroKey : nearestColorForWild(idx);
  }

  // ---------- Click casting (tap) ----------
  let suppressNextClick = false;
  function onBlockClick(e) {
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (!state.running) return;

    const idx = +e.currentTarget.dataset.index;
    const item = state.blockRow[idx];
    if (!item) return;

    const color = targetColorAtIndex(idx);
    const picked = buildComboFromSeed(idx, color, 3);

    // Consume & cast
    for (const i of picked) { state.blockRow[i] = null; renderBlock(i); }
    compactRow();
    castSkill(color, picked.length);
  }

  // ---------- Drag selection with preview ----------
  const drag = { active:false, seedIndex:-1, targetColor:null, picked:[] };
  function indexFromTarget(ev) {
    const el = ev.target.closest?.('.block');
    if (el && el.parentElement === $row) return +el.dataset.index;

    const rect = $row.getBoundingClientRect();
    if (ev.clientX == null) return -1;
    if (ev.clientY < rect.top || ev.clientY > rect.bottom) return -1;
    const colW = rect.width / state.blockRow.length;
    const idx = Math.floor((ev.clientX - rect.left) / colW);
    return (idx < 0 || idx >= state.blockRow.length) ? -1 : idx;
  }
  function showPreview(indices, seedIndex) {
    clearPreview();
    for (const i of indices) $row.children[i].classList.add('preview');
    if (seedIndex >= 0) $row.children[seedIndex].classList.add('preview-core');
  }
  function clearPreview() {
    for (const el of $row.children) el.classList.remove('preview','preview-core');
  }

  $row.addEventListener('pointerdown', (ev) => {
    if (!state.running) return;
    const idx = indexFromTarget(ev); if (idx < 0) return;
    if (!state.blockRow[idx]) return;

    drag.active = true; drag.seedIndex = idx;
    drag.targetColor = targetColorAtIndex(idx);
    drag.picked = buildComboFromSeed(idx, drag.targetColor, 3);
    showPreview(drag.picked, drag.seedIndex);

    ev.preventDefault();
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
  });
  $row.addEventListener('pointermove', (ev) => {
    if (!drag.active || !state.running) return;
    if (!state.blockRow[drag.seedIndex]) { clearPreview(); return; }
    drag.targetColor = targetColorAtIndex(drag.seedIndex);
    drag.picked = buildComboFromSeed(drag.seedIndex, drag.targetColor, 3);
    showPreview(drag.picked, drag.seedIndex);
  });
  window.addEventListener('pointerup', () => {
    if (!drag.active) return;
    clearPreview();
    if (!state.running) { drag.active=false; return; }

    // Commit
    for (const i of drag.picked) { state.blockRow[i] = null; renderBlock(i); }
    compactRow();
    castSkill(drag.targetColor, drag.picked.length);

    drag.active = false;
    suppressNextClick = true; setTimeout(() => suppressNextClick=false, 0);
    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
  }, { passive:true });

  // ---------- Skills / Combat ----------
  function castSkill(heroKey, count) {
    const hero = HEROES[heroKey];
    const ctx = { damageAmp: state.damageAmp };
    const skill = hero.skills[count](ctx);

    switch (skill.type) {
      case 'dmg': applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value})`); break;
      case 'dmg_stun':
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value}, stun)`);
        state.enemy.stunned = Math.max(state.enemy.stunned, skill.stun || 0); break;
      case 'aoe': applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value} AoE)`); break;
      case 'slow':
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value}, slow)`);
        state.enemy.slow = Math.max(state.enemy.slow, skill.duration || 3); break;
      case 'heal_one': {
        const idx = lowestAllyIndex();
        if (idx >= 0) {
          const ally = state.heroes[idx];
          const healAmt = Math.round(ally.max * skill.value);
          ally.hp = Math.min(ally.max, ally.hp + healAmt);
          setHeroHP(ally.key, ally.hp / ally.max);
          floatText(`+${healAmt} heal`, '#7affc3');
        } break;
      }
      case 'heal_all':
        for (const ally of state.heroes) {
          const healAmt = Math.round(ally.max * skill.value);
          ally.hp = Math.min(ally.max, ally.hp + healAmt);
          setHeroHP(ally.key, ally.hp / ally.max);
        }
        floatText(`Group Heal`, '#7affc3'); break;
      case 'revive': floatText(`Revive ready`, '#7affc3'); break;
    }
  }

  function lowestAllyIndex() {
    let idx = -1, frac = 1e9;
    for (let i = 0; i < state.heroes.length; i++) {
      const h = state.heroes[i], f = h.hp / h.max;
      if (f < frac) { frac = f; idx = i; }
    }
    return idx;
  }

  function applyEnemyDamage(amount, label) {
    state.enemy.hp = Math.max(0, state.enemy.hp - amount);
    setEnemyHP(state.enemy.hp / state.enemy.max);
    floatText(label, '#ffd166');
    if (state.enemy.hp <= 0) onEnemyDefeated();
  }

  function onEnemyDefeated() {
    state.running = false;
    if (state.wave >= WAVES) {
      win();
    } else {
      // show reward overlay
      state.pendingReward = null;
      document.querySelectorAll('.reward').forEach(b => b.classList.remove('selected'));
      show($rewardOverlay);
    }
  }

  // ---------- Enemy auto-attacks & defeat check ----------
  function enemyTick(dt) {
    if (!state.running) return;

    if (state.enemy.stunned > 0) { state.enemy.stunned -= dt; return; }
    if (state.enemy.slow > 0) state.enemy.slow -= dt;

    const interval = 1.8 * (state.enemy.slow > 0 ? 1.6 : 1.0);
    state.enemy._atkTimer += dt;
    if (state.enemy._atkTimer >= interval) {
      state.enemy._atkTimer = 0;
      const idx = lowestAllyIndex(); if (idx < 0) return;
      const target = state.heroes[idx];
      const dmg = state.enemy.atk;
      target.hp = Math.max(0, target.hp - dmg);
      setHeroHP(target.key, target.hp / target.max);
      floatText(`-${dmg}`, '#ff5a78');
      // defeat check
      const alive = state.heroes.some(h => h.hp > 0);
      if (!alive) lose();
    }
  }

  // ---------- Rewards ----------
  function applyReward(key) {
    switch (key) {
      case 'heal':
        for (const ally of state.heroes) {
          ally.hp = Math.min(ally.max, Math.round(ally.hp + ally.max * 0.25));
          setHeroHP(ally.key, ally.hp / ally.max);
        }
        break;
      case 'amp':
        state.damageAmp = +(state.damageAmp * 1.10).toFixed(3);
        break;
      case 'rate':
        state.spawnEvery = Math.max(250, Math.round(state.spawnEvery * 0.85));
        $rate.value = state.spawnEvery;
        break;
    }
  }

  // ---------- UI helpers ----------
  function setHeroHP(key, frac) {
    const el = document.querySelector(`.hero[data-hero="${key}"] .hp .fill`);
    if (!el) return;
    if (typeof frac === 'number') el.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    else {
      const hero = state.heroes.find(h => h.key === key);
      el.style.width = `${(hero?.hp ?? 1)/(hero?.max ?? 1)*100}%`;
    }
  }
  function setEnemyHP(frac) {
    const el = document.querySelector(`.enemy .fill`);
    el.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }
  function floatText(text, color = '#fff') {
    const fx = document.createElement('div');
    fx.className = 'ftext';
    fx.textContent = text;
    fx.style.color = color;
    $arena.appendChild(fx);
    setTimeout(() => fx.remove(), 900);
  }
  function show(el){ el.classList.add('show'); }
  function hide(el){ el.classList.remove('show'); }

  function update(dtMs) {
    if (!state.running) return;

    // spawn timer
    state.blockTimer += dtMs;
    if (state.blockTimer >= state.spawnEvery) {
      state.blockTimer = 0;
      spawnOneBlock();
    }
  }

  // ---------- Main loop ----------
  function tick(ts) {
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000);
    state.lastTs = ts;

    update(dt * 1000);
    enemyTick(dt);

    requestAnimationFrame(tick);
  }

  // seed row
  for (let i = 0; i < 5; i++) spawnOneBlock();
  requestAnimationFrame(tick);
})();
