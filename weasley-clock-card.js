// Weasley-style family clock card for Home Assistant.
// One hand per person; faces follow the clock in Goblet of Fire (Mortal Peril at twelve).
const WC_VERSION = "1.2.0";
const WC_FONTS = "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Cinzel+Decorative:wght@700&family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&display=swap";

// Clockwise from twelve.
const WC_FACES = [
  { key: "peril", label: "Mortal Peril" },
  { key: "travelling", label: "Travelling" },
  { key: "work", label: "Work" },
  { key: "school", label: "School" },
  { key: "home", label: "Home" },
  { key: "lost", label: "Lost" },
  { key: "somewhere", label: "Somewhere" },
  { key: "shopping", label: "Shopping" },
  { key: "out", label: "Out and About" },
];
const WC_STEP = 360 / WC_FACES.length;
// Gem stops run highlight -> body -> shadow; `css` overrides the side-list swatch.
const WC_GEMS = {
  ruby: { stops: ["#ff9aaa", "#e0304a", "#7a0c1c"] },
  sapphire: { stops: ["#b4d0ff", "#3d7fe0", "#0b2f6e"] },
  emerald: { stops: ["#b0f2c8", "#3fbf6a", "#0b4a22"] },
  topaz: { stops: ["#fff0a8", "#f2c230", "#7a5208"] },
  amethyst: { stops: ["#e6ccff", "#a35fd6", "#3e1460"] },
  pearl: { stops: ["#ffffff", "#f4efe4", "#8c8270"] },
  opal: {
    stops: ["#ffffff", "#ffb3e0", "#9ff0ff", "#d2b8ff", "#ffe39a", "#a8ffc4", "#7fa8e8"],
    css: "radial-gradient(circle at 35% 30%, #fffc 0 10%, transparent 30%), conic-gradient(#ff9ad5, #8ef0ff, #c9a7ff, #ffe08a, #9dffb0, #ff9ad5)",
  },
  tigerseye: {
    stops: ["#f2c46a", "#b8741e", "#5a300c"], bands: true,
    css: "radial-gradient(circle at 35% 30%, #fff8 0 10%, transparent 30%), repeating-linear-gradient(115deg, #e3a53e 0 3px, #8a4e14 3px 5px, #c98a2c 5px 8px, #5a300c 8px 9px)",
  },
};
const gemCss = (g) => g.css || `radial-gradient(circle at 35% 30%, ${g.stops[0]} 0 12%, ${g.stops[1]} 40%, ${g.stops[2]} 100%)`;
const gemDefs = () => Object.entries(WC_GEMS).map(([k, g]) => g.bands
  ? `<linearGradient id="wcGem-${k}" x1="0" y1="0" x2="1" y2=".55" spreadMethod="reflect">${[0, .18, .3, .45, .6, .72, .88, 1].map((o, i) => `<stop offset="${o}" stop-color="${["#e3a53e", "#c98a2c", "#5a300c", "#f2c46a", "#8a4e14", "#e3a53e", "#5a300c", "#c98a2c"][i]}"/>`).join("")}</linearGradient>`
  : `<radialGradient id="wcGem-${k}" cx="38%" cy="32%" r="75%">${g.stops.map((c, i) => `<stop offset="${(i / (g.stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join("")}</radialGradient>`).join("");
const C = 500; // dial centre in SVG units

const pt = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};
const miles = (a, b) => {
  const R = 3958.8, rad = Math.PI / 180;
  const dLa = (b[0] - a[0]) * rad, dLo = (b[1] - a[1]) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ago = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

class WeasleyClockCard extends HTMLElement {
  setConfig(config) {
    if (!config.people || !config.people.length) throw new Error("weasley-clock-card: 'people' is required");
    this._config = {
      title: "Our Family",
      units: "mi",
      stopped_pattern: "^StatZon",
      place_radius_m: 100,
      lost_after_hours: 4,
      lost_at_home_after_hours: 12,
      peril_battery: 10,
      ...config,
    };
    this._labels = Object.fromEntries(WC_FACES.map((f) => [f.key, (config.face_labels || {})[f.key] || f.label]));
    this._last = {};
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
  }

  getCardSize() { return 12; }

  // ---------- status ----------
  _zoneName(id) {
    if (id === "home") return "home";
    const z = this._hass.states[`zone.${id}`];
    return z ? z.attributes.friendly_name : id;
  }
  _inZones(state, ids) { return (ids || []).some((id) => state === this._zoneName(id)); }

  _status(p) {
    const h = this._hass, cfg = this._config, now = Date.now();
    const st = h.states[p.entity];
    let s = st && st.state;
    const blip = !s || s === "unknown" || s === "unavailable";
    if (blip && this._last[p.entity]) return this._last[p.entity];

    // Freshness = newest real report from any of the person's trackers.
    const trackers = (st && st.attributes.device_trackers) || [];
    let newest = 0;
    for (const t of trackers) {
      const ts = h.states[t];
      if (ts && !["unknown", "unavailable"].includes(ts.state)) newest = Math.max(newest, Date.parse(ts.last_updated));
    }
    const age = newest ? now - newest : Infinity;
    const homeZones = p.home_zones || ["home"];
    const atHome = !blip && this._inZones(s, homeZones);

    const bat = p.battery ? parseFloat((h.states[p.battery] || {}).state) : NaN;
    const bs = p.battery_status ? String((h.states[p.battery_status] || {}).state || "") : "";
    const charging = /charg/i.test(bs) && !/not/i.test(bs);

    let out;
    if (blip) out = { face: "lost", sub: "no word yet" };
    else if (!atHome && bat < cfg.peril_battery && !charging) out = { face: "peril", sub: `phone battery ${Math.round(bat)}%` };
    else if (atHome) out = age > cfg.lost_at_home_after_hours * 3600e3
      ? { face: "lost", sub: `last heard from ${ago(age)}` }
      : { face: "home", sub: "" };
    else if (age > cfg.lost_after_hours * 3600e3) out = { face: "lost", sub: `last heard from ${ago(age)}` };
    else if (this._inZones(s, p.work_zones)) out = { face: "work", sub: s };
    else if (this._inZones(s, p.school_zones)) out = { face: "school", sub: s };
    else {
      const mi = this._milesFromHome(st, homeZones[0]);
      const km = cfg.units === "km", d = mi == null ? null : km ? mi * 1.609 : mi;
      const dist = d == null ? "" : `${d < 10 ? d.toFixed(1) : Math.round(d)} ${km ? "km" : "mi"} from home`;
      // iCloud3 makes a temporary "StatZon" zone when someone stops at an unnamed place.
      if (s === "not_home") out = { face: "travelling", sub: dist ? `on the move, ${dist}` : "on the move" };
      else if (new RegExp(cfg.stopped_pattern, "i").test(s)) {
        const work = this._placeAt(st, (this._places || {})[p.entity], cfg.place_radius_m);
        const place = !work && this._listAt(st, this._somewhere);
        const shop = !work && !place && this._listAt(st, this._shops);
        out = work ? { face: "work", sub: work } : place ? { face: "somewhere", sub: place }
          : shop ? { face: "shopping", sub: shop } : { face: "out", sub: dist || "" };
      }
      else out = { face: "somewhere", sub: s };
    }
    out.text = this._labels[out.face];
    out.age = age;
    this._last[p.entity] = out;
    return out;
  }

  // Match a stop against an OpenStreetMap list (shops, post offices): inside a store's outline
  // (plus a GPS margin) wins, smallest outline first; otherwise a mapped point within 60 m.
  _listAt(st, list) {
    const a = st && st.attributes;
    if (!list || !a || a.latitude == null) return null;
    const lat = a.latitude, lon = a.longitude;
    const mLat = 40 / 111320, mLon = 40 / (111320 * Math.cos((lat * Math.PI) / 180));
    let best = null, bestArea = Infinity, near = null, nearD = 0.06 / 1.609;
    for (const s of list) {
      if (Math.abs(s.la - lat) > 0.02 || Math.abs(s.lo - lon) > 0.03) continue;
      if (s.b) {
        const [a0, o0, a1, o1] = s.b;
        if (lat >= a0 - mLat && lat <= a1 + mLat && lon >= o0 - mLon && lon <= o1 + mLon) {
          const area = (a1 - a0) * (o1 - o0);
          if (area < bestArea) { best = s; bestArea = area; }
        }
      } else {
        const d = miles([lat, lon], [s.la, s.lo]);
        if (d < nearD) { near = s; nearD = d; }
      }
    }
    const hit = best || near;
    return hit ? hit.n || `a ${hit.t.replace(/_/g, " ")}` : null;
  }

  // Nearest entry of a per-person place list (points only) within radius metres.
  _placeAt(st, list, radiusM) {
    const a = st && st.attributes;
    if (!list || !a || a.latitude == null) return null;
    let hit = null, best = radiusM / 1609.34;
    for (const s of list) {
      const d = miles([a.latitude, a.longitude], [s.la, s.lo]);
      if (d < best) { hit = s; best = d; }
    }
    return hit ? hit.n : null;
  }

  _milesFromHome(st, homeZone) {
    const z = this._hass.states[`zone.${homeZone}`];
    const a = st && st.attributes;
    if (!z || !a || a.latitude == null) return null;
    return miles([a.latitude, a.longitude], [z.attributes.latitude, z.attributes.longitude]);
  }

  // ---------- drawing ----------
  _build() {
    if (!document.getElementById("wc-fonts")) {
      const l = document.createElement("link");
      l.id = "wc-fonts"; l.rel = "stylesheet"; l.href = WC_FONTS;
      document.head.appendChild(l);
    }
    const cfg = this._config;
    if (cfg.shops_url && !this._shopsLoading) {
      this._shopsLoading = true;
      fetch(cfg.shops_url).then((r) => r.json()).then((d) => { this._shops = d; this._last = {}; if (this._hass) this._update(); })
        .catch((e) => console.warn("weasley-clock-card: shops list not loaded", e));
    }
    this._places = this._places || {};
    for (const p of cfg.people) {
      if (!p.work_places_url || this._places[p.entity]) continue;
      this._places[p.entity] = [];
      fetch(p.work_places_url).then((r) => r.json()).then((d) => { this._places[p.entity] = d; this._last = {}; if (this._hass) this._update(); })
        .catch((e) => console.warn(`weasley-clock-card: work places for ${p.name} not loaded`, e));
    }
    if (cfg.somewhere_places_url && !this._somewhereLoading) {
      this._somewhereLoading = true;
      fetch(cfg.somewhere_places_url).then((r) => r.json()).then((d) => { this._somewhere = d; this._last = {}; if (this._hass) this._update(); })
        .catch((e) => console.warn("weasley-clock-card: somewhere places not loaded", e));
    }
    const gems = ["sapphire", "ruby", "emerald", "topaz", "amethyst", "pearl"];
    this._people = cfg.people.map((p, i) => ({ ...p, gem: WC_GEMS[p.gem] ? p.gem : gems[i % gems.length] }));
    const n = this._people.length;
    const lengths = this._people.map((_, i) => 340 - i * (110 / Math.max(1, n - 1)));

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${WC_CSS}</style>
      <div class="wrap">
        ${(cfg.links || []).length ? `<nav>${cfg.links.map((l) => `<button class="link" data-path="${esc(l.path)}">${esc(l.name)}</button>`).join("")}</nav>` : ""}
        <svg class="clock" viewBox="0 0 1000 1000" role="img" aria-label="${esc(cfg.title)} clock">
          ${this._dialSvg()}
          <g class="hands">${this._people.map((p, i) => this._handSvg(p, i, lengths[i])).join("")}</g>
          <circle cx="${C}" cy="${C}" r="34" fill="url(#wcBrass)" stroke="#5a3d0c" stroke-width="2"/>
          <circle cx="${C}" cy="${C}" r="15" fill="#2a1a08"/>
          <circle cx="${C}" cy="${C}" r="6" fill="#e8c25e"/>
        </svg>
        <div class="scroll">
          <div class="title">${esc(cfg.title)}</div>
          <div class="rule"></div>
          ${this._people.map((p, i) => `
            <div class="who" data-i="${i}">
              <span class="gem" style="background:${gemCss(WC_GEMS[p.gem])}"></span>
              <div class="txt"><div class="name">${esc(p.name)}</div><div class="where"></div><div class="when"></div></div>
            </div>`).join("")}
        </div>
      </div>`;

    this.shadowRoot.querySelectorAll(".who, .hand").forEach((el) =>
      el.addEventListener("click", () => this._moreInfo(this._people[+el.dataset.i].entity)));
    this.shadowRoot.querySelectorAll(".link").forEach((el) =>
      el.addEventListener("click", () => { history.pushState(null, "", el.dataset.path); window.dispatchEvent(new CustomEvent("location-changed")); }));
    this._built = true;
  }

  _dialSvg() {
    const stains = [[380, 330, 120], [640, 610, 150], [560, 260, 80], [330, 660, 95]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#wcStain)"/>`).join("");
    const grain = [452, 461, 468, 474, 481, 487, 492]
      .map((r, i) => `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="#000" stroke-opacity="${0.08 + (i % 3) * 0.05}" stroke-width="${1 + (i % 2)}"/>`).join("");
    const dividers = WC_FACES.map((_, i) => {
      const a = (i + 0.5) * WC_STEP, [x1, y1] = pt(a, 160), [x2, y2] = pt(a, 418), [sx, sy] = pt(a, 404);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#5b3a1a" stroke-opacity=".55" stroke-width="2"/>
        <path d="M${sx},${sy - 10} L${sx + 3},${sy - 3} L${sx + 10},${sy} L${sx + 3},${sy + 3} L${sx},${sy + 10} L${sx - 3},${sy + 3} L${sx - 10},${sy} L${sx - 3},${sy - 3}Z" fill="#8a5f12"/>`;
    }).join("");
    const labels = WC_FACES.map((f, i) => {
      const a = i * WC_STEP, bottom = a > 90 && a < 270, h = WC_STEP / 2 - 1.5;
      const r = bottom ? 396 : 373, [x1, y1] = pt(bottom ? a + h : a - h, r), [x2, y2] = pt(bottom ? a - h : a + h, r);
      return `<path id="wcArc${i}" d="M${x1},${y1} A${r},${r} 0 0 ${bottom ? 0 : 1} ${x2},${y2}" fill="none"/>
        <text class="face${f.key === "peril" ? " perilLabel" : ""}" data-face="${f.key}"${this._labels[f.key].length > 10 ? ' style="font-size:23px;letter-spacing:1px"' : ""}><textPath href="#wcArc${i}" startOffset="50%" text-anchor="middle">${esc(this._labels[f.key])}</textPath></text>`;
    }).join("");
    const [tx1, ty1] = pt(-50, 222), [tx2, ty2] = pt(50, 222);
    return `<defs>
        <radialGradient id="wcWood" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#7a4e28"/><stop offset=".75" stop-color="#4a2a12"/><stop offset="1" stop-color="#22120a"/></radialGradient>
        <linearGradient id="wcBrass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".3" stop-color="#d9ac45"/><stop offset=".65" stop-color="#8a5f12"/><stop offset="1" stop-color="#e8c25e"/></linearGradient>
        <radialGradient id="wcParch" cx="48%" cy="44%" r="60%"><stop offset="0" stop-color="#f7e9c6"/><stop offset=".65" stop-color="#ecd5a0"/><stop offset="1" stop-color="#c39d5e"/></radialGradient>
        <radialGradient id="wcStain"><stop offset="0" stop-color="#8a5a24" stop-opacity=".16"/><stop offset=".7" stop-color="#8a5a24" stop-opacity=".06"/><stop offset="1" stop-color="#8a5a24" stop-opacity="0"/></radialGradient>
        ${gemDefs()}
        <path id="wcTitleArc" d="M${tx1},${ty1} A222,222 0 0 1 ${tx2},${ty2}" fill="none"/>
      </defs>
      <circle cx="${C}" cy="${C}" r="496" fill="url(#wcWood)"/>
      ${grain}
      <circle cx="${C}" cy="${C}" r="440" fill="none" stroke="url(#wcBrass)" stroke-width="22"/>
      <circle cx="${C}" cy="${C}" r="428" fill="url(#wcParch)" stroke="#6b4b12" stroke-width="3"/>
      ${stains}
      <circle cx="${C}" cy="${C}" r="350" fill="none" stroke="#5b3a1a" stroke-opacity=".6" stroke-width="2"/>
      <circle cx="${C}" cy="${C}" r="343" fill="none" stroke="#5b3a1a" stroke-opacity=".4" stroke-width="1"/>
      <circle cx="${C}" cy="${C}" r="160" fill="none" stroke="#5b3a1a" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="2 6"/>
      ${dividers}
      ${labels}
      <text class="motto"><textPath href="#wcTitleArc" startOffset="50%" text-anchor="middle">${esc(this._config.title)}</textPath></text>`;
  }

  _handSvg(p, i, L) {
    const g = WC_GEMS[p.gem], edge = g.stops[g.stops.length - 1];
    const tip = C - L, plateC = C - L + 128, plateH = 30 + p.name.length * 17;
    return `<g class="hand" data-i="${i}" transform="rotate(180 ${C} ${C})"><g class="sway">
      <path d="M${C - 9},${C + 4} L${C - 4},${tip + 62} Q${C},${tip + 44} ${C + 4},${tip + 62} L${C + 9},${C + 4}Z" fill="url(#wcBrass)" stroke="#4a3208" stroke-width="2"/>
      <path d="M${C},${tip} L${C - 15},${tip + 40} L${C},${tip + 31} L${C + 15},${tip + 40}Z" fill="url(#wcBrass)" stroke="#4a3208" stroke-width="2"/>
      <circle cx="${C}" cy="${tip + 56}" r="13" fill="#2a1a08" stroke="url(#wcBrass)" stroke-width="4"/>
      <circle cx="${C}" cy="${tip + 56}" r="8" fill="url(#wcGem-${p.gem})" stroke="${edge}" stroke-width="2"/>
      <path d="M${C - 7},${C + 4} L${C - 4},${C + 62} Q${C},${C + 84} ${C + 4},${C + 62} L${C + 7},${C + 4}Z" fill="url(#wcBrass)" stroke="#4a3208" stroke-width="2"/>
      <rect x="${C - 17}" y="${plateC - plateH / 2}" width="34" height="${plateH}" rx="8" fill="#f1dc9f" stroke="#6b4b12" stroke-width="3"/>
      <text class="plate" x="${C}" y="${plateC}" transform="rotate(-90 ${C} ${plateC})">${esc(p.name)}</text>
    </g></g>`;
  }

  _update() {
    const root = this.shadowRoot;
    const stats = this._people.map((p) => this._status(p));
    const byFace = {};
    stats.forEach((s, i) => (byFace[s.face] = byFace[s.face] || []).push(i));
    const anyPeril = !!byFace.peril;
    root.querySelector(".perilLabel").classList.toggle("on", anyPeril);

    for (const [face, idx] of Object.entries(byFace)) {
      const base = WC_FACES.findIndex((f) => f.key === face) * WC_STEP;
      idx.forEach((i, k) => {
        const ang = base + (k - (idx.length - 1) / 2) * 8;
        const el = root.querySelector(`.hand[data-i="${i}"]`);
        // Spin the shortest way round from where the hand is now.
        const prev = el._cur ?? 180;
        let next = ang;
        while (next - prev > 180) next -= 360;
        while (prev - next > 180) next += 360;
        if (el._to !== next) { el._from = prev; el._to = next; el._t0 = performance.now(); }
        el._mode = face;
        el.setAttribute("class", `hand ${face}`);
        const norm = ((next % 360) + 360) % 360;
        const t = el.querySelector(".plate"), y = t.getAttribute("y");
        t.setAttribute("transform", `rotate(${norm > 180 ? 90 : -90} ${C} ${y})`);
      });
    }
    this._animate();

    stats.forEach((s, i) => {
      const row = root.querySelector(`.who[data-i="${i}"]`);
      row.className = `who ${s.face}`;
      row.querySelector(".where").textContent = s.sub ? `${s.text} · ${s.sub}` : s.text;
      row.querySelector(".when").textContent = Number.isFinite(s.age) ? `heard from ${ago(s.age)}` : "";
    });
  }

  // Hands turn via the SVG transform attribute (explicit centre), driven from JS.
  // CSS transform-origin on SVG is unreliable in older Safari (e.g. iOS 15 iPads).
  _animate() {
    if (this._raf) return;
    const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const SWAY = { travelling: [3, 3400], lost: [9, 8000], peril: [1.2, 160] };
    const tick = (now) => {
      let busy = false;
      this.shadowRoot.querySelectorAll(".hand").forEach((el) => {
        if (el._to == null) return;
        const p = still ? 1 : Math.min(1, (now - el._t0) / 2600);
        const c1 = 2.0, c3 = c1 + 1, q = p - 1; // ease-out with a little overshoot
        let a = el._from + (el._to - el._from) * (p < 1 ? 1 + c3 * q * q * q + c1 * q * q : 1);
        const sw = !still && SWAY[el._mode];
        if (sw) a += sw[0] * Math.sin((2 * Math.PI * now) / sw[1]);
        if (p < 1 || sw) busy = true;
        el._cur = a;
        el.setAttribute("transform", `rotate(${a.toFixed(2)} ${C} ${C})`);
      });
      this._raf = busy && this.isConnected ? requestAnimationFrame(tick) : null;
    };
    this._raf = requestAnimationFrame(tick);
  }

  connectedCallback() { if (this._built) this._animate(); }
  disconnectedCallback() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

  _moreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
}

const WC_CSS = `
:host{display:block}
.wrap{position:relative;display:flex;overflow:hidden;align-items:center;justify-content:center;gap:3vmin;box-sizing:border-box;
  min-height:calc(100vh - var(--header-height, 0px));padding:3vmin;
  background:radial-gradient(ellipse at 40% 45%, #3d2814 0%, #24170c 55%, #120b05 100%);}
nav{position:absolute;top:12px;left:12px;display:flex;gap:6px;z-index:2}
.link{font:600 15px 'Cinzel',serif;color:#f1dc9f;background:#3a2412cc;border:1px solid #8a5f12;border-radius:6px;padding:6px 12px;cursor:pointer}
.clock{width:min(88vh, 60%);height:auto;max-width:100%;flex:0 1 auto;min-width:0;filter:drop-shadow(0 12px 24px #000a)}
.face{font:700 26px 'Cinzel',Georgia,serif;letter-spacing:2px;fill:#3b2410}
.perilLabel{fill:#6e1010}
.perilLabel.on{animation:perilGlow 1.2s ease-in-out infinite}
.motto{font:700 26px 'Cinzel Decorative','Cinzel',Georgia,serif;fill:#5b3a1a;fill-opacity:.85;letter-spacing:1px}
.plate{font:700 20px 'Cinzel',Georgia,serif;fill:#3b2410;text-anchor:middle;dominant-baseline:central}
.hand{cursor:pointer}
@keyframes perilGlow{0%,100%{fill:#6e1010}50%{fill:#d42020}}
.scroll{flex:0 0 300px;max-width:90vw;color:#3b2410;padding:22px 24px;border-radius:10px;
  background:radial-gradient(ellipse at 50% 40%, #f7e9c6 0%, #ead39b 70%, #c9a46a 100%);
  box-shadow:0 10px 30px #000a, inset 0 0 40px #8a5a2455;border:2px solid #8a5f12}
.title{font:700 26px 'Cinzel Decorative','Cinzel',Georgia,serif;text-align:center}
.rule{height:2px;margin:10px 0 6px;background:linear-gradient(90deg,transparent,#8a5f12,transparent)}
.who{display:flex;gap:12px;align-items:flex-start;padding:10px 4px;cursor:pointer;border-bottom:1px dashed #8a5f1255}
.who:last-child{border-bottom:none}
.gem{width:18px;height:18px;border-radius:50%;flex:0 0 auto;margin-top:6px;border:2px solid #8a5f12}
.name{font:24px 'IM Fell English SC',Georgia,serif;line-height:1.1}
.where{font:italic 19px 'IM Fell English',Georgia,serif;line-height:1.25}
.when{font:14px 'IM Fell English',Georgia,serif;opacity:.7}
.who.peril .where{color:#8a1010;font-weight:bold}
@media (max-aspect-ratio: 1/1){.wrap{flex-direction:column}.clock{width:min(100%,62vh)}.scroll{flex:0 0 auto;width:100%;max-width:520px;box-sizing:border-box}}
@media (prefers-reduced-motion: reduce){.perilLabel.on{animation:none;fill:#d42020}}
`;

customElements.define("weasley-clock-card", WeasleyClockCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "weasley-clock-card", name: "Weasley clock", description: "A hand for each person, pointing where they are." });
console.info(`%c weasley-clock-card ${WC_VERSION} `, "background:#3b2410;color:#f1dc9f");
