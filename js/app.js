// ============================================================
// TOEIC スタディブック — アプリ本体
// ============================================================

const STORAGE_KEY = "toeicStudyBook";

let store = loadStore();
let quiz = null; // 進行中のクイズ状態

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* 破損時は初期化 */ }
  return {
    currentLevel: null,
    sessions: [],   // {date, level, mode, correct, total}
    wrong: [],      // {level, part, q, choices, answer, picked, exp}
    tasks: {},      // {levelId: {taskIndex: true}}
    diag: null,     // {date, correct, level, est}
  };
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function levelOf(id) {
  return LEVELS.find((l) => l.id === id);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// 音声読み上げは js/audio.js(Gemini TTS + ブラウザTTS)に実装

// ---------------- タブ切り替え ----------------

const TABS = ["home", "diag", "practice", "ai", "plan", "record", "nlm"];

function show(tab) {
  stopAudio();
  TABS.forEach((t) => {
    document.getElementById("view-" + t).classList.toggle("hidden", t !== tab);
    document.getElementById("tab-" + t).classList.toggle("active", t === tab);
  });
  if (tab === "home") renderHome();
  if (tab === "diag") renderDiagIntro();
  if (tab === "practice") renderPracticeMenu();
  if (tab === "ai") renderAi();
  if (tab === "plan") renderPlan();
  if (tab === "record") renderRecord();
  if (tab === "nlm") renderNlm();
  window.scrollTo(0, 0);
}

// ---------------- ホーム: レベルと目標点数 ----------------

function levelStats(levelId) {
  const s = store.sessions.filter((x) => x.level === levelId);
  const total = s.reduce((a, b) => a + b.total, 0);
  const correct = s.reduce((a, b) => a + b.correct, 0);
  return { total, correct, pct: total ? Math.round((correct / total) * 100) : 0 };
}

function levelAccuracy(levelId) {
  const st = levelStats(levelId);
  return st.total ? st.pct : null;
}

function renderHome() {
  const el = document.getElementById("view-home");
  const cur = store.currentLevel;

  let html = `
    <div class="hero">
      <h2>レベル別 目標点数マップ</h2>
      <p>自分の現在地に合ったレベルを選ぶと、そのレベル専用の課題と問題が使えるようになります。<br>
      現在地がわからない場合は、まず<a href="#" onclick="show('diag');return false;">診断テスト</a>を受けてください。</p>
    </div>
    <div class="level-grid">`;

  LEVELS.forEach((lv) => {
    const acc = levelAccuracy(lv.id);
    const active = cur === lv.id;
    html += `
      <div class="level-card ${active ? "level-card-active" : ""}" style="--lv-color:${lv.color}">
        <div class="level-head">
          <span class="level-badge">Lv${lv.id} ${lv.name}</span>
          <span class="level-target">${lv.target === 950 ? "900〜990" : lv.target}<small>点目標</small></span>
        </div>
        <div class="level-meta">
          <span>L ${lv.targetL} / R ${lv.targetR}</span>
          <span>CEFR ${lv.cefr}</span>
          <span>IIBCレベル ${lv.iibc.split(" ")[0]}</span>
        </div>
        <p class="level-desc">${lv.desc}</p>
        <ul class="cando">${lv.canDo.map((c) => `<li>${c}</li>`).join("")}</ul>
        <div class="level-stats">
          <span>目安学習期間: ${lv.period}</span>
          <span>語彙: ${lv.vocab}</span>
          <span>${lv.accuracy}</span>
        </div>
        ${acc !== null ? `
        <div class="progress-row">
          <div class="progress-bar"><div class="progress-fill" style="width:${acc}%"></div></div>
          <span class="progress-label">演習正答率 ${acc}%</span>
        </div>` : ""}
        <button class="btn ${active ? "btn-ghost" : "btn-primary"}" onclick="setLevel(${lv.id})">
          ${active ? "✓ 現在の目標レベル" : "このレベルを目標にする"}
        </button>
      </div>`;
  });

  html += `</div>
    <div class="ref-tables">
      <div class="ref-table">
        <h3>TOEIC L&R スコアと CEFR の対応(ETS公式マッピング)</h3>
        <table>
          <tr><th>CEFR</th><th>リスニング</th><th>リーディング</th><th>合計の目安</th></tr>
          ${CEFR_TABLE.map((r) => `<tr><td><b>${r.cefr}</b></td><td>${r.listening}</td><td>${r.reading}</td><td>${r.total}</td></tr>`).join("")}
        </table>
      </div>
      <div class="ref-table">
        <h3>IIBC コミュニケーション能力レベル(A〜E)</h3>
        <table>
          <tr><th>レベル</th><th>スコア</th><th>評価</th></tr>
          ${IIBC_TABLE.map((r) => `<tr><td><b>${r.level}</b></td><td>${r.score}</td><td>${r.desc}</td></tr>`).join("")}
        </table>
      </div>
      <p class="note">出典: IIBC「TOEIC Program各テストスコアとCEFRとの対照表」および「PROFICIENCY SCALE」をもとに作成。</p>
    </div>`;

  el.innerHTML = html;
}

function setLevel(id) {
  store.currentLevel = id;
  saveStore();
  renderHome();
  updateHeaderBadge();
}

function updateHeaderBadge() {
  const el = document.getElementById("header-badge");
  if (store.currentLevel) {
    const lv = levelOf(store.currentLevel);
    el.textContent = `目標: Lv${lv.id} ${lv.name} / ${lv.target === 950 ? "900+" : lv.target}点`;
    el.style.background = lv.color;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// ---------------- 診断テスト ----------------

function renderDiagIntro() {
  const el = document.getElementById("view-diag");
  let last = "";
  if (store.diag) {
    const lv = levelOf(store.diag.level);
    last = `<div class="callout">前回の診断 (${store.diag.date}): ${store.diag.correct}/12問正解 → 推定 ${store.diag.est} / おすすめは <b>Lv${lv.id} ${lv.name}(目標${lv.target === 950 ? "900+" : lv.target}点)</b></div>`;
  }
  el.innerHTML = `
    <div class="hero">
      <h2>レベル診断テスト</h2>
      <p>Lv1〜Lv6 から2問ずつ、計12問の文法・語彙問題(Part 5形式)を出題します。<br>
      結果からあなたの推定スコアと、始めるべきレベルを判定します。所要時間は約5分です。</p>
      ${last}
      <button class="btn btn-primary btn-lg" onclick="startDiag()">診断テストを始める</button>
    </div>`;
}

function startDiag() {
  const items = [];
  LEVELS.forEach((lv) => {
    QUESTIONS[lv.id].part5.slice(0, 2).forEach((q) => {
      items.push({ ...q, level: lv.id, part: "part5" });
    });
  });
  quiz = { mode: "diag", items, idx: 0, correct: 0, answers: [] };
  renderQuizQuestion("view-diag");
}

// ---------------- 問題演習 ----------------

function renderPracticeMenu() {
  const el = document.getElementById("view-practice");
  const cur = store.currentLevel || 1;
  let html = `
    <div class="hero">
      <h2>問題演習</h2>
      <p>レベルとパートを選んでください。リスニング(Part 2)は音声が再生されます。<br>
      間違えた問題は自動で記録され、「記録」タブと NotebookLM 書き出しで復習できます。</p>
    </div>
    ${audioSettingsHtml()}
    <div class="practice-controls">
      <label>レベル:
        <select id="practice-level">
          ${LEVELS.map((lv) => `<option value="${lv.id}" ${lv.id === cur ? "selected" : ""}>Lv${lv.id} ${lv.name}(目標${lv.target === 950 ? "900+" : lv.target}点)</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="mode-grid">
      <div class="mode-card" onclick="startPractice('part2')">
        <div class="mode-icon">🎧</div>
        <h3>Part 2 応答問題</h3>
        <p>音声を聞いて最も適切な返答を選ぶ(3問・選択肢は音声のみ)</p>
      </div>
      <div class="mode-card" onclick="startPractice('part5')">
        <div class="mode-icon">✏️</div>
        <h3>Part 5 短文穴埋め</h3>
        <p>文法・語彙の4択問題(8問)</p>
      </div>
      <div class="mode-card" onclick="startPractice('part7')">
        <div class="mode-icon">📄</div>
        <h3>Part 7 長文読解</h3>
        <p>文書を読んで設問に答える(1文書・3問)</p>
      </div>
      <div class="mode-card" onclick="startPractice('mix')">
        <div class="mode-icon">🔀</div>
        <h3>ミックス演習</h3>
        <p>全パートをまとめて演習(14問)</p>
      </div>
    </div>`;
  el.innerHTML = html;
}

function startPractice(mode) {
  const level = parseInt(document.getElementById("practice-level").value, 10);
  const bank = QUESTIONS[level];
  let items = [];

  if (mode === "part2" || mode === "mix") {
    bank.part2.forEach((q) => items.push({ ...q, level, part: "part2" }));
  }
  if (mode === "part5" || mode === "mix") {
    bank.part5.forEach((q) => items.push({ ...q, level, part: "part5" }));
  }
  if (mode === "part7" || mode === "mix") {
    bank.part7.qs.forEach((q) =>
      items.push({ ...q, level, part: "part7", passage: bank.part7.passage, ptitle: bank.part7.title, passageJa: bank.part7.ja })
    );
  }

  quiz = { mode, level, items, idx: 0, correct: 0, answers: [] };
  renderQuizQuestion("view-practice");
}

// ---------------- クイズエンジン(共通) ----------------

function renderQuizQuestion(viewId) {
  const el = document.getElementById(viewId);
  const item = quiz.items[quiz.idx];
  const n = quiz.idx + 1;
  const total = quiz.items.length;
  const labels = ["A", "B", "C", "D"];
  const isListening = item.part === "part2" || item.part === "part1";

  let body = "";
  if (isListening) {
    const img = item.image ? `<div class="p1-image"><img src="${item.image}" alt="Part 1 写真"></div>` : "";
    const hint = item.part === "part1"
      ? "写真について述べた英文のうち、最も適切なものを選んでください。"
      : "質問への応答として最も適切なものを選んでください。";
    body = `
      ${img}
      <div class="listening-box">
        <p>🎧 音声を再生し、${hint}<br><small>本番同様、選択肢の英文は解答後に表示されます。</small></p>
        <button class="btn btn-primary" id="play-btn" onclick="playCurrentAudio()">▶ 音声を再生</button>
        <div id="voice-info" class="voice-info"></div>
      </div>
      <div class="choices">
        ${item.choices.map((c, i) => `
          <button class="choice" id="choice-${i}" onclick="answer(${i}, '${viewId}')">
            <span class="choice-label">${labels[i]}</span><span id="choice-text-${i}"></span>
          </button>`).join("")}
      </div>`;
  } else {
    const passage = item.passage
      ? `<div class="passage"><div class="passage-title">${esc(item.ptitle)}</div><pre>${esc(item.passage)}</pre></div>`
      : "";
    body = `
      ${passage}
      <div class="question-text">${esc(item.q)}</div>
      <div class="choices">
        ${item.choices.map((c, i) => `
          <button class="choice" id="choice-${i}" onclick="answer(${i}, '${viewId}')">
            <span class="choice-label">${labels[i]}</span><span>${esc(c)}</span>
          </button>`).join("")}
      </div>`;
  }

  const lv = levelOf(item.level);
  el.innerHTML = `
    <div class="quiz-top">
      <span class="quiz-progress">問題 ${n} / ${total}</span>
      <span class="quiz-tag" style="background:${lv.color}">Lv${lv.id} ・ ${partName(item.part)}</span>
      <button class="btn btn-ghost btn-sm" onclick="quitQuiz('${viewId}')">中断する</button>
    </div>
    <div class="quiz-card">
      ${body}
      <div id="feedback"></div>
    </div>`;

  if (isListening) {
    setTimeout(() => playCurrentAudio(), 400);
  }
}

function partName(p) {
  return { part1: "Part 1 写真描写", part2: "Part 2 応答", part5: "Part 5 文法・語彙", part7: "Part 7 読解" }[p] || p;
}

function playCurrentAudio() {
  const item = quiz.items[quiz.idx];
  if (item && (item.part === "part2" || item.part === "part1")) {
    playAudioItem(item, document.getElementById("play-btn"));
  }
}

function answer(picked, viewId) {
  const item = quiz.items[quiz.idx];
  if (quiz.answered) return;
  quiz.answered = true;
  stopAudio();

  const ok = picked === item.answer;
  if (ok) quiz.correct++;
  quiz.answers.push({ item, picked, ok });

  if (!ok) {
    store.wrong.unshift({
      date: new Date().toISOString().slice(0, 10),
      level: item.level,
      part: item.part,
      q: item.q,
      ja: item.ja || "",
      choices: item.choices,
      choiceNotes: item.choiceNotes || null,
      answer: item.answer,
      picked,
      exp: item.exp,
    });
    store.wrong = store.wrong.slice(0, 200);
    saveStore();
  }

  // 選択肢の色付け + リスニングは英文を開示
  item.choices.forEach((c, i) => {
    const btn = document.getElementById("choice-" + i);
    btn.disabled = true;
    if (i === item.answer) btn.classList.add("choice-correct");
    if (i === picked && !ok) btn.classList.add("choice-wrong");
    const t = document.getElementById("choice-text-" + i);
    if (t) t.textContent = c;
  });

  const last = quiz.idx === quiz.items.length - 1;
  const labels = ["A", "B", "C", "D"];
  const jaHtml = item.ja ? `<div class="fb-ja">📖 <b>訳:</b> ${esc(item.ja)}</div>` : "";
  const passageJaHtml = item.passageJa ? `<div class="fb-ja">📄 <b>文書の要旨:</b> ${esc(item.passageJa)}</div>` : "";
  const notesHtml = item.choiceNotes ? `
    <div class="fb-notes">
      ${item.choices.map((c, i) => `
        <div class="fb-note ${i === item.answer ? "fb-note-ok" : (i === picked ? "fb-note-ng" : "")}">
          <b>${labels[i]}. ${esc(c)}</b>
          <span>${esc(item.choiceNotes[i] || "")}</span>
        </div>`).join("")}
    </div>` : "";
  document.getElementById("feedback").innerHTML = `
    <div class="feedback ${ok ? "feedback-ok" : "feedback-ng"}">
      <div class="feedback-head">${ok ? "⭕ 正解!" : "❌ 不正解"}</div>
      <p>${esc(item.exp)}</p>
      ${jaHtml}
      ${passageJaHtml}
      ${notesHtml}
      <button class="btn btn-primary" onclick="nextQuestion('${viewId}')">${last ? "結果を見る" : "次の問題へ"}</button>
    </div>`;
}

function nextQuestion(viewId) {
  quiz.answered = false;
  quiz.idx++;
  if (quiz.idx < quiz.items.length) {
    renderQuizQuestion(viewId);
  } else {
    finishQuiz(viewId);
  }
}

function quitQuiz(viewId) {
  quiz = null;
  stopAudio();
  if (viewId === "view-diag") renderDiagIntro();
  else if (viewId === "view-ai") renderAi();
  else renderPracticeMenu();
}

function finishQuiz(viewId) {
  const el = document.getElementById(viewId);
  const pct = Math.round((quiz.correct / quiz.items.length) * 100);

  if (quiz.mode === "diag") {
    const map = DIAG_MAP.find((m) => quiz.correct >= m.min && quiz.correct <= m.max);
    const lv = levelOf(map.level);
    store.diag = { date: new Date().toISOString().slice(0, 10), correct: quiz.correct, level: map.level, est: map.est };
    saveStore();
    el.innerHTML = `
      <div class="result-card">
        <h2>診断結果</h2>
        <div class="result-score">${quiz.correct} / ${quiz.items.length} 問正解</div>
        <div class="result-est">推定スコア: <b>${map.est}</b></div>
        <div class="result-level" style="border-color:${lv.color}">
          おすすめレベル: <b style="color:${lv.color}">Lv${lv.id} ${lv.name}</b>(目標 ${lv.target === 950 ? "900〜990" : lv.target}点)
          <p>${lv.desc}</p>
        </div>
        <div class="result-actions">
          <button class="btn btn-primary" onclick="setLevel(${lv.id}); show('plan')">このレベルの課題を見る</button>
          <button class="btn btn-ghost" onclick="renderDiagIntro()">もう一度診断する</button>
        </div>
      </div>`;
    updateHeaderBadge();
    return;
  }

  // 通常演習: セッションを記録
  store.sessions.push({
    date: new Date().toISOString().slice(0, 10),
    level: quiz.level,
    mode: quiz.mode,
    correct: quiz.correct,
    total: quiz.items.length,
  });
  saveStore();

  const lv = levelOf(quiz.level);
  const wrongs = quiz.answers.filter((a) => !a.ok);
  const msg =
    pct >= 90 ? "素晴らしい! このレベルはほぼ完成です。次のレベルに挑戦しましょう。" :
    pct >= 70 ? "合格圏です。間違えた問題を復習して90%を目指しましょう。" :
    pct >= 50 ? "あと一歩。解説を読み込み、同じ問題でもう一度満点を取りましょう。" :
    "まずは解説をじっくり読み、このレベルの基礎項目から固めましょう。";

  // レベルアップ判定: 累計30問以上かつ正答率80%以上
  const stats = levelStats(quiz.level);
  let lvlUpHtml = "";
  if (quiz.level < 6 && stats.total >= 30 && stats.pct >= 80) {
    const next = levelOf(quiz.level + 1);
    lvlUpHtml = `
      <div class="levelup-banner">
        🎉 <b>レベルアップ判定クリア!</b> Lv${quiz.level} の累計正答率が ${stats.pct}%(${stats.total}問)に達しました。
        次は <b>Lv${next.id} ${next.name}(目標 ${next.target === 950 ? "900〜990" : next.target}点)</b> に進みましょう。
        <button class="btn btn-primary btn-sm" onclick="setLevel(${next.id}); show('plan')">レベルアップする</button>
      </div>`;
  }
  const backAction = quiz.mode === "ai" ? "show('ai')" : "renderPracticeMenu()";

  el.innerHTML = `
    <div class="result-card">
      <h2>演習結果 — Lv${lv.id} ${lv.name}${quiz.mode === "ai" ? "(AI生成問題)" : ""}</h2>
      <div class="result-score">${quiz.correct} / ${quiz.items.length} 問正解(${pct}%)</div>
      <p class="result-msg">${msg}</p>
      ${lvlUpHtml}
      ${wrongs.length ? `
        <h3>間違えた問題</h3>
        <div class="wrong-list">
          ${wrongs.map((a) => `
            <div class="wrong-item">
              <div class="wrong-q">${esc(a.item.q)}</div>
              ${a.item.ja ? `<div class="wrong-ja">訳: ${esc(a.item.ja)}</div>` : ""}
              <div>正解: <b>${esc(a.item.choices[a.item.answer])}</b> / あなたの解答: ${esc(a.item.choices[a.picked])}</div>
              <p class="wrong-exp">${esc(a.item.exp)}</p>
            </div>`).join("")}
        </div>` : "<p>全問正解です! 🎉</p>"}
      <div class="result-actions">
        <button class="btn btn-primary" onclick="${backAction}">別の演習をする</button>
        <button class="btn btn-ghost" onclick="show('record')">記録を見る</button>
        <button class="btn btn-ghost" onclick="show('ai')">AIで類似問題を作る</button>
      </div>
    </div>`;
}

// ---------------- 学習課題(プラン) ----------------

function renderPlan() {
  const el = document.getElementById("view-plan");
  const cur = store.currentLevel;
  if (!cur) {
    el.innerHTML = `
      <div class="hero">
        <h2>学習課題</h2>
        <p>まず<a href="#" onclick="show('home');return false;">ホーム</a>で目標レベルを選ぶか、
        <a href="#" onclick="show('diag');return false;">診断テスト</a>を受けてください。</p>
      </div>`;
    return;
  }
  const lv = levelOf(cur);
  const done = store.tasks[cur] || {};
  const doneCount = lv.tasks.filter((_, i) => done[i]).length;
  const pct = Math.round((doneCount / lv.tasks.length) * 100);

  el.innerHTML = `
    <div class="hero">
      <h2>Lv${lv.id} ${lv.name} の学習課題 <span class="quiz-tag" style="background:${lv.color}">目標 ${lv.target === 950 ? "900〜990" : lv.target}点</span></h2>
      <p>${lv.desc}</p>
      <p><b>目安学習期間:</b> ${lv.period} / <b>必要語彙:</b> ${lv.vocab} / <b>${lv.accuracy}</b>が目安です。</p>
    </div>
    <div class="progress-row plan-progress">
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${lv.color}"></div></div>
      <span class="progress-label">${doneCount}/${lv.tasks.length} 完了 (${pct}%)</span>
    </div>
    <div class="task-list">
      ${lv.tasks.map((t, i) => `
        <label class="task-item ${done[i] ? "task-done" : ""}">
          <input type="checkbox" ${done[i] ? "checked" : ""} onchange="toggleTask(${cur}, ${i})">
          <span>${t}</span>
        </label>`).join("")}
    </div>
    <div class="callout">
      💡 課題の仕上げとして、このアプリの <a href="#" onclick="show('practice');return false;">Lv${lv.id} 問題演習</a>で
      正答率80%以上(Lv5以上は90%以上)を取れたら、次のレベルへ進みましょう。
    </div>`;
}

function toggleTask(levelId, idx) {
  if (!store.tasks[levelId]) store.tasks[levelId] = {};
  store.tasks[levelId][idx] = !store.tasks[levelId][idx];
  saveStore();
  renderPlan();
}

// ---------------- 記録 ----------------

function renderRecord() {
  const el = document.getElementById("view-record");
  const s = store.sessions;

  if (!s.length && !store.wrong.length) {
    el.innerHTML = `
      <div class="hero"><h2>学習記録</h2>
      <p>まだ記録がありません。<a href="#" onclick="show('practice');return false;">問題演習</a>を始めましょう。</p></div>`;
    return;
  }

  // レベル別の集計
  const byLevel = LEVELS.map((lv) => {
    const ss = s.filter((x) => x.level === lv.id);
    const total = ss.reduce((a, b) => a + b.total, 0);
    const correct = ss.reduce((a, b) => a + b.correct, 0);
    return { lv, total, correct, pct: total ? Math.round((correct / total) * 100) : null };
  });

  // 推定到達レベル: 正答率80%以上の最高レベル
  let reached = null;
  byLevel.forEach((r) => { if (r.pct !== null && r.pct >= 80) reached = r.lv; });

  // 再診断リマインド(2週間ごとの診断でレベルを見直す)
  let diagNote;
  if (store.diag) {
    const days = Math.floor((Date.now() - new Date(store.diag.date).getTime()) / 86400000);
    diagNote = days >= 14
      ? `<p>⏰ 前回の診断から <b>${days}日</b> 経過しています。<a href="#" onclick="show('diag');return false;">再診断</a>で現在地を確認し、レベルを見直しましょう。</p>`
      : `<p>前回の診断: ${store.diag.date}(推定 ${store.diag.est})。2週間ごとの<a href="#" onclick="show('diag');return false;">再診断</a>がおすすめです。</p>`;
  } else {
    diagNote = `<p><a href="#" onclick="show('diag');return false;">診断テスト</a>で現在地を測りましょう。以後は2週間ごとの再診断がおすすめです。</p>`;
  }

  el.innerHTML = `
    <div class="hero"><h2>学習記録</h2>
      ${reached
        ? `<p>演習正答率80%以上をクリアした最高レベル: <b style="color:${reached.color}">Lv${reached.id} ${reached.name}(${reached.target === 950 ? "900+" : reached.target}点圏)</b></p>`
        : `<p>各レベルで正答率80%以上を目指しましょう。</p>`}
      ${diagNote}
    </div>
    <h3>レベル別 正答率</h3>
    <div class="stat-grid">
      ${byLevel.map((r) => `
        <div class="stat-card">
          <div class="stat-title" style="color:${r.lv.color}">Lv${r.lv.id} ${r.lv.name}</div>
          ${r.pct !== null
            ? `<div class="stat-big">${r.pct}%</div><div class="stat-sub">${r.correct}/${r.total}問</div>`
            : `<div class="stat-big stat-empty">—</div><div class="stat-sub">未演習</div>`}
        </div>`).join("")}
    </div>
    <h3>演習履歴(直近20回)</h3>
    <table class="history-table">
      <tr><th>日付</th><th>レベル</th><th>内容</th><th>結果</th></tr>
      ${s.slice(-20).reverse().map((x) => {
        const lv = levelOf(x.level);
        return `<tr><td>${x.date}</td><td>Lv${lv.id} ${lv.name}</td><td>${modeName(x.mode)}</td><td>${x.correct}/${x.total}</td></tr>`;
      }).join("")}
    </table>
    <h3>間違えた問題(直近10問)</h3>
    ${store.wrong.length ? `
      <div class="wrong-list">
        ${store.wrong.slice(0, 10).map((w) => `
          <div class="wrong-item">
            <div class="wrong-meta">Lv${w.level} ・ ${partName(w.part)} ・ ${w.date}</div>
            <div class="wrong-q">${esc(w.q)}</div>
            ${w.ja ? `<div class="wrong-ja">訳: ${esc(w.ja)}</div>` : ""}
            <div>正解: <b>${esc(w.choices[w.answer])}</b></div>
            <p class="wrong-exp">${esc(w.exp)}</p>
          </div>`).join("")}
      </div>` : "<p>間違えた問題はありません。</p>"}
    <div class="result-actions">
      <button class="btn btn-ghost" onclick="resetData()">記録をすべて削除する</button>
    </div>`;
}

function modeName(m) {
  return { part1: "Part 1", part2: "Part 2", part5: "Part 5", part7: "Part 7", mix: "ミックス", diag: "診断", ai: "AI生成" }[m] || m;
}

function resetData() {
  if (!confirm("学習記録・課題チェック・間違えた問題をすべて削除します。よろしいですか?")) return;
  localStorage.removeItem(STORAGE_KEY);
  store = loadStore();
  renderRecord();
  updateHeaderBadge();
}

// ---------------- NotebookLM 活用 ----------------

function buildExportText() {
  const lines = [];
  const lv = store.currentLevel ? levelOf(store.currentLevel) : null;
  lines.push("# TOEIC 学習データ(TOEIC スタディブックからの書き出し)");
  lines.push("書き出し日: " + new Date().toISOString().slice(0, 10));
  lines.push("");
  if (lv) {
    lines.push(`## 目標`);
    lines.push(`目標レベル: Lv${lv.id} ${lv.name} / 目標スコア: ${lv.target === 950 ? "900〜990" : lv.target}点 (CEFR ${lv.cefr})`);
    lines.push("");
  }
  if (store.diag) {
    lines.push(`## 診断テスト結果`);
    lines.push(`${store.diag.date}: 12問中${store.diag.correct}問正解 / 推定スコア ${store.diag.est}`);
    lines.push("");
  }
  if (store.sessions.length) {
    lines.push("## 演習成績");
    LEVELS.forEach((l) => {
      const ss = store.sessions.filter((x) => x.level === l.id);
      const total = ss.reduce((a, b) => a + b.total, 0);
      const correct = ss.reduce((a, b) => a + b.correct, 0);
      if (total) lines.push(`- Lv${l.id} ${l.name}(目標${l.target}点): ${correct}/${total}問正解 (${Math.round((correct / total) * 100)}%)`);
    });
    lines.push("");
  }
  if (store.wrong.length) {
    lines.push("## 間違えた問題(復習用)");
    store.wrong.forEach((w, i) => {
      lines.push(`### 問題${i + 1} [Lv${w.level} / ${partName(w.part)}]`);
      lines.push("問題: " + w.q);
      if (w.ja) lines.push("訳: " + w.ja);
      w.choices.forEach((c, j) => lines.push(`  ${"ABCD"[j]}. ${c}`));
      lines.push(`正解: ${"ABCD"[w.answer]}. ${w.choices[w.answer]}`);
      lines.push(`自分の解答: ${"ABCD"[w.picked]}. ${w.choices[w.picked]}`);
      lines.push("解説: " + w.exp);
      lines.push("");
    });
  }
  return lines.join("\n");
}

function downloadExport() {
  const text = buildExportText();
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "toeic_study_data.txt";
  a.click();
  URL.revokeObjectURL(a.href);
}

function copyPrompt(idx) {
  navigator.clipboard.writeText(NLM_PROMPTS[idx].text).then(() => {
    const btn = document.getElementById("copy-btn-" + idx);
    btn.textContent = "✓ コピーしました";
    setTimeout(() => (btn.textContent = "コピー"), 1500);
  });
}

function renderNlm() {
  const el = document.getElementById("view-nlm");
  el.innerHTML = `
    <div class="hero">
      <h2>Google NotebookLM 活用ガイド</h2>
      <p>NotebookLM は、資料を読み込ませると<b>クイズ・フラッシュカード・学習ガイド・音声解説</b>を
      自動生成してくれる Google の無料学習AIです。このアプリの学習データと組み合わせると、
      「自分の弱点だけの問題集」が作れます。</p>
      <p>💡 アプリ内で問題を直接作りたい場合は、<a href="#" onclick="show('ai');return false;">AI問題生成(Gemini連携)</a>タブの方が手軽です。</p>
    </div>
    <div class="nlm-steps">
      <div class="nlm-step"><span class="step-num">1</span>
        <div><b>学習データを書き出す</b><br>下のボタンで、あなたの成績と間違えた問題(解説付き)をテキストファイルに保存します。
        <div style="margin-top:10px"><button class="btn btn-primary" onclick="downloadExport()">📄 学習データを書き出す (.txt)</button></div></div>
      </div>
      <div class="nlm-step"><span class="step-num">2</span>
        <div><b>NotebookLM に読み込ませる</b><br>
        <a href="https://notebooklm.google.com" target="_blank" rel="noopener">notebooklm.google.com</a> で新しいノートブックを作り、
        「ソースを追加」から書き出したファイルをアップロードします。</div>
      </div>
      <div class="nlm-step"><span class="step-num">3</span>
        <div><b>プロンプトで学習素材を作らせる</b><br>下のプロンプトをコピーして使うと、弱点に合わせた類似問題・単語帳・音声解説が作れます。</div>
      </div>
    </div>
    <h3>コピーして使えるプロンプト集</h3>
    <div class="prompt-list">
      ${NLM_PROMPTS.map((p, i) => `
        <div class="prompt-card">
          <div class="prompt-head">
            <b>${p.title}</b>
            <button class="btn btn-ghost btn-sm" id="copy-btn-${i}" onclick="copyPrompt(${i})">コピー</button>
          </div>
          <p>${p.text}</p>
        </div>`).join("")}
    </div>
    <div class="callout">
      💡 おすすめの使い方: 週の終わりに学習データを書き出し → NotebookLM で「類似問題10問」を生成 → 解けたらこのアプリで次のレベルに挑戦、のサイクルを回しましょう。
      フラッシュカード機能は通勤・通学中の単語学習に、音声概要(Audio Overview)は耳からの復習に向いています。
    </div>`;
}

// ---------------- 初期化 ----------------

document.addEventListener("DOMContentLoaded", () => {
  updateHeaderBadge();
  show("home");
});
