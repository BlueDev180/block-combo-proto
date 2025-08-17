/* Rogue Blocks – Block Combo Prototype
   - Tap any block -> auto-collect up to 3 contiguous blocks of same hero
   - Consume them -> cast that hero's 1/2/3-block skill
   - Simple auto-battle numbers to feel the feedback
*/
(() => {
  // ---------- Data ----------
  const HEROES = {
    knight: {
      color: 'knight', // css hook
      name: 'Knight',
      // Returns { type, value, text }
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
        1: (ctx) => ({ type: 'heal_one', value: 0.25, text: 'Heal' }), // 25% heal of lowest ally
        2: (ctx) => ({ type: 'heal_all', value: 0.15, text: 'Group Heal' }),
        3: (ctx) => ({ type: 'revive', value: 0.5, text: 'Revive' }), // not used in proto (no deaths), kept for API
      },
      atk: 20, hp: 280
    }
  };

  function scale(ctx, base) {
    // Very light scaling hook: relics, buffs could go here later.
    return Math.round(base * ctx.damageAmp);
  }

  // ---------- State ----------
  const state = {
    blockRow: Array(8).fill(null),          // each entry: { heroKey }
    heroes: [
      { key: 'knight', hp: HEROES.knight.hp, max: HEROES.knight.hp },
      { key: 'mage',   hp: HEROES.mage.hp,   max: HEROES.mage.hp },
      { key: 'priest', hp: HEROES.priest.hp, max: HEROES.priest.hp },
    ],
    enemy: { name: 'Training Dummy', hp: 1500, max: 1500, stunned: 0, slow: 0 },
    rng: Math.random,
    t: 0,
    blockTimer: 0,
    spawnEvery: 900,                         // ms between new blocks (controlled by range input)
    damageAmp: 1.0,                          // pseudo relic multiplier
    lastTs: performance.now()
  };

  // ---------- DOM ----------
  const $row = document.getElementById('blockRow');
  const $tpl = document.getElementById('blockTpl');
  const $arena = document.getElementById('arena');
  const $rate = document.getElementById('rate');

  $rate.addEventListener('input', e => state.spawnEvery = +e.target.value);

  // Initialize row slots
  for (let i = 0; i < state.blockRow.length; i++) {
    const node = $tpl.content.firstElementChild.cloneNode(true);
    node.classList.add('empty');
    node.dataset.index = i;
    node.addEventListener('click', onBlockClick, { passive: true });
    node.addEventListener('pointerdown', (e) => e.currentTarget.setPointerCapture?.(e.pointerId));
    $row.appendChild(node);
  }

  // Initialize HP bars
  for (const h of document.querySelectorAll('.hero')) {
    setHeroHP(h.dataset.hero, 1);
  }
  setEnemyHP(1);

  // ---------- Block Spawning ----------
  function spawnOneBlock() {
    // find first empty slot from left
    const idx = state.blockRow.findIndex(x => x === null);
    if (idx === -1) return false;

    // Pick hero color weighted evenly for now
    const keys = Object.keys(HEROES);
    const heroKey = keys[Math.floor(state.rng() * keys.length)];
    state.blockRow[idx] = { heroKey };
    renderBlock(idx);
    return true;
  }

  function renderBlock(i) {
    const btn = $row.children[i];
    const item = state.blockRow[i];
    if (!item) {
      btn.classList.add('empty');
      btn.dataset.color = '';
      btn.querySelector('.count').textContent = '';
      return;
    }
    btn.classList.remove('empty');
    btn.dataset.color = item.heroKey;
    btn.querySelector('.count').textContent = ''; // count label appears only on combo preview if needed
  }

  // ---------- Casting via Block Click ----------
  function onBlockClick(e) {
    const idx = +e.currentTarget.dataset.index;
    const item = state.blockRow[idx];
    if (!item) return; // empty

    const color = item.heroKey;

    // Count contiguous same-color starting at idx moving right (Crusader Quest feel)
    let count = 1;
    for (let j = idx + 1; j < Math.min(idx + 3, state.blockRow.length); j++) {
      const b = state.blockRow[j];
      if (b && b.heroKey === color && count < 3) count++;
      else break;
    }

    // Consume exactly `count` blocks (max 3)
    for (let k = 0; k < count; k++) {
      state.blockRow[idx + k] = null;
      renderBlock(idx + k);
    }

    // Compact row left (shift remaining blocks to the left)
    compactRow();
    // Cast hero skill
    castSkill(color, count);
  }

  function compactRow() {
    const filtered = state.blockRow.filter(x => x !== null);
    while (filtered.length < state.blockRow.length) filtered.push(null);
    state.blockRow = filtered;
    // Re-render all slots
    for (let i = 0; i < state.blockRow.length; i++) renderBlock(i);
  }

  // ---------- Skills / Combat ----------
  function castSkill(heroKey, count) {
    const hero = HEROES[heroKey];
    const ctx = { damageAmp: state.damageAmp };
    const skill = hero.skills[count](ctx);

    switch (skill.type) {
      case 'dmg': {
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value})`);
        break;
      }
      case 'dmg_stun': {
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value}, stun)`);
        state.enemy.stunned = Math.max(state.enemy.stunned, skill.stun || 0);
        break;
      }
      case 'aoe': {
        // Single dummy: treat as big hit
        applyEnemyDamage(skill.value, `${hero.name} · ${skill.text} (-${skill.value} AoE)`);
        break;
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
        // Not fully simulated in prototype (no death), but included to show pipeline.
        floatText(`Revive ready`, '#7affc3');
        break;
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

  // ---------- Auto-Battle: Enemy pokes party ----------
  function enemyTick(dt) {
    // stunned / slowed handling
    if (state.enemy.stunned > 0) {
      state.enemy.stunned -= dt;
      return;
    }
    if (state.enemy.slow > 0) {
      state.enemy.slow -= dt;
    }

    // Attack cadence
    // Base every 1.8s; slowed increases interval by +60%
    const interval = 1.8 * (state.enemy.slow > 0 ? 1.6 : 1.0);
    state._atkTimer = (state._atkTimer || 0) + dt;
    if (state._atkTimer >= interval) {
      state._atkTimer = 0;
      // Hit lowest ally for small damage
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
      // init full
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

    // spawn blocks over time
    state.blockTimer += dt * 1000;
    if (state.blockTimer >= state.spawnEvery) {
      state.blockTimer = 0;
      spawnOneBlock(); // if full, silently skip
    }

    // enemy attacks
    enemyTick(dt);

    requestAnimationFrame(tick);
  }

  // Seed a starting row
  for (let i = 0; i < 5; i++) spawnOneBlock();

  requestAnimationFrame(tick);
})();
