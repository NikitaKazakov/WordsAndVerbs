const STORAGE_KEY = "irregular-verbs-quiz-v1";
const MASTER_STREAK = 3;
const HINTS = ["сначала 1-я форма", "теперь 2-я форма", "теперь 3-я форма"];
const MODE_IDS = ["simple", "prefixed", "mixed"];
const PREFIXES = [
  "under",
  "over",
  "with",
  "back",
  "fore",
  "broad",
  "brow",
  "spot",
  "part",
  "gain",
  "way",
  "mis",
  "out",
  "for",
  "pre",
  "un",
  "re",
  "be",
  "in",
  "up",
];

const els = {
  streak: document.getElementById("streak"),
  best: document.getElementById("best"),
  today: document.getElementById("today"),
  hint: document.getElementById("hint"),
  prompt: document.getElementById("prompt"),
  forms: document.getElementById("forms"),
  grid: document.getElementById("grid"),
  dontKnow: document.getElementById("dont-know"),
  next: document.getElementById("next"),
  legend: document.getElementById("legend"),
  segNew: document.getElementById("seg-new"),
  segLearning: document.getElementById("seg-learning"),
  segKnown: document.getElementById("seg-known"),
  reset: document.getElementById("reset"),
  flash: document.getElementById("flash"),
  modes: [...document.querySelectorAll(".mode")],
};

const state = {
  allVerbs: [],
  verbs: [],
  store: null,
  mode: "simple",
  progress: null,
  verb: null,
  tiles: [],
  selected: [],
  locked: false,
  showingResult: false,
};

function emptyVerbStats() {
  return {
    seen: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    lastSeen: 0,
    lastWrong: 0,
    lastResult: null,
  };
}

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function defaultProgress(verbs) {
  const verbsMap = {};
  for (const verb of verbs) verbsMap[verb.id] = emptyVerbStats();
  return {
    verbs: verbsMap,
    lastId: null,
    currentStreak: 0,
    bestStreak: 0,
    todayDate: todayKey(),
    todayCount: 0,
  };
}

function isPrefixedId(id, idSet) {
  for (const prefix of PREFIXES) {
    if (!id.startsWith(prefix) || id.length <= prefix.length + 1) continue;
    const rest = id.slice(prefix.length);
    if (idSet.has(rest)) return true;
  }
  return false;
}

function markPrefixes(verbs) {
  const idSet = new Set(verbs.map((verb) => verb.id));
  return verbs.map((verb) => ({ ...verb, prefixed: isPrefixedId(verb.id, idSet) }));
}

function verbsFor(mode, allVerbs) {
  if (mode === "prefixed") return allVerbs.filter((verb) => verb.prefixed);
  if (mode === "simple") return allVerbs.filter((verb) => !verb.prefixed);
  return allVerbs;
}

function copyBundle(saved, pool) {
  const bundle = defaultProgress(pool);
  if (!saved) return bundle;
  for (const verb of pool) {
    const row = saved.verbs && saved.verbs[verb.id];
    if (row) bundle.verbs[verb.id] = { ...emptyVerbStats(), ...row };
  }
  bundle.lastId = saved.lastId || null;
  bundle.currentStreak = Number(saved.currentStreak) || 0;
  bundle.bestStreak = Number(saved.bestStreak) || 0;
  if (saved.todayDate === todayKey()) {
    bundle.todayDate = saved.todayDate;
    bundle.todayCount = Number(saved.todayCount) || 0;
  }
  return bundle;
}

function emptyStore(allVerbs) {
  return {
    v: 2,
    mode: "simple",
    modes: {
      simple: defaultProgress(verbsFor("simple", allVerbs)),
      prefixed: defaultProgress(verbsFor("prefixed", allVerbs)),
      mixed: defaultProgress(allVerbs),
    },
  };
}

function loadStore(allVerbs) {
  const fresh = emptyStore(allVerbs);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw);
    if (!saved) return fresh;
    if (saved.v === 1 && saved.verbs) {
      fresh.mode = "mixed";
      fresh.modes.mixed = copyBundle(saved, allVerbs);
      return fresh;
    }
    if (saved.v === 2 && saved.modes) {
      fresh.mode = MODE_IDS.includes(saved.mode) ? saved.mode : "simple";
      for (const mode of MODE_IDS) {
        fresh.modes[mode] = copyBundle(saved.modes[mode], verbsFor(mode, allVerbs));
      }
      return fresh;
    }
  } catch {
    return fresh;
  }
  return fresh;
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
}

function renderModes() {
  for (const btn of els.modes) {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  }
}

function applyMode(mode, restart) {
  if (!MODE_IDS.includes(mode)) mode = "simple";
  state.mode = mode;
  state.store.mode = mode;
  state.verbs = verbsFor(mode, state.allVerbs);
  state.progress = state.store.modes[mode];
  if (state.progress.lastId && !state.verbs.some((verb) => verb.id === state.progress.lastId)) {
    state.progress.lastId = null;
  }
  saveProgress();
  renderModes();
  if (restart) nextRound();
}

function hoursSince(ts, now) {
  if (!ts) return 1e6;
  return (now - ts) / 3_600_000;
}

function dueHours(streak) {
  if (streak <= 2) return 0;
  if (streak === 3) return 8;
  if (streak === 4) return 24;
  if (streak === 5) return 72;
  return 168;
}

function isMastered(stats) {
  return (stats.streak || 0) >= MASTER_STREAK;
}

function errorWeight(stats, now) {
  if (!stats.seen) return 6;
  const errorRate = stats.wrong / Math.max(1, stats.seen);
  const recency = stats.lastWrong ? 1 / (1 + hoursSince(stats.lastWrong, now) / 6) : 0.25;
  const streakMul = stats.streak === 0 ? 1.6 : stats.streak === 1 ? 1.15 : 0.85;
  return (1 + errorRate * 8) * (0.4 + recency * 2.2) * streakMul * (1 + stats.wrong * 0.15);
}

function staleWeight(stats, now) {
  if (!stats.seen) return 0;
  const hours = hoursSince(stats.lastSeen, now);
  const overdue = Math.max(0, hours - dueHours(stats.streak || 0));
  return 1 + hours + overdue * 3;
}

function weightedPick(items, weightFn) {
  const weights = items.map(weightFn);
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= Math.max(0, weights[i]);
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function pickNext(now = Date.now()) {
  const { verbs, progress } = state;
  const notLast = (verb) => verb.id !== progress.lastId || verbs.length === 1;
  const errorPool = verbs.filter((verb) => notLast(verb) && !isMastered(progress.verbs[verb.id]));
  const stalePool = verbs.filter((verb) => notLast(verb) && progress.verbs[verb.id].seen > 0);
  const wantError = Math.random() < 0.7;
  let pool = wantError ? errorPool : stalePool;
  let weightFn = wantError ? errorWeight : staleWeight;
  if (!pool.length) {
    pool = wantError ? stalePool : errorPool;
    weightFn = wantError ? staleWeight : errorWeight;
  }
  if (!pool.length) {
    pool = verbs.filter(notLast);
    weightFn = () => 1;
  }
  return weightedPick(pool, (verb) => weightFn(progress.verbs[verb.id], now));
}

function similarity(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 100;
  let score = 0;
  if (a[0] === b[0]) score += 3;
  if (a.slice(0, 2) === b.slice(0, 2)) score += 5;
  if (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3)) score += 3;
  if (a.slice(-2) === b.slice(-2)) score += 4;
  if (a.length >= 3 && b.length >= 3 && a.slice(-3) === b.slice(-3)) score += 3;
  if (Math.abs(a.length - b.length) <= 1) score += 1;
  return score;
}

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildTiles(verb) {
  const banned = new Set([verb.v1, verb.v2, verb.v3].map((text) => text.toLowerCase()));
  const best = new Map();
  for (const other of state.verbs) {
    if (other.id === verb.id) continue;
    for (const text of [other.v1, other.v2, other.v3]) {
      const key = text.toLowerCase();
      if (banned.has(key)) continue;
      const score = Math.max(
        similarity(text, verb.v1),
        similarity(text, verb.v2),
        similarity(text, verb.v3)
      );
      const prev = best.get(key);
      if (!prev || prev.score < score) best.set(key, { text, score });
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score || Math.random() - 0.5);
  const distractors = ranked.slice(0, 9).map((item) => ({
    text: item.text,
    correct: false,
  }));
  const tiles = [
    { text: verb.v1, correct: true, form: 1 },
    { text: verb.v2, correct: true, form: 2 },
    { text: verb.v3, correct: true, form: 3 },
    ...distractors,
  ].map((tile, index) => ({ ...tile, id: `t${index}` }));
  return shuffle(tiles);
}

function masteryCounts() {
  let fresh = 0;
  let learning = 0;
  let known = 0;
  for (const verb of state.verbs) {
    const stats = state.progress.verbs[verb.id];
    if (!stats.seen) fresh += 1;
    else if (isMastered(stats)) known += 1;
    else learning += 1;
  }
  return { fresh, learning, known, total: state.verbs.length };
}

function renderStats() {
  const { progress } = state;
  if (progress.todayDate !== todayKey()) {
    progress.todayDate = todayKey();
    progress.todayCount = 0;
  }
  els.streak.textContent = String(progress.currentStreak);
  els.best.textContent = String(progress.bestStreak);
  els.today.textContent = String(progress.todayCount);
  const { fresh, learning, known, total } = masteryCounts();
  els.segNew.style.flex = String(fresh || 0.0001);
  els.segLearning.style.flex = String(learning || 0.0001);
  els.segKnown.style.flex = String(known || 0.0001);
  els.legend.textContent = `новые ${fresh} · учу ${learning} · знаю ${known} / ${total}`;
}

function expectedForms() {
  const verb = state.verb;
  return [verb.v1, verb.v2, verb.v3];
}

function pickIndex(tileId) {
  return state.selected.indexOf(tileId);
}

function tileClass(tile) {
  const classes = ["tile"];
  const pos = pickIndex(tile.id);
  if (state.showingResult) {
    if (pos >= 0) {
      classes.push(tile.text === expectedForms()[pos] ? "good" : "bad");
    } else if (tile.correct) {
      classes.push("missed");
    }
  } else if (pos >= 0) {
    classes.push("picked");
  }
  return classes.join(" ");
}

function renderGrid() {
  els.grid.replaceChildren(
    ...state.tiles.map((tile) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = tileClass(tile);
      btn.disabled = state.showingResult;
      const pos = pickIndex(tile.id);
      if (pos >= 0) {
        const mark = document.createElement("span");
        mark.className = "tile-n";
        mark.textContent = String(pos + 1);
        btn.append(mark);
      }
      btn.append(tile.text);
      btn.addEventListener("click", () => onTile(tile.id));
      return btn;
    })
  );
}

function renderRound() {
  const verb = state.verb;
  els.prompt.textContent = verb.ru;
  els.hint.textContent = state.showingResult ? "три формы" : HINTS[state.selected.length] || HINTS[0];
  els.forms.hidden = !state.showingResult;
  if (state.showingResult) {
    els.forms.textContent = `${verb.v1}  →  ${verb.v2}  →  ${verb.v3}`;
  }
  els.dontKnow.hidden = state.showingResult;
  els.next.hidden = !state.showingResult;
  renderGrid();
  renderStats();
}

function flashStreak(n) {
  els.flash.textContent = `Серия ${n}`;
  els.flash.classList.remove("show");
  void els.flash.offsetWidth;
  els.flash.classList.add("show");
}

function applyResult(ok) {
  const stats = state.progress.verbs[state.verb.id];
  const now = Date.now();
  stats.seen += 1;
  stats.lastSeen = now;
  if (state.progress.todayDate !== todayKey()) {
    state.progress.todayDate = todayKey();
    state.progress.todayCount = 0;
  }
  state.progress.todayCount += 1;
  state.progress.lastId = state.verb.id;
  if (ok) {
    stats.correct += 1;
    stats.streak += 1;
    stats.lastResult = "correct";
    state.progress.currentStreak += 1;
    if (state.progress.currentStreak > state.progress.bestStreak) {
      state.progress.bestStreak = state.progress.currentStreak;
    }
    if (state.progress.currentStreak === 5 || state.progress.currentStreak === 10) {
      flashStreak(state.progress.currentStreak);
    }
  } else {
    stats.wrong += 1;
    stats.streak = 0;
    stats.lastWrong = now;
    stats.lastResult = "wrong";
    state.progress.currentStreak = 0;
  }
  saveProgress();
}

function inCorrectOrder() {
  const expected = expectedForms();
  return (
    state.selected.length === 3 &&
    state.selected.every((id, i) => {
      const tile = state.tiles.find((item) => item.id === id);
      return tile && tile.text === expected[i];
    })
  );
}

function orderedCorrectIds() {
  return [1, 2, 3].map((form) => state.tiles.find((tile) => tile.correct && tile.form === form).id);
}

function finishRound(gaveUp) {
  if (state.showingResult) return;
  state.locked = true;
  state.showingResult = true;
  if (gaveUp) state.selected = orderedCorrectIds();
  applyResult(!gaveUp && inCorrectOrder());
  renderRound();
}

function onTile(id) {
  if (state.showingResult || state.locked) return;
  const pos = pickIndex(id);
  if (pos >= 0) state.selected = state.selected.slice(0, pos);
  else {
    if (state.selected.length >= 3) return;
    state.selected.push(id);
  }
  renderRound();
  if (state.selected.length === 3) finishRound(false);
}

function nextRound() {
  state.showingResult = false;
  state.locked = false;
  state.selected = [];
  state.verb = pickNext();
  state.tiles = buildTiles(state.verb);
  renderRound();
}

function resetProgress() {
  if (!confirm("Сбросить прогресс этого режима?")) return;
  state.store.modes[state.mode] = defaultProgress(state.verbs);
  state.progress = state.store.modes[state.mode];
  saveProgress();
  nextRound();
}

async function loadVerbs() {
  const res = await fetch("verbs.json");
  if (!res.ok) throw new Error("Не удалось загрузить verbs.json");
  const verbs = await res.json();
  if (!Array.isArray(verbs) || !verbs.length) throw new Error("Пустой словарь");
  return verbs;
}

async function main() {
  try {
    state.allVerbs = markPrefixes(await loadVerbs());
  } catch (err) {
    els.prompt.textContent = "Не открылось. Запусти через сайт или локальный сервер, не как файл.";
    els.hint.textContent = String(err.message || err);
    return;
  }
  state.store = loadStore(state.allVerbs);
  applyMode(state.store.mode, true);
  els.dontKnow.addEventListener("click", () => finishRound(true));
  els.next.addEventListener("click", nextRound);
  els.reset.addEventListener("click", resetProgress);
  for (const btn of els.modes) {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === state.mode) return;
      applyMode(btn.dataset.mode, true);
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && state.showingResult) nextRound();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

main();
