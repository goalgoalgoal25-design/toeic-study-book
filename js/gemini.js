// ============================================================
// TOEIC スタディブック — Gemini 連携(AI問題生成)
// ・APIキー方式: Google AI Studio のキーで問題・画像を自動生成
// ・コピペ方式: Gemini アプリ(Pro加入)にプロンプトを貼り、JSONを取り込む
// ============================================================

const GKEY_STORAGE = "toeicStudyBookGeminiKey";
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

let aiBusy = false;

function getApiKey() { return localStorage.getItem(GKEY_STORAGE) || ""; }

function saveApiKeyFromInput() {
  const v = document.getElementById("ai-key-input").value.trim();
  if (v) localStorage.setItem(GKEY_STORAGE, v);
  else localStorage.removeItem(GKEY_STORAGE);
  renderAi();
}

// ---------------- Gemini API 呼び出し ----------------

async function geminiCall(model, body) {
  const key = getApiKey();
  if (!key) throw new Error("APIキーが設定されていません。上の「APIキー設定」で保存するか、下の「コピペ連携」を使ってください。");
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error("通信に失敗しました。インターネット接続を確認してください。");
  }
  if (!res.ok) {
    let msg = "Gemini APIエラー (" + res.status + ")";
    try {
      const e = await res.json();
      if (e.error && e.error.message) msg += ": " + e.error.message;
    } catch (_) {}
    if (res.status === 400 || res.status === 403) msg += " — APIキーが正しいか確認してください。";
    if (res.status === 429) {
      if (/prepay|credit|billing/i.test(msg)) {
        msg += "\n→ このプロジェクトの前払いクレジットが尽きています。対処法: ① AI Studio (ai.studio/projects) でクレジットを追加する、または ② 無料枠が使える別プロジェクトでAPIキーを新規作成して貼り直す。APIキーなしでも「コピペ連携」は利用できます。";
      } else {
        msg += " — 利用上限(レート制限)に達した可能性があります。1〜2分待ってから再試行してください。";
      }
    }
    throw new Error(msg);
  }
  return res.json();
}

async function geminiText(prompt) {
  const data = await geminiCall(GEMINI_TEXT_MODEL, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" },
  });
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.map((p) => p.text || "").join("");
  if (!text) throw new Error("Geminiから応答が得られませんでした。もう一度お試しください。");
  return text;
}

async function geminiImage(prompt) {
  const data = await geminiCall(GEMINI_IMAGE_MODEL, {
    contents: [{ parts: [{ text: prompt }] }],
  });
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const img = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!img) throw new Error("画像を生成できませんでした。もう一度お試しください。");
  return "data:" + (img.inlineData.mimeType || "image/png") + ";base64," + img.inlineData.data;
}

// ---------------- プロンプト作成 ----------------

function weaknessNote(level) {
  const wrongs = store.wrong.filter((w) => w.level === level).slice(0, 5);
  if (!wrongs.length) return "";
  const lines = wrongs.map((w) => "・" + w.q + "(ポイント: " + w.exp.slice(0, 60) + ")");
  return "\n# 学習者が最近間違えた問題(同じ文法・語彙ポイントを優先して出題すること)\n" + lines.join("\n") + "\n";
}

function buildGenPrompt(level, part) {
  const lv = levelOf(level);
  const target = lv.target === 950 ? "900〜990" : lv.target;
  const common =
    "あなたはTOEIC教材作成の専門家です。以下の条件でオリジナル問題を作成してください。\n" +
    "# 条件\n" +
    "・対象: TOEIC " + target + "点を目指す学習者(CEFR " + lv.cefr + "・" + lv.name + "レベル)。難易度を必ずこのレベルに合わせること。\n" +
    "・実在のTOEIC過去問の複製は禁止。完全オリジナルの問題を作ること。\n" +
    "・解説(exp)は日本語で、正解の根拠と誤答の選択肢が不適切な理由を簡潔に説明すること。\n" +
    weaknessNote(level);
  if (part === "part2") {
    return common +
      "# 形式\n" +
      "TOEIC Part 2(応答問題)を4問。qは話しかけ・質問の英文1文、choicesはそれに対する応答の英文3つ(正解1つ+ひっかけ2つ。音の類似や連想語のひっかけを含めること)。\n" +
      "# 出力\n" +
      'JSONのみを出力: {"questions":[{"q":"英文","choices":["応答1","応答2","応答3"],"answer":0,"exp":"日本語解説","ja":"qの日本語訳","choiceNotes":["各応答の日本語訳+正解/不正解の理由(3つ)"]}]}\n' +
      "answerは正解のインデックス(0始まり)。正解の位置は問題ごとにランダムにすること。";
  }
  return common +
    "# 形式\n" +
    "TOEIC Part 5(短文穴埋め)を5問。空所は ------- で表す。文法問題(品詞・時制・前置詞・接続詞など)と語彙問題を混ぜること。choicesは4つ。\n" +
    "# 出力\n" +
    'JSONのみを出力: {"questions":[{"q":"英文(空所は-------)","choices":["A","B","C","D"],"answer":0,"exp":"日本語解説","ja":"完成した英文の日本語訳","choiceNotes":["各選択肢が正解/不正解である理由の短い日本語補足(4つ)"]}]}\n' +
    "answerは正解のインデックス(0始まり)。正解の位置は問題ごとにランダムにすること。";
}

function buildPart1Prompt(level) {
  const lv = levelOf(level);
  const target = lv.target === 950 ? "900〜990" : lv.target;
  return (
    "あなたはTOEIC教材作成の専門家です。TOEIC Part 1(写真描写問題)を2問作成してください。\n" +
    "# 条件\n" +
    "・対象: TOEIC " + target + "点を目指す学習者(CEFR " + lv.cefr + ")。難易度をこのレベルに合わせること。\n" +
    "・sceneは写真として生成しやすい具体的な場面の英語描写1〜2文(人物の動作・物の位置が明確なオフィス・店・駅などの日常場面)。\n" +
    "・statementsは写真についての英文4つ。写真の内容と一致するものを1つだけ含め、残り3つは動作・物・位置が少し異なるひっかけにすること。\n" +
    "・expは日本語解説(正解の根拠と、誤答が違う理由)。\n" +
    "# 出力\n" +
    'JSONのみを出力: {"questions":[{"scene":"場面の英語描写","statements":["英文1","英文2","英文3","英文4"],"answer":0,"exp":"日本語解説","ja":"正解文の日本語訳","choiceNotes":["各英文の日本語訳+写真と合う/合わない理由(4つ)"]}]}\n' +
    "answerは正解のインデックス(0始まり)。正解の位置は問題ごとにランダムにすること。"
  );
}

function photoPrompt(scene) {
  return (
    "A realistic photograph for an English listening test question: " + scene +
    " Photorealistic, natural lighting, ordinary everyday scene, clear composition, no text, no captions, no watermarks."
  );
}

// ---------------- JSON 解析 ----------------

function extractJson(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("応答からJSONが見つかりませんでした。もう一度お試しください。");
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    throw new Error("JSONの解析に失敗しました。もう一度生成してください。");
  }
}

function parseGenQuestions(text, part, level) {
  const data = extractJson(text);
  const list = data.questions;
  if (!Array.isArray(list) || !list.length) throw new Error("問題データが空でした。もう一度生成してください。");
  const need = part === "part2" ? 3 : 4;
  return list.map((q) => {
    if (typeof q.q !== "string" || !Array.isArray(q.choices) || q.choices.length < need ||
        typeof q.answer !== "number" || q.answer < 0 || q.answer >= need) {
      throw new Error("問題データの形式が不正でした。もう一度生成してください。");
    }
    const item = { part, level, q: q.q, choices: q.choices.slice(0, need).map(String), answer: q.answer, exp: String(q.exp || "解説なし") };
    if (typeof q.ja === "string" && q.ja) item.ja = q.ja;
    if (Array.isArray(q.choiceNotes) && q.choiceNotes.length >= need) item.choiceNotes = q.choiceNotes.slice(0, need).map(String);
    return item;
  });
}

function parsePart1Spec(text) {
  const data = extractJson(text);
  const list = data.questions;
  if (!Array.isArray(list) || !list.length) throw new Error("問題データが空でした。もう一度生成してください。");
  return list.slice(0, 2).map((q) => {
    if (typeof q.scene !== "string" || !Array.isArray(q.statements) || q.statements.length < 4 ||
        typeof q.answer !== "number" || q.answer < 0 || q.answer >= 4) {
      throw new Error("問題データの形式が不正でした。もう一度生成してください。");
    }
    const item = { scene: q.scene, statements: q.statements.slice(0, 4).map(String), answer: q.answer, exp: String(q.exp || "解説なし") };
    if (typeof q.ja === "string" && q.ja) item.ja = q.ja;
    if (Array.isArray(q.choiceNotes) && q.choiceNotes.length >= 4) item.choiceNotes = q.choiceNotes.slice(0, 4).map(String);
    return item;
  });
}

// ---------------- AI問題生成タブ ----------------

function renderAi() {
  const el = document.getElementById("view-ai");
  const cur = store.currentLevel || 1;
  const hasKey = !!getApiKey();

  el.innerHTML = `
    <div class="hero">
      <h2>AI問題生成(Gemini連携)</h2>
      <p>あなたのレベルと<b>最近間違えた問題の弱点</b>に合わせて、Gemini が新しい問題を無限に生成します。
      Part 1 は<b>写真もAIが生成</b>する本番形式です。生成した問題の成績も記録され、レベルアップ判定に使われます。</p>
    </div>

    <div class="ai-key-box">
      <div class="prompt-head"><b>🔑 APIキー設定(自動生成に必要)</b>
        <span class="key-status ${hasKey ? "key-ok" : ""}">${hasKey ? "✓ 設定済み" : "未設定"}</span>
      </div>
      <p class="note">
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>
        で無料発行できるAPIキーを貼り付けてください(Googleアカウントでログイン →「Create API key」)。無料枠内で利用できます。<br>
        ※ Gemini アプリの Pro 加入とAPIキーは別の仕組みです。<b>APIキーなしで Pro 加入をそのまま使いたい場合は、下の「コピペ連携」</b>をご利用ください。
      </p>
      <div class="key-row">
        <input type="password" id="ai-key-input" class="key-input" placeholder="AIza... で始まるAPIキー" value="${esc(getApiKey())}">
        <button class="btn btn-primary" onclick="saveApiKeyFromInput()">保存</button>
      </div>
    </div>

    <div class="practice-controls">
      <label>生成するレベル:
        <select id="ai-level">
          ${LEVELS.map((lv) => `<option value="${lv.id}" ${lv.id === cur ? "selected" : ""}>Lv${lv.id} ${lv.name}(目標${lv.target === 950 ? "900+" : lv.target}点)</option>`).join("")}
        </select>
      </label>
    </div>

    ${audioSettingsHtml()}

    <div class="mode-grid">
      <div class="mode-card" onclick="generateAi('part1')">
        <div class="mode-icon">🖼️</div>
        <h3>Part 1 写真描写 <span class="tag-new">AI写真生成</span></h3>
        <p>Geminiが写真を生成し、音声で4つの英文を読み上げ(2問・要APIキー)</p>
      </div>
      <div class="mode-card" onclick="generateAi('part2')">
        <div class="mode-icon">🎧</div>
        <h3>Part 2 応答問題</h3>
        <p>弱点に合わせた新作の応答問題(4問)</p>
      </div>
      <div class="mode-card" onclick="generateAi('part5')">
        <div class="mode-icon">✏️</div>
        <h3>Part 5 文法・語彙</h3>
        <p>弱点に合わせた新作の文法・語彙問題(5問)</p>
      </div>
    </div>

    <div id="ai-status"></div>

    <details class="paste-box">
      <summary>📋 APIキーなしで使う — Gemini Pro アプリとのコピペ連携(Part 2 / Part 5)</summary>
      <div class="paste-inner">
        <p>① パートを選んで「プロンプトを作成」→ ② コピーして
        <a href="https://gemini.google.com" target="_blank" rel="noopener">gemini.google.com</a>(Pro加入のアカウント)に貼り付け →
        ③ 返ってきたJSONをコピーして下の欄に貼り付け →「取り込んで演習開始」。</p>
        <div class="paste-controls">
          <select id="paste-part">
            <option value="part5">Part 5 文法・語彙(5問)</option>
            <option value="part2">Part 2 応答問題(4問)</option>
          </select>
          <button class="btn btn-ghost" onclick="showPastePrompt()">① プロンプトを作成</button>
          <button class="btn btn-ghost" id="paste-copy-btn" onclick="copyPastePrompt()">② プロンプトをコピー</button>
        </div>
        <textarea id="paste-prompt" class="gen-textarea" readonly placeholder="ここに生成用プロンプトが表示されます"></textarea>
        <textarea id="paste-json" class="gen-textarea" placeholder='③ Geminiの返答(JSON)をここに貼り付け'></textarea>
        <button class="btn btn-primary" onclick="importPasted()">④ 取り込んで演習開始</button>
        <div id="paste-status"></div>
      </div>
    </details>`;
}

function aiSpinner(msg) {
  return `<div class="ai-loading"><span class="spinner"></span> ${esc(msg)}</div>`;
}

async function generateAi(part) {
  if (aiBusy) return;
  const level = parseInt(document.getElementById("ai-level").value, 10);
  const out = document.getElementById("ai-status");
  aiBusy = true;
  try {
    if (part === "part1") {
      out.innerHTML = aiSpinner("Gemini が写真描写問題を作成しています…");
      const spec = parsePart1Spec(await geminiText(buildPart1Prompt(level)));
      const items = [];
      for (let i = 0; i < spec.length; i++) {
        out.innerHTML = aiSpinner("写真を生成しています… (" + (i + 1) + "/" + spec.length + ")");
        const image = await geminiImage(photoPrompt(spec[i].scene));
        items.push({
          part: "part1", level,
          q: "(写真描写) " + spec[i].scene,
          ja: spec[i].ja || "",
          choices: spec[i].statements,
          choiceNotes: spec[i].choiceNotes || null,
          answer: spec[i].answer,
          exp: spec[i].exp,
          image,
        });
      }
      out.innerHTML = "";
      startAiQuiz(level, items);
    } else {
      out.innerHTML = aiSpinner("Gemini があなたの弱点に合わせて問題を作成しています…");
      const items = parseGenQuestions(await geminiText(buildGenPrompt(level, part)), part, level);
      out.innerHTML = "";
      startAiQuiz(level, items);
    }
  } catch (e) {
    out.innerHTML = `<div class="callout err">⚠ ${esc(e.message)}</div>`;
  } finally {
    aiBusy = false;
  }
}

function startAiQuiz(level, items) {
  quiz = { mode: "ai", level, items, idx: 0, correct: 0, answers: [] };
  renderQuizQuestion("view-ai");
}

// ---------------- コピペ連携 ----------------

function showPastePrompt() {
  const part = document.getElementById("paste-part").value;
  const level = parseInt(document.getElementById("ai-level").value, 10);
  document.getElementById("paste-prompt").value = buildGenPrompt(level, part);
  document.getElementById("paste-status").innerHTML = "";
}

function copyPastePrompt() {
  const t = document.getElementById("paste-prompt").value;
  if (!t) { showPastePrompt(); }
  navigator.clipboard.writeText(document.getElementById("paste-prompt").value).then(() => {
    const btn = document.getElementById("paste-copy-btn");
    btn.textContent = "✓ コピーしました";
    setTimeout(() => (btn.textContent = "② プロンプトをコピー"), 1500);
  });
}

function importPasted() {
  const part = document.getElementById("paste-part").value;
  const level = parseInt(document.getElementById("ai-level").value, 10);
  const out = document.getElementById("paste-status");
  try {
    const items = parseGenQuestions(document.getElementById("paste-json").value, part, level);
    out.innerHTML = "";
    startAiQuiz(level, items);
  } catch (e) {
    out.innerHTML = `<div class="callout err">⚠ ${esc(e.message)}</div>`;
  }
}
