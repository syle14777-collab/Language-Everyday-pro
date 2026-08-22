import React, { useState, useEffect, useRef, useCallback } from "react";
import { Sun, Sparkles, BookOpen, MessageCircle, Volume2, VolumeX, Check, ChevronRight, ChevronLeft, Send, RefreshCw, Mic } from "lucide-react";

const TOKENS = {
  paper: "#FAF6ED",
  paperDim: "#F1EBDC",
  ink: "#1B2A4A",
  inkSoft: "#4C5A78",
  highlight: "#FFD23F",
  coral: "#FF6B5B",
  sage: "#6B9080",
  slate: "#8B93A6",
  card: "#FFFFFF",
};

// window.storage only exists inside claude.ai artifacts previews.
// In a real deployed app we persist to the browser's own localStorage instead.
window.storage = {
  async get(key) {
    const v = localStorage.getItem(key);
    if (v === null) throw new Error("not found");
    return { key, value: v };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

const SESSION_COUNT = 10;
const TOPICS = [
  "công việc văn phòng", "du lịch sân bay", "mua sắm hàng ngày", "sức khỏe & thể thao",
  "công nghệ & mạng xã hội", "nhà hàng & ẩm thực", "cuộc họp & email", "thời tiết & cảm xúc",
  "tài chính cá nhân", "gia đình & bạn bè",
];

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function msUntilNine() {
  const now = new Date();
  const nine = new Date(now);
  nine.setHours(9, 0, 0, 0);
  return nine - now;
}
function emptySessions() {
  return Array.from({ length: SESSION_COUNT }, (_, i) => ({ id: i + 1, messages: [], completed: false }));
}

async function callClaude(messages, system) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  const text = (data.content || []).map((b) => b.text || "").join("\n");
  return text;
}

function parseBilingual(text) {
  // lines like "EN: ..." and "VI: ..." — fall back to raw text if not formatted
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const pairs = [];
  let cur = {};
  for (const line of lines) {
    if (/^EN:/i.test(line)) {
      if (cur.en) pairs.push(cur);
      cur = { en: line.replace(/^EN:/i, "").trim() };
    } else if (/^VI:/i.test(line)) {
      cur.vi = line.replace(/^VI:/i, "").trim();
    } else if (cur.en && !cur.vi) {
      cur.vi = line;
    } else {
      pairs.push({ en: line, vi: "" });
      cur = {};
    }
  }
  if (cur.en) pairs.push(cur);
  return pairs.length ? pairs : [{ en: text, vi: "" }];
}

function pickAdamVoice() {
  const voices = window.speechSynthesis.getVoices();
  const prefer = ["Daniel", "Alex", "Fred", "Google US English", "Male"];
  for (const name of prefer) {
    const v = voices.find((v) => v.name.includes(name) && v.lang.startsWith("en"));
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith("en")) || null;
}

function AdamCat({ speaking, size = 120 }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} style={{ flexShrink: 0 }}>
      <style>{`
        @keyframes adamBlink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(0.12); } }
        .adam-eye { transform-origin: center; animation: adamBlink 4.2s infinite; }
        @keyframes adamBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .adam-body { animation: adamBob 2.6s ease-in-out infinite; transform-origin: center; }
      `}</style>
      <g className="adam-body">
        <ellipse cx="100" cy="122" rx="72" ry="66" fill="#FF6B5B" />
        <path d="M42 72 L58 18 L86 66 Z" fill="#FF6B5B" />
        <path d="M158 72 L142 18 L114 66 Z" fill="#FF6B5B" />
        <path d="M52 76 L63 38 L78 68 Z" fill="#FFD23F" />
        <path d="M148 76 L137 38 L122 68 Z" fill="#FFD23F" />
        <circle cx="63" cy="140" r="9" fill="#FFB199" opacity="0.55" />
        <circle cx="137" cy="140" r="9" fill="#FFB199" opacity="0.55" />
        <ellipse className="adam-eye" cx="74" cy="116" rx="8" ry="10" fill="#1B2A4A" />
        <ellipse className="adam-eye" cx="126" cy="116" rx="8" ry="10" fill="#1B2A4A" />
        <path d="M92 134 Q100 140 108 134" stroke="#1B2A4A" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <ellipse cx="100" cy="152" rx="15" ry={speaking ? 11 : 4} fill="#1B2A4A" style={{ transition: "ry 0.12s ease" }} />
        <line x1="45" y1="145" x2="15" y2="140" stroke="#1B2A4A" strokeWidth="1.5" opacity="0.5" />
        <line x1="45" y1="153" x2="15" y2="156" stroke="#1B2A4A" strokeWidth="1.5" opacity="0.5" />
        <line x1="155" y1="145" x2="185" y2="140" stroke="#1B2A4A" strokeWidth="1.5" opacity="0.5" />
        <line x1="155" y1="153" x2="185" y2="156" stroke="#1B2A4A" strokeWidth="1.5" opacity="0.5" />
      </g>
    </svg>
  );
}

export default function App() {
  const [dk] = useState(dayKey());
  const [dayData, setDayData] = useState(null);
  const [view, setView] = useState("loading"); // loading | input | dashboard | words | chat
  const [inputText, setInputText] = useState("");
  const [autoLoading, setAutoLoading] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [activeSession, setActiveSession] = useState(null);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(msUntilNine());
  const [error, setError] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceRef = useRef(null);
  const scrollRef = useRef(null);

  const speakText = useCallback((text, enabled) => {
    if (!enabled || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.04;
      u.pitch = 1.18;
      if (voiceRef.current) u.voice = voiceRef.current;
      u.onstart = () => setIsSpeaking(true);
      u.onend = () => setIsSpeaking(false);
      u.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.error("TTS error", e);
    }
  }, []);

  useEffect(() => {
    const loadVoices = () => { voiceRef.current = pickAdamVoice(); };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  useEffect(() => {
    const t = setInterval(() => setCountdown(msUntilNine()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadDay = useCallback(async () => {
    try {
      const res = await window.storage.get(`day:${dk}`);
      const data = JSON.parse(res.value);
      setDayData(data);
      setView("dashboard");
    } catch (e) {
      const deadlinePassed = msUntilNine() <= 0;
      if (deadlinePassed) {
        setView("input");
        runAutoGenerate();
      } else {
        setView("input");
      }
    }
  }, [dk]);

  useEffect(() => { loadDay(); }, [loadDay]);

  const saveDay = async (data) => {
    setDayData(data);
    try {
      await window.storage.set(`day:${dk}`, JSON.stringify(data));
    } catch (e) {
      setError("Không lưu được dữ liệu, thử lại nhé.");
    }
  };

  const submitOwnWords = async () => {
    const words = inputText
      .split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 10)
      .map((line) => {
        const [en, vi] = line.split("-").map((s) => s.trim());
        return { en: en || line, vi: vi || "" };
      });
    if (words.length < 1) return;
    const data = {
      words, topic: "Chủ đề tự chọn của bạn", source: "user",
      submittedAt: new Date().toISOString(), sessions: emptySessions(),
    };
    await saveDay(data);
    setView("dashboard");
  };

  const runAutoGenerate = async () => {
    setAutoLoading(true);
    setError("");
    try {
      const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
      const system = `You output ONLY strict JSON, no markdown fences, no preamble. Generate exactly 10 English vocabulary words at TOEIC 400+ difficulty level related to the topic "${topic}". JSON shape: {"topic": "short Vietnamese topic name", "words": [{"en": "word", "vi": "Vietnamese meaning", "example": "short example sentence in English"}]}`;
      const raw = await callClaude([{ role: "user", content: `Topic: ${topic}` }], system);
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      const data = {
        words: parsed.words.map((w) => ({ en: w.en, vi: w.vi, example: w.example })),
        topic: parsed.topic || topic, source: "auto",
        submittedAt: new Date().toISOString(), sessions: emptySessions(),
      };
      await saveDay(data);
      setView("dashboard");
    } catch (e) {
      setError("Adam chưa tạo được từ vựng tự động, thử lại giúp mình nhé.");
    } finally {
      setAutoLoading(false);
    }
  };

  const openSession = (id) => {
    setActiveSession(id);
    setView("chat");
    const sess = dayData.sessions.find((s) => s.id === id);
    if (sess.messages.length === 0) {
      kickoffSession(id);
    }
  };

  const buildSystemPrompt = () => {
    const wordList = dayData.words.map((w) => `${w.en} (${w.vi})`).join(", ");
    return `You are "Adam", a funny, upbeat, encouraging English tutor chatting with a Vietnamese learner (TOEIC 400+ level). Topic for today: ${dayData.topic}. Vocabulary to practice this session: ${wordList}. Rules: keep replies short (2-4 exchanges), always bilingual, format EVERY line as "EN: <english sentence>" followed by "VI: <vietnamese translation>". Be playful and use light humor/jokes. Ask the learner a question that pushes them to use one of the vocabulary words. Never break the EN:/VI: format.`;
  };

  const kickoffSession = async (id) => {
    setSending(true);
    try {
      const system = buildSystemPrompt();
      const reply = await callClaude([{ role: "user", content: "Start today's session with a fun greeting and your first question." }], system);
      appendMessage(id, "assistant", reply);
    } catch (e) {
      setError("Adam đang bận, thử lại nhé.");
    } finally {
      setSending(false);
    }
  };

  const appendMessage = (id, role, content) => {
    setDayData((prev) => {
      const next = { ...prev, sessions: prev.sessions.map((s) => s.id === id ? { ...s, messages: [...s.messages, { role, content }] } : s) };
      window.storage.set(`day:${dk}`, JSON.stringify(next)).catch(() => {});
      if (role === "assistant" && ttsEnabled) {
        const pairs = parseBilingual(content);
        speakText(pairs.map((p) => p.en).join(". "), true);
      }
      return next;
    });
  };

  const sendChat = async () => {
    if (!chatInput.trim() || !activeSession) return;
    const text = chatInput.trim();
    setChatInput("");
    appendMessage(activeSession, "user", text);
    setSending(true);
    try {
      const sess = dayData.sessions.find((s) => s.id === activeSession);
      const history = [...sess.messages, { role: "user", content: text }].map((m) => ({ role: m.role, content: m.content }));
      const system = buildSystemPrompt();
      const reply = await callClaude(history, system);
      appendMessage(activeSession, "assistant", reply);
    } catch (e) {
      setError("Adam đang bận, thử lại nhé.");
    } finally {
      setSending(false);
    }
  };

  const markComplete = () => {
    setDayData((prev) => {
      const next = { ...prev, sessions: prev.sessions.map((s) => s.id === activeSession ? { ...s, completed: true } : s) };
      window.storage.set(`day:${dk}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setView("dashboard");
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [dayData, view]);

  const minutes = Math.max(0, Math.floor(countdown / 60000));
  const seconds = Math.max(0, Math.floor((countdown % 60000) / 1000));
  const deadlinePassed = countdown <= 0;
  const pct = Math.min(100, Math.max(0, 100 - (countdown / (9 * 3600000)) * 100));

  const Shell = ({ children }) => (
    <div style={{ background: TOKENS.paperDim, minHeight: "100vh", display: "flex", justifyContent: "center", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 430, minHeight: "100vh", background: TOKENS.paper, boxShadow: "0 0 40px rgba(27,42,74,0.08)", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );

  const Header = ({ title, onBack }) => (
    <div style={{ padding: "18px 20px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${TOKENS.slate}22` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: TOKENS.ink }}>
            <ChevronLeft size={22} />
          </button>
        )}
        <span style={{ fontFamily: "ui-rounded, system-ui, sans-serif", fontWeight: 800, fontSize: 20, color: TOKENS.ink, letterSpacing: -0.3 }}>{title}</span>
      </div>
      <button onClick={() => setTtsEnabled((v) => !v)} title="Bật/tắt giọng Adam"
        style={{ background: ttsEnabled ? TOKENS.coral : TOKENS.slate + "33", border: "none", borderRadius: 999, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: ttsEnabled ? "#fff" : TOKENS.ink }}>
        {ttsEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
      </button>
    </div>
  );

  if (view === "loading") {
    return (
      <Shell>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: TOKENS.inkSoft }}>Đang tải…</div>
      </Shell>
    );
  }

  if (view === "input") {
    return (
      <Shell>
        <Header title="Học tiếng Anh với Adam" />
        <div style={{ padding: 20, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
            <AdamCat speaking={isSpeaking} size={110} />
          </div>
          <div style={{ background: TOKENS.card, borderRadius: 20, padding: 20, marginBottom: 18, position: "relative", overflow: "hidden", border: `1px solid ${TOKENS.slate}22` }}>
            <svg viewBox="0 0 100 100" style={{ position: "absolute", right: -20, top: -20, width: 130, opacity: 0.12 }}>
              <circle cx="50" cy="50" r="45" fill={TOKENS.highlight} />
            </svg>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: TOKENS.coral, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
              <Sun size={16} /> HẠN CHÓT 9:00 SÁNG
            </div>
            {!deadlinePassed ? (
              <>
                <div style={{ fontFamily: "ui-rounded, system-ui, sans-serif", fontSize: 34, fontWeight: 800, color: TOKENS.ink }}>
                  {minutes}:{String(seconds).padStart(2, "0")}
                </div>
                <div style={{ color: TOKENS.inkSoft, fontSize: 13, marginTop: 2 }}>còn lại để đẩy 10 từ vựng của riêng bạn</div>
                <div style={{ height: 6, background: TOKENS.slate + "22", borderRadius: 999, marginTop: 12, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: TOKENS.coral, borderRadius: 999 }} />
                </div>
              </>
            ) : (
              <div style={{ color: TOKENS.ink, fontWeight: 600 }}>Đã quá 9h sáng — Adam sẽ tự chọn chủ đề & từ vựng cho bạn hôm nay.</div>
            )}
          </div>

          {!deadlinePassed && (
            <>
              <div style={{ color: TOKENS.ink, fontWeight: 700, marginBottom: 8, fontSize: 15 }}>Nhập 10 từ vựng hôm nay</div>
              <div style={{ color: TOKENS.inkSoft, fontSize: 13, marginBottom: 10 }}>Mỗi dòng một từ, có thể thêm nghĩa: <i>negotiate - đàm phán</i></div>
              <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} rows={8}
                placeholder={"negotiate - đàm phán\ndeadline - hạn chót\ninvoice - hóa đơn\n..."}
                style={{ width: "100%", borderRadius: 14, border: `1px solid ${TOKENS.slate}44`, padding: 14, fontSize: 14, fontFamily: "ui-monospace, monospace", resize: "vertical", boxSizing: "border-box", color: TOKENS.ink, background: "#fff" }} />
              <button onClick={submitOwnWords} disabled={!inputText.trim()}
                style={{ marginTop: 14, width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: TOKENS.ink, color: "#fff", fontWeight: 700, fontSize: 15, cursor: inputText.trim() ? "pointer" : "not-allowed", opacity: inputText.trim() ? 1 : 0.5 }}>
                Lưu 10 từ vựng của tôi
              </button>
              <button onClick={runAutoGenerate} disabled={autoLoading}
                style={{ marginTop: 10, width: "100%", padding: "13px 0", borderRadius: 14, border: `1.5px solid ${TOKENS.ink}`, background: "transparent", color: TOKENS.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {autoLoading ? <RefreshCw size={16} className="spin" /> : <Sparkles size={16} />}
                {autoLoading ? "Adam đang chọn từ..." : "Để Adam tự chọn từ vựng hôm nay"}
              </button>
            </>
          )}
          {deadlinePassed && autoLoading && (
            <div style={{ textAlign: "center", padding: 30, color: TOKENS.inkSoft }}>
              <RefreshCw size={22} className="spin" /> <div style={{ marginTop: 8 }}>Adam đang chọn chủ đề TOEIC 400+ cho bạn…</div>
            </div>
          )}
          {error && <div style={{ color: TOKENS.coral, marginTop: 12, fontSize: 13 }}>{error}</div>}
        </div>
      </Shell>
    );
  }

  if (view === "words" && dayData) {
    return (
      <Shell>
        <Header title="Từ vựng hôm nay" onBack={() => setView("dashboard")} />
        <div style={{ padding: 20, flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 13, color: TOKENS.inkSoft, marginBottom: 14 }}>
            Chủ đề: <b style={{ color: TOKENS.ink }}>{dayData.topic}</b> · nguồn: {dayData.source === "user" ? "bạn nhập" : "Adam tự chọn"}
          </div>
          {dayData.words.map((w, i) => (
            <div key={i} style={{ background: TOKENS.card, border: `1px solid ${TOKENS.slate}22`, borderRadius: 14, padding: "12px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 700, color: TOKENS.ink, fontFamily: "ui-monospace, monospace" }}>{w.en}</span>
                <span style={{ color: TOKENS.coral, fontSize: 13 }}>{w.vi}</span>
              </div>
              {w.example && <div style={{ fontSize: 12, color: TOKENS.inkSoft, marginTop: 4, fontStyle: "italic" }}>{w.example}</div>}
            </div>
          ))}
        </div>
      </Shell>
    );
  }

  if (view === "chat" && dayData && activeSession) {
    const sess = dayData.sessions.find((s) => s.id === activeSession);
    return (
      <Shell>
        <Header title={`Buổi trò chuyện ${activeSession}/${SESSION_COUNT}`} onBack={() => setView("dashboard")} />
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 16px 6px" }}>
          {sess.messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 6, marginBottom: 10 }}>
              {m.role === "assistant" && <AdamCat speaking={isSpeaking && i === sess.messages.length - 1} size={34} />}
              <div style={{ maxWidth: "78%", background: m.role === "user" ? TOKENS.ink : TOKENS.card, color: m.role === "user" ? "#fff" : TOKENS.ink, borderRadius: 16, padding: "10px 14px", border: m.role === "user" ? "none" : `1px solid ${TOKENS.slate}22` }}>
                {m.role === "assistant" ? (
                  parseBilingual(m.content).map((p, idx) => (
                    <div key={idx} style={{ marginBottom: idx < parseBilingual(m.content).length - 1 ? 8 : 0 }}>
                      <div style={{ fontSize: 14 }}>{p.en}</div>
                      {p.vi && <div style={{ fontSize: 12.5, color: TOKENS.coral, marginTop: 2 }}>{p.vi}</div>}
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 14 }}>{m.content}</div>
                )}
                {m.role === "assistant" && (
                  <button onClick={() => speakText(parseBilingual(m.content).map((p) => p.en).join(". "), true)}
                    style={{ marginTop: 6, background: "none", border: "none", color: TOKENS.coral, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
                    <Volume2 size={13} /> Nghe lại
                  </button>
                )}
              </div>
            </div>
          ))}
          {sending && <div style={{ color: TOKENS.slate, fontSize: 13, padding: "6px 4px" }}>Adam đang gõ…</div>}
        </div>
        <div style={{ padding: 14, borderTop: `1px solid ${TOKENS.slate}22`, display: "flex", gap: 8, alignItems: "center" }}>
          <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendChat()}
            placeholder="Trả lời Adam bằng tiếng Anh hoặc tiếng Việt..."
            style={{ flex: 1, borderRadius: 999, border: `1px solid ${TOKENS.slate}44`, padding: "11px 16px", fontSize: 14, boxSizing: "border-box" }} />
          <button onClick={sendChat} disabled={sending} style={{ background: TOKENS.coral, border: "none", borderRadius: 999, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", cursor: "pointer", flexShrink: 0 }}>
            <Send size={17} />
          </button>
        </div>
        {!sess.completed && sess.messages.length > 1 && (
          <button onClick={markComplete} style={{ margin: "0 14px 14px", padding: "12px 0", borderRadius: 14, border: "none", background: TOKENS.sage, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            Đánh dấu hoàn thành buổi này
          </button>
        )}
      </Shell>
    );
  }

  if (view === "dashboard" && dayData) {
    const doneCount = dayData.sessions.filter((s) => s.completed).length;
    return (
      <Shell>
        <Header title="Hôm nay" />
        <div style={{ padding: 20, flex: 1, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <AdamCat speaking={isSpeaking} size={92} />
            <div style={{ flex: 1, background: TOKENS.card, border: `1.5px solid ${TOKENS.slate}33`, borderRadius: "4px 16px 16px 16px", padding: "12px 14px", position: "relative" }}>
              <div style={{ fontSize: 13.5, color: TOKENS.ink, lineHeight: 1.4 }}>
                Meo! Mình là Adam 🐱 Sẵn sàng luyện {SESSION_COUNT} buổi hôm nay chưa?
              </div>
              <button onClick={() => speakText(`Meow! Ready for today's ${SESSION_COUNT} sessions?`, true)}
                style={{ marginTop: 6, background: "none", border: "none", color: TOKENS.coral, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
                <Volume2 size={12} /> Nghe Adam nói
              </button>
            </div>
          </div>
          <div style={{ background: TOKENS.ink, borderRadius: 20, padding: 20, color: "#fff", marginBottom: 18, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", right: -30, top: -30, width: 140, height: 140, borderRadius: "50%", background: TOKENS.highlight, opacity: 0.15 }} />
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 4 }}>Chủ đề hôm nay</div>
            <div style={{ fontFamily: "ui-rounded, system-ui, sans-serif", fontWeight: 800, fontSize: 21 }}>{dayData.topic}</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{dayData.source === "user" ? "Từ vựng do bạn chọn" : "Adam tự chọn (TOEIC 400+)"}</div>
            <button onClick={() => setView("words")} style={{ marginTop: 14, background: "rgba(255,255,255,0.14)", border: "none", borderRadius: 999, padding: "8px 14px", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <BookOpen size={14} /> Xem 10 từ vựng <ChevronRight size={14} />
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontWeight: 700, color: TOKENS.ink, fontSize: 15 }}>10 buổi trò chuyện với Adam</span>
            <span style={{ color: TOKENS.sage, fontWeight: 700, fontSize: 13 }}>{doneCount}/{SESSION_COUNT} xong</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {dayData.sessions.map((s) => (
              <button key={s.id} onClick={() => openSession(s.id)}
                style={{ textAlign: "left", background: TOKENS.card, border: `1.5px solid ${s.completed ? TOKENS.sage : TOKENS.slate + "33"}`, borderRadius: 14, padding: 14, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, color: TOKENS.ink, fontSize: 14 }}>Buổi {s.id}</span>
                  {s.completed ? <Check size={16} color={TOKENS.sage} /> : <MessageCircle size={15} color={TOKENS.slate} />}
                </div>
                <div style={{ fontSize: 11, color: TOKENS.inkSoft, marginTop: 4 }}>~18 phút</div>
              </button>
            ))}
          </div>
        </div>
      </Shell>
    );
  }

  return null;
}
