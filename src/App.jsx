import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

function parseChoice(line) {
  const match = line.trim().match(/^([A-Ha-h])[\.)、:]\s*(.+)$/);
  if (!match) return null;
  return { letter: match[1].toUpperCase(), text: match[2].trim() };
}

function isAnswerLine(line) {
  return /^(答案|正确答案|answer|correct answer|correct answers|ans|key)\s*[:：\-]?/i.test(line.trim());
}

function isExplanationLine(line) {
  return /^(解析|解释|explanation|reason|why)\s*[:：\-]?/i.test(line.trim());
}

function stripAnswerLabel(line) {
  return line.replace(/^(答案|正确答案|answer|correct answer|correct answers|ans|key)\s*[:：\-]?\s*/i, "").trim();
}

function stripExplanationLabel(line) {
  return line.replace(/^(解析|解释|explanation|reason|why)\s*[:：\-]?\s*/i, "").trim();
}

function extractAnswerIndexes(answerText, choices) {
  const letters = String(answerText || "").match(/[A-Ha-h]/g) || [];
  const indexes = [...new Set(
    letters
      .map((letter) => letter.toUpperCase().charCodeAt(0) - 65)
      .filter((idx) => idx >= 0 && idx < choices.length)
  )];
  return indexes.length ? indexes.sort((a, b) => a - b) : [0];
}

function splitIntoQuestionBlocks(text) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks = [];
  let current = [];
  let currentHasAnswer = false;
  let currentChoiceCount = 0;

  for (const line of lines) {
    const choice = parseChoice(line);
    const looksLikeNewQuestion =
      current.length > 0 &&
      currentHasAnswer &&
      currentChoiceCount >= 2 &&
      !choice &&
      !isAnswerLine(line) &&
      !isExplanationLine(line);

    const startsWithAAfterAnswered =
      current.length > 0 &&
      currentHasAnswer &&
      choice?.letter === "A";

    if (looksLikeNewQuestion || startsWithAAfterAnswered) {
      blocks.push(current);
      current = [line];
      currentHasAnswer = false;
      currentChoiceCount = choice ? 1 : 0;
    } else {
      current.push(line);
      if (choice) currentChoiceCount += 1;
      if (isAnswerLine(line)) currentHasAnswer = true;
    }
  }

  if (current.length) blocks.push(current);
  return blocks;
}

function parseQuestions(text) {
  return splitIntoQuestionBlocks(text)
    .map((block) => {
      const promptLines = [];
      const choices = [];
      let answerRaw = "";
      const explanationLines = [];
      let mode = "prompt";

      for (const line of block) {
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

        if (mode === "explanation") {
          explanationLines.push(line);
        } else {
          promptLines.push(line.replace(/^\d+[.)]\s*/, ""));
        }
      }

      const prompt = promptLines.join(" ").trim();
      if (!prompt || choices.length < 2) return null;

      return {
        prompt,
        choices,
        answers: extractAnswerIndexes(answerRaw, choices),
        explanation: explanationLines.join(" ").trim() || "No explanation added yet.",
      };
    })
    .filter(Boolean);
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const x = [...a].sort((m, n) => m - n);
  const y = [...b].sort((m, n) => m - n);
  return x.every((value, index) => value === y[index]);
}

function answerLetters(answers) {
  return answers.map((idx) => String.fromCharCode(65 + idx)).join(", ");
}

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const [subjects, setSubjects] = useState([]);
  const [folders, setFolders] = useState([]);
  const [questions, setQuestions] = useState([]);

  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");

  const [newSubject, setNewSubject] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [importText, setImportText] = useState(`Which statements are true about skeletal muscle contraction?\nA. Ca²⁺ binds to troponin\nB. ATP is needed for crossbridge cycling\nC. Myosin directly binds oxygen\nD. Actin and myosin interact during contraction\n答案：A, B, D\n解析：Ca²⁺ exposes actin binding sites, ATP supports crossbridge cycling, and actin-myosin interaction produces contraction.\n\nWhat directly triggers skeletal muscle contraction?\nA. ATP binding to myosin\nB. Ca²⁺ binding to troponin\nC. Na⁺ leaving the cell\nD. O₂ binding to hemoglobin\n答案：B\n解析：Ca²⁺ binds to troponin.`);

  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) loadData();
  }, [session]);

  async function loadData() {
    const userId = session.user.id;

    const [subjectRes, folderRes, questionRes] = await Promise.all([
      supabase.from("subjects").select("*").eq("user_id", userId).order("created_at"),
      supabase.from("folders").select("*").eq("user_id", userId).order("created_at"),
      supabase.from("questions").select("*").eq("user_id", userId).order("created_at"),
    ]);

    if (subjectRes.error || folderRes.error || questionRes.error) {
      setMessage(subjectRes.error?.message || folderRes.error?.message || questionRes.error?.message);
      return;
    }

    let loadedSubjects = subjectRes.data || [];
    let loadedFolders = folderRes.data || [];
    const loadedQuestions = (questionRes.data || []).map((q) => ({
      ...q,
      choices: Array.isArray(q.choices) ? q.choices : [],
      answers: Array.isArray(q.answers) ? q.answers : [0],
    }));

    if (loadedSubjects.length === 0) {
      const { data: subject, error: subjectError } = await supabase
        .from("subjects")
        .insert({ user_id: userId, name: "Default Subject" })
        .select()
        .single();

      if (subjectError) {
        setMessage(subjectError.message);
        return;
      }

      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .insert({ user_id: userId, subject_id: subject.id, name: "Default Folder" })
        .select()
        .single();

      if (folderError) {
        setMessage(folderError.message);
        return;
      }

      loadedSubjects = [subject];
      loadedFolders = [folder];
    }

    setSubjects(loadedSubjects);
    setFolders(loadedFolders);
    setQuestions(loadedQuestions);

    const firstSubject = loadedSubjects[0];
    const firstFolder = loadedFolders.find((folder) => folder.subject_id === firstSubject?.id);
    setSelectedSubjectId(firstSubject?.id || "");
    setSelectedFolderId(firstFolder?.id || "");
  }

  async function signUp() {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      alert(error.message);
      return;
    }
    alert("Account created. If email confirmation is required, check your email.");
  }

  async function signIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      alert(error.message);
      return;
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSubjects([]);
    setFolders([]);
    setQuestions([]);
    setSelectedSubjectId("");
    setSelectedFolderId("");
  }

  async function addSubject() {
    const name = newSubject.trim();
    if (!name) return;

    const { data: subject, error } = await supabase
      .from("subjects")
      .insert({ user_id: session.user.id, name })
      .select()
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    const { data: folder, error: folderError } = await supabase
      .from("folders")
      .insert({ user_id: session.user.id, subject_id: subject.id, name: "Default Folder" })
      .select()
      .single();

    if (folderError) {
      setMessage(folderError.message);
      return;
    }

    setSubjects((prev) => [...prev, subject]);
    setFolders((prev) => [...prev, folder]);
    setSelectedSubjectId(subject.id);
    setSelectedFolderId(folder.id);
    setNewSubject("");
  }

  async function renameSubject() {
    const subject = subjects.find((s) => s.id === selectedSubjectId);
    if (!subject) return;
    const name = prompt("Rename subject:", subject.name);
    if (!name?.trim()) return;

    const { error } = await supabase.from("subjects").update({ name: name.trim() }).eq("id", subject.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    setSubjects((prev) => prev.map((s) => (s.id === subject.id ? { ...s, name: name.trim() } : s)));
  }

  async function deleteSubject() {
    if (subjects.length <= 1) {
      alert("You need at least one subject.");
      return;
    }
    const subject = subjects.find((s) => s.id === selectedSubjectId);
    if (!subject) return;
    if (!confirm(`Delete subject "${subject.name}"?`)) return;

    const { error } = await supabase.from("subjects").delete().eq("id", subject.id);
    if (error) {
      setMessage(error.message);
      return;
    }

    const nextSubjects = subjects.filter((s) => s.id !== subject.id);
    const removedFolderIds = folders.filter((f) => f.subject_id === subject.id).map((f) => f.id);
    const nextFolders = folders.filter((f) => f.subject_id !== subject.id);
    const nextQuestions = questions.filter((q) => !removedFolderIds.includes(q.folder_id));

    setSubjects(nextSubjects);
    setFolders(nextFolders);
    setQuestions(nextQuestions);
    setSelectedSubjectId(nextSubjects[0]?.id || "");
    setSelectedFolderId(nextFolders.find((f) => f.subject_id === nextSubjects[0]?.id)?.id || "");
  }

  async function addFolder() {
    const name = newFolder.trim();
    if (!name || !selectedSubjectId) return;

    const { data, error } = await supabase
      .from("folders")
      .insert({ user_id: session.user.id, subject_id: selectedSubjectId, name })
      .select()
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    setFolders((prev) => [...prev, data]);
    setSelectedFolderId(data.id);
    setNewFolder("");
  }

  async function renameFolder(folderId) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    const name = prompt("Rename folder:", folder.name);
    if (!name?.trim()) return;

    const { error } = await supabase.from("folders").update({ name: name.trim() }).eq("id", folderId);
    if (error) {
      setMessage(error.message);
      return;
    }
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: name.trim() } : f)));
  }

  async function deleteFolder(folderId) {
    const currentFolders = folders.filter((f) => f.subject_id === selectedSubjectId);
    if (currentFolders.length <= 1) {
      alert("You need at least one folder.");
      return;
    }
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    if (!confirm(`Delete folder "${folder.name}"?`)) return;

    const { error } = await supabase.from("folders").delete().eq("id", folderId);
    if (error) {
      setMessage(error.message);
      return;
    }

    const nextFolders = folders.filter((f) => f.id !== folderId);
    setFolders(nextFolders);
    setQuestions((prev) => prev.filter((q) => q.folder_id !== folderId));
    if (selectedFolderId === folderId) {
      setSelectedFolderId(nextFolders.find((f) => f.subject_id === selectedSubjectId)?.id || "");
    }
  }

  async function importQuestions() {
    if (!selectedFolderId) return;
    const parsed = parseQuestions(importText);
    if (!parsed.length) {
      setMessage("No valid questions detected.");
      return;
    }

    const rows = parsed.map((q) => ({
      user_id: session.user.id,
      folder_id: selectedFolderId,
      prompt: q.prompt,
      choices: q.choices,
      answers: q.answers,
      explanation: q.explanation,
    }));

    const { data, error } = await supabase.from("questions").insert(rows).select();
    if (error) {
      setMessage(error.message);
      return;
    }

    setQuestions((prev) => [...prev, ...(data || [])]);
    setImportText("");
    setMessage(`Imported ${(data || []).length} question(s).`);
  }

  async function deleteQuestion(id) {
    const { error } = await supabase.from("questions").delete().eq("id", id);
    if (error) {
      setMessage(error.message);
      return;
    }
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  function startEditQuestion(q) {
    setEditingId(q.id);
    setEditDraft({
      prompt: q.prompt,
      choicesText: q.choices.join("\n"),
      answersText: answerLetters(q.answers),
      explanation: q.explanation || "",
    });
  }

  async function saveQuestion(q) {
    const choices = editDraft.choicesText.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!editDraft.prompt.trim() || choices.length < 2) {
      alert("Question and at least two choices are required.");
      return;
    }

    const updates = {
      prompt: editDraft.prompt.trim(),
      choices,
      answers: extractAnswerIndexes(editDraft.answersText, choices),
      explanation: editDraft.explanation.trim(),
    };

    const { data, error } = await supabase.from("questions").update(updates).eq("id", q.id).select().single();
    if (error) {
      setMessage(error.message);
      return;
    }

    setQuestions((prev) => prev.map((item) => (item.id === q.id ? data : item)));
    setEditingId(null);
    setEditDraft(null);
    setAnswers((prev) => ({ ...prev, [q.id]: [] }));
    setChecked((prev) => ({ ...prev, [q.id]: false }));
  }

  function chooseAnswer(q, index) {
    const isMultiple = q.answers.length > 1;
    if (isMultiple) {
      setAnswers((prev) => {
        const current = prev[q.id] || [];
        const next = current.includes(index) ? current.filter((x) => x !== index) : [...current, index];
        return { ...prev, [q.id]: next };
      });
      setChecked((prev) => ({ ...prev, [q.id]: false }));
    } else {
      setAnswers((prev) => ({ ...prev, [q.id]: [index] }));
      setChecked((prev) => ({ ...prev, [q.id]: true }));
    }
  }

  function isCorrect(q) {
    return arraysEqual(answers[q.id] || [], q.answers || []);
  }

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId);
  const selectedFolders = folders.filter((f) => f.subject_id === selectedSubjectId);
  const selectedQuestions = useMemo(
    () => questions.filter((q) => q.folder_id === selectedFolderId),
    [questions, selectedFolderId]
  );

  if (!session) {
    return (
      <div style={styles.page}>
        <div style={styles.authCard}>
          <h1>Quiz Platform</h1>
          <p style={styles.muted}>Sign in to save your question bank in the cloud.</p>
          <input style={styles.input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={styles.input} placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button style={styles.primary} onClick={signIn}>Sign In</button>
          <button style={styles.secondary} onClick={signUp}>Create Account</button>
          {message && <div style={styles.message}>{message}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.topBar}>
          <h2>Quiz Platform</h2>
          <button style={styles.secondary} onClick={signOut}>Sign Out</button>
        </div>

        <div style={styles.card}>
          <h3>Subjects</h3>
          <div style={styles.row}>
            <select style={styles.input} value={selectedSubjectId} onChange={(e) => setSelectedSubjectId(e.target.value)}>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button style={styles.secondary} onClick={renameSubject}>Rename</button>
            <button style={styles.danger} onClick={deleteSubject}>Delete</button>
            <input style={styles.input} placeholder="New subject" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
            <button style={styles.primary} onClick={addSubject}>Add Subject</button>
          </div>
        </div>

        <div style={styles.card}>
          <h3>Folders {selectedSubject ? `for ${selectedSubject.name}` : ""}</h3>
          <div style={styles.row}>
            {selectedFolders.map((f) => (
              <button
                key={f.id}
                style={{ ...styles.folderBtn, background: f.id === selectedFolderId ? "#111827" : "#e5e7eb", color: f.id === selectedFolderId ? "white" : "#111827" }}
                onClick={() => setSelectedFolderId(f.id)}
              >
                {f.name}
              </button>
            ))}
            <input style={styles.input} placeholder="New folder" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} />
            <button style={styles.primary} onClick={addFolder}>Add Folder</button>
            {selectedFolderId && <button style={styles.secondary} onClick={() => renameFolder(selectedFolderId)}>Rename Folder</button>}
            {selectedFolderId && <button style={styles.danger} onClick={() => deleteFolder(selectedFolderId)}>Delete Folder</button>}
          </div>
        </div>

        <div style={styles.card}>
          <h3>Paste & Import</h3>
          <p style={styles.muted}>No numbering needed. Paste question, choices, answer, and explanation.</p>
          <textarea style={styles.textarea} value={importText} onChange={(e) => setImportText(e.target.value)} />
          <button style={styles.primary} onClick={importQuestions}>Import Questions</button>
          {message && <div style={styles.message}>{message}</div>}
        </div>

        {selectedQuestions.map((q, idx) => {
          const selected = answers[q.id] || [];
          const checkedNow = checked[q.id];
          const multiple = q.answers.length > 1;
          const correctNow = checkedNow && isCorrect(q);
          const editing = editingId === q.id;

          return (
            <div key={q.id} style={styles.questionCard}>
              <div style={styles.questionHeader}>
                <h3>{idx + 1}. {q.prompt}</h3>
                <div>
                  <button style={styles.secondary} onClick={() => startEditQuestion(q)}>Edit</button>
                  <button style={styles.danger} onClick={() => deleteQuestion(q.id)}>Delete</button>
                </div>
              </div>

              {editing && editDraft ? (
                <div style={styles.editBox}>
                  <label>Question</label>
                  <textarea style={styles.textareaSmall} value={editDraft.prompt} onChange={(e) => setEditDraft((d) => ({ ...d, prompt: e.target.value }))} />
                  <label>Choices, one per line</label>
                  <textarea style={styles.textareaSmall} value={editDraft.choicesText} onChange={(e) => setEditDraft((d) => ({ ...d, choicesText: e.target.value }))} />
                  <label>Answer, like B or A,C,D</label>
                  <input style={styles.input} value={editDraft.answersText} onChange={(e) => setEditDraft((d) => ({ ...d, answersText: e.target.value }))} />
                  <label>Explanation</label>
                  <textarea style={styles.textareaSmall} value={editDraft.explanation} onChange={(e) => setEditDraft((d) => ({ ...d, explanation: e.target.value }))} />
                  <button style={styles.primary} onClick={() => saveQuestion(q)}>Save</button>
                  <button style={styles.secondary} onClick={() => { setEditingId(null); setEditDraft(null); }}>Cancel</button>
                </div>
              ) : (
                <>
                  <div style={styles.choices}>
                    {q.choices.map((choice, index) => {
                      const isSelected = selected.includes(index);
                      const isAnswer = q.answers.includes(index);
                      let background = "white";
                      if (!checkedNow && isSelected) background = "#e0f2fe";
                      if (checkedNow && isAnswer) background = "#dcfce7";
                      if (checkedNow && isSelected && !isAnswer) background = "#fee2e2";

                      return (
                        <button key={index} style={{ ...styles.choice, background }} onClick={() => chooseAnswer(q, index)}>
                          {multiple ? (isSelected ? "☑ " : "☐ ") : ""}{String.fromCharCode(65 + index)}. {choice}
                        </button>
                      );
                    })}
                  </div>
                  {multiple && !checkedNow && <button style={styles.primary} onClick={() => setChecked((prev) => ({ ...prev, [q.id]: true }))}>Check Answer</button>}
                  {checkedNow && <div style={styles.explanation}><b>{correctNow ? "Correct" : "Incorrect"}</b><br />{q.explanation}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#f8fafc", padding: 28, fontFamily: "Arial, sans-serif", color: "#0f172a" },
  container: { maxWidth: 1300, margin: "0 auto" },
  authCard: { maxWidth: 440, margin: "90px auto", background: "white", padding: 28, borderRadius: 24, boxShadow: "0 10px 30px rgba(0,0,0,0.06)", display: "grid", gap: 12 },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  card: { background: "white", padding: 20, borderRadius: 20, marginBottom: 20, boxShadow: "0 8px 24px rgba(0,0,0,0.04)" },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  input: { padding: 12, borderRadius: 12, border: "1px solid #cbd5e1", minWidth: 200 },
  textarea: { width: "100%", minHeight: 180, padding: 14, borderRadius: 14, border: "1px solid #cbd5e1", marginBottom: 12, lineHeight: 1.5 },
  textareaSmall: { width: "100%", minHeight: 90, padding: 12, borderRadius: 12, border: "1px solid #cbd5e1", marginBottom: 10, lineHeight: 1.5 },
  primary: { background: "#111827", color: "white", border: "none", borderRadius: 12, padding: "12px 16px", cursor: "pointer", fontWeight: 700, marginRight: 8 },
  secondary: { background: "#e5e7eb", color: "#111827", border: "none", borderRadius: 12, padding: "10px 14px", cursor: "pointer", fontWeight: 700, marginRight: 8 },
  danger: { background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 12, padding: "10px 14px", cursor: "pointer", fontWeight: 700, marginRight: 8 },
  folderBtn: { border: "none", borderRadius: 999, padding: "10px 16px", cursor: "pointer", fontWeight: 700 },
  questionCard: { background: "white", padding: 24, borderRadius: 22, marginBottom: 18, boxShadow: "0 8px 24px rgba(0,0,0,0.04)" },
  questionHeader: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" },
  choices: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 16, marginBottom: 16 },
  choice: { padding: 16, borderRadius: 14, border: "1px solid #cbd5e1", textAlign: "left", cursor: "pointer", fontWeight: 700 },
  explanation: { background: "#f1f5f9", padding: 14, borderRadius: 14, marginTop: 12, lineHeight: 1.5 },
  editBox: { background: "#f8fafc", padding: 16, borderRadius: 16, display: "grid", gap: 8 },
  message: { marginTop: 12, background: "#ecfeff", color: "#155e75", padding: 12, borderRadius: 14, fontWeight: 700 },
  muted: { color: "#64748b" },
};
