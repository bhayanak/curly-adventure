/* main.js — Dog Day platformer engine: loop, camera, tile physics,
 * entities (player, enemies, projectiles, pickups, crates), rendering, states.
 */
(function () {
  "use strict";

  // ---------------- Constants ----------------
  const TILE = 44;
  const GRAVITY = 2300;
  const WALK = 150;
  const RUN = 290;
  const ACCEL = 1700;
  const FRICTION = 2000;
  const AIR_ACCEL = 1300;
  const JUMP_VY = -780;
  const DJUMP_VY = -700;
  const MAX_FALL = 1250;
  const DASH_SPEED = 560;
  const DASH_TIME = 0.16;
  const DASH_CD = 0.45;
  const CLIMB = 150;
  const SWIM = 165;
  const WORD = "BONES";
  const COYOTE = 0.10;       // grace period to jump after leaving a ledge
  const JUMP_BUFFER = 0.12;  // pre-press jump just before landing
  const STRIDE = 15;         // px travelled per run/walk animation frame

  // Hero sprite frames are 260x239 with the character centred near the bottom.
  const HERO_RATIO = 260 / 239;
  const HERO_DRAW_H = 96;    // drawn frame height (character ≈ 72% of frame)
  const HERO_FOOT = 10;      // sprite bottom sits this far below the hitbox feet

  const S = { LOADING: 0, MENU: 1, INTRO: 2, PLAYING: 3, PAUSED: 4, CLEAR: 5, OVER: 6, WIN: 7 };

  // ---------------- Canvas ----------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let dpr = 1, viewW = 0, viewH = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    viewW = r.width; viewH = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  // ---------------- DOM ----------------
  const $ = (id) => document.getElementById(id);
  const dom = {
    loading: $("loading"), loaderFill: $("loader-fill"),
    menu: $("menu"), btnPlay: $("btn-play"), menuBest: $("menu-best"),
    intro: $("intro"), introTitle: $("intro-title"), introSub: $("intro-sub"), btnGo: $("btn-go"),
    pause: $("pause"), btnResume: $("btn-resume"), btnQuit: $("btn-quit"),
    clear: $("levelclear"), clearStats: $("clear-stats"), btnNext: $("btn-next"),
    over: $("gameover"), goStats: $("go-stats"), btnRetry: $("btn-retry"),
    win: $("win"), winStats: $("win-stats"), btnAgain: $("btn-again"),
    hud: $("hud"),
    hLives: $("hud-lives"), hHealth: $("hud-health"), hCoins: $("hud-coins"),
    hGems: $("hud-gems"), hWord: $("hud-word"), hScore: $("hud-score"),
    hLevel: $("hud-level"), hObj: $("hud-objective"),
    btnPause: $("btn-pause"), btnMute: $("btn-mute"), touch: $("touch"),
  };

  // ---------------- Helpers ----------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const approach = (a, b, amt) => (a < b ? Math.min(a + amt, b) : Math.max(a - amt, b));
  const aabb = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------------- Game state ----------------
  let state = S.LOADING;
  let level = null, levelIndex = 0;
  let inBonus = false, bonusReturnIndex = 0;
  let grid, cols, rows, levelW, levelH;
  let player, enemies, projectiles, pickups, crates, particles = [];
  let cam = { x: 0, y: 0 };
  let totalPickups = 0, gotPickups = 0, exitUnlocked = false;
  let lives = 3, health = 3, maxHealth = 3, score = 0;
  let coins = 0, gems = 0, wordGot = new Set(), bonusGiven = false;
  let best = parseInt(localStorage.getItem("dogday.best2") || "0", 10) || 0;
  let introTimer = 0;

  // ---------------- Tile queries ----------------
  function tileAt(c, r) {
    if (c < 0 || c >= cols) return "#";   // walls at sides
    if (r < 0) return " ";
    if (r >= rows) return " ";
    return grid[r][c];
  }
  const isSolidChar = (ch) => ch === "#" || ch === "G";
  function crateAt(c, r) {
    for (const k of crates) if (!k.broken && k.col === c && k.row === r) return k;
    return null;
  }
  function solidAt(c, r) {
    return isSolidChar(tileAt(c, r)) || !!crateAt(c, r);
  }

  // ---------------- Level loading ----------------
  function loadLevel(i) {
    inBonus = false;
    applyLevel(window.LEVELS[i]);
  }

  function applyLevel(lvl) {
    level = lvl;
    grid = level.grid;
    cols = level.cols; rows = level.rows;
    levelW = cols * TILE; levelH = rows * TILE;

    enemies = []; projectiles = []; pickups = []; crates = []; particles = [];

    for (const p of level.pickups)
      pickups.push({ type: p.type, letter: p.letter || null, x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2, got: false, bob: Math.random() * 6 });

    for (const k of level.crates)
      crates.push({ col: k.x, row: k.y, contains: k.contains, broken: false });

    for (const e of level.enemies) spawnEnemy(e);

    // objective total (coins + gems placed + crate contents that are coin/gem)
    totalPickups = pickups.filter((p) => p.type === "coin" || p.type === "gem").length +
      crates.filter((k) => k.contains === "coin" || k.contains === "gem").length;
    gotPickups = 0;
    exitUnlocked = false;

    const sp = level.spawn;
    player = makePlayer(sp.x * TILE + 6, sp.y * TILE);
    cam.x = clamp(player.x - viewW / 2, 0, Math.max(0, levelW - viewW));
    cam.y = clamp(player.y - viewH / 2, 0, Math.max(0, levelH - viewH));

    if (!Sfx.muted) Sfx.startMusic(level.theme);
  }

  function spawnEnemy(e) {
    const baseX = e.x * TILE, baseY = e.y * TILE;
    const t = level.theme;
    const walkSprite = t === "underwater" ? "crab" : t === "cave" ? "bunny" : "fox";
    const flySprite = t === "underwater" ? "fish" : t === "cave" ? "parrot" : "bee";
    if (e.type === "patroller")
      enemies.push({ type: "patroller", x: baseX, y: baseY, w: 38, h: 36, vx: 60, dir: -1, homeX: baseX, range: (e.range || 4) * TILE, alive: true, sprite: walkSprite });
    else if (e.type === "flyer")
      enemies.push({ type: "flyer", x: baseX, y: baseY, w: 38, h: 30, homeX: baseX, range: (e.range || 3) * TILE, amp: (e.amp || 2) * TILE, baseY, phase: Math.random() * 6, dir: -1, vx: 70, alive: true, sprite: flySprite });
    else if (e.type === "shooter")
      enemies.push({ type: "shooter", x: baseX + 2, y: baseY, w: 40, h: 40, dir: e.dir || -1, cd: rand(0.5, 1.5), alive: true, sprite: "pig" });
    else if (e.type === "chaser")
      enemies.push({ type: "chaser", x: baseX, y: baseY, w: 38, h: 38, vx: 60, dir: -1, want: 0, bob: 0, range: (e.range || 7) * TILE, alive: true, sprite: t === "forest" ? "cat" : walkSprite });
  }

  // ---------------- Player ----------------
  function makePlayer(x, y) {
    return {
      x, y, w: 26, h: 40, vx: 0, vy: 0, facing: 1,
      grounded: false, jumps: 0, crouch: false,
      dashTime: 0, dashCD: 0, inWater: false, onLadder: false, climbing: false,
      invuln: 0, anim: 0, alive: true,
      coyote: 0, jumpBuf: 0, dist: 0, shield: 0,
      punchTime: 0, punchAnim: 0,
    };
  }

  function playerHitWater() {
    const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
    return tileAt(Math.floor(cx / TILE), Math.floor(cy / TILE)) === "W";
  }
  function playerOnLadder() {
    const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
    return tileAt(Math.floor(cx / TILE), Math.floor(cy / TILE)) === "L";
  }

  function updatePlayer(dt) {
    const p = player;
    p.dashCD = Math.max(0, p.dashCD - dt);
    if (p.invuln > 0) p.invuln -= dt;

    // jump buffering + coyote time (set once so we never double-consume the edge)
    if (Input.pressed("jump")) p.jumpBuf = JUMP_BUFFER;
    p.jumpBuf = Math.max(0, p.jumpBuf - dt);
    if (p.grounded) p.coyote = COYOTE; else p.coyote = Math.max(0, p.coyote - dt);

    const wasWater = p.inWater;
    p.inWater = playerHitWater();
    if (p.inWater && !wasWater) { Sfx.splash(); spawnSplash(p.x + p.w / 2, p.y); }
    p.onLadder = playerOnLadder();

    const dir = (Input.right ? 1 : 0) - (Input.left ? 1 : 0);
    if (dir !== 0) p.facing = dir;
    p.crouch = Input.down && p.grounded && !p.inWater && !p.climbing;

    // ---- Punch (melee) ----
    p.punchTime = Math.max(0, p.punchTime - dt);
    if (Input.pressed("punch") && p.punchTime <= 0 && p.dashTime <= 0) {
      p.punchTime = 0.30; p.punchAnim = 0; p.punchHitDone = false;
      Sfx.punch ? Sfx.punch() : Sfx.dash();
    }
    if (p.punchTime > 0) {
      p.punchAnim += dt;
      // land the hit in the middle of the swing
      if (!p.punchHitDone && p.punchTime <= 0.18) {
        p.punchHitDone = true;
        punchAttack();
      }
    }

    // ---- Dash ----
    if (Input.pressed("dash") && p.dashTime <= 0 && p.dashCD <= 0 && !p.crouch) {
      p.dashTime = DASH_TIME; p.dashCD = DASH_CD;
      p.vx = p.facing * DASH_SPEED; p.vy = p.inWater ? p.vy * 0.3 : 0;
      Sfx.dash(); for (let i = 0; i < 8; i++) spawnDust(p.x + p.w / 2, p.y + p.h, "#dfe7ef");
    }

    // ---- Climbing ----
    if (p.onLadder && (Input.up || Input.down)) p.climbing = true;
    if (p.climbing && !p.onLadder) p.climbing = false;
    if (p.climbing && p.jumpBuf > 0) { p.climbing = false; p.vy = JUMP_VY * 0.8; p.jumps = 1; p.jumpBuf = 0; }

    // ---- Horizontal ----
    if (p.dashTime > 0) {
      p.dashTime -= dt;
      p.vx = approach(p.vx, p.facing * (p.inWater ? DASH_SPEED * 0.6 : DASH_SPEED), 4000 * dt);
    } else {
      let target = (Input.running ? RUN : WALK) * dir;
      if (p.crouch) target *= 0.35;
      if (p.inWater) target *= 0.72;
      const acc = (p.grounded ? ACCEL : AIR_ACCEL) * dt;
      if (dir !== 0) p.vx = approach(p.vx, target, acc);
      else p.vx = approach(p.vx, 0, (p.grounded ? FRICTION : AIR_ACCEL * 0.6) * dt);
    }

    // ---- Vertical ----
    if (p.climbing) {
      p.vy = (Input.up ? -CLIMB : 0) + (Input.down ? CLIMB : 0);
    } else if (p.inWater) {
      if (Input.up || Input.jumpHeld) p.vy = approach(p.vy, -SWIM, 900 * dt);
      else if (Input.down) p.vy = approach(p.vy, SWIM, 900 * dt);
      else p.vy = approach(p.vy, 35, 500 * dt);
      if (p.jumpBuf > 0) { p.vy = -SWIM * 1.3; p.jumpBuf = 0; spawnSplash(p.x + p.w / 2, p.y + p.h); }
      p.jumps = 1;
    } else {
      // jump / double jump with coyote time + input buffering
      if (p.jumpBuf > 0) {
        if (p.grounded || p.coyote > 0) {
          p.vy = JUMP_VY; p.jumps = 1; p.grounded = false; p.coyote = 0; p.jumpBuf = 0;
          Sfx.jump(); spawnDust(p.x + p.w / 2, p.y + p.h, "#cdbd9a");
        } else if (p.jumps < 2) {
          p.vy = DJUMP_VY; p.jumps = 2; p.jumpBuf = 0;
          Sfx.doubleJump(); for (let i = 0; i < 6; i++) spawnDust(p.x + p.w / 2, p.y + p.h, "#fff");
        }
      }
      // variable jump height
      if (!Input.jumpHeld && p.vy < -200) p.vy = -200;
      p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
    }

    // one-way platforms stay solid from above so you never slip off by crouching
    p.wantDrop = false;

    // ---- Move + collide ----
    moveX(p, p.vx * dt);
    const wasGrounded = p.grounded;
    p.grounded = false;
    moveY(p, p.vy * dt);
    if (p.grounded && !wasGrounded && p.vy === 0) { /* landed */ }

    // hazards: spikes
    if (overlapsTile(p, "^")) damagePlayer(2);

    // fell out of the world
    if (p.y > levelH + 60) { loseLife(); return; }

    // animation: idle/jump advance on time; walking/running advances on
    // distance travelled so the legs never blur at high frame rates.
    p.anim += dt;
    if (p.grounded && !p.climbing) p.dist += Math.abs(p.vx) * dt;
  }

  function moveX(p, dx) {
    p.x += dx;
    const r0 = Math.floor(p.y / TILE), r1 = Math.floor((p.y + p.h - 1) / TILE);
    if (dx > 0) {
      const c = Math.floor((p.x + p.w - 1) / TILE);
      for (let r = r0; r <= r1; r++) {
        if (solidAt(c, r)) {
          const k = crateAt(c, r);
          if (k) { breakCrate(k); continue; }   // bump a crate and it bursts open
          p.x = c * TILE - p.w; p.vx = 0; break;
        }
      }
    } else if (dx < 0) {
      const c = Math.floor(p.x / TILE);
      for (let r = r0; r <= r1; r++) {
        if (solidAt(c, r)) {
          const k = crateAt(c, r);
          if (k) { breakCrate(k); continue; }   // bump a crate and it bursts open
          p.x = (c + 1) * TILE; p.vx = 0; break;
        }
      }
    }
    p.x = clamp(p.x, 0, levelW - p.w);
  }

  function moveY(p, dy) {
    const prevBottom = p.y + p.h;
    p.y += dy;
    const c0 = Math.floor(p.x / TILE), c1 = Math.floor((p.x + p.w - 1) / TILE);
    if (dy > 0) {
      const r = Math.floor((p.y + p.h - 1) / TILE);
      for (let c = c0; c <= c1; c++) {
        const ch = tileAt(c, r);
        const k = crateAt(c, r);
        if (isSolidChar(ch) || k) {
          if (k) { breakCrate(k); p.vy = DJUMP_VY * 0.7; continue; }
          p.y = r * TILE - p.h; p.vy = 0; p.grounded = true; p.jumps = 0; break;
        }
        // one-way platform — forgiving landing so tops never feel slippery
        if (ch === "=" && !p.wantDrop && p.vy >= 0 && prevBottom <= r * TILE + 8) {
          p.y = r * TILE - p.h; p.vy = 0; p.grounded = true; p.jumps = 0; break;
        }
      }
    } else if (dy < 0) {
      const r = Math.floor(p.y / TILE);
      for (let c = c0; c <= c1; c++) {
        if (isSolidChar(tileAt(c, r)) || crateAt(c, r)) { p.y = (r + 1) * TILE; p.vy = 0; break; }
      }
    }
  }

  function overlapsTile(p, ch) {
    const c0 = Math.floor(p.x / TILE), c1 = Math.floor((p.x + p.w - 1) / TILE);
    const r0 = Math.floor(p.y / TILE), r1 = Math.floor((p.y + p.h - 1) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (tileAt(c, r) === ch) return true;
    return false;
  }

  // ---------------- Damage / lives ----------------
  function damagePlayer(amount, fromX) {
    const p = player;
    if (p.invuln > 0 || p.dashTime > 0) return;
    health -= amount;
    p.invuln = 1.3;
    p.vy = -320;
    p.vx = (fromX != null ? (p.x < fromX ? -1 : 1) : -p.facing) * 220;
    Sfx.hit();
    if (navigator.vibrate) navigator.vibrate(60);
    if (health <= 0) loseLife();
    updateHUD();
  }

  function loseLife() {
    lives -= 1;
    if (lives < 0) { gameOver(); return; }
    health = maxHealth;
    Sfx.hit();
    const sp = level.spawn;
    player = makePlayer(sp.x * TILE + 6, sp.y * TILE);
    player.invuln = 1.5;
    projectiles = [];
    updateHUD();
  }

  function gameOver() {
    state = S.OVER;
    Sfx.stopMusic(); Sfx.gameOver();
    if (score > best) { best = score; localStorage.setItem("dogday.best2", String(best)); }
    dom.goStats.innerHTML = `Score <b>${score}</b> · Best <b>${best}</b>`;
    showOnly(dom.over);
    dom.hud.classList.add("hidden");
  }

  // ---------------- Enemies ----------------
  function punchAttack() {
    const p = player;
    const reach = 36;
    const box = {
      x: p.facing > 0 ? p.x + p.w - 4 : p.x - reach + 4,
      y: p.y + 2, w: reach, h: p.h - 4,
    };
    let hit = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (aabb(box, e)) {
        e.alive = false; e.deathT = 0.3; score += 30; hit = true;
        for (let i = 0; i < 12; i++) spawnDust(e.x + e.w / 2, e.y + e.h / 2, "#ffd27f");
        spawnText(e.x + e.w / 2, e.y - 6, "POW!");
      }
    }
    // a punch also bursts a crate right in front
    const cc = Math.floor((p.facing > 0 ? p.x + p.w + 6 : p.x - 6) / TILE);
    const cr0 = Math.floor(p.y / TILE), cr1 = Math.floor((p.y + p.h - 1) / TILE);
    for (let r = cr0; r <= cr1; r++) { const k = crateAt(cc, r); if (k) breakCrate(k); }
    if (hit) { score += 0; if (navigator.vibrate) navigator.vibrate(30); }
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.type === "patroller") {
        e.x += e.vx * e.dir * dt;
        // turn at range limits, walls, or ledges
        const aheadC = Math.floor((e.dir > 0 ? e.x + e.w + 2 : e.x - 2) / TILE);
        const footR = Math.floor((e.y + e.h + 2) / TILE);
        const midR = Math.floor((e.y + e.h / 2) / TILE);
        if (e.x < e.homeX - e.range || e.x > e.homeX + e.range ||
            solidAt(aheadC, midR) || !solidAt(aheadC, footR)) {
          e.dir *= -1;
          e.x = clamp(e.x, e.homeX - e.range, e.homeX + e.range);
        }
      } else if (e.type === "flyer") {
        e.phase += dt * 2.4;
        e.x += e.vx * e.dir * dt;
        if (e.x < e.homeX - e.range || e.x > e.homeX + e.range) e.dir *= -1;
        e.y = e.baseY + Math.sin(e.phase) * e.amp;
      } else if (e.type === "shooter") {
        e.cd -= dt;
        const dxp = player.x - e.x;
        e.dir = dxp < 0 ? -1 : 1;
        const near = Math.abs(dxp) < viewW * 0.6 && Math.abs(player.y - e.y) < TILE * 4;
        if (e.cd <= 0 && near) {
          e.cd = 1.6;
          projectiles.push({ x: e.x + e.w / 2, y: e.y + e.h / 2 - 4, vx: e.dir * 260, vy: 0, w: 14, h: 14, life: 3 });
          Sfx.shoot();
        }
      } else if (e.type === "chaser") {
        const dxp = (player.x + player.w / 2) - (e.x + e.w / 2);
        const sees = Math.abs(dxp) < (e.range || viewW * 0.55) &&
                     Math.abs(player.y - e.y) < TILE * 3;
        e.want = sees ? (dxp < 0 ? -1 : 1) : 0;
        if (e.want !== 0) e.dir = e.want;
        const spd = sees ? (e.vx * 1.55) : 0;
        const aheadC = Math.floor((e.dir > 0 ? e.x + e.w + 2 : e.x - 2) / TILE);
        const footR = Math.floor((e.y + e.h + 2) / TILE);
        const midR = Math.floor((e.y + e.h / 2) / TILE);
        const wall = solidAt(aheadC, midR);
        const ledge = !solidAt(aheadC, footR);
        // chase, but don't walk off ledges or into walls
        if (spd > 0 && !wall && !ledge) {
          e.x += spd * e.dir * dt;
          e.bob = (e.bob || 0) + dt * 10;
        }
      }
      // collision with player
      handleEnemyPlayer(e);
    }
    enemies = enemies.filter((e) => e.alive || e.deathT > 0);
  }

  function handleEnemyPlayer(e) {
    const p = player;
    if (!aabb(p, e)) return;
    const stomp = p.vy > 60 && (p.y + p.h) - e.y < 22;
    if (stomp) {
      e.alive = false; e.deathT = 0.3;
      p.vy = JUMP_VY * 0.62; p.jumps = 1;
      score += 30; Sfx.stomp();
      for (let i = 0; i < 10; i++) spawnDust(e.x + e.w / 2, e.y + e.h / 2, "#ffd27f");
      updateHUD();
    } else if (p.dashTime > 0) {
      e.alive = false; e.deathT = 0.3; score += 30; Sfx.stomp();
    } else {
      damagePlayer(1, e.x + e.w / 2);
    }
  }

  function updateProjectiles(dt) {
    for (const pr of projectiles) {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (aabb(player, pr)) { damagePlayer(1, pr.x); pr.life = 0; }
      const c = Math.floor(pr.x / TILE), r = Math.floor(pr.y / TILE);
      if (solidAt(c, r)) pr.life = 0;
    }
    projectiles = projectiles.filter((p) => p.life > 0);
  }

  // ---------------- Pickups / crates ----------------
  function collect(p) {
    p.got = true;
    if (p.type === "portal") {
      score += 50; Sfx.power();
      for (let i = 0; i < 16; i++) spawnSparkle(p.x, p.y);
      enterBonus();
      return;
    }
    if (p.type === "coin") { coins++; score += 10; gotPickups++; Sfx.coin(); }
    else if (p.type === "gem") { gems++; score += 50; gotPickups++; Sfx.gem(); }
    else if (p.type === "letter") {
      wordGot.add(p.letter); score += 150; Sfx.letter();
      spawnText(p.x, p.y, p.letter);
      if (!bonusGiven && WORD.split("").every((ch) => wordGot.has(ch))) {
        bonusGiven = true; lives++; Sfx.win();
        spawnText(player.x, player.y - 20, "+1 LIFE!");
      }
    }
    else if (p.type === "heart") { health = Math.min(maxHealth, health + 1); score += 20; Sfx.power(); }
    else if (p.type === "shield") { player.invuln = Math.max(player.invuln, 6); player.shield = 6; score += 20; Sfx.power(); }
    else if (p.type === "egg") { lives++; score += 20; Sfx.power(); }
    for (let i = 0; i < 8; i++) spawnSparkle(p.x, p.y);
    if (gotPickups >= Math.ceil(totalPickups * 0.7)) {
      if (!exitUnlocked) { exitUnlocked = true; Sfx.door(); }
    }
    updateHUD();
  }

  function updatePickups(dt) {
    for (const p of pickups) {
      if (p.got) continue;
      if (p.vy !== undefined && !p.settled) {
        // "spat out" loot arcs then settles on the ground
        p.vy = Math.min(900, p.vy + 1500 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.96;
        const c = Math.floor(p.x / TILE), r = Math.floor((p.y + 12) / TILE);
        if (p.vy > 0 && solidAt(c, r)) { p.y = r * TILE - 12; p.vy = 0; p.vx = 0; p.settled = true; }
        p.x = clamp(p.x, TILE / 2, levelW - TILE / 2);
      } else {
        p.bob += dt * 4;
      }
      if (aabb(player, { x: p.x - 16, y: p.y - 16, w: 32, h: 32 })) {
        collect(p);
        if (p.type === "portal") break; // level was swapped under us
      }
    }
  }

  function spawnLoot(x, y, type, letter) {
    pickups.push({
      type, letter: letter || null, x, y, got: false, bob: Math.random() * 6,
      vx: rand(-150, 150), vy: rand(-360, -200), settled: false,
    });
  }

  function breakCrate(k) {
    if (k.broken) return;
    k.broken = true;
    Sfx.stomp();
    const cx = k.col * TILE + TILE / 2, cy = k.row * TILE + TILE / 2;
    for (let i = 0; i < 14; i++) spawnDust(cx, cy, "#c98f5a");
    // crates spit out a handful of coins...
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) spawnLoot(cx, cy - 6, "coin");
    // ...plus any special treasure inside (gem / heart / letter-bone)
    if (k.contains && k.contains !== "coin") spawnLoot(cx, cy - 10, k.contains, k.letter);
  }

  // ---------------- Particles ----------------
  function spawnDust(x, y, color) {
    particles.push({ x, y, vx: rand(-90, 90), vy: rand(-160, -30), life: rand(0.3, 0.6), max: 0.6, r: rand(2, 5), color, g: 600 });
  }
  function spawnSparkle(x, y) {
    const a = rand(0, 6.28);
    particles.push({ x, y, vx: Math.cos(a) * rand(40, 140), vy: Math.sin(a) * rand(40, 140), life: 0.4, max: 0.4, r: rand(2, 4), color: "#ffe082", g: 200 });
  }
  function spawnSplash(x, y) {
    for (let i = 0; i < 10; i++) particles.push({ x, y, vx: rand(-120, 120), vy: rand(-220, -40), life: 0.5, max: 0.5, r: rand(2, 4), color: "#bfe9ff", g: 700 });
  }
  function spawnText(x, y, text) {
    particles.push({ x, y, vx: 0, vy: -40, life: 1.1, max: 1.1, text, color: "#fff" });
  }
  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      if (p.g) p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  // ---------------- Camera ----------------
  function updateCamera() {
    // Horizontal dead-zone: the hero can roam a central band of the screen
    // before the camera scrolls, so walking/running reads as actual movement.
    const px = player.x + player.w / 2;
    const leftEdge = cam.x + viewW * 0.38;
    const rightEdge = cam.x + viewW * 0.62;
    let txCam = cam.x;
    if (px < leftEdge) txCam = px - viewW * 0.38;
    else if (px > rightEdge) txCam = px - viewW * 0.62;
    txCam = clamp(txCam, 0, Math.max(0, levelW - viewW));
    cam.x += (txCam - cam.x) * 0.18;

    const ty = player.y + player.h / 2 - viewH * 0.55;
    cam.y += (clamp(ty, 0, Math.max(0, levelH - viewH)) - cam.y) * 0.16;
  }

  // ---------------- Win / clear ----------------
  function checkExit() {
    const ex = level.exit;
    const door = { x: ex.x * TILE, y: ex.y * TILE - TILE, w: TILE, h: TILE * 2 };
    if (exitUnlocked && aabb(player, door)) {
      Sfx.stopMusic(); Sfx.levelClear();
      score += 200 + lives * 50;
      if (inBonus) {
        // leaving the secret world warps you onward to the next main level
        inBonus = false;
        const target = bonusReturnIndex + 1;
        if (target >= window.LEVELS.length) {
          state = S.WIN;
          if (score > best) { best = score; localStorage.setItem("dogday.best2", String(best)); }
          dom.winStats.innerHTML = `You spelled ${[...wordGot].length === WORD.length ? "<b>BONES</b> 🦴" : "the secret word"}!<br>Final score <b>${score}</b> · Best <b>${best}</b>`;
          showOnly(dom.win); dom.hud.classList.add("hidden");
        } else {
          beginLevel(target);
        }
        return;
      }
      if (levelIndex + 1 >= window.LEVELS.length) {
        state = S.WIN;
        if (score > best) { best = score; localStorage.setItem("dogday.best2", String(best)); }
        dom.winStats.innerHTML = `You spelled ${[...wordGot].length === WORD.length ? "<b>BONES</b> 🦴" : "the secret word"}!<br>Final score <b>${score}</b> · Best <b>${best}</b>`;
        showOnly(dom.win); dom.hud.classList.add("hidden");
      } else {
        state = S.CLEAR;
        dom.clearStats.innerHTML = `Coins ${coins} · Gems ${gems}<br>Score <b>${score}</b>`;
        showOnly(dom.clear); dom.hud.classList.add("hidden");
      }
    }
  }

  // ====================================================================
  // RENDER
  // ====================================================================
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (state === S.LOADING || state === S.MENU) { drawMenuScene(); return; }
    if (!level) return;

    drawBackground();

    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

    drawTiles();
    drawExit();
    drawCrates();
    drawPickups();
    drawEnemies();
    drawProjectiles();
    drawPlayer();
    drawParticles();
    drawWaterOverlay();

    ctx.restore();

    if (level.theme === "cave") drawVignette();
  }

  function drawMenuScene() {
    drawSky("forest");
    drawParallax("forest", performance.now() / 1000 * 14);
    // ground band
    ctx.fillStyle = "#7cc06a"; ctx.fillRect(0, viewH - 74, viewW, 74);
    ctx.fillStyle = "#6aa757"; ctx.fillRect(0, viewH - 74, viewW, 8);
    // hero idle bobbing in the centre
    const frames = Sprites.hero.idle;
    const t = performance.now() / 1000;
    const img = frames && frames.length ? frames[Math.floor(t * 6) % frames.length] : null;
    if (img && img.complete && img.naturalWidth) {
      const h = 158, w = h * HERO_RATIO;
      ctx.drawImage(img, viewW / 2 - w / 2, viewH - 74 - h + 16, w, h);
    }
  }

  // Tiled horizontal band in screen space (parallax via scroll factor).
  function band(img, y, h, scroll, factor) {
    if (!img || !img.complete || !img.naturalWidth) return;
    const w = h * (img.naturalWidth / img.naturalHeight);
    let off = (-scroll * factor) % w;
    if (off > 0) off -= w;
    for (let x = off; x < viewW + w; x += w) ctx.drawImage(img, x, y, w, h);
  }

  function drawSky(t) {
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    if (t === "forest") { g.addColorStop(0, "#8ed2ff"); g.addColorStop(0.55, "#cfeeff"); g.addColorStop(1, "#e9f7df"); }
    else if (t === "cave") { g.addColorStop(0, "#28344e"); g.addColorStop(1, "#0d1019"); }
    else { g.addColorStop(0, "#2d8bc9"); g.addColorStop(1, "#0a3a63"); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, viewW, viewH);
    if (t === "forest" && Sprites.props.sun && Sprites.props.sun.complete) {
      ctx.globalAlpha = 0.95; ctx.drawImage(Sprites.props.sun, viewW - 150, 46, 92, 92); ctx.globalAlpha = 1;
    }
  }

  function drawParallax(t, scroll) {
    // drifting clouds
    band(Sprites.bg.cloudLayer1, viewH * 0.03, viewH * 0.30, scroll, 0.10);
    // far + near hill bands
    band(Sprites.bg.hillsLarge, viewH * 0.34, viewH * 0.46, scroll, 0.25);
    band(Sprites.bg.hills, viewH * 0.50, viewH * 0.48, scroll, 0.45);
    // a band of trees/bushes for depth
    drawPropBand(t, scroll);
  }

  function drawPropBand(t, scroll) {
    const list = t === "underwater" ? ["treePalm", "bush1", "treeSmall_green2"]
      : t === "cave" ? ["treeFrozen", "treePineSnow", "bushAlt1"]
        : ["tree", "treePine", "treeSmall_green1", "bush1", "treeOrange"];
    const factor = 0.62, spacing = 230, base = viewH * 0.78, hMax = viewH * 0.26;
    const first = Math.floor((scroll * factor) / spacing) - 1;
    for (let i = first; i < first + viewW / spacing + 3; i++) {
      const name = list[((i % list.length) + list.length) % list.length];
      const img = Sprites.props[name];
      if (!img || !img.complete || !img.naturalWidth) continue;
      const x = i * spacing - scroll * factor;
      const isBush = name.startsWith("bush");
      const h = isBush ? hMax * 0.45 : hMax * (0.7 + ((i * 7) % 5) * 0.06);
      const w = h * (img.naturalWidth / img.naturalHeight);
      ctx.drawImage(img, x, base - h, w, h);
    }
  }

  function drawBackground() {
    const t = level.theme;
    drawSky(t);
    drawParallax(t, cam.x);
    if (t === "cave") { ctx.fillStyle = "rgba(8,10,22,0.55)"; ctx.fillRect(0, 0, viewW, viewH); }
    else if (t === "underwater") { ctx.fillStyle = "rgba(18,90,150,0.34)"; ctx.fillRect(0, 0, viewW, viewH); }
  }

  function drawTiles() {
    const c0 = Math.max(0, Math.floor(cam.x / TILE));
    const c1 = Math.min(cols - 1, Math.ceil((cam.x + viewW) / TILE));
    const r0 = Math.max(0, Math.floor(cam.y / TILE));
    const r1 = Math.min(rows - 1, Math.ceil((cam.y + viewH) / TILE));
    const t = level.theme;
    const dirt = t === "cave" ? "#3a3550" : t === "underwater" ? "#2a5a4a" : "#caa472";
    const dirtDark = t === "cave" ? "#2a2740" : t === "underwater" ? "#1f4438" : "#a9844f";
    const grass = t === "cave" ? "#5b6b8a" : t === "underwater" ? "#3fae8a" : "#7bc96f";

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = grid[r][c];
        const x = c * TILE, y = r * TILE;
        if (ch === "#") { ctx.fillStyle = dirt; ctx.fillRect(x, y, TILE, TILE); ctx.fillStyle = dirtDark; ctx.fillRect(x, y + TILE - 6, TILE, 6); }
        else if (ch === "G") {
          ctx.fillStyle = dirt; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = grass; ctx.fillRect(x, y, TILE, 12);
          ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(x, y + 12, TILE, 4);
        }
        else if (ch === "=") {
          ctx.fillStyle = dirtDark; ctx.fillRect(x, y, TILE, 12);
          ctx.fillStyle = grass; ctx.fillRect(x, y, TILE, 5);
        }
        else if (ch === "L") {
          ctx.strokeStyle = t === "forest" ? "#6b4a23" : "#9a8";
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(x + 10, y); ctx.lineTo(x + 10, y + TILE); ctx.moveTo(x + TILE - 10, y); ctx.lineTo(x + TILE - 10, y + TILE);
          for (let yy = y + 6; yy < y + TILE; yy += 12) { ctx.moveTo(x + 10, yy); ctx.lineTo(x + TILE - 10, yy); }
          ctx.stroke();
        }
        else if (ch === "^") {
          ctx.fillStyle = "#c9ccd6";
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(x + i * 15 + 2, y + TILE);
            ctx.lineTo(x + i * 15 + 9, y + TILE - 20);
            ctx.lineTo(x + i * 15 + 16, y + TILE); ctx.closePath(); ctx.fill();
          }
        }
      }
    }
  }

  function drawWaterOverlay() {
    if (level.theme !== "underwater") {
      // still draw any water tiles (e.g. small ponds)
    }
    const c0 = Math.max(0, Math.floor(cam.x / TILE));
    const c1 = Math.min(cols - 1, Math.ceil((cam.x + viewW) / TILE));
    const r0 = Math.max(0, Math.floor(cam.y / TILE));
    const r1 = Math.min(rows - 1, Math.ceil((cam.y + viewH) / TILE));
    ctx.fillStyle = "rgba(40,130,200,0.32)";
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (grid[r][c] === "W") ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
  }

  function drawExit() {
    const ex = level.exit;
    const x = ex.x * TILE, y = ex.y * TILE - TILE;
    // frame
    ctx.fillStyle = exitUnlocked ? "#6ad36a" : "#7a6b55";
    ctx.fillRect(x - 4, y - 4, TILE + 8, TILE * 2 + 8);
    ctx.fillStyle = exitUnlocked ? "#2e7d32" : "#3a3228";
    ctx.fillRect(x, y, TILE, TILE * 2);
    ctx.fillStyle = exitUnlocked ? "#a5f0a5" : "#5a4d3a";
    ctx.fillRect(x + 6, y + 6, TILE - 12, TILE * 2 - 12);
    // icon
    ctx.font = "26px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(exitUnlocked ? "🚪" : "🔒", x + TILE / 2, y + TILE);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }

  function drawCrates() {
    for (const k of crates) {
      if (k.broken) continue;
      const x = k.col * TILE, y = k.row * TILE;
      ctx.fillStyle = "#b5793f"; ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = "#8a5a2b"; ctx.lineWidth = 3;
      ctx.fillRect(x + 2, y + 2, TILE - 4, 5); ctx.fillRect(x + 2, y + TILE - 7, TILE - 4, 5);
      ctx.strokeStyle = "#6e471f"; ctx.beginPath();
      ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + TILE - 4, y + TILE - 4);
      ctx.moveTo(x + TILE - 4, y + 4); ctx.lineTo(x + 4, y + TILE - 4); ctx.stroke();
    }
  }

  function drawPickups() {
    for (const p of pickups) {
      if (p.got) continue;
      const bob = Math.sin(p.bob) * 4;
      const x = p.x, y = p.y + bob;
      if (p.type === "coin") {
        ctx.fillStyle = "#ffd54f"; ctx.beginPath(); ctx.arc(x, y, 11, 0, 6.28); ctx.fill();
        ctx.fillStyle = "#f0a500"; ctx.beginPath(); ctx.arc(x, y, 11, 0, 6.28); ctx.lineWidth = 3; ctx.strokeStyle = "#f0a500"; ctx.stroke();
        ctx.fillStyle = "#fff4c2"; ctx.fillRect(x - 2, y - 6, 4, 12);
      } else if (p.type === "gem") {
        ctx.fillStyle = "#5ad1ff"; ctx.beginPath();
        ctx.moveTo(x, y - 12); ctx.lineTo(x + 11, y - 2); ctx.lineTo(x, y + 13); ctx.lineTo(x - 11, y - 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath();
        ctx.moveTo(x, y - 12); ctx.lineTo(x + 5, y - 3); ctx.lineTo(x - 4, y - 3); ctx.closePath(); ctx.fill();
      } else if (p.type === "letter") {
        ctx.fillStyle = "rgba(255,235,130,0.35)"; ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.28); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#e6a700"; ctx.lineWidth = 3;
        ctx.font = "bold 22px 'Baloo 2', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.strokeText(p.letter, x, y); ctx.fillText(p.letter, x, y);
        ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      } else if (p.type === "portal") {
        // swirling magic portal
        const t = p.bob;
        for (let r = 18; r > 4; r -= 4) {
          ctx.strokeStyle = `hsla(${(t * 60 + r * 12) % 360}, 90%, 65%, 0.85)`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, r, t + r, t + r + 5.0);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.28); ctx.fill();
      } else {
        const icon = p.type === "heart" ? "❤️" : p.type === "shield" ? "🛡️" : "🥚";
        ctx.font = "24px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(icon, x, y); ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      }
    }
  }

  function drawEnemies() {
    for (const e of enemies) {
      const x = e.x, y = e.y;
      if (!e.alive) { // death poof
        ctx.globalAlpha = Math.max(0, e.deathT / 0.3);
        ctx.font = "26px sans-serif"; ctx.fillText("💥", x, y + e.h);
        ctx.globalAlpha = 1; continue;
      }
      // image-based cube pets
      const spr = e.sprite && Sprites.enemies[e.sprite];
      if (spr && spr.complete && spr.naturalWidth) {
        const pad = e.type === "flyer" ? 9 : 7;
        const dw = e.w + pad * 2, dh = e.h + pad * 2;
        ctx.save();
        ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
        if (e.dir < 0) ctx.scale(-1, 1);
        ctx.drawImage(spr, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
        if (e.type === "shooter") {
          ctx.fillStyle = "#2c3e50";
          ctx.fillRect(x + (e.dir > 0 ? e.w - 4 : -10), y + e.h / 2 - 4, 14, 8);
        }
        continue;
      }
      if (e.type === "patroller") {
        ctx.fillStyle = level.theme === "underwater" ? "#ff7f50" : "#9b59b6";
        roundRect(x, y + 6, e.w, e.h - 6, 10); ctx.fill();
        eyes(x + e.w * 0.32, y + 16, x + e.w * 0.68, y + 16);
        ctx.fillStyle = "#fff";
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 6 + i * 12, y + e.h); ctx.lineTo(x + 12 + i * 12, y + e.h - 6); ctx.lineTo(x + 18 + i * 12, y + e.h); ctx.fill(); }
      } else if (e.type === "flyer") {
        const flap = Math.sin(e.phase * 3) * 6;
        ctx.fillStyle = level.theme === "underwater" ? "#ffd166" : level.theme === "cave" ? "#6c5b7b" : "#f6c177";
        if (level.theme === "underwater") {
          // fish
          ctx.beginPath(); ctx.ellipse(x + e.w / 2, y + e.h / 2, e.w / 2, e.h / 2, 0, 0, 6.28); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + (e.dir > 0 ? 0 : e.w), y + e.h / 2); ctx.lineTo(x + (e.dir > 0 ? -10 : e.w + 10), y + 2); ctx.lineTo(x + (e.dir > 0 ? -10 : e.w + 10), y + e.h - 2); ctx.fill();
        } else {
          ctx.beginPath(); ctx.ellipse(x + e.w / 2, y + e.h / 2, e.w / 2.4, e.h / 2.4, 0, 0, 6.28); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x, y + e.h / 2); ctx.quadraticCurveTo(x - 10, y - flap, x - 16, y + e.h / 2); ctx.lineTo(x, y + e.h / 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + e.w, y + e.h / 2); ctx.quadraticCurveTo(x + e.w + 10, y - flap, x + e.w + 16, y + e.h / 2); ctx.lineTo(x + e.w, y + e.h / 2); ctx.fill();
        }
        eyes(x + e.w * 0.36, y + e.h * 0.42, x + e.w * 0.64, y + e.h * 0.42, 3);
      } else if (e.type === "shooter") {
        ctx.fillStyle = level.theme === "underwater" ? "#e76f51" : "#566573";
        roundRect(x, y + 4, e.w, e.h - 4, 8); ctx.fill();
        ctx.fillStyle = "#2c3e50";
        ctx.fillRect(x + (e.dir > 0 ? e.w - 6 : -8), y + e.h / 2 - 5, 14, 10);
        eyes(x + e.w * 0.32, y + 16, x + e.w * 0.6, y + 16, 4);
      }
    }
  }
  function eyes(x1, y1, x2, y2, r = 4) {
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x1, y1, r, 0, 6.28); ctx.arc(x2, y2, r, 0, 6.28); ctx.fill();
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(x1, y1, r / 2, 0, 6.28); ctx.arc(x2, y2, r / 2, 0, 6.28); ctx.fill();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawProjectiles() {
    for (const pr of projectiles) {
      ctx.fillStyle = "#ff5a5a"; ctx.beginPath(); ctx.arc(pr.x, pr.y, 7, 0, 6.28); ctx.fill();
      ctx.fillStyle = "rgba(255,180,120,0.6)"; ctx.beginPath(); ctx.arc(pr.x - pr.vx * 0.01, pr.y, 9, 0, 6.28); ctx.fill();
    }
  }

  function drawPlayer() {
    const p = player;
    if (p.invuln > 0 && p.shield <= 0 && Math.floor(p.invuln * 12) % 2 === 0) return;

    // shield bubble
    if (p.shield > 0) {
      ctx.strokeStyle = "rgba(120,200,255,0.8)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y + p.h / 2, 30, 0, 6.28); ctx.stroke();
    }

    const H = Sprites.hero;
    let frames, idx;
    const pressingMove = Input.left || Input.right;
    if (p.punchTime > 0 && H.punch && H.punch.length) {
      // play the punch swing once over its duration
      frames = H.punch;
      const t = 1 - (p.punchTime / 0.30);
      idx = clamp(Math.floor(t * frames.length), 0, frames.length - 1);
    } else if (p.climbing) {
      frames = H.run;
      idx = (Input.up || Input.down) ? Math.floor(p.dist / 26) % frames.length : 2;
    } else if (!p.grounded && !p.inWater) {
      frames = p.vy < -40 ? H.jumpup : H.jumpdown;
      idx = clamp(Math.floor(p.anim * 12) % frames.length, 0, frames.length - 1);
    } else if (p.inWater) {
      frames = H.run; idx = Math.floor(p.anim * 8) % frames.length;
    } else if (pressingMove && Math.abs(p.vx) > 18) {
      // distance-based legs: a quick run vs. a calmer walk (no leg blur)
      frames = H.run;
      const stride = Input.running ? 13 : 24;
      idx = Math.floor(p.dist / stride) % frames.length;
    } else {
      // truly standing still — hold one calm pose (never shuffles in place)
      frames = H.idle; idx = 0;
    }
    const img = frames && frames[idx];

    let h = HERO_DRAW_H, w = h * HERO_RATIO;
    if (p.crouch) h *= 0.72;
    const cx = p.x + p.w / 2;
    // gentle breathing bob so an idle pup still feels alive
    const idleBob = frames === H.idle ? Math.sin(p.anim * 2.2) * 1.5 : 0;
    const bottom = p.y + p.h + HERO_FOOT + idleBob;

    ctx.save();
    ctx.translate(cx, bottom);
    if (p.facing < 0) ctx.scale(-1, 1);
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, -w / 2, -h, w, h);
    else { ctx.fillStyle = "#caa46a"; ctx.fillRect(-p.w / 2, -p.h, p.w, p.h); }
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.text) {
        ctx.globalAlpha = a; ctx.fillStyle = "#fff"; ctx.strokeStyle = "#e6a700"; ctx.lineWidth = 3;
        ctx.font = "bold 18px 'Baloo 2', sans-serif"; ctx.textAlign = "center";
        ctx.strokeText(p.text, p.x, p.y); ctx.fillText(p.text, p.x, p.y);
        ctx.textAlign = "start"; ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = a; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(viewW / 2, viewH / 2, viewH * 0.3, viewW / 2, viewH / 2, viewH * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, viewW, viewH);
  }

  // ====================================================================
  // HUD + overlays
  // ====================================================================
  function updateHUD() {
    dom.hLives.textContent = "🐾 ×" + Math.max(0, lives);
    let hearts = "";
    for (let i = 0; i < maxHealth; i++) hearts += i < health ? "❤️" : "🤍";
    dom.hHealth.textContent = hearts;
    dom.hCoins.textContent = "🪙 " + coins;
    dom.hGems.textContent = "💎 " + gems;
    dom.hScore.textContent = score;
    dom.hLevel.textContent = level ? level.name : "";
    let w = "";
    for (const ch of WORD) w += `<span class="${wordGot.has(ch) ? "lit" : ""}">${ch}</span>`;
    dom.hWord.innerHTML = w;
    const need = Math.ceil(totalPickups * 0.7);
    const pct = totalPickups ? Math.min(100, Math.round((gotPickups / totalPickups) * 100)) : 100;
    dom.hObj.innerHTML = exitUnlocked
      ? `<span class="ok">🚪 Exit open!</span>`
      : `🔒 ${gotPickups}/${need} (${pct}%)`;
  }

  function showOnly(el) {
    [dom.loading, dom.menu, dom.intro, dom.pause, dom.clear, dom.over, dom.win].forEach((o) => o && o.classList.add("hidden"));
    if (el) el.classList.remove("hidden");
  }

  // ====================================================================
  // Flow
  // ====================================================================
  function startGame() {
    Sfx.unlock();
    levelIndex = 0; lives = 3; health = maxHealth = 3; score = 0;
    coins = 0; gems = 0; wordGot = new Set(); bonusGiven = false;
    beginLevel(0);
  }
  function beginLevel(i) {
    levelIndex = i;
    loadLevel(i);
    state = S.INTRO; introTimer = 0;
    dom.introTitle.textContent = `Level ${i + 1} · ${level.name}`;
    dom.introSub.innerHTML = `Collect <b>70%</b> of coins &amp; gems to open the exit.<br>Find the hidden <b>${WORD}</b> letters!`;
    showOnly(dom.intro);
    dom.hud.classList.add("hidden");
    updateHUD();
  }
  function go() {
    state = S.PLAYING;
    showOnly(null);
    dom.hud.classList.remove("hidden");
    if (!Sfx.muted) Sfx.startMusic(level.theme);
  }
  function nextLevel() { beginLevel(levelIndex + 1); }
  function enterBonus() {
    if (inBonus || !window.BONUS_LEVELS || !window.BONUS_LEVELS.candy) return;
    bonusReturnIndex = levelIndex;
    inBonus = true;
    Sfx.stopMusic(); Sfx.door();
    applyLevel(window.BONUS_LEVELS.candy);
    state = S.INTRO; introTimer = 0;
    dom.introTitle.textContent = "✨ A Secret World! ✨";
    dom.introSub.innerHTML = `You slipped through the portal into a hidden land of treasure!<br>Grab the loot, then reach the exit to warp ahead.`;
    showOnly(dom.intro);
    dom.hud.classList.add("hidden");
    updateHUD();
  }  function togglePause() {
    if (state === S.PLAYING) { state = S.PAUSED; showOnly(dom.pause); Sfx.stopMusic(); }
    else if (state === S.PAUSED) { state = S.PLAYING; showOnly(null); dom.hud.classList.remove("hidden"); if (!Sfx.muted) Sfx.startMusic(level.theme); }
  }
  function toMenu() {
    Sfx.stopMusic(); state = S.MENU; showOnly(dom.menu);
    dom.hud.classList.add("hidden"); dom.menuBest.textContent = best;
  }

  // ====================================================================
  // Loop
  // ====================================================================
  let last = 0;
  function frame(now) {
    if (!last) last = now;
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.05) dt = 0.05;

    if (Input.pressed("pause") && (state === S.PLAYING || state === S.PAUSED)) togglePause();
    if (Input.pressed("mute")) { const m = Sfx.toggleMute(); dom.btnMute.textContent = m ? "🔇" : "🔊"; if (m) Sfx.stopMusic(); else if (state === S.PLAYING) Sfx.startMusic(level.theme); }

    if (state === S.INTRO) {
      introTimer += dt;
      if (Input.pressed("jump") || Input.pressed("start") || introTimer > 6) go();
    } else if (state === S.PLAYING) {
      updatePlayer(dt);
      updateEnemies(dt);
      updateProjectiles(dt);
      updatePickups(dt);
      if (player.shield > 0) player.shield -= dt;
      updateParticles(dt);
      updateCamera();
      checkExit();
    } else {
      if (level) updateParticles(dt);
    }

    render();
    requestAnimationFrame(frame);
  }

  // ====================================================================
  // Boot
  // ====================================================================
  Input.onFirstInteraction(() => Sfx.unlock());
  dom.btnPlay.addEventListener("click", startGame);
  dom.btnGo.addEventListener("click", go);
  dom.btnResume.addEventListener("click", togglePause);
  dom.btnQuit.addEventListener("click", toMenu);
  dom.btnNext.addEventListener("click", nextLevel);
  dom.btnRetry.addEventListener("click", startGame);
  dom.btnAgain.addEventListener("click", startGame);
  dom.btnPause.addEventListener("click", togglePause);
  dom.btnMute.addEventListener("click", () => { const m = Sfx.toggleMute(); dom.btnMute.textContent = m ? "🔇" : "🔊"; if (m) Sfx.stopMusic(); else if (state === S.PLAYING) Sfx.startMusic(level.theme); });

  resize();
  Sprites.load((p) => { dom.loaderFill.style.width = Math.round(p * 100) + "%"; }).then(() => {
    toMenu();
  });
  requestAnimationFrame(frame);
})();
