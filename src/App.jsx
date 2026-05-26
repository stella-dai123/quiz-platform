import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Folder,
  Plus,
  Upload,
  Search,
  ChevronDown,
  ChevronRight,
  Trash2,
  BookOpen,
  Sparkles,
} from "lucide-react";

const STORAGE_KEY = "quiz-platform-data-v3";

const starterSubjects = [
  {
    id: crypto.randomUUID(),
    name: "Animal Physiology",
    folders: [
      {
        id: crypto.randomUUID(),
        name: "Muscle System",
        questions: [
          {
            id: crypto.randomUUID(),
            prompt: "What directly triggers skeletal muscle contraction?",
            choices: [
              "ATP binding to myosin",
              "Ca²⁺ binding to troponin",
              "Na⁺ leaving the cell",
              "O₂ binding to hemoglobin",
            ],
            answer: 1,
            explanation:
              "Ca²⁺ binds to troponin, which moves tropomyosin away from actin and allows actin-myosin crossbridge formation.",
          },
        ],
      },
    ],
  },
  {
    id: crypto.randomUUID(),
    name: "GRE Vocabulary",
    folders: [
      {
        id: crypto.randomUUID(),
        name: "High Frequency Words",
        questions: [],
      },
    ],
  },
];

function makeId() {
  return crypto.randomUUID();
}

function cleanLine(line) {
  return line.replace(/\r/g, "").trim();
}

function isChoiceLine(line) {
  return /^([A-Ha-h])[\.|\)|:|、]\s+/.test(line);
}

function parseChoice(line) {
  const match = line.match(/^([A-Ha-h])[\.|\)|:|、]\s+(.+)$/);
  if (!match) return null;
  return { letter: match[1].toUpperCase(), text: match[2].trim() };
}

function isAnswerLine(line) {
  return /^(答案|正确答案|answer|correct answer|correct|ans|key)\s*[:：\-]?\s*/i.test(line);
}

function isExplanationLine(line) {
  return /^(解析|解释|explanation|reason|rationale|why)\s*[:：\-]?\s*/i.test(line);
}

function removeQuestionPrefix(line) {
  return line
    .replace(/^\s*(Question|Q)\s*\d*\s*[:：\.\)]\s*/i, "")
    .replace(/^\s*第\s*\d+\s*题\s*[:：\.\)]?\s*/i, "")
    .replace(/^\s*\d+\s*[\.\)]\s*/, "")
    .trim();
}

function extractAnswerIndex(answerText, choices) {
  const text = answerText.trim();
  const letterMatch = text.match(/[A-Ha-h]/);
  if (letterMatch) {
    const idx = letterMatch[0].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < choices.length) return idx;
  }

  const normalized = text.toLowerCase();
  const byText = choices.findIndex((choice) =>
    normalized.includes(choice.toLowerCase()) || choice.toLowerCase().includes(normalized)
  );
  return byText >= 0 ? byText : 0;
}

function splitIntoQuestionBlocks(text) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);

  const blocks = [];
  let current = [];

  for (const line of lines) {
    const looksLikeNewQuestion =
      /^(\d+\s*[\.\)]|Question\s*\d*[:：\.\)]|Q\d*[:：\.\)]|第\s*\d+\s*题)/i.test(line) &&
      current.length > 0 &&
      current.some((l) => isAnswerLine(l));

    if (looksLikeNewQuestion) {
      blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length) blocks.push(current);
  return blocks;
}

function parseQuestions(rawText) {
  const blocks = splitIntoQuestionBlocks(rawText);

  return blocks
    .map((lines) => {
      const promptLines = [];
      const choices = [];
      let answerRaw = "";
      const explanationLines = [];
      let mode = "prompt";

      for (const line of lines) {
        const choice = parseChoice(line);

        if (choice) {
          mode = "choices";
          choices.push(choice.text);
          continue;
        }

        if (isAnswerLine(line)) {
          mode = "answer";
          answerRaw = line.replace(/^(答案|正确答案|answer|correct answer|correct|ans|key)\s*[:：\-]?\s*/i, "").trim();
          continue;
        }

        if (isExplanationLine(line)) {
          mode = "explanation";
          const explanation = line.replace(/^(解析|解释|explanation|reason|rationale|why)\s*[:：\-]?\s*/i, "").trim();
          if (explanation) explanationLines.push(explanation);
          continue;
        }

        if (mode === "answer" && !answerRaw) {
          answerRaw = line;
        } else if (mode === "explanation") {
          explanationLines.push(line);
        } else if (mode === "prompt" || mode === "choices") {
          promptLines.push(removeQuestionPrefix(line));
        }
      }

      const prompt = promptLines.join(" ").trim();
      if (!prompt || choices.length < 2) return null;

      return {
        id: makeId(),
        prompt,
        choices,
        answer: extractAnswerIndex(answerRaw, choices),
        explanation: explanationLines.join(" ").trim() || "No explanation added yet.",
      };
    })
    .filter(Boolean);
}

function App() {
  const [subjects, setSubjects] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : starterSubjects;
    } catch {
      return starterSubjects;
    }
  });

  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || "");
  const [selectedFolderId, setSelectedFolderId] = useState(subjects[0]?.folders[0]?.id || "");
  const [answers, setAnswers] = useState({});
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(true);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [message, setMessage] = useState("");
  const [importText, setImportText] = useState(`1. What directly triggers skeletal muscle contraction?
A. ATP binding to myosin
B. Ca²⁺ binding to troponin
C. Na⁺ leaving the cell
D. O₂ binding to hemoglobin
答案：B
解析：Ca²⁺ binds to troponin and allows actin-myosin crossbridge formation.

2. Complete tetanus happens when:
A. muscle fully relaxes between stimuli
B. stimuli are so frequent that relaxation disappears
C. ATP is completely absent
D. the nerve stops firing
正确答案：B
解释：Frequent stimulation keeps Ca²⁺ high, so the muscle stays contracted.`);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subjects));
  }, [subjects]);

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId) || subjects[0];
  const selectedFolder = selectedSubject?.folders.find((f) => f.id === selectedFolderId) || selectedSubject?.folders[0];

  const filteredQuestions = useMemo(() => {
    if (!selectedFolder) return [];
    return selectedFolder.questions.filter((q) =>
      q.prompt.toLowerCase().includes(search.toLowerCase())
    );
  }, [selectedFolder, search]);

  const answeredCount = selectedFolder?.questions.filter((q) => answers[q.id] !== undefined).length || 0;
  const correctCount = selectedFolder?.questions.filter((q) => answers[q.id] === q.answer).length || 0;

  function selectSubject(subject) {
    setSelectedSubjectId(subject.id);
    setSelectedFolderId(subject.folders[0]?.id || "");
    setAnswers({});
    setMessage("");
  }

  function addSubject() {
    const name = newSubjectName.trim();
    if (!name) return;
    const folder = { id: makeId(), name: "Default Folder", questions: [] };
    const subject = { id: makeId(), name, folders: [folder] };
    setSubjects((prev) => [...prev, subject]);
    setSelectedSubjectId(subject.id);
    setSelectedFolderId(folder.id);
    setNewSubjectName("");
  }

  function addFolder() {
    const name = newFolderName.trim();
    if (!name || !selectedSubject) return;
    const folder = { id: makeId(), name, questions: [] };
    setSubjects((prev) =>
      prev.map((subject) =>
        subject.id === selectedSubject.id
          ? { ...subject, folders: [...subject.folders, folder] }
          : subject
      )
    );
    setSelectedFolderId(folder.id);
    setNewFolderName("");
    setAnswers({});
  }

  function importQuestions() {
    const parsed = parseQuestions(importText);
    if (!parsed.length) {
      setMessage("No valid questions detected. Please include choices like A. B. C. D. plus an answer line.");
      return;
    }

    setSubjects((prev) =>
      prev.map((subject) =>
        subject.id === selectedSubject.id
          ? {
              ...subject,
              folders: subject.folders.map((folder) =>
                folder.id === selectedFolder.id
                  ? { ...folder, questions: [...folder.questions, ...parsed] }
                  : folder
              ),
            }
          : subject
      )
    );

    setImportText("");
    setShowImport(false);
    setMessage(`Imported ${parsed.length} question${parsed.length > 1 ? "s" : ""} into ${selectedFolder.name}.`);
  }

  function deleteQuestion(questionId) {
    setSubjects((prev) =>
      prev.map((subject) =>
        subject.id === selectedSubject.id
          ? {
              ...subject,
              folders: subject.folders.map((folder) =>
                folder.id === selectedFolder.id
                  ? { ...folder, questions: folder.questions.filter((q) => q.id !== questionId) }
                  : folder
              ),
            }
          : subject
      )
    );
  }

  function chooseAnswer(questionId, choiceIndex) {
    setAnswers((prev) => ({ ...prev, [questionId]: choiceIndex }));
  }

  function resetDemo() {
    localStorage.removeItem(STORAGE_KEY);
    setSubjects(starterSubjects);
    setSelectedSubjectId(starterSubjects[0].id);
    setSelectedFolderId(starterSubjects[0].folders[0].id);
    setAnswers({});
    setMessage("Demo restored.");
  }

  return (
    <div className="page">
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        .page { min-height: 100vh; background: #f8fafc; color: #0f172a; font-family: Inter, Arial, sans-serif; padding: 32px; }
        .container { max-width: 1280px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 28px; }
        .eyebrow { color: #64748b; font-size: 14px; font-weight: 700; margin-bottom: 8px; }
        h1 { margin: 0; font-size: 34px; letter-spacing: -0.04em; }
        .subtitle { color: #64748b; margin-top: 10px; max-width: 720px; line-height: 1.6; }
        .layout { display: grid; grid-template-columns: 290px 1fr; gap: 22px; align-items: start; }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04); }
        .card-pad { padding: 20px; }
        .sidebar-title, .section-title { display: flex; align-items: center; gap: 10px; font-weight: 800; color: #475569; margin-bottom: 14px; }
        .subject-btn, .folder-btn { width: 100%; border: none; border-radius: 16px; padding: 13px 14px; margin-bottom: 10px; text-align: left; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
        .subject-btn.active, .folder-btn.active { background: #111827; color: white; }
        .subject-btn:not(.active), .folder-btn:not(.active) { background: #f1f5f9; color: #334155; }
        .subject-btn:not(.active):hover, .folder-btn:not(.active):hover { background: #e2e8f0; }
        .mini-form { background: #f8fafc; padding: 12px; border-radius: 18px; margin-top: 16px; display: grid; gap: 8px; }
        input, textarea { border: 1px solid #cbd5e1; outline: none; border-radius: 14px; padding: 11px 12px; font-size: 14px; width: 100%; background: white; }
        input:focus, textarea:focus { border-color: #64748b; }
        button { font-family: inherit; }
        .primary { border: none; background: #111827; color: white; border-radius: 14px; padding: 11px 16px; cursor: pointer; font-weight: 800; display: inline-flex; gap: 8px; align-items: center; justify-content: center; }
        .secondary { border: none; background: #f1f5f9; color: #334155; border-radius: 14px; padding: 11px 16px; cursor: pointer; font-weight: 800; display: inline-flex; gap: 8px; align-items: center; justify-content: center; }
        .top-grid { display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center; }
        .stats { display: grid; grid-template-columns: repeat(3, 100px); gap: 10px; }
        .stat { background: #f8fafc; border-radius: 18px; padding: 14px; text-align: center; }
        .stat-number { font-size: 22px; font-weight: 900; }
        .stat-label { font-size: 12px; color: #64748b; margin-top: 2px; }
        .folder-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 18px; }
        .folder-chip { border: none; padding: 10px 14px; border-radius: 999px; cursor: pointer; font-weight: 800; }
        .folder-chip.active { background: #111827; color: white; }
        .folder-chip:not(.active) { background: #f1f5f9; color: #475569; }
        .import-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; cursor: pointer; }
        .import-box textarea { min-height: 260px; margin-top: 14px; line-height: 1.5; }
        .message { margin-top: 12px; background: #ecfeff; color: #155e75; padding: 12px 14px; border-radius: 16px; font-weight: 700; }
        .search-wrap { position: relative; }
        .search-icon { position: absolute; top: 12px; left: 12px; color: #94a3b8; }
        .search-input { padding-left: 40px; }
        .question { padding: 22px; margin-bottom: 18px; }
        .q-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
        .q-number { color: #94a3b8; font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }
        .q-prompt { font-size: 18px; font-weight: 800; line-height: 1.5; }
        .choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .choice { border: 1px solid #cbd5e1; background: white; border-radius: 16px; padding: 14px 15px; text-align: left; cursor: pointer; font-weight: 700; line-height: 1.4; }
        .choice.correct { background: #dcfce7; border-color: #86efac; color: #166534; }
        .choice.wrong { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
        .badge { display: inline-flex; gap: 6px; align-items: center; padding: 7px 10px; border-radius: 999px; font-size: 13px; font-weight: 900; white-space: nowrap; }
        .badge.correct { background: #dcfce7; color: #166534; }
        .badge.wrong { background: #fee2e2; color: #991b1b; }
        .explanation { margin-top: 14px; background: #f8fafc; border-radius: 16px; padding: 14px; color: #334155; line-height: 1.55; }
        .delete { border: none; background: #f8fafc; color: #64748b; cursor: pointer; border-radius: 12px; padding: 9px; }
        .delete:hover { background: #fee2e2; color: #991b1b; }
        .empty { text-align: center; padding: 48px; color: #64748b; }
        @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .top-grid { grid-template-columns: 1fr; } .stats { grid-template-columns: repeat(3, 1fr); } .choices { grid-template-columns: 1fr; } }
      `}</style>

      <div className="container">
        <div className="header">
          <div>
            <div className="eyebrow">Study Question Bank</div>
            <h1>Quiz Practice Platform</h1>
            <div className="subtitle">
              Create subjects and folders, paste questions quickly, auto-detect choices, answers, and explanations, then practice with instant green/red feedback.
            </div>
          </div>
          <button className="secondary" onClick={resetDemo}>Reset Demo</button>
        </div>

        <div className="layout">
          <aside className="card card-pad">
            <div className="sidebar-title"><Folder size={18} /> Subjects</div>
            {subjects.map((subject) => (
              <button
                key={subject.id}
                className={`subject-btn ${subject.id === selectedSubjectId ? "active" : ""}`}
                onClick={() => selectSubject(subject)}
              >
                <span>{subject.name}</span>
                <ChevronRight size={16} />
              </button>
            ))}

            <div className="mini-form">
              <input
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
                placeholder="New subject name"
              />
              <button className="secondary" onClick={addSubject}><Plus size={16} /> Add Subject</button>
            </div>
          </aside>

          <main>
            <section className="card card-pad" style={{ marginBottom: 18 }}>
              <div className="top-grid">
                <div>
                  <div className="section-title"><BookOpen size={18} /> Current Subject</div>
                  <h2 style={{ margin: 0, fontSize: 26 }}>{selectedSubject?.name}</h2>
                  <div className="folder-row">
                    {selectedSubject?.folders.map((folder) => (
                      <button
                        key={folder.id}
                        className={`folder-chip ${folder.id === selectedFolderId ? "active" : ""}`}
                        onClick={() => {
                          setSelectedFolderId(folder.id);
                          setAnswers({});
                          setMessage("");
                        }}
                      >
                        {folder.name}
                      </button>
                    ))}
                    <input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="New folder"
                      style={{ width: 170 }}
                    />
                    <button className="primary" onClick={addFolder}><Plus size={16} /> Add Folder</button>
                  </div>
                </div>
                <div className="stats">
                  <div className="stat"><div className="stat-number">{selectedFolder?.questions.length || 0}</div><div className="stat-label">Questions</div></div>
                  <div className="stat"><div className="stat-number">{answeredCount}</div><div className="stat-label">Answered</div></div>
                  <div className="stat"><div className="stat-number">{correctCount}</div><div className="stat-label">Correct</div></div>
                </div>
              </div>
            </section>

            <section className="card card-pad import-box" style={{ marginBottom: 18 }}>
              <div className="import-header" onClick={() => setShowImport((v) => !v)}>
                <div>
                  <div className="section-title" style={{ marginBottom: 4 }}><Sparkles size={18} /> Paste & Auto Import</div>
                  <div style={{ color: "#64748b", fontSize: 14 }}>
                    Supports 答案/解析 or Answer/Explanation. After import, this box closes automatically.
                  </div>
                </div>
                {showImport ? <ChevronDown size={22} /> : <ChevronRight size={22} />}
              </div>

              {showImport && (
                <>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={`Paste like this:\nQuestion text\nA. choice\nB. choice\nC. choice\nD. choice\n答案：B\n解析：your explanation`}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 12 }}>
                    <div style={{ color: "#64748b", fontSize: 14 }}>
                      Import target: <b>{selectedSubject?.name} / {selectedFolder?.name}</b>
                    </div>
                    <button className="primary" onClick={importQuestions}><Upload size={16} /> Import Questions</button>
                  </div>
                </>
              )}
              {message && <div className="message">{message}</div>}
            </section>

            <section className="card card-pad" style={{ marginBottom: 18 }}>
              <div className="search-wrap">
                <Search className="search-icon" size={18} />
                <input
                  className="search-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search questions in this folder..."
                />
              </div>
            </section>

            {filteredQuestions.length === 0 ? (
              <section className="card empty">No questions in this folder yet. Open Paste & Auto Import to add some.</section>
            ) : (
              filteredQuestions.map((question, index) => {
                const chosen = answers[question.id];
                const isAnswered = chosen !== undefined;
                const isCorrect = chosen === question.answer;

                return (
                  <section className="card question" key={question.id}>
                    <div className="q-head">
                      <div>
                        <div className="q-number">Question {index + 1}</div>
                        <div className="q-prompt">{question.prompt}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {isAnswered && (
                          <span className={`badge ${isCorrect ? "correct" : "wrong"}`}>
                            {isCorrect ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                            {isCorrect ? "Correct" : "Incorrect"}
                          </span>
                        )}
                        <button className="delete" onClick={() => deleteQuestion(question.id)} title="Delete question"><Trash2 size={17} /></button>
                      </div>
                    </div>

                    <div className="choices">
                      {question.choices.map((choice, choiceIndex) => {
                        const selected = chosen === choiceIndex;
                        const correct = question.answer === choiceIndex;
                        let className = "choice";
                        if (isAnswered && correct) className += " correct";
                        if (isAnswered && selected && !correct) className += " wrong";

                        return (
                          <button
                            key={`${question.id}-${choiceIndex}`}
                            className={className}
                            onClick={() => chooseAnswer(question.id, choiceIndex)}
                          >
                            {String.fromCharCode(65 + choiceIndex)}. {choice}
                          </button>
                        );
                      })}
                    </div>

                    {isAnswered && (
                      <div className="explanation"><b>Explanation:</b> {question.explanation}</div>
                    )}
                  </section>
                );
              })
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
