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
  Download,
  RotateCcw,
  Edit3,
  Save,
  X,
  LogOut,
} from "lucide-react";
import { supabase } from "./supabase";

const WRONG_KEY = "quiz-platform-wrong-v1";

function cleanLine(line) {
  return line.replace(/\r/g, "").trim();
}

function parseChoice(line) {
  const match = line.match(/^([A-Ha-h])[\.\):、]\s+(.+)$/);
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
  return line
    .replace(/^(答案|正确答案|answer|correct answer|correct answers|correct|ans|key)\s*[:：\-]?\s*/i, "")
    .trim();
}

function stripExplanationLabel(line) {
  return line
    .replace(/^(解析|解释|explanation|reason|rationale|why)\s*[:：\-]?\s*/i, "")
    .trim();
}

function removeQuestionPrefix(line) {
  return line
    .replace(/^\s*(Question|Q)\s*\d*\s*[:：\.\)]\s*/i, "")
    .replace(/^\s*第\s*\d+\s*题\s*[:：\.\)]?\s*/i, "")
    .replace(/^\s*\d+\s*[\.\)]\s*/, "")
    .trim();
}

function extractAnswerIndexes(answerText, choices) {
  const text = String(answerText || "").trim();
  const indexes = new Set();
  const letters = text.match(/[A-Ha-h]/g) || [];

  for (const letter of letters) {
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

function blockHasAnswer(lines) {
  return lines.some((line) => isAnswerLine(line));
}

function blockChoiceCount(lines) {
  return lines.filter((line) => parseChoice(line)).length;
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
    const explicitQuestionStart =
      /^(\d+\s*[\.\)]|Question\s*\d*[:：\.\)]|Q\d*[:：\.\)]|第\s*\d+\s*题)/i.test(line);

    const startsNewByExplicitQuestion =
      explicitQuestionStart &&
      current.length > 0 &&
      (blockChoiceCount(current) >= 2 || blockHasAnswer(current));

    const startsNewByChoiceRestart =
      choice &&
      choice.letter === "A" &&
      current.length > 0 &&
      currentChoiceLetters.size >= 2 &&
      blockHasAnswer(current);

    const startsNewByAnswerThenNewPrompt =
      !choice &&
      !isAnswerLine(line) &&
      !isExplanationLine(line) &&
      current.length > 0 &&
      blockChoiceCount(current) >= 2 &&
      blockHasAnswer(current);

    if (startsNewByExplicitQuestion || startsNewByChoiceRestart || startsNewByAnswerThenNewPrompt) {
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
  return splitIntoQuestionBlocks(rawText)
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
        } else {
          promptLines.push(removeQuestionPrefix(line));
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
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((value, index) => value === sortedB[index]);
}

function answersToLetters(answers) {
  return answers.map((idx) => String.fromCharCode(65 + idx)).join(", ");
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [subjects, setSubjects] = useState([]);
  const [folders, setFolders] = useState([]);
  const [questions, setQuestions] = useState([]);

  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");

  const [answers, setAnswers] = useState({});
  const [checkedQuestions, setCheckedQuestions] = useState({});
  const [wrongIds, setWrongIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(WRONG_KEY) || "[]");
    } catch {
      return [];
    }
  });

  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(true);
  const [showBackup, setShowBackup] = useState(false);
  const [showWrongOnly, setShowWrongOnly] = useState(false);
  const [backupText, setBackupText] = useState("");

  const [newSubjectName, setNewSubjectName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [message, setMessage] = useState("");

  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(WRONG_KEY, JSON.stringify(wrongIds));
  }, [wrongIds]);

  useEffect(() => {
    if (session?.user?.id) {
      loadCloudData(session.user.id);
    }
  }, [session]);

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId) || subjects[0];
  const selectedFolders = folders.filter((f) => f.subject_id === selectedSubject?.id);
  const selectedFolder =
    selectedFolders.find((f) => f.id === selectedFolderId) || selectedFolders[0];

  const selectedQuestions = questions.filter((q) => q.folder_id === selectedFolder?.id);

  const filteredQuestions = useMemo(() => {
    return selectedQuestions.filter((q) => {
      const matchesSearch = q.prompt.toLowerCase().includes(search.toLowerCase());
      const matchesWrong = !showWrongOnly || wrongIds.includes(q.id);
      return matchesSearch && matchesWrong;
    });
  }, [selectedQuestions, search, showWrongOnly, wrongIds]);

  const answeredCount = selectedQuestions.filter(
    (q) => checkedQuestions[q.id] || answers[q.id]?.length > 0
  ).length;

  const correctCount = selectedQuestions.filter(
    (q) => checkedQuestions[q.id] && arraysEqual(answers[q.id], q.answers)
  ).length;

  const wrongCountInFolder = selectedQuestions.filter((q) => wrongIds.includes(q.id)).length;

  async function handleAuth() {
    if (!email || !password) {
      setMessage("Please enter email and password.");
      return;
    }

    const fn = authMode === "signin" ? supabase.auth.signInWithPassword : supabase.auth.signUp;
    const { error } = await fn({ email, password });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(authMode === "signin" ? "Signed in." : "Account created. Check email if confirmation is required.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSubjects([]);
    setFolders([]);
    setQuestions([]);
    setSelectedSubjectId("");
    setSelectedFolderId("");
  }

  async function loadCloudData(userId) {
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
    let loadedQuestions = (questionRes.data || []).map((q) => ({
      ...q,
      choices: Array.isArray(q.choices) ? q.choices : [],
      answers: Array.isArray(q.answers) ? q.answers : [0],
    }));

    if (loadedSubjects.length === 0) {
      const { data: newSubject, error: sErr } = await supabase
        .from("subjects")
        .insert({ user_id: userId, name: "Animal Physiology" })
        .select()
        .single();

      if (sErr) {
        setMessage(sErr.message);
        return;
      }

      const { data: newFolder, error: fErr } = await supabase
        .from("folders")
        .insert({ user_id: userId, subject_id: newSubject.id, name: "Default Folder" })
        .select()
        .single();

      if (fErr) {
        setMessage(fErr.message);
        return;
      }

      loadedSubjects = [newSubject];
      loadedFolders = [newFolder];
      loadedQuestions = [];
    }

    setSubjects(loadedSubjects);
    setFolders(loadedFolders);
    setQuestions(loadedQuestions);

    const firstSubject = loadedSubjects[0];
    const firstFolder = loadedFolders.find((f) => f.subject_id === firstSubject.id);

    setSelectedSubjectId(firstSubject?.id || "");
    setSelectedFolderId(firstFolder?.id || "");
    setAnswers({});
    setCheckedQuestions({});
  }

  function selectSubject(subjectId) {
    const firstFolder = folders.find((f) => f.subject_id === subjectId);
    setSelectedSubjectId(subjectId);
    setSelectedFolderId(firstFolder?.id || "");
    setAnswers({});
    setCheckedQuestions({});
    setMessage("");
  }

  async function addSubject() {
    const name = newSubjectName.trim();
    if (!name || !session?.user?.id) return;

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
    setNewSubjectName("");
  }

  async function renameSubject() {
    if (!selectedSubject) return;
    const nextName = prompt("Rename subject:", selectedSubject.name);
    if (!nextName || !nextName.trim()) return;

    const { error } = await supabase
      .from("subjects")
      .update({ name: nextName.trim() })
      .eq("id", selectedSubject.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setSubjects((prev) =>
      prev.map((s) => (s.id === selectedSubject.id ? { ...s, name: nextName.trim() } : s))
    );
  }

  async function deleteSubject() {
    if (!selectedSubject) return;
    if (subjects.length <= 1) {
      alert("You need at least one subject.");
      return;
    }

    const ok = confirm(`Delete subject "${selectedSubject.name}" and all folders/questions inside it?`);
    if (!ok) return;

    const removedFolderIds = folders.filter((f) => f.subject_id === selectedSubject.id).map((f) => f.id);
    const removedQuestionIds = questions.filter((q) => removedFolderIds.includes(q.folder_id)).map((q) => q.id);

    const { error } = await supabase.from("subjects").delete().eq("id", selectedSubject.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    const nextSubjects = subjects.filter((s) => s.id !== selectedSubject.id);
    const nextFolders = folders.filter((f) => f.subject_id !== selectedSubject.id);
    const nextQuestions = questions.filter((q) => !removedFolderIds.includes(q.folder_id));

    setSubjects(nextSubjects);
    setFolders(nextFolders);
    setQuestions(nextQuestions);
    setWrongIds((prev) => prev.filter((id) => !removedQuestionIds.includes(id)));

    const nextSubject = nextSubjects[0];
    const nextFolder = nextFolders.find((f) => f.subject_id === nextSubject.id);

    setSelectedSubjectId(nextSubject.id);
    setSelectedFolderId(nextFolder?.id || "");
  }

  async function addFolder() {
    const name = newFolderName.trim();
    if (!name || !selectedSubject || !session?.user?.id) return;

    const { data: folder, error } = await supabase
      .from("folders")
      .insert({
        user_id: session.user.id,
        subject_id: selectedSubject.id,
        name,
      })
      .select()
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    setFolders((prev) => [...prev, folder]);
    setSelectedFolderId(folder.id);
    setNewFolderName("");
    setAnswers({});
    setCheckedQuestions({});
  }

  async function renameFolder(folderId) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;

    const nextName = prompt("Rename folder:", folder.name);
    if (!nextName || !nextName.trim()) return;

    const { error } = await supabase
      .from("folders")
      .update({ name: nextName.trim() })
      .eq("id", folderId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, name: nextName.trim() } : f))
    );
  }

  async function deleteFolder(folderId) {
    const currentSubjectFolders = folders.filter((f) => f.subject_id === selectedSubject?.id);
    if (currentSubjectFolders.length <= 1) {
      alert("You need at least one folder in each subject.");
      return;
    }

    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;

    const ok = confirm(`Delete folder "${folder.name}" and all questions inside it?`);
    if (!ok) return;

    const removedQuestionIds = questions.filter((q) => q.folder_id === folderId).map((q) => q.id);

    const { error } = await supabase.from("folders").delete().eq("id", folderId);

    if (error) {
      setMessage(error.message);
      return;
    }

    const nextFolders = folders.filter((f) => f.id !== folderId);
    const nextQuestions = questions.filter((q) => q.folder_id !== folderId);

    setFolders(nextFolders);
    setQuestions(nextQuestions);
    setWrongIds((prev) => prev.filter((id) => !removedQuestionIds.includes(id)));

    if (selectedFolderId === folderId) {
      const nextFolder = nextFolders.find((f) => f.subject_id === selectedSubject.id);
      setSelectedFolderId(nextFolder?.id || "");
      setAnswers({});
      setCheckedQuestions({});
    }
  }
    async function importQuestions() {
    if (!selectedFolder || !session?.user?.id) return;

    const parsed = parseQuestions(importText);

    if (!parsed.length) {
      setMessage("No valid questions detected. Please include choices like A. B. C. D. plus an answer line.");
      return;
    }

    const rows = parsed.map((q) => ({
      user_id: session.user.id,
      folder_id: selectedFolder.id,
      prompt: q.prompt,
      choices: q.choices,
      answers: q.answers,
      explanation: q.explanation,
    }));

    const { data, error } = await supabase
      .from("questions")
      .insert(rows)
      .select();

    if (error) {
      setMessage(error.message);
      return;
    }

    setQuestions((prev) => [...prev, ...(data || [])]);
    setImportText("");
    setShowImport(false);
    setMessage(`Imported ${data.length} question${data.length > 1 ? "s" : ""} into ${selectedFolder.name}.`);
  }

  async function deleteQuestion(questionId) {
    const { error } = await supabase.from("questions").delete().eq("id", questionId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    setWrongIds((prev) => prev.filter((id) => id !== questionId));
  }

  function startEditQuestion(question) {
    setEditingQuestionId(question.id);
    setEditDraft({
      prompt: question.prompt,
      choicesText: question.choices.join("\n"),
      answersText: answersToLetters(question.answers),
      explanation: question.explanation || "",
    });
  }

  function cancelEditQuestion() {
    setEditingQuestionId(null);
    setEditDraft(null);
  }

  async function saveEditQuestion(question) {
    if (!editDraft?.prompt.trim()) {
      alert("Question cannot be empty.");
      return;
    }

    const nextChoices = editDraft.choicesText
      .split("\n")
      .map((choice) => choice.trim())
      .filter(Boolean);

    if (nextChoices.length < 2) {
      alert("A question needs at least two choices.");
      return;
    }

    const nextAnswers = extractAnswerIndexes(editDraft.answersText, nextChoices);

    const updatePayload = {
      prompt: editDraft.prompt.trim(),
      choices: nextChoices,
      answers: nextAnswers,
      explanation: editDraft.explanation.trim() || "No explanation added yet.",
    };

    const { error } = await supabase
      .from("questions")
      .update(updatePayload)
      .eq("id", question.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setQuestions((prev) =>
      prev.map((q) => (q.id === question.id ? { ...q, ...updatePayload } : q))
    );

    setAnswers((prev) => {
      const copy = { ...prev };
      delete copy[question.id];
      return copy;
    });

    setCheckedQuestions((prev) => {
      const copy = { ...prev };
      delete copy[question.id];
      return copy;
    });

    cancelEditQuestion();
  }

  function markWrongIfNeeded(questionId, isCorrect) {
    if (isCorrect) {
      setWrongIds((prev) => prev.filter((id) => id !== questionId));
    } else {
      setWrongIds((prev) => (prev.includes(questionId) ? prev : [...prev, questionId]));
    }
  }

  function toggleAnswer(question, choiceIndex) {
    const isMultiple = question.answers.length > 1;

    setAnswers((prev) => {
      const current = prev[question.id] || [];

      if (!isMultiple) {
        const next = [choiceIndex];
        const correct = arraysEqual(next, question.answers);
        markWrongIfNeeded(question.id, correct);
        setCheckedQuestions((checked) => ({ ...checked, [question.id]: true }));
        return { ...prev, [question.id]: next };
      }

      setCheckedQuestions((checked) => ({ ...checked, [question.id]: false }));

      const next = current.includes(choiceIndex)
        ? current.filter((idx) => idx !== choiceIndex)
        : [...current, choiceIndex];

      return { ...prev, [question.id]: next };
    });
  }

  function checkMultipleAnswer(question) {
    const current = answers[question.id] || [];
    const correct = arraysEqual(current, question.answers);

    markWrongIfNeeded(question.id, correct);

    setCheckedQuestions((prev) => ({
      ...prev,
      [question.id]: true,
    }));
  }

  function resetProgress() {
    setAnswers({});
    setCheckedQuestions({});
    setMessage("Progress reset for this session.");
  }

  function clearWrongBook() {
    const ok = confirm("Clear all wrong-question records?");
    if (!ok) return;

    setWrongIds([]);
    setShowWrongOnly(false);
    setMessage("Wrong book cleared.");
  }

  function exportBackup() {
    const exportData = subjects.map((subject) => ({
      ...subject,
      folders: folders
        .filter((folder) => folder.subject_id === subject.id)
        .map((folder) => ({
          ...folder,
          questions: questions.filter((question) => question.folder_id === folder.id),
        })),
    }));

    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = "quiz-platform-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    setMessage("Backup downloaded.");
  }

  async function importBackup() {
    if (!session?.user?.id) return;

    try {
      const parsed = JSON.parse(backupText);

      if (!Array.isArray(parsed)) {
        alert("Invalid backup format.");
        return;
      }

      for (const subject of parsed) {
        const { data: newSubject, error: subjectError } = await supabase
          .from("subjects")
          .insert({
            user_id: session.user.id,
            name: subject.name || "Imported Subject",
          })
          .select()
          .single();

        if (subjectError) throw subjectError;

        for (const folder of subject.folders || []) {
          const { data: newFolder, error: folderError } = await supabase
            .from("folders")
            .insert({
              user_id: session.user.id,
              subject_id: newSubject.id,
              name: folder.name || "Imported Folder",
            })
            .select()
            .single();

          if (folderError) throw folderError;

          const importedQuestions = (folder.questions || []).map((q) => ({
            user_id: session.user.id,
            folder_id: newFolder.id,
            prompt: q.prompt,
            choices: q.choices,
            answers: q.answers || [q.answer ?? 0],
            explanation: q.explanation || "No explanation added yet.",
          }));

          if (importedQuestions.length) {
            const { error: questionError } = await supabase
              .from("questions")
              .insert(importedQuestions);

            if (questionError) throw questionError;
          }
        }
      }

      setBackupText("");
      setShowBackup(false);
      await loadCloudData(session.user.id);
      setMessage("Backup imported successfully.");
    } catch (err) {
      setMessage(err.message || "Could not import backup.");
    }
  }

  async function resetCloudData() {
    const ok = confirm("Delete ALL your cloud quiz data? This cannot be undone unless you exported a backup.");
    if (!ok || !session?.user?.id) return;

    const { error } = await supabase
      .from("subjects")
      .delete()
      .eq("user_id", session.user.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setSubjects([]);
    setFolders([]);
    setQuestions([]);
    setAnswers({});
    setCheckedQuestions({});
    setWrongIds([]);
    await loadCloudData(session.user.id);
    setMessage("Cloud data reset.");
  }

  if (!session) {
    return (
      <div className="page">
        <style>{baseStyles}</style>

        <div className="auth-card">
          <h1>Quiz Platform</h1>
          <p className="muted">Sign in to save your subjects, folders, and questions in the cloud.</p>

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
          />

          <button className="primary full" onClick={handleAuth}>
            {authMode === "signin" ? "Sign In" : "Create Account"}
          </button>

          <button
            className="secondary full"
            onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
          >
            {authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>

          {message && <div className="message">{message}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <style>{baseStyles}</style>

      <div className="container">
        <div className="top-toolbar card card-pad">
          <div className="toolbar-group">
            <div className="toolbar-label">
              <Folder size={16} /> Subject
            </div>

            <select
              value={selectedSubjectId}
              onChange={(e) => selectSubject(e.target.value)}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
               