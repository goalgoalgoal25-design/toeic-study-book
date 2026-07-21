// ============================================================
// TOEIC スタディブック — リスニング音声エンジン
// ・Gemini TTS: ネイティブ品質。アクセント(米/英/豪/加)と話者(男女)を指定可能
// ・ブラウザ内蔵TTS: フォールバック。必ず英語音声を選択(日本語読み防止)
// ============================================================

const AUDIO_CFG_KEY = "toeicStudyBookAudio";
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

let currentAudio = null; // 再生中の Audio 要素

// ---------------- 設定 ----------------

function getAudioCfg() {
  const def = { engine: "auto", accent: "random", gender: "random" };
  try {
    return Object.assign(def, JSON.parse(localStorage.getItem(AUDIO_CFG_KEY) || "{}"));
  } catch (e) {
    return def;
  }
}

function setAudioCfg(patch) {
  localStorage.setItem(AUDIO_CFG_KEY, JSON.stringify(Object.assign(getAudioCfg(), patch)));
}

const ACCENTS = {
  us: { label: "🇺🇸 アメリカ", lang: "en-US", style: "a natural American English accent" },
  uk: { label: "🇬🇧 イギリス", lang: "en-GB", style: "a natural British English accent" },
  au: { label: "🇦🇺 オーストラリア", lang: "en-AU", style: "a natural Australian English accent" },
  ca: { label: "🇨🇦 カナダ", lang: "en-CA", style: "a natural Canadian English accent" },
};

// Gemini TTS のプリセット話者(男性寄り / 女性寄り)
const GEMINI_VOICES = {
  male: ["Puck", "Charon", "Fenrir", "Orus", "Iapetus", "Enceladus"],
  female: ["Kore", "Aoede", "Leda", "Zephyr", "Callirrhoe", "Autonoe"],
};

// 問題ごとに話者プロファイル(アクセント・性別・声)を決める
function chooseProfile() {
  const cfg = getAudioCfg();
  const keys = Object.keys(ACCENTS);
  const accent = cfg.accent === "random" ? keys[Math.floor(Math.random() * keys.length)] : cfg.accent;
  const gender = cfg.gender === "random" ? (Math.random() < 0.5 ? "male" : "female") : cfg.gender;
  const pool = GEMINI_VOICES[gender];
  const voice = pool[Math.floor(Math.random() * pool.length)];
  return { accent, gender, voice };
}

function profileLabel(p) {
  return ACCENTS[p.accent].label + "・" + (p.gender === "male" ? "男性" : "女性");
}

function audioEngine() {
  const cfg = getAudioCfg();
  if (cfg.engine === "gemini") return "gemini";
  if (cfg.engine === "browser") return "browser";
  return getApiKey() ? "gemini" : "browser"; // auto
}

// ---------------- 再生スクリプト ----------------

function itemScript(item) {
  const labels = ["A", "B", "C", "D"];
  const first = item.part === "part1" ? "Look at the picture." : item.q;
  return [first].concat(item.choices.map((c, i) => labels[i] + ". " + c));
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

// ---------------- Gemini TTS ----------------

function pcmToWavUrl(b64, sampleRate) {
  const bin = atob(b64);
  const n = bin.length;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, 1, true);           // モノラル
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);          // 16bit
  w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, bin.charCodeAt(i));
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

async function ttsGemini(lines, profile) {
  const text =
    "Read the following TOEIC listening question aloud in " + ACCENTS[profile.accent].style +
    ", at a moderate pace, with a short pause between the lettered options:\n\n" +
    lines.join("\n");
  const data = await geminiCall(GEMINI_TTS_MODEL, {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voice } } },
    },
  });
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const p = parts.find((x) => x.inlineData && x.inlineData.data);
  if (!p) throw new Error("音声を生成できませんでした。もう一度お試しください。");
  const m = (p.inlineData.mimeType || "").match(/rate=(\d+)/);
  const rate = m ? parseInt(m[1], 10) : 24000;
  return pcmToWavUrl(p.inlineData.data, rate);
}

// ---------------- ブラウザ内蔵TTS(フォールバック) ----------------

function ensureVoices() {
  return new Promise((resolve) => {
    let vs = speechSynthesis.getVoices();
    if (vs.length) return resolve(vs);
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(speechSynthesis.getVoices()); } };
    speechSynthesis.onvoiceschanged = finish;
    setTimeout(finish, 1500);
  });
}

const VOICE_FEMALE = /zira|jenny|aria|susan|hazel|heather|libby|sonia|natasha|hayley|clara|linda|catherine|samantha|karen|moira|tessa|fiona|serena|michelle|emma|ava|olivia|female/i;
const VOICE_MALE = /david|mark|george|james|daniel|alex|fred|guy|ryan|william|liam|christopher|eric|andrew|brian|thomas|male/i;

function pickBrowserVoice(vs, profile) {
  const en = vs.filter((v) => /^en[-_]/i.test(v.lang) || v.lang === "en");
  if (!en.length) return null;
  const lang = ACCENTS[profile.accent].lang.toLowerCase();
  const genderRe = profile.gender === "male" ? VOICE_MALE : VOICE_FEMALE;
  const byLang = en.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang));
  return (
    byLang.find((v) => genderRe.test(v.name)) ||
    byLang[0] ||
    en.find((v) => genderRe.test(v.name)) ||
    en[0]
  );
}

async function ttsBrowser(lines, profile) {
  if (!("speechSynthesis" in window)) throw new Error("このブラウザは音声再生に対応していません。");
  const vs = await ensureVoices();
  const voice = pickBrowserVoice(vs, profile);
  if (!voice) {
    throw new Error("英語の音声がこのブラウザに見つかりませんでした。「AI問題生成」タブでAPIキーを設定すると、Geminiのネイティブ音声が使えます。");
  }
  speechSynthesis.cancel();
  lines.forEach((line) => {
    const u = new SpeechSynthesisUtterance(line);
    u.voice = voice;            // 必ず英語ボイスを明示(日本語読み防止)
    u.lang = voice.lang;
    u.rate = 0.9;
    u.pitch = 1;
    speechSynthesis.speak(u);
  });
  return voice;
}

// ---------------- メイン再生 ----------------

async function playAudioItem(item, btn) {
  stopAudio();
  if (!item._profile) item._profile = chooseProfile(); // 同じ問題は同じ話者で再生
  const profile = item._profile;
  const lines = itemScript(item);
  const info = document.getElementById("voice-info");
  try {
    if (audioEngine() === "gemini") {
      if (!item._wavUrl) {
        if (btn) { btn.disabled = true; btn.textContent = "♪ 音声を生成中…"; }
        item._wavUrl = await ttsGemini(lines, profile);
        if (btn) { btn.disabled = false; btn.textContent = "▶ 音声を再生"; }
      }
      currentAudio = new Audio(item._wavUrl);
      await currentAudio.play();
      item._engineUsed = "Gemini音声";
    } else {
      const v = await ttsBrowser(lines, profile);
      item._engineUsed = "ブラウザ音声: " + v.name;
    }
    if (info) info.textContent = "話者: " + profileLabel(profile) + "(" + item._engineUsed + ")";
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "▶ 音声を再生"; }
    if (info) info.innerHTML = `<span class="err-text">⚠ ${esc(e.message)}</span>`;
  }
}

// ---------------- 設定UI ----------------

function audioSettingsHtml() {
  const cfg = getAudioCfg();
  const sel = (v, cur) => (v === cur ? "selected" : "");
  return `
    <div class="audio-settings">
      <b>🔊 リスニング音声:</b>
      <label>エンジン
        <select onchange="setAudioCfg({engine:this.value})">
          <option value="auto" ${sel("auto", cfg.engine)}>自動(キー設定時はGemini)</option>
          <option value="gemini" ${sel("gemini", cfg.engine)}>Gemini音声(ネイティブ品質)</option>
          <option value="browser" ${sel("browser", cfg.engine)}>ブラウザ内蔵</option>
        </select>
      </label>
      <label>アクセント
        <select onchange="setAudioCfg({accent:this.value})">
          <option value="random" ${sel("random", cfg.accent)}>🔀 ランダム(本番形式)</option>
          <option value="us" ${sel("us", cfg.accent)}>🇺🇸 アメリカ</option>
          <option value="uk" ${sel("uk", cfg.accent)}>🇬🇧 イギリス</option>
          <option value="au" ${sel("au", cfg.accent)}>🇦🇺 オーストラリア</option>
          <option value="ca" ${sel("ca", cfg.accent)}>🇨🇦 カナダ</option>
        </select>
      </label>
      <label>話者
        <select onchange="setAudioCfg({gender:this.value})">
          <option value="random" ${sel("random", cfg.gender)}>🔀 ランダム</option>
          <option value="male" ${sel("male", cfg.gender)}>男性</option>
          <option value="female" ${sel("female", cfg.gender)}>女性</option>
        </select>
      </label>
      <span class="note">本番のTOEICは米・英・豪・加の4カ国の発音が使われます。ランダムがおすすめです。</span>
    </div>`;
}
