/* input.js — unifies keyboard + on-screen touch buttons into one input model.
 *
 * Held state:   Input.left/right/up/down/run/jumpHeld (booleans)
 * Edge actions: Input.pressed(name) consumes a one-shot press
 *               names: "jump", "dash", "pause", "start", "mute"
 */
(function () {
  "use strict";

  const Input = {
    left: false,
    right: false,
    up: false,
    down: false,
    run: false,
    jumpHeld: false,
    runLatched: false, // mobile RUN toggle

    _edges: {},
    _firstDone: false,
    _firstCbs: [],

    onFirstInteraction(cb) {
      this._firstCbs.push(cb);
    },
    _fireFirst() {
      if (this._firstDone) return;
      this._firstDone = true;
      this._firstCbs.forEach((cb) => {
        try { cb(); } catch (e) {}
      });
    },

    _edge(name) {
      this._fireFirst();
      this._edges[name] = true;
    },
    pressed(name) {
      if (this._edges[name]) {
        this._edges[name] = false;
        return true;
      }
      return false;
    },
    clearEdges() {
      this._edges = {};
    },
    get running() {
      return this.run || this.runLatched;
    },
  };

  // ---------- Keyboard ----------
  const onKey = (down) => (e) => {
    switch (e.code) {
      case "ArrowLeft": case "KeyA": Input.left = down; break;
      case "ArrowRight": case "KeyD": Input.right = down; break;
      case "ArrowUp": case "KeyW":
        Input.up = down;
        Input.jumpHeld = down;
        if (down && !e.repeat) Input._edge("jump");
        break;
      case "ArrowDown": case "KeyS": Input.down = down; break;
      case "Space": case "KeyZ":
        Input.jumpHeld = down;
        if (down && !e.repeat) Input._edge("jump");
        break;
      case "ShiftLeft": case "ShiftRight": Input.run = down; break;
      case "KeyX": case "KeyK":
        if (down && !e.repeat) Input._edge("dash");
        break;
      case "KeyF": case "KeyJ":
        if (down && !e.repeat) Input._edge("punch");
        break;
      case "KeyP": case "Escape":
        if (down && !e.repeat) Input._edge("pause");
        break;
      case "KeyM":
        if (down && !e.repeat) Input._edge("mute");
        break;
      case "Enter":
        if (down && !e.repeat) Input._edge("start");
        break;
      default:
        return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code))
      e.preventDefault();
  };

  window.addEventListener("keydown", onKey(true), { passive: false });
  window.addEventListener("keyup", onKey(false), { passive: false });

  // ---------- Touch buttons ----------
  // Buttons in the DOM carry data-hold="left|right|down" or data-tap="jump|dash|pause|mute"
  // and RUN uses data-toggle="run".
  function bindTouch() {
    const holdSet = (name, val) => {
      if (name === "left") Input.left = val;
      else if (name === "right") Input.right = val;
      else if (name === "down") Input.down = val;
      else if (name === "jump") {
        Input.jumpHeld = val;
        if (val) Input._edge("jump");
      }
    };

    document.querySelectorAll("[data-hold]").forEach((btn) => {
      const name = btn.getAttribute("data-hold");
      const press = (e) => {
        e.preventDefault();
        btn.classList.add("pressed");
        holdSet(name, true);
      };
      const release = (e) => {
        e.preventDefault();
        btn.classList.remove("pressed");
        holdSet(name, false);
      };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
    });

    document.querySelectorAll("[data-tap]").forEach((btn) => {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        btn.classList.add("pressed");
        Input._edge(btn.getAttribute("data-tap"));
      });
      const up = () => btn.classList.remove("pressed");
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("pointerleave", up);
    });

    document.querySelectorAll("[data-toggle='run']").forEach((btn) => {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        Input.runLatched = !Input.runLatched;
        btn.classList.toggle("active", Input.runLatched);
      });
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bindTouch);
  else bindTouch();

  window.Input = Input;
})();
