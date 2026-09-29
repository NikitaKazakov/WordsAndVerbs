const STORAGE_KEY = "irregular-verbs-quiz-v1";
const MASTER_STREAK = 3;
const SECTIONS = ["words", "verbs", "phrasal", "phrases"];
const VERB_MODES = ["simple", "prefixed", "mixed"];
const POOL_KEYS = ["words", "phrasal", "phrases", "simple", "prefixed", "mixed"];
const CUSTOM_SECTIONS = ["words", "phrasal", "phrases"];
const MOVED_PHRASE_IDS = [
  "right-away",
  "had-such-a-ball",
  "all-in-all",
  "hail-mary",
  "its-not-my-cup-of-tea",
  "when-pigs-fly",
  "make-dream-come-true",
  "it-is-customary",
  "short-of-money",
  "frankly-speaking",
  "do-a-favor",
];
const ADD_UI = {
  words: { btn: "Добавить слово", title: "Новое слово", empty: "Добавь первое слово" },
  phrasal: { btn: "Добавить фразовый", title: "Новый фразовый глагол", empty: "Добавь первый фразовый" },
  phrases: { btn: "Добавить оборот", title: "Новый оборот", empty: "Добавь первый оборот" },
};
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
  sections: [...document.querySelectorAll("[data-section]")],
  verbModes: [...document.querySelectorAll("[data-verb-mode]")],
  verbModesNav: document.getElementById("verb-modes"),
  addOpen: document.getElementById("add-open"),
  addCancel: document.getElementById("add-cancel"),
  addForm: document.getElementById("add-form"),
  addRu: document.getElementById("add-ru"),
  addEn: document.getElementById("add-en"),
  sheet: document.getElementById("sheet"),
  sheetTitle: document.getElementById("sheet-title"),
  sheetError: document.getElementById("sheet-error"),
};

const state = {
  catalogs: { verbs: [], words: [], phrasal: [], phrases: [] },
  items: [],
  store: null,
  section: "words",
  verbMode: "simple",
  progress: null,
  item: null,
  tiles: [],
  selected: [],
  locked: false,
  showingResult: false,
};

function emptyStats() {
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

function defaultProgress(items) {
  const verbs = {};
  for (const item of items) verbs[item.id] = emptyStats();
  return {
    verbs,
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
    if (idSet.has(id.slice(prefix.length))) return true;
  }
  return false;
}

function markPrefixes(verbs) {
  const idSet = new Set(verbs.map((verb) => verb.id));
  return verbs.map((verb) => ({
    ...verb,
    kind: "verb",
    answers: [verb.v1, verb.v2, verb.v3],
    prefixed: isPrefixedId(verb.id, idSet),
  }));
}

function asEntry(row, kind) {
  const en = (row.en || "").trim();
  return {
    id: row.id,
    ru: (row.ru || "").trim(),
    en,
    kind,
    answers: [en],
    custom: Boolean(row.custom),
  };
}

function verbsFor(mode, allVerbs) {
  if (mode === "prefixed") return allVerbs.filter((verb) => verb.prefixed);
  if (mode === "simple") return allVerbs.filter((verb) => !verb.prefixed);
  return allVerbs;
}

function poolKey() {
  return state.section === "verbs" ? state.verbMode : state.section;
}

function currentPool() {
  if (state.section === "verbs") return verbsFor(state.verbMode, state.catalogs.verbs);
  return state.catalogs[state.section];
}

function neededPicks() {
  return state.item && state.item.kind === "verb" ? 3 : 1;
}

function expectedAnswers() {
  return state.item.answers;
}

function copyBundle(saved, pool) {
  const bundle = defaultProgress(pool);
  if (!saved) return bundle;
  for (const item of pool) {
    const row = saved.verbs && saved.verbs[item.id];
    if (row) bundle.verbs[item.id] = { ...emptyStats(), ...row };
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

function emptyStore() {
  return {
    v: 4,
    section: "words",
    verbMode: "simple",
    custom: { words: [], phrasal: [], phrases: [] },
    modes: {
      words: defaultProgress([]),
      phrasal: defaultProgress([]),
      phrases: defaultProgress([]),
      simple: defaultProgress([]),
      prefixed: defaultProgress([]),
      mixed: defaultProgress([]),
    },
  };
}

function movePhraseProgress(fromWords, intoPhrases) {
  if (!fromWords?.verbs || !intoPhrases?.verbs) return;
  for (const id of MOVED_PHRASE_IDS) {
    if (fromWords.verbs[id] && !intoPhrases.verbs[id]) {
      intoPhrases.verbs[id] = fromWords.verbs[id];
    }
  }
}

function loadStore() {
  const fresh = emptyStore();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return fresh;
    if (Array.isArray(saved.custom?.words)) fresh.custom.words = saved.custom.words;
    if (Array.isArray(saved.custom?.phrasal)) fresh.custom.phrasal = saved.custom.phrasal;
    if (Array.isArray(saved.custom?.phrases)) fresh.custom.phrases = saved.custom.phrases;
    if (saved.v === 1 && saved.verbs) {
      fresh.section = "verbs";
      fresh.verbMode = "mixed";
      fresh.modes.mixed = saved;
      return fresh;
    }
    if (saved.v === 2 && saved.modes) {
      fresh.section = "verbs";
      fresh.verbMode = VERB_MODES.includes(saved.mode) ? saved.mode : "simple";
      for (const key of VERB_MODES) fresh.modes[key] = saved.modes[key] || fresh.modes[key];
      return fresh;
    }
    if (saved.v === 3 || saved.v === 4) {
      if (SECTIONS.includes(saved.section)) fresh.section = saved.section;
      if (VERB_MODES.includes(saved.verbMode)) fresh.verbMode = saved.verbMode;
      for (const key of POOL_KEYS) {
        if (saved.modes && saved.modes[key]) fresh.modes[key] = saved.modes[key];
      }
      if (saved.v === 3) movePhraseProgress(fresh.modes.words, fresh.modes.phrases);
    }
  } catch {
    return fresh;
  }
  return fresh;
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
}

function mergeCatalog(seed, custom, kind) {
  const byId = new Map();
  for (const row of seed) byId.set(row.id, asEntry(row, kind));
  for (const row of custom) byId.set(row.id, asEntry({ ...row, custom: true }, kind));
  return [...byId.values()].filter((row) => row.ru && row.en);
}

function rebuildCatalogs(seeds) {
  state.catalogs.verbs = markPrefixes(seeds.verbs);
  state.catalogs.words = mergeCatalog(seeds.words, state.store.custom.words, "word");
  state.catalogs.phrasal = mergeCatalog(seeds.phrasal, state.store.custom.phrasal, "phrasal");
  state.catalogs.phrases = mergeCatalog(seeds.phrases, state.store.custom.phrases, "phrase");
}

function ensureProgress(key, pool) {
  state.store.modes[key] = copyBundle(state.store.modes[key], pool);
  return state.store.modes[key];
}

function renderNav() {
  for (const btn of els.sections) {
    btn.classList.toggle("active", btn.dataset.section === state.section);
  }
  els.verbModesNav.hidden = state.section !== "verbs";
  for (const btn of els.verbModes) {
    btn.classList.toggle("active", btn.dataset.verbMode === state.verbMode);
  }
  els.addOpen.hidden = state.section === "verbs";
  const add = ADD_UI[state.section];
  els.addOpen.textContent = add ? add.btn : "Добавить";
}

function applyCurrent(restart) {
  state.store.section = state.section;
  state.store.verbMode = state.verbMode;
  state.items = currentPool();
  const key = poolKey();
  state.progress = ensureProgress(key, state.items);
  if (state.progress.lastId && !state.items.some((item) => item.id === state.progress.lastId)) {
    state.progress.lastId = null;
  }
  saveProgress();
  renderNav();
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
  const { items, progress } = state;
  const notLast = (item) => item.id !== progress.lastId || items.length === 1;
  const errorPool = items.filter((item) => notLast(item) && !isMastered(progress.verbs[item.id]));
  const stalePool = items.filter((item) => notLast(item) && progress.verbs[item.id].seen > 0);
  const wantError = Math.random() < 0.7;
  let pool = wantError ? errorPool : stalePool;
  let weightFn = wantError ? errorWeight : staleWeight;
  if (!pool.length) {
    pool = wantError ? stalePool : errorPool;
    weightFn = wantError ? staleWeight : errorWeight;
  }
  if (!pool.length) {
    pool = items.filter(notLast);
    weightFn = () => 1;
  }
  return weightedPick(pool, (item) => weightFn(progress.verbs[item.id], now));
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

function buildTiles(item) {
  const answers = item.answers;
  const banned = new Set(answers.map((text) => text.toLowerCase()));
  const best = new Map();
  for (const other of state.items) {
    if (other.id === item.id) continue;
    for (const text of other.answers) {
      const key = text.toLowerCase();
      if (banned.has(key)) continue;
      const score = Math.max(...answers.map((answer) => similarity(text, answer)));
      const prev = best.get(key);
      if (!prev || prev.score < score) best.set(key, { text, score });
    }
  }
  const need = (item.kind === "phrase" ? 6 : 12) - answers.length;
  const ranked = [...best.values()].sort((a, b) => b.score - a.score || Math.random() - 0.5);
  const distractors = ranked.slice(0, Math.max(0, need)).map((row) => ({
    text: row.text,
    correct: false,
  }));
  const tiles = [
    ...answers.map((text, index) => ({ text, correct: true, form: index + 1 })),
    ...distractors,
  ].map((tile, index) => ({ ...tile, id: `t${index}` }));
  return shuffle(tiles);
}

function masteryCounts() {
  let fresh = 0;
  let learning = 0;
  let known = 0;
  for (const item of state.items) {
    const stats = state.progress.verbs[item.id] || emptyStats();
    if (!stats.seen) fresh += 1;
    else if (isMastered(stats)) known += 1;
    else learning += 1;
  }
  return { fresh, learning, known, total: state.items.length };
}

function renderStats() {
  const { progress } = state;
  if (!progress) return;
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

function pickIndex(tileId) {
  return state.selected.indexOf(tileId);
}

function tileClass(tile) {
  const classes = ["tile"];
  const pos = pickIndex(tile.id);
  const expected = state.item ? expectedAnswers() : [];
  if (state.showingResult) {
    if (pos >= 0) classes.push(tile.text === expected[pos] ? "good" : "bad");
    else if (tile.correct) classes.push("missed");
  } else if (pos >= 0) {
    classes.push("picked");
  }
  return classes.join(" ");
}

function playHint() {
  if (state.item?.kind === "verb") {
    return ["сначала 1-я форма", "теперь 2-я форма", "теперь 3-я форма"][state.selected.length] || "сначала 1-я форма";
  }
  if (state.item?.kind === "phrasal") return "выбери фразовый глагол";
  if (state.item?.kind === "phrase") return "выбери оборот";
  return "выбери перевод";
}

function resultLine() {
  const item = state.item;
  if (item.kind === "verb") return `${item.v1}  →  ${item.v2}  →  ${item.v3}`;
  return item.en;
}

function renderGrid() {
  els.grid.replaceChildren(
    ...state.tiles.map((tile) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = tileClass(tile);
      btn.disabled = state.showingResult;
      const pos = pickIndex(tile.id);
      if (pos >= 0 && neededPicks() > 1) {
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

function renderEmpty() {
  state.item = null;
  state.tiles = [];
  els.hint.textContent = "пока пусто";
  els.prompt.textContent = ADD_UI[state.section]?.empty || "Добавь первое слово";
  els.prompt.classList.remove("long");
  els.grid.classList.remove("wide");
  els.forms.hidden = true;
  els.dontKnow.hidden = true;
  els.next.hidden = true;
  els.grid.replaceChildren();
  renderStats();
}

function renderRound() {
  const item = state.item;
  if (!item) {
    renderEmpty();
    return;
  }
  els.prompt.textContent = item.ru;
  els.prompt.classList.toggle("long", item.kind === "phrase");
  els.grid.classList.toggle("wide", item.kind === "phrase");
  els.hint.textContent = state.showingResult ? "ответ" : playHint();
  els.forms.hidden = !state.showingResult;
  if (state.showingResult) els.forms.textContent = resultLine();
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
  const stats = state.progress.verbs[state.item.id];
  const now = Date.now();
  stats.seen += 1;
  stats.lastSeen = now;
  if (state.progress.todayDate !== todayKey()) {
    state.progress.todayDate = todayKey();
    state.progress.todayCount = 0;
  }
  state.progress.todayCount += 1;
  state.progress.lastId = state.item.id;
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
  const expected = expectedAnswers();
  return (
    state.selected.length === expected.length &&
    state.selected.every((id, i) => {
      const tile = state.tiles.find((row) => row.id === id);
      return tile && tile.text === expected[i];
    })
  );
}

function orderedCorrectIds() {
  return expectedAnswers().map((_, i) => state.tiles.find((tile) => tile.correct && tile.form === i + 1).id);
}

function finishRound(gaveUp) {
  if (state.showingResult || !state.item) return;
  state.locked = true;
  state.showingResult = true;
  if (gaveUp) state.selected = orderedCorrectIds();
  applyResult(!gaveUp && inCorrectOrder());
  renderRound();
}

function onTile(id) {
  if (state.showingResult || state.locked || !state.item) return;
  const pos = pickIndex(id);
  if (pos >= 0) state.selected = state.selected.slice(0, pos);
  else {
    if (state.selected.length >= neededPicks()) return;
    state.selected.push(id);
  }
  renderRound();
  if (state.selected.length === neededPicks()) finishRound(false);
}

function nextRound() {
  state.showingResult = false;
  state.locked = false;
  state.selected = [];
  if (!state.items.length) {
    renderEmpty();
    return;
  }
  state.item = pickNext();
  state.tiles = buildTiles(state.item);
  renderRound();
}

function resetProgress() {
  if (!confirm("Сбросить прогресс этого режима?")) return;
  const key = poolKey();
  state.store.modes[key] = defaultProgress(state.items);
  state.progress = state.store.modes[key];
  saveProgress();
  nextRound();
}

function slug(text) {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `item-${Date.now()}`;
}

function openSheet() {
  if (state.section === "verbs") return;
  els.sheetTitle.textContent = ADD_UI[state.section]?.title || "Новое слово";
  els.sheetError.hidden = true;
  els.addForm.reset();
  els.sheet.hidden = false;
  els.addRu.focus();
}

function closeSheet() {
  els.sheet.hidden = true;
}

function showSheetError(message) {
  els.sheetError.hidden = false;
  els.sheetError.textContent = message;
}

function saveCustom(event) {
  event.preventDefault();
  const ru = els.addRu.value.trim();
  const en = els.addEn.value.trim();
  if (!ru || !en) {
    showSheetError("Нужны оба поля");
    return;
  }
  const section = state.section;
  if (!CUSTOM_SECTIONS.includes(section)) return;
  const list = state.store.custom[section];
  const existing = state.catalogs[section].find((row) => row.en.toLowerCase() === en.toLowerCase());
  if (existing && !existing.custom) {
    showSheetError("Это уже есть в базовом наборе");
    return;
  }
  if (existing?.custom) {
    existing.ru = ru;
    const saved = list.find((row) => row.id === existing.id);
    if (saved) saved.ru = ru;
  } else {
    let id = slug(en);
    const ids = new Set(state.catalogs[section].map((row) => row.id));
    let n = 2;
    while (ids.has(id)) {
      id = `${slug(en)}-${n}`;
      n += 1;
    }
    list.push({ id, ru, en });
  }
  rebuildCatalogs(state.seeds);
  closeSheet();
  applyCurrent(true);
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Не удалось загрузить ${path}`);
  return res.json();
}

async function main() {
  try {
    const [verbs, words, phrasal, phrases] = await Promise.all([
      loadJson("verbs.json"),
      loadJson("words.json"),
      loadJson("phrasal.json"),
      loadJson("phrases.json"),
    ]);
    state.seeds = { verbs, words, phrasal, phrases };
  } catch (err) {
    els.prompt.textContent = "Не открылось. Запусти через сайт или локальный сервер, не как файл.";
    els.hint.textContent = String(err.message || err);
    return;
  }
  state.store = loadStore();
  rebuildCatalogs(state.seeds);
  state.section = SECTIONS.includes(state.store.section) ? state.store.section : "words";
  state.verbMode = VERB_MODES.includes(state.store.verbMode) ? state.store.verbMode : "simple";
  applyCurrent(true);
  els.dontKnow.addEventListener("click", () => finishRound(true));
  els.next.addEventListener("click", nextRound);
  els.reset.addEventListener("click", resetProgress);
  els.addOpen.addEventListener("click", openSheet);
  els.addCancel.addEventListener("click", closeSheet);
  els.sheet.addEventListener("click", (event) => {
    if (event.target === els.sheet) closeSheet();
  });
  els.addForm.addEventListener("submit", saveCustom);
  for (const btn of els.sections) {
    btn.addEventListener("click", () => {
      if (btn.dataset.section === state.section) return;
      state.section = btn.dataset.section;
      applyCurrent(true);
    });
  }
  for (const btn of els.verbModes) {
    btn.addEventListener("click", () => {
      if (btn.dataset.verbMode === state.verbMode) return;
      state.verbMode = btn.dataset.verbMode;
      applyCurrent(true);
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheet();
    if (event.key === "Enter" && state.showingResult && els.sheet.hidden) nextRound();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

main();
