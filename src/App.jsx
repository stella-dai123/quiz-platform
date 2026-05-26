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

const STORAGE_KEY = "quiz-platform-data-v4";

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
            answers: [1],
            explanation:
              "Ca²⁺ binds to troponin, which moves tropomyosin away from actin and allows actin-myosin crossbridge formation.",
          },
          {
            id: crypto.randomUUID(),
            prompt: "Which statements are true about skeletal muscle contraction?",
            choices: [
              "Ca²⁺ binds to troponin",
              "ATP is needed for crossbridge cycling",
              "Myosin directly binds oxygen",
              "Actin and myosin interact during contraction",
            ],
            answers: [0, 1, 3],
            explanation:
              "Ca²⁺ exposes actin binding sites, ATP supports crossbridge cycling, and actin-myosin interaction produces contraction.",
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

function parseChoice(line) {
  const match = line.match(/^([A-Ha-h])[\.|\)|:|、]\s+(.+)$/);
  if (!match) return null;
  return { letter: match[1].toUpperCase(), text: match[2].trim() };
}

function isAnswerLine(line) {
  return /^(答案|正确答案|answer|correct answer|correct answers|correct|ans|key)\s*[:：\-]?\s*/i.test(line);
}

function isExplanationLine(line) {
  return /^(解析|解释|explanation|reason|rationale|why)\s*[:：\-]?\s*/i.test(line);
}

function stripAnswerLabel(line) {
  return line.replace(/^(答案|正确答案|answer|correct answer|correct answers|correct|ans|key)\s*[:：\-]?\s*/i, "").trim();
}

function stripExplanationLabel(line) {
  return line.replace(/^(解析|解释|explanation|reason|rationale|why)\s*[:：\-]?\s*/i, "").trim();
}

function removeQuestionPrefix(line) {
  return line
    .replace(/^\s*(Question|Q)\s*\d*\s*[:：\.\)]\s*/i, "")
    .replace(/^\s*第\s*\d+\s*题\s*[:：\.\)]?\s*/i, "")
    .replace(/^\s*\d+\s*[\.\)]\s*/, "")
    .trim();
}

function extractAnswerIndexes(answerText, choices) {
  const text = answerText.trim();
  const indexes = new Set();

  const separatedLetters = text.match(/[A-Ha-h]/g) || [];
  for (const letter of separatedLetters) {
    const idx = letter.toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < choices.length) indexes.add(idx);
  }

  if (indexes.size > 0) return Array.from(indexes).sort((a, b) => a - b);

  const normalized = text.toLowerCase();
  choices.forEach((choice, index) => {
    const c = choice.toLowerCase();
    if (normalized.includes(c) || c.includes(normalized)) indexes.add(index);
  });

  return indexes.size ? Array.from(indexes).sort((a, b) => a - b) : [0];
}

function hasAnswer(lines) {
  return lines.some((line) => isAnswerLine(line));
}

function hasChoices(lines) {
  return lines.filter((line) => parseChoice(line)).length >= 2;
}

function splitIntoQuestionBlocks(text) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);

  const blocks = [];
  let current = [];
  let currentChoiceLetters = new Set();

  for (const line of lines) {
    const choice = parseChoice(line);
    const explicitQuestionStart = /^(\d+\s*[\.\)]|Question\s*\d*[:：\.\)]|Q\d*[:：\.\)]|第\s*\d+\s*题)/i.test(line);

    const startsNewByExplicitQuestion =
      explicitQuestionStart && current.length > 0 && (hasChoices(current) || hasAnswer(current));

    const startsNewByChoiceRestart =
      choice &&
      choice.letter === "A" &&
      current.length > 0 &&
      currentChoiceLetters.size >= 2 &&
      hasAnswer(current);

    if (startsNewByExplicitQuestion || startsNewByChoiceRestart) {
      blocks.push(current);
      current = [line];
      currentChoiceLetters = new Set(choice ? [choice.letter] : []);
    } else {
      current.push(line);
      if (choice) currentChoiceLetters.add(choice.letter);
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
          answerRaw = stripAnswerLabel(line);
          continue;
        }

        if (isExplanationLine(line)) {
          mode = "explanation";
          const explanation = stripExplanationLabel(line);
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

      const answers = extractAnswerIndexes(answerRaw, choices);

      return {
        id: makeId(),
        prompt,
        choices,
        answers,
        explanation: explanationLines.join(" ").trim() || "No explanation added yet.",
      };
    })
    .filter(Boolean);
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((value, index) => value === sortedB[index]);
}

function normalizeQuestion(question) {
  if (question.answers) return question;
  if (typeof question.answer === "number") return { ...question, answers: [question.answer] };
  return { ...question, answers: [0] };
}

function App() {
  const [subjects, setSubjects] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved
        ? JSON.parse(saved).map((subject) => ({
            ...subject,
            folders: subject.folders.map((folder) => ({
              ...folder,
              questions: folder.questions.map(normalizeQuestion),
            })),
          }))
        : starterSubjects;
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
  const [importText, setImportText] = useState(`Which statements are true about skeletal muscle contraction?
A. Ca²⁺ binds to troponin
B. ATP is needed for crossbridge cycling
C. Myosin directly binds oxygen
D. Actin and myosin interact during contraction
答案：A, B, D
解析：Ca²⁺ exposes actin binding sites, ATP supports crossbridge cycling, and actin-myosin interaction produces contraction.

What directly triggers skeletal muscle contraction?
A. ATP binding to myosin
B. Ca²⁺ binding to troponin
C. Na⁺ leaving the cell
D. O₂ binding to hemoglobin
答案：B
解析：Ca²⁺ binds to troponin.`);

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

  const answeredCount = selectedFolder?.questions.filter((q) => answers[q.id]?.length > 0).length || 0;
  const correctCount = selectedFolder?.questions.filter((q) => arraysEqual(answers[q.id], q.answers)).length || 0;

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

  function toggleAnswer(questionId, choiceIndex, isMultiple) {
    setAnswers((prev) => {
      const current = prev[questionId] || [];
      if (!isMultiple) return { ...prev, [questionId]: [choiceIndex] };

      const next = current.includes(choiceIndex)
        ? current.filter((idx) => idx !== choiceIndex)
        : [...current, choiceIndex];
      return { ...prev, [questionId]: next };
    });
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
        .wide { max-width: 1500px; }
        .top-toolbar { display: flex; gap: 14px; align-items: center; margin-bottom: 18px; flex-wrap: wrap; }
        .toolbar-group { display: grid; gap: 7px; }
        .toolbar-group.grow { flex: 1; min-width: 360px; }
        .toolbar-label { display: flex; gap: 6px; align-items: center; color: #64748b; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .04em; }
        select { border: 1px solid #cbd5e1; border-radius: 14px; padding: 11px 12px; background: white; font-weight: 800; min-width: 210px; }
        .add-group { grid-template-columns: 150px auto; align-items: end; }
        .practice-layout { display: block; }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04); }
        .card-pad { padding: 20px; }
        .sidebar-title, .section-title { display: flex; align-items: center; gap: 10px; font-weight: 800; color: #475569; margin-bottom: 14px; }
        .subject-btn { width: 100%; border: none; border-radius: 16px; padding: 13px 14px; margin-bottom: 10px; text-align: left; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
        .subject-btn.active { background: #111827; color: white; }
        .subject-btn:not(.active) { background: #f1f5f9; color: #334155; }
        .subject-btn:not(.active):hover { background: #e2e8f0; }
        .mini-form { background: #f8fafc; padding: 12px; border-radius: 18px; margin-top: 16px; display: grid; gap: 8px; }
        input, textarea { border: 1px solid #cbd5e1; outline: none; border-radius: 14px; padding: 11px 12px; font-size: 14px; width: 100%; background: white; }
        input:focus, textarea:focus { border-color: #64748b; }
        button { font-family: inherit; }
        .primary { border: none; background: #111827; color: white; border-radius: 14px; padding: 11px 16px; cursor: pointer; font-weight: 800; display: inline-flex; gap: 8px; align-items: center; justify-content: center; }
        .secondary { border: none; background: #f1f5f9; color: #334155; border-radius: 14px; padding: 11px 16px; cursor: pointer; font-weight: 800; display: inline-flex; gap: 8px; align-items: center; justify-content: center; }
        .top-grid { display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center; }
        .stats { display: grid; grid-template-columns: repeat(3, 100px); gap: 10px; }
        .wide-stats { grid-template-columns: repeat(3, minmax(120px, 1fr)); }
        .stat { background: #f8fafc; border-radius: 18px; padding: 14px; text-align: center; }
        .stat-number { font-size: 22px; font-weight: 900; }
        .stat-label { font-size: 12px; color: #64748b; margin-top: 2px; }
        .folder-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 18px; }
        .folder-row.compact { margin-top: 0; max-height: 46px; overflow: auto; }
        .folder-chip { border: none; padding: 10px 14px; border-radius: 999px; cursor: pointer; font-weight: 800; }
        .folder-chip.active { background: #111827; color: white; }
        .folder-chip:not(.active) { background: #f1f5f9; color: #475569; }
        .import-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; cursor: pointer; }
        .import-box textarea { min-height: 260px; margin-top: 14px; line-height: 1.5; }
        .message { margin-top: 12px; background: #ecfeff; color: #155e75; padding: 12px 14px; border-radius: 16px; font-weight: 700; }
        .search-wrap { position: relative; }
        .search-icon { position: absolute; top: 12px; left: 12px; color: #94a3b8; }
        .search-input { padding-left: 40px; }
        .question { padding: 30px; margin-bottom: 18px; }
        .q-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
        .q-number { color: #94a3b8; font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }
        .q-prompt { font-size: 23px; font-weight: 850; line-height: 1.55; max-width: 1200px; }
        .type-label { display: inline-flex; margin-top: 10px; background: #eef2ff; color: #3730a3; padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 900; }
        .choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .choice { border: 1px solid #cbd5e1; background: white; border-radius: 18px; padding: 18px 20px; text-align: left; cursor: pointer; font-weight: 750; line-height: 1.5; font-size: 16px; }
        .choice.selected { outline: 2px solid #111827; }
        .choice.correct { background: #dcfce7; border-color: #86efac; color: #166534; }
        .choice.wrong { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
        .badge { display: inline-flex; gap: 6px; align-items: center; padding: 7px 10px; border-radius: 999px; font-size: 13px; font-weight: 900; white-space: nowrap; }
        .badge.correct { background: #dcfce7; color: #166534; }
        .badge.wrong { background: #fee2e2; color: #991b1b; }
        .explanation { margin-top: 14px; background: #f8fafc; border-radius: 16px; padding: 14px; color: #334155; line-height: 1.55; }
        .delete { border: none; background: #f8fafc; color: #64748b; cursor: pointer; border-radius: 12px; padding: 9px; }
        .delete:hover { background: #fee2e2; color: #991b1b; }
        .empty { text-align: center; padding: 48px; color: #64748b; }
        @media (max-width: 900px) { .top-toolbar { display: grid; } .toolbar-group.grow { min-width: 0; } .add-group { grid-template-columns: 1fr; } .stats { grid-template-columns: repeat(3, 1fr); } .choices { grid-template-columns: 1fr; } .q-prompt { font-size: 20px; } .page { padding: 16px; } }
      `}</style>

      <div className="container wide">
        <div className="top-toolbar card card-pad">
          <div className="toolbar-group">
            <div className="toolbar-label"><Folder size={16} /> Subject</div>
            <select
              value={selectedSubjectId}
              onChange={(e) => {
                const subject = subjects.find((s) => s.id === e.target.value);
                if (subject) selectSubject(subject);
              }}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
          </div>

          <div className="toolbar-group grow">
            <div className="toolbar-label"><BookOpen size={16} /> Folder</div>
            <div className="folder-row compact">
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
            </div>
          </div>

          <div className="toolbar-group add-group">
            <input
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="New subject"
            />
            <button className="secondary" onClick={addSubject}><Plus size={15} /> Subject</button>
          </div>

          <div className="toolbar-group add-group">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder"
            />
            <button className="primary" onClick={addFolder}><Plus size={15} /> Folder</button>
          </div>
        </div>

        <div className="practice-layout">
          <main>
            <section className="card card-pad slim-stats" style={{ marginBottom: 18 }}>
              <div className="stats wide-stats">
                <div className="stat"><div className="stat-number">{selectedFolder?.questions.length || 0}</div><div className="stat-label">Questions</div></div>
                <div className="stat"><div className="stat-number">{answeredCount}</div><div className="stat-label">Answered</div></div>
                <div className="stat"><div className="stat-number">{correctCount}</div><div className="stat-label">Correct</div></div>
              </div>
            </section>

            <section className="card card-pad import-box" style={{ marginBottom: 18 }}>
              <div className="import-header" onClick={() => setShowImport((v) => !v)}>
                <div>
                  <div className="section-title" style={{ marginBottom: 4 }}><Sparkles size={18} /> Paste & Auto Import</div>
                  <div style={{ color: "#64748b", fontSize: 14 }}>
                    Supports no-number questions, single-choice, multiple-choice, 答案/解析, and Answer/Explanation.
                  </div>
                </div>
                {showImport ? <ChevronDown size={22} /> : <ChevronRight size={22} />}
              </div>

              {showImport && (
                <>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={`Paste like this:\nQuestion text\nA. choice\nB. choice\nC. choice\nD. choice\n答案：A, C\n解析：your explanation\n\nNext question text\nA. choice\nB. choice\n答案：B\n解析：your explanation`}
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
                const chosen = answers[question.id] || [];
                const isAnswered = chosen.length > 0;
                const isCorrect = arraysEqual(chosen, question.answers);
                const isMultiple = question.answers.length > 1;

                return (
                  <section className="card question" key={question.id}>
                    <div className="q-head">
                      <div>
                        <div className="q-number">Question {index + 1}</div>
                        <div className="q-prompt">{question.prompt}</div>
                        <span className="type-label">{isMultiple ? "Multiple choice" : "Single choice"}</span>
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
                        const selected = chosen.includes(choiceIndex);
                        const correct = question.answers.includes(choiceIndex);
                        let className = "choice";

                        if (selected && !isAnswered) className += " selected";
                        if (isAnswered && correct) className += " correct";
                        if (isAnswered && selected && !correct) className += " wrong";
                        if (isAnswered && selected) className += " selected";

                        return (
                          <button
                            key={`${question.id}-${choiceIndex}`}
                            className={className}
                            onClick={() => toggleAnswer(question.id, choiceIndex, isMultiple)}
                          >
                            {isMultiple ? (selected ? "☑" : "☐") : ""} {String.fromCharCode(65 + choiceIndex)}. {choice}
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
