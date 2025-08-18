/* Rogue Blocks – Combo Prototype (+Wild/+Cursed +Drag)
   - Taps expand left+right up to 3, including wild blocks
   - Drag shows live preview; release = cast
   - Wild (★) matches any color (nearest neighbor, then most common)
   - Cursed (☠) detonates on tap: chip party damage + spawn slow
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
        2: (ctx) => ({ type: 'slow', value: scale(ctx, 90), slow: 0.5, duration: 4, text: 'Ice Spike' }),
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
  const state = {
    blockRow: Array(8).fill(null),          // item: { kind:'hero'|'wild'|'cursed', heroKey? }
    heroes: [
      { key: 'knight', hp: HEROES.knight.hp, max: HEROES.knight.hp },
      { key: 'mage',   hp: HEROES.mage.hp,   max: HEROES.mage.hp },
      { key: 'priest', hp: HEROES.priest.hp, max: HEROES.priest.hp },
    ],
    enemy: { name: 'Training Dummy', hp: 1500, max: 1500, stunned: 0, slow: 0 },
    rng: Math.random,
    blockTimer: 0,
    spawnEvery: 900,                         // ms baseline
    damageAmp: 1.0,
    lastTs: performance.now(),
    pWild: 0.10,
    pCursed: 0.08,
    curseSlowTimer: 0
  };

  // ---------- DOM ----------
  const $row = document.getElementById('blockRow');
  const $tpl = document.getElementById('blockTpl');
  const $arena = document.getElementById('arena');
  const $rate = document.getElementById('rate');
  const $pWild = document.getElementById('pWild');
  const $pCursed = document.getElementById('pCursed');

  $rate.addEventListener('input', e => state.spawnEvery = +e.target.value);
  $pWild.addEventListener('input', e => state.pWild = (+e.target.value)/100);
  $pCursed.addEventListener('input', e => state.pCursed = (+e.target.value)/100);

  // Build row buttons
  for (let i = 0; i < state.blockRow.length; i++) {
    const node = $tpl.content.firstElementChild.cloneNode(true);
    node.dataset.index = i;
    node.addEventListener('click', onBlockClick, { passive: true });
    node.addEventListener('pointerdown', (e) => e.currentTarget.setPointerCapture?.(e.pointerId));
    $row.appendChild(node);
  }

  // Initialize HP bars
  for (const h of document.querySelectorAll('.hero')) setHeroHP(h.dataset.hero, 1);
  setEnemyHP(1);

  // ---------- Block spawning ----------
  function spawnOneBlock() {
    const idx = state.blockRow.findIndex(x => x === null);
    if (idx === -1) return false;

    const r = state.rng();
    let item;
    if (r < state.pWild) {
      item = { kind: 'wild' };
    } else if (r < state.pWild + state.pCursed) {
      item = { kind: 'cursed' };
    } else {
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
      btn.querySelector('.count').textContent = '';
      return;
    }
    btn.className = 'block'; // reset classes (preview cleared elsewhere)
    btn.dataset.type = item.kind;
    btn.dataset.color = item.heroKey || '';
    btn.querySelector('.count').textContent = '';
    btn.querySelector('.glyph').textContent =
      item.kind === 'wild' ? '★' : (item.kind === 'cursed' ? '☠' : '');
  }

  function compactRow() {
    const filtered = state.blockRow.filter(x => x !== null);
    while (filtered.length < state.blockRow.length) filtered.push(null);
    state.blockRow = filtered;
    for (let i = 0; i < state.blockRow.length; i++) renderBlock(i);
  }

  // ---------- Wild helpers ----------
  function nearestColorForWild(idx) {
    const left = state.blockRow[idx - 1];
    if (left && left.kind === 'hero') return left.heroKey;
    const right = state.blockRow[idx + 1];
    if (right && right.kind === 'hero') return right.heroKey;

    const counts = {};
    for (const it of state.blockRow) if (it?.kind === 'hero') counts[it.heroKey] = (counts[it.heroKey] || 0) + 1;
    let best = null, max = -1;
    for (const k in counts) if (counts[k] > max) { max = counts[k]; best = k; }
    return best || 'knight';
  }
  function canJoin(color, it) {
    if (!it) return false;
    if (it.kind === 'cursed') return false;
    if (it.kind === 'wild') return true;
    return it.kind === 'hero' && it.heroKey === color;
  }

  // ---------- Click casting (tap) ----------
  let suppressNextClick = false; // to prevent double-fire after drag commit

  function onBlockClick(e) {
    if (suppressNextClick) { suppressNextClick = false; return; }

    const idx = +e.currentTarget.dataset.index;
    const item = state.blockRow[idx];
    if (!item) return;

    if (item.kind === 'cursed') { detonateCursed(idx); return; }

    // Determine target color
    const targetColor = item.kind === 'hero' ? item.heroKey : nearestColorForWild(idx);

    // Build combo expanding left then right (max 3)
    const picked = buildComboFromSeed(idx, targetColor, 3);

    // Consume and cast
    for (const i of picked) { state.blockRow[i] = null; renderBlock(i); }
    compactRow();
    castSkill(targetColor, picked.length);
  }

  // ---------- Drag selection with live preview ----------
  const drag = { active:false, seedIndex:-1, targetColor:null, picked:[], moved:false };

  function indexFromTarget(ev) {
    const el = ev.target.closest?.('.block');
    if (el && el.parentElement === $row) return +el.dataset.index;

    const rect = $row.getBoundingClientRect();
    if (ev.clientX == null) return -1;
    if (ev.clientY < rect.top || ev.clientY > rect.bottom) return -1;
    const colW = rect.width / state.blockRow.length;
    let idx = Math.floor((ev.clientX - rect.left) / colW);
    if (idx < 0 || idx >= state.blockRow.length) return -1;
    return idx;
  }

  function buildComboFromSeed(seedIndex, targetColor, maxN = 3) {
    const arr = state.blockRow;
    const picked = [seedIndex];
    // left
    let l = seedIndex - 1;
    while (l >= 0 && picked.length < maxN && canJoin(targetColor, arr[l])) { picked.unshift(l); l--; }
    // right
    let r = seedIndex + 1;
    while (r < arr.length && picked.length < maxN && canJoin(targetColor, arr[r])) { picked.push(r); r++; }
    return picked;
  }

  function pickTargetColorForIndex(idx) {
    const it = state.blockRow[idx];
    if (!it || it.kind === 'cursed') return null;
    if (it.kind === 'hero') return it.heroKey;
    return nearestColorForWild(idx); // wild
  }

  function showPreview(indices, seedIndex) {
    clearPreview();
    for (const i of indices) $row.children[i].classList.add('preview');
    if (seedIndex >= 0) $row.children[seedIndex].classList.add('preview-core');
  }
  function clearPreview() {
    for (const el of $row.children) el.classList.remove('preview', 'preview-core', 'invalid');
  }

  $row.addEventListener('pointerdown', (ev) => {
    const idx = indexFromTarget(ev);
    if (idx < 0) return;

    drag.active = true; drag.moved = false; drag.seedIndex = idx;

    const item = state.blockRow[idx];
    if (!item) { drag.active = false; return; }

    if (item.kind === 'cursed') {
      $row.children[idx].classList.add('invalid'); // visual feedback
      return; // don't preview/cast via drag; tap detonates
    }

    drag.targetColor = pickTargetColorForIndex(idx);
    drag.picked = buildComboFromSeed(idx, drag.targetColor, 3);
    showPreview(drag.picked, drag.seedIndex);

    ev.preventDefault();
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
  });

  $row.addEventListener('pointermove', (ev) => {
    if (!drag.active) return;
    drag.moved = true;

    // Keep seed fixed for consistent feel (optional: switch to hovered index)
    const seedValid = state.blockRow[drag.seedIndex] && state.blockRow[drag.seedIndex].kind !== 'cursed';
    if (!seedValid) { clearPreview(); return; }

    drag.targetColor = pickTargetColorForIndex(drag.seedIndex);
    drag.picked = buildComboFromSeed(drag.seedIndex, drag.targetColor, 3);
    showPreview(drag.picked, drag.seedIndex);
  });

  window.addEventListener('pointerup', () => {
    if (!drag.active) return;

    const item = state.blockRow[drag.seedIndex];
    const canCommit = item && item.kind !== 'cursed';

    clearPreview();
    drag.active = false;

    if (!canCommit) return;

    // Commit selection on release
    for (const i of drag.picked) { state.blockRow[i] = null; renderBlock(i); }
    compactRow();
    castSkill(drag.targetColor, drag.picked.length);

    // suppress the subsequent click event from also firing
    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 0);

    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
  }, { passive: true });

  // ---------- Cursed behavior ----------
  function detonateCursed(idx) {
    state.blockRow[idx] = null;

    // scorch nearest non-null to the right (adds bite)
    let right = -1;
    for (let j = idx + 1; j < state.blockRow.length; j++) {
      if (state.blockRow[j] !== null) { right = j; break; }
    }
    if (right !== -1) state.blockRow[right] = null;

    compactRow();

    // penalties
    for (const ally of state.heroes) {
      const loss = Math.round(ally.max * 0.06);
      ally.hp = Math.max(0, ally.hp - loss);
      setHeroHP(ally.key, ally.hp / ally.max);
    }
    state.curseSlowTimer = Math.max(state.curseSlowTimer, 3.0);

    floatText('CURSE EXPLODED!', '#b162ff');
    if (navigator.vibrate) try { navigator.vibrate([6, 20, 8]); } catch {}
  }

  // ---------- Skills / Combat ----------
  function castSkill(heroKey, count) {
    const hero = HEROES[heroKey];
    const ctx = { damageAmp: state.damageAmp };
    const skill = hero.skills[count](ctx);

    switch (skill.type) {
      case 'dmg': {
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value})`); break;
      }
      case 'dmg_stun': {
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value}, stun)`);
        state.enemy.stunned = Math.max(state.enemy.stunned, skill.stun || 0);
        break;
      }
      case 'aoe': {
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value} AoE)`); break;
      }
      case 'slow': {
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value}, slow)`);
        state.enemy.slow = Math.max(state.enemy.slow, skill.duration || 3);
        break;
      }
      case 'heal_one': {
        const idx = lowestAllyIndex();
        if (idx >= 0) {
          const ally = state.heroes[idx];
          const healAmt = Math.round(ally.max * skill.value);
          ally.hp = Math.min(ally.max, ally.hp + healAmt);
          setHeroHP(ally.key, ally.hp / ally.max);
          floatText(`+${healAmt} heal`, '#7affc3');
        }
        break;
      }
      case 'heal_all': {
        for (const ally of state.heroes) {
          const healAmt = Math.round(ally.max * skill.value);
          ally.hp = Math.min(ally.max, ally.hp + healAmt);
          setHeroHP(ally.key, ally.hp / ally.max);
        }
        floatText(`Group Heal`, '#7affc3');
        break;
      }
      case 'revive': {
        floatText(`Revive ready`, '#7affc3'); break;
      }
    }
  }

  function lowestAllyIndex() {
    let idx = -1, frac = 1e9;
    for (let i = 0; i < state.heroes.length; i++) {
      const h = state.heroes[i];
      const f = h.hp / h.max;
      if (f < frac) { frac = f; idx = i; }
    }
    return idx;
  }

  function applyEnemyDamage(amount, label) {
    state.enemy.hp = Math.max(0, state.enemy.hp - amount);
    setEnemyHP(state.enemy.hp / state.enemy.max);
    floatText(label, '#ffd166');
  }

  // ---------- Enemy auto-attacks ----------
  function enemyTick(dt) {
    if (state.enemy.stunned > 0) { state.enemy.stunned -= dt; return; }
    if (state.enemy.slow > 0) state.enemy.slow -= dt;

    const interval = 1.8 * (state.enemy.slow > 0 ? 1.6 : 1.0);
    state._atkTimer = (state._atkTimer || 0) + dt;
    if (state._atkTimer >= interval) {
      state._atkTimer = 0;
      const idx = lowestAllyIndex();
      const target = state.heroes[idx];
      const dmg = 38;
      target.hp = Math.max(0, target.hp - dmg);
      setHeroHP(target.key, target.hp / target.max);
      floatText(`-${dmg}`, '#ff5a78');
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

  // ---------- Main loop ----------
  function tick(ts) {
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000);
    state.lastTs = ts;

    // cursed slow effect
    if (state.curseSlowTimer > 0) state.curseSlowTimer -= dt;

    // spawn timer (add penalty while slowed)
    state.blockTimer += dt * 1000;
    const penalty = state.curseSlowTimer > 0 ? 450 : 0; // extra ms per spawn while slowed
    if (state.blockTimer >= state.spawnEvery + penalty) {
      state.blockTimer = 0;
      spawnOneBlock();
    }

    enemyTick(dt);
    requestAnimationFrame(tick);
  }

  // Seed starting blocks
  for (let i = 0; i < 5; i++) spawnOneBlock();
  requestAnimationFrame(tick);
})();
