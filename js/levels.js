/* levels.js — three themed tile-map levels built with a small builder API.
 * window.LEVELS = [ levelObj, ... ]
 *
 * Terrain grid chars: ' ' empty, '#' dirt, 'G' grass-top, '=' one-way,
 *   'W' water, 'L' ladder, '^' spikes, 'X' exit.
 * Entities live in separate arrays (pixel conversion happens in main.js).
 */
(function () {
  "use strict";

  class LevelBuilder {
    constructor(cols, rows, meta) {
      this.cols = cols;
      this.rows = rows;
      this.meta = meta;
      this.grid = Array.from({ length: rows }, () => new Array(cols).fill(" "));
      this.pickups = [];
      this.crates = [];
      this.enemies = [];
      this.spawn = { x: 2, y: rows - 3 };
      this.exit = { x: cols - 3, y: rows - 3 };
    }
    inb(x, y) { return x >= 0 && x < this.cols && y >= 0 && y < this.rows; }
    set(x, y, ch) { if (this.inb(x, y)) this.grid[y][x] = ch; }

    fillGround(topRow) {
      for (let x = 0; x < this.cols; x++) {
        this.grid[topRow][x] = "G";
        for (let y = topRow + 1; y < this.rows; y++) this.grid[y][x] = "#";
      }
      this._groundTop = topRow;
      return this;
    }
    pit(x0, x1) {
      for (let x = x0; x <= x1; x++)
        for (let y = 0; y < this.rows; y++)
          if (this.grid[y][x] === "#" || this.grid[y][x] === "G") this.grid[y][x] = " ";
      return this;
    }
    solid(x, y, w, h, ch = "#") {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch);
      return this;
    }
    block(x, y, w) { // grass-topped platform with dirt under
      for (let i = 0; i < w; i++) {
        this.set(x + i, y, "G");
        this.set(x + i, y + 1, "#");
      }
      return this;
    }
    plat(x, y, w) { for (let i = 0; i < w; i++) this.set(x + i, y, "="); return this; }
    water(x0, x1, topRow) {
      for (let x = x0; x <= x1; x++) for (let y = topRow; y < this.rows; y++)
        if (this.grid[y][x] === " ") this.grid[y][x] = "W";
      return this;
    }
    ladder(x, y0, y1) { for (let y = y0; y <= y1; y++) this.set(x, y, "L"); return this; }
    spikes(x, y, w) { for (let i = 0; i < w; i++) this.set(x + i, y, "^"); return this; }

    coins(x, y, n, step = 1) {
      for (let i = 0; i < n; i++) this.pickups.push({ type: "coin", x: x + i * step, y });
      return this;
    }
    coinArc(x0, x1, y, h = 2) {
      const n = x1 - x0 + 1;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        this.pickups.push({ type: "coin", x: x0 + i, y: y - Math.round(Math.sin(t * Math.PI) * h) });
      }
      return this;
    }
    gem(x, y) { this.pickups.push({ type: "gem", x, y }); return this; }
    heart(x, y) { this.pickups.push({ type: "heart", x, y }); return this; }
    shield(x, y) { this.pickups.push({ type: "shield", x, y }); return this; }
    egg(x, y) { this.pickups.push({ type: "egg", x, y }); return this; }
    portal(x, y) { this.pickups.push({ type: "portal", x, y }); return this; }
    letter(ch, x, y) { this.pickups.push({ type: "letter", letter: ch, x, y }); return this; }
    crate(x, y, contains = "coin") { this.crates.push({ x, y, contains }); return this; }

    patroller(x, y, range = 4) { this.enemies.push({ type: "patroller", x, y, range }); return this; }
    flyer(x, y, range = 3, amp = 2) { this.enemies.push({ type: "flyer", x, y, range, amp }); return this; }
    shooter(x, y, dir = -1) { this.enemies.push({ type: "shooter", x, y, dir }); return this; }
    chaser(x, y, range = 7) { this.enemies.push({ type: "chaser", x, y, range }); return this; }

    setSpawn(x, y) { this.spawn = { x, y }; return this; }
    setExit(x, y) { this.exit = { x, y }; this.set(x, y, "X"); return this; }

    build() {
      return {
        ...this.meta,
        cols: this.cols,
        rows: this.rows,
        grid: this.grid,
        pickups: this.pickups,
        crates: this.crates,
        enemies: this.enemies,
        spawn: this.spawn,
        exit: this.exit,
      };
    }
  }

  // =====================================================================
  // LEVEL 1 — FOREST  (big, explorable; chasers, hurdles, hidden caverns,
  //                    a secret PORTAL to a treasure world, letter B)
  // =====================================================================
  function forest() {
    const b = new LevelBuilder(150, 18, { name: "Sunny Forest", theme: "forest", music: "forest" });
    const GT = 15;                 // ground top row
    b.fillGround(GT);
    b.setSpawn(2, GT - 2);

    // ---- ACT 1: meadow + first hops ----
    b.coins(3, GT - 2, 5);
    b.plat(8, GT - 3, 3); b.coins(8, GT - 4, 3);
    b.crate(12, GT - 1, "gem");
    b.crate(13, GT - 1, "coin");

    b.pit(16, 17);                 // small 2-wide pit
    b.coinArc(15, 18, GT - 2, 2);
    b.coins(20, GT - 2, 3);
    b.patroller(23, GT - 1, 4);

    // stepped tree-platforms climbing to a high coin trail
    b.plat(26, GT - 3, 3); b.coins(26, GT - 4, 3);
    b.plat(31, GT - 5, 3); b.coins(31, GT - 6, 3);
    b.plat(36, GT - 7, 3); b.gem(37, GT - 8);
    b.heart(29, GT - 2);

    // ---- HIDDEN TUNNEL through the hill ----
    // a grassy mound blocks the path; jump OVER it, or duck THROUGH the
    // hidden tunnel at its base to grab a stash most players will miss.
    b.solid(40, GT - 3, 10, 4, "#");      // mound cols 40-49, rows GT-3..GT
    for (let i = 0; i < 10; i++) b.set(40 + i, GT - 3, "G"); // grassy cap
    b.solid(40, GT - 2, 10, 2, " ");      // carve a passage at the base (both ends open)
    b.coins(42, GT - 1, 6);               // coins hidden in the tunnel
    b.gem(45, GT - 1);
    b.egg(47, GT - 1);                    // a 1-up tucked away inside
    b.coins(41, GT - 4, 8);               // coin trail for those who go over the top
    b.flyer(45, GT - 6, 3, 2);

    // ---- ACT 2: chasers + hurdles ----
    b.coins(50, GT - 2, 3);
    b.chaser(54, GT - 1, 8);             // fox/cat that runs at you
    b.spikes(58, GT - 1, 2);             // jump the spikes
    b.coinArc(57, 60, GT - 2, 2);
    b.crate(62, GT - 1, "heart");
    b.coins(64, GT - 2, 3);

    // staircase blocks (real terrain hurdles)
    b.block(67, GT - 1, 2);
    b.block(70, GT - 2, 2);
    b.block(73, GT - 3, 2);
    b.coins(67, GT - 2, 1); b.coins(70, GT - 3, 1); b.coins(73, GT - 4, 1);
    b.chaser(77, GT - 4, 7);

    // hidden letter B on a high ledge behind the staircase
    b.plat(76, GT - 6, 3); b.letter("B", 77, GT - 7);
    b.gem(73, GT - 4);

    // ---- a gentle gap, then OPTIONAL sky-stairs to the secret portal ----
    b.pit(80, 82);                       // small 3-wide pit on the ground path
    b.coinArc(79, 83, GT - 2, 2);

    // ---- ACT 3: SECRET PORTAL alcove (high up, easy to miss) ----
    // optional floating stones climb to a hidden portal most players skip
    b.plat(82, GT - 3, 2); b.coins(82, GT - 4, 2);
    b.plat(85, GT - 5, 2); b.coins(85, GT - 6, 2);
    b.plat(88, GT - 7, 3);               // portal platform, high overhead
    b.gem(88, GT - 8); b.gem(90, GT - 8);
    b.portal(89, GT - 8);                // <- warps to the secret world
    b.coinArc(85, 90, GT - 8, 1);

    // main path continues on the ground for players who skip the portal
    b.coins(85, GT - 2, 4);
    b.patroller(95, GT - 1, 4);
    b.crate(98, GT - 1, "gem");

    // ---- ACT 4: home stretch with a guarded treasure ----
    b.pit(102, 104);
    b.coinArc(101, 105, GT - 2, 2);
    b.chaser(108, GT - 1, 8);
    b.spikes(112, GT - 1, 2);
    b.coinArc(111, 114, GT - 2, 2);
    b.coins(116, GT - 2, 4);

    b.plat(120, GT - 3, 3); b.gem(121, GT - 4); b.egg(122, GT - 4);
    b.crate(126, GT - 1, "coin");
    b.coins(128, GT - 2, 5);
    b.patroller(134, GT - 1, 3);
    b.coins(138, GT - 2, 4);
    b.gem(143, GT - 2);
    b.setExit(147, GT - 1);
    return b.build();
  }

  // =====================================================================
  // SECRET WORLD — a candy-bright sky island stuffed with treasure.
  // Reached only through the hidden forest portal; its exit warps you on.
  // =====================================================================
  function secretWorld() {
    const b = new LevelBuilder(60, 16, { name: "Candy Clouds", theme: "forest", music: "forest" });
    // floating sky platforms instead of solid ground (Charlie's other world)
    b.setSpawn(2, 11);
    b.plat(1, 13, 6);  b.coins(1, 12, 6);
    b.plat(9, 12, 4);  b.coins(9, 11, 4); b.gem(11, 10);
    b.plat(15, 11, 4); b.coinArc(15, 18, 9, 2); b.gem(16, 9);
    b.plat(21, 10, 4); b.gem(22, 8); b.gem(24, 8); b.egg(23, 8);
    b.plat(27, 12, 3); b.heart(28, 11);
    b.plat(32, 11, 4); b.coins(32, 10, 4); b.gem(34, 9);
    b.plat(38, 10, 4); b.coinArc(38, 41, 8, 2); b.gem(39, 8); b.gem(41, 8);
    b.plat(44, 12, 4); b.coins(44, 11, 4);
    b.plat(50, 11, 5); b.gem(51, 10); b.gem(53, 10); b.egg(52, 10);
    // a tiny floor by the exit so you can stand and step through
    b.block(55, 12, 4);
    b.coins(55, 11, 3);
    b.setExit(57, 11);
    return b.build();
  }

  // =====================================================================
  // LEVEL 2 — CAVE  (fair stair-steps, bats, one turret-free gauntlet,
  //                  letters O & N — no ceiling traps, no slippery ladders)
  // =====================================================================
  function cave() {
    const b = new LevelBuilder(80, 17, { name: "Crystal Cave", theme: "cave", music: "cave" });
    b.fillGround(14);
    b.setSpawn(2, 12);

    // gentle opening — coins on flat ground
    b.coins(3, 12, 5);

    // stair-step up to the hidden letter O (one-way: the ground path stays clear)
    b.plat(9, 11, 3); b.coins(9, 10, 3);
    b.plat(13, 9, 3); b.coins(13, 8, 2);
    b.letter("O", 14, 7);
    b.crate(17, 13, "gem");

    // FIRST PIT — only 2 wide, a coin arc shows the hop
    b.pit(20, 21);
    b.coinArc(19, 22, 12, 2);
    b.coins(24, 12, 3);
    b.flyer(27, 9, 3, 2);           // a bat overhead, easy to dodge

    // crystal balcony reached by stairs (gem reward) + a heart on the ground
    b.plat(30, 11, 3); b.coins(30, 10, 3);
    b.plat(34, 9, 3);  b.gem(35, 8);
    b.heart(32, 12);

    // SECOND PIT — 3 wide with a clear runway: hold Shift to run + jump
    b.coins(38, 12, 2);
    b.pit(41, 43);
    b.coinArc(40, 44, 12, 3);
    b.coins(46, 12, 3);
    b.patroller(50, 13, 3);         // a ground crawler — stomp it

    // upper secret: letter N via open stairs (nothing overhead to clip)
    b.plat(54, 11, 3); b.coins(54, 10, 3);
    b.plat(58, 9, 3);  b.coins(58, 8, 2);
    b.letter("N", 59, 7);
    b.egg(56, 10);

    // avoidable ground spikes with a coin arc + plenty of headroom to jump
    b.spikes(63, 13, 2);
    b.coinArc(62, 65, 12, 2);
    b.coins(67, 12, 3);

    // crate stash, then the home straight to the exit
    b.crate(70, 13, "coin");
    b.coins(72, 12, 3);
    b.gem(75, 12);
    b.setExit(77, 13);
    return b.build();
  }

  // =====================================================================
  // LEVEL 3 — UNDERWATER  (swim physics, fish, puffers, letters E & S)
  // =====================================================================
  function underwater() {
    const b = new LevelBuilder(80, 18, { name: "Coral Deep", theme: "underwater", music: "underwater" });
    b.fillGround(15);
    b.setSpawn(2, 13);

    // a shallow start, then a large flooded basin
    b.coins(3, 13, 4);
    b.block(7, 12, 3);
    b.coins(7, 11, 3);

    // flood the central basin
    b.pit(12, 60);            // carve the basin
    b.solid(12, 16, 49, 2, "#"); // basin floor
    b.water(12, 60, 6);       // water fills from row 6 down

    // floating coral platforms inside the water
    b.block(14, 12, 3); b.coins(14, 11, 3);
    b.flyer(18, 10, 4, 3);    // fish
    b.gem(20, 9);
    b.block(22, 9, 3); b.coins(22, 8, 3);
    b.letter("E", 24, 7); b.gem(25, 7);
    b.flyer(28, 12, 5, 2);
    b.shooter(31, 14, -1);    // puffer on the floor
    b.block(30, 13, 4); b.coins(30, 12, 4);
    b.heart(33, 11);

    b.block(36, 10, 3); b.coins(36, 9, 3);
    b.flyer(40, 8, 5, 3);
    b.gem(42, 7);
    b.shield(44, 9);
    b.block(45, 11, 4); b.coins(45, 10, 4);
    b.flyer(49, 9, 5, 3);
    b.letter("S", 52, 6); b.gem(53, 6); b.gem(51, 6);
    b.block(50, 8, 4); b.coins(50, 7, 4);

    b.shooter(56, 14, -1);
    b.block(55, 12, 4); b.coins(55, 11, 4);
    b.egg(58, 11);

    // climb out of the water to the exit on dry land
    b.block(62, 13, 4);
    b.coins(62, 12, 4);
    b.gem(66, 12);
    b.coins(68, 13, 6);
    b.block(74, 12, 3);
    b.gem(75, 11);
    b.setExit(78, 13);
    return b.build();
  }

  window.LEVELS = [forest(), cave(), underwater()];
  window.BONUS_LEVELS = { candy: secretWorld() };
})();
