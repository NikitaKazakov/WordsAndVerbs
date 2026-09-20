const STORAGE_KEY = "irregular-verbs-quiz-v1";
const MASTER_STREAK = 3;
const AUTO_NEXT_MS = 2200;

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
};

const state = {
  verbs: [],
  progress: null,
  verb: null,
  tiles: [],
  selected: new Set(),
  locked: false,
  showingResult: false,
  nextTimer: 0,
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
    v: 1,
    verbs: verbsMap,
    lastId: null,
    currentStreak: 0,
    bestStreak: 0,
    todayDate: todayKey(),
    todayCount: 0,
  };
}

function loadProgress(verbs) {
  const fresh = defaultProgress(verbs);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw);
    if (!saved || saved.v !== 1 || !saved.verbs) return fresh;
    for (const verb of verbs) {
      const row = saved.verbs[verb.id];
      if (row) fresh.verbs[verb.id] = { ...emptyVerbStats(), ...row };
    }
    fresh.lastId = saved.lastId || null;
    fresh.currentStreak = Number(saved.currentStreak) || 0;
    fresh.bestStreak = Number(saved.bestStreak) || 0;
    if (saved.todayDate === todayKey()) {
      fresh.todayDate = saved.todayDate;
      fresh.todayCount = Number(saved.todayCount) || 0;
    }
    return fresh;
  } catch {
    return fresh;
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
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

function tileClass(tile) {
  const classes = ["tile"];
  if (state.showingResult) {
    const picked = state.selected.has(tile.id);
    if (tile.correct && picked) classes.push("good");
    else if (tile.correct && !picked) classes.push("missed");
    else if (!tile.correct && picked) classes.push("bad");
  } else if (state.selected.has(tile.id)) {
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
      btn.textContent = tile.text;
      btn.disabled = state.locked && !state.showingResult;
      btn.addEventListener("click", () => onTile(tile.id));
      return btn;
    })
  );
}

function renderRound() {
  const verb = state.verb;
  els.prompt.textContent = verb.ru;
  els.hint.textContent = state.showingResult ? "три формы" : "выбери 3 формы";
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

function allCorrectSelected() {
  return state.tiles.filter((tile) => tile.correct).every((tile) => state.selected.has(tile.id));
}

function finishRound(gaveUp) {
  if (state.showingResult) return;
  state.locked = true;
  state.showingResult = true;
  if (gaveUp) {
    for (const tile of state.tiles) {
      if (tile.correct) state.selected.add(tile.id);
    }
  }
  applyResult(!gaveUp && allCorrectSelected());
  renderRound();
  clearTimeout(state.nextTimer);
  state.nextTimer = window.setTimeout(nextRound, AUTO_NEXT_MS);
}

function onTile(id) {
  if (state.showingResult) {
    nextRound();
    return;
  }
  if (state.locked) return;
  if (state.selected.has(id)) state.selected.delete(id);
  else {
    if (state.selected.size >= 3) return;
    state.selected.add(id);
  }
  renderGrid();
  if (state.selected.size === 3) finishRound(false);
}

function nextRound() {
  clearTimeout(state.nextTimer);
  state.showingResult = false;
  state.locked = false;
  state.selected = new Set();
  state.verb = pickNext();
  state.tiles = buildTiles(state.verb);
  renderRound();
}

function resetProgress() {
  if (!confirm("Сбросить весь прогресс?")) return;
  state.progress = defaultProgress(state.verbs);
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
    state.verbs = await loadVerbs();
  } catch (err) {
    els.prompt.textContent = "Не открылось. Запусти через сайт или локальный сервер, не как файл.";
    els.hint.textContent = String(err.message || err);
    return;
  }
  state.progress = loadProgress(state.verbs);
  renderStats();
  nextRound();
  els.dontKnow.addEventListener("click", () => finishRound(true));
  els.next.addEventListener("click", nextRound);
  els.reset.addEventListener("click", resetProgress);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && state.showingResult) nextRound();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

main();
