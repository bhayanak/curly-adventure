/* sprites.js — preloads all image assets for the platformer.
 * window.Sprites = {
 *   hero: { idle:[Image], run:[Image], jumpup:[Image], jumpdown:[Image] },
 *   bg:   { cloudLayer1, hills, hillsLarge, mountainA, mountainB, mountainC },
 *   props:{ tree, treePine, ... },
 *   enemies: { bee, fox, crab, bunny, cat, pig, parrot, fish },
 *   ready, load(onProgress)
 * }
 */
(function () {
  "use strict";

  const pad2 = (n) => String(n).padStart(2, "0");
  const seq = (dir, count) => {
    const a = [];
    for (let i = 0; i < count; i++) a.push(`assets/hero/${dir}/${pad2(i)}.png`);
    return a;
  };

  const HERO = {
    idle: seq("idle", 7),
    run: seq("run", 12),
    jumpup: seq("jumpup", 6),
    jumpdown: seq("jumpdown", 6),
    punch: seq("punch", 10),
  };

  const BG = ["cloudLayer1", "hills", "hillsLarge", "mountainA", "mountainB", "mountainC"];
  const PROPS = [
    "tree", "treePine", "treePalm", "treeSmall_green1", "treeSmall_green2",
    "bush1", "bushAlt1", "cloud1", "cloud3", "cloud5", "sun",
    "treeFrozen", "treePineSnow", "treePineOrange", "treeOrange",
  ];
  const ENEMIES = ["bee", "fox", "crab", "bunny", "cat", "pig", "parrot", "fish"];

  const Sprites = {
    hero: { idle: [], run: [], jumpup: [], jumpdown: [], punch: [] },
    bg: {},
    props: {},
    enemies: {},
    ready: false,

    load(onProgress) {
      const jobs = [];
      const push = (src, assign) => jobs.push([src, assign]);

      for (const state of Object.keys(HERO)) {
        HERO[state].forEach((src, i) => push(src, (img) => (this.hero[state][i] = img)));
      }
      BG.forEach((n) => push(`assets/bg/${n}.png`, (img) => (this.bg[n] = img)));
      PROPS.forEach((n) => push(`assets/props/${n}.png`, (img) => (this.props[n] = img)));
      ENEMIES.forEach((n) => push(`assets/enemies/${n}.png`, (img) => (this.enemies[n] = img)));

      let done = 0;
      const total = jobs.length;
      return new Promise((resolve) => {
        jobs.forEach(([src, assign]) => {
          const img = new Image();
          img.onload = img.onerror = () => {
            assign(img);
            if (onProgress) onProgress(++done / total);
            if (done === total) {
              this.ready = true;
              resolve(this);
            }
          };
          img.src = src;
        });
      });
    },
  };

  window.Sprites = Sprites;
})();
