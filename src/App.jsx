import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

export default function App() {
  const [session, setSession] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [subjects, setSubjects] = useState([]);
  const [folders, setFolders] = useState([]);
  const [questions, setQuestions] = useState([]);

  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");

  const [newSubject, setNewSubject] = useState("");
  const [newFolder, setNewFolder] = useState("");

  const [importText, setImportText] = useState("");

  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      loadData();
    }
  }, [session]);

  async function loadData() {
    const userId = session.user.id;

    const subjectRes = await supabase
      .from("subjects")
      .select("*")
      .eq("user_id", userId);

    const folderRes = await supabase
      .from("folders")
      .select("*")
      .eq("user_id", userId);

    const questionRes = await supabase
      .from("questions")
      .select("*")
      .eq("user_id", userId);

    setSubjects(subjectRes.data || []);
    setFolders(folderRes.data || []);
    setQuestions(questionRes.data || []);

    if (subjectRes.data?.length) {
      setSelectedSubjectId(subjectRes.data[0].id);
    }

    if (folderRes.data?.length) {
      setSelectedFolderId(folderRes.data[0].id);
    }
  }

  async function signUp() {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    alert(error.message);
    console.error(error);
    return;
  }

  alert("Account created. If email confirmation is on, check your email.");
  console.log(data);
}

async function signIn() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    alert(error.message);
    console.error(error);
    return;
  }

  alert("Signed in!");
  console.log(data);
}

  alert("Signed in!");
  console.log(data);
}

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function addSubject() {
    if (!newSubject.trim()) return;

    const { data } = await supabase
      .from("subjects")
      .insert({
        user_id: session.user.id,
        name: newSubject,
      })
      .select()
      .single();

    setSubjects((prev) => [...prev, data]);
    setNewSubject("");
  }

  async function addFolder() {
    if (!newFolder.trim()) return;

    const { data } = await supabase
      .from("folders")
      .insert({
        user_id: session.user.id,
        subject_id: selectedSubjectId,
        name: newFolder,
      })
      .select()
      .single();

    setFolders((prev) => [...prev, data]);
    setNewFolder("");
  }

  function parseQuestions(text) {
    const blocks = text
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean);

    return blocks.map((block) => {
      const lines = block.split("\n");

      const prompt = lines[0];

      const choices = [];
      let answerLine = "";
      let explanation = "";

      for (const line of lines.slice(1)) {
        if (/^[A-D][\.\)]/i.test(line)) {
          choices.push(line.replace(/^[A-D][\.\)]\s*/, ""));
        } else if (line.startsWith("答案")) {
          answerLine = line;
        } else if (line.startsWith("解析")) {
          explanation = line.replace(/^解析[:：]/, "");
        }
      }

      const letters = answerLine.match(/[A-D]/g) || [];

      const answers = letters.map(
        (l) => l.charCodeAt(0) - 65
      );

      return {
        prompt,
        choices,
        answers,
        explanation,
      };
    });
  }
    async function importQuestions() {
    if (!selectedFolderId) return;

    const parsed = parseQuestions(importText);

    const rows = parsed.map((q) => ({
      user_id: session.user.id,
      folder_id: selectedFolderId,
      prompt: q.prompt,
      choices: q.choices,
      answers: q.answers,
      explanation: q.explanation,
    }));

    const { data } = await supabase
      .from("questions")
      .insert(rows)
      .select();

    setQuestions((prev) => [...prev, ...(data || [])]);
    setImportText("");
  }

  async function deleteQuestion(id) {
    await supabase.from("questions").delete().eq("id", id);
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  async function editQuestion(q) {
    const explanation = prompt("Edit explanation:", q.explanation || "");
    if (explanation === null) return;

    const { data } = await supabase
      .from("questions")
      .update({ explanation })
      .eq("id", q.id)
      .select()
      .single();

    setQuestions((prev) =>
      prev.map((item) => (item.id === q.id ? data : item))
    );
  }

  function chooseAnswer(question, index) {
    const isMultiple = question.answers.length > 1;

    if (isMultiple) {
      setAnswers((prev) => {
        const current = prev[question.id] || [];
        const next = current.includes(index)
          ? current.filter((x) => x !== index)
          : [...current, index];

        return {
          ...prev,
          [question.id]: next,
        };
      });
    } else {
      setAnswers((prev) => ({
        ...prev,
        [question.id]: [index],
      }));

      setChecked((prev) => ({
        ...prev,
        [question.id]: true,
      }));
    }
  }

  function checkAnswer(id) {
    setChecked((prev) => ({
      ...prev,
      [id]: true,
    }));
  }

  function isCorrect(question) {
    const selected = answers[question.id] || [];
    const correct = question.answers || [];

    if (selected.length !== correct.length) return false;

    return [...selected]
      .sort()
      .every((x, i) => x === [...correct].sort()[i]);
  }

  const selectedFolders = folders.filter(
    (f) => f.subject_id === selectedSubjectId
  );

  const selectedQuestions = questions.filter(
    (q) => q.folder_id === selectedFolderId
  );

  if (!session) {
    return (
      <div style={styles.page}>
        <div style={styles.authCard}>
          <h1>Quiz Platform</h1>
          <p>Sign in to save your question bank in the cloud.</p>

          <input
            style={styles.input}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            style={styles.input}
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button style={styles.primary} onClick={signIn}>
            Sign In
          </button>

          <button style={styles.secondary} onClick={signUp}>
            Create Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.topBar}>
          <h2>Quiz Platform</h2>
          <button style={styles.secondary} onClick={signOut}>
            Sign Out
          </button>
        </div>

        <div style={styles.card}>
          <h3>Subjects</h3>

          <div style={styles.row}>
            <select
              style={styles.input}
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <input
              style={styles.input}
              placeholder="New subject"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
            />

            <button style={styles.primary} onClick={addSubject}>
              Add Subject
            </button>
          </div>
        </div>

        <div style={styles.card}>
          <h3>Folders</h3>

          <div style={styles.row}>
            {selectedFolders.map((f) => (
              <button
                key={f.id}
                style={{
                  ...styles.folderBtn,
                  background:
                    f.id === selectedFolderId ? "#111827" : "#e5e7eb",
                  color: f.id === selectedFolderId ? "white" : "black",
                }}
                onClick={() => setSelectedFolderId(f.id)}
              >
                {f.name}
              </button>
            ))}

            <input
              style={styles.input}
              placeholder="New folder"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
            />

            <button style={styles.primary} onClick={addFolder}>
              Add Folder
            </button>
          </div>
        </div>

        <div style={styles.card}>
          <h3>Paste & Import</h3>

          <textarea
            style={styles.textarea}
            placeholder={`Question text
A. choice
B. choice
C. choice
D. choice
答案：B
解析：Explanation here`}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />

          <button style={styles.primary} onClick={importQuestions}>
            Import Questions
          </button>
        </div>

        <div>
          {selectedQuestions.map((q, idx) => {
            const selected = answers[q.id] || [];
            const checkedNow = checked[q.id];
            const multiple = q.answers.length > 1;
            const correctNow = checkedNow && isCorrect(q);

            return (
              <div key={q.id} style={styles.questionCard}>
                <div style={styles.questionHeader}>
                  <h3>
                    {idx + 1}. {q.prompt}
                  </h3>

                  <div>
                    <button
                      style={styles.secondary}
                      onClick={() => editQuestion(q)}
                    >
                      Edit Explanation
                    </button>

                    <button
                      style={styles.danger}
                      onClick={() => deleteQuestion(q.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div style={styles.choices}>
                  {q.choices.map((choice, index) => {
                    const isSelected = selected.includes(index);
                    const isAnswer = q.answers.includes(index);

                    let background = "white";

                    if (checkedNow && isAnswer) {
                      background = "#dcfce7";
                    }

                    if (checkedNow && isSelected && !isAnswer) {
                      background = "#fee2e2";
                    }

                    if (!checkedNow && isSelected) {
                      background = "#e0f2fe";
                    }

                    return (
                      <button
                        key={index}
                        style={{
                          ...styles.choice,
                          background,
                        }}
                        onClick={() => chooseAnswer(q, index)}
                      >
                        {multiple ? (isSelected ? "☑ " : "☐ ") : ""}
                        {String.fromCharCode(65 + index)}. {choice}
                      </button>
                    );
                  })}
                </div>

                {multiple && !checkedNow && (
                  <button
                    style={styles.primary}
                    onClick={() => checkAnswer(q.id)}
                  >
                    Check Answer
                  </button>
                )}

                {checkedNow && (
                  <div style={styles.explanation}>
                    <b>{correctNow ? "Correct" : "Incorrect"}</b>
                    <br />
                    {q.explanation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );


const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    padding: 28,
    fontFamily: "Arial, sans-serif",
    color: "#0f172a",
  },
  container: {
    maxWidth: 1300,
    margin: "0 auto",
  },
  authCard: {
    maxWidth: 420,
    margin: "100px auto",
    background: "white",
    padding: 28,
    borderRadius: 24,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  card: {
    background: "white",
    padding: 20,
    borderRadius: 20,
    marginBottom: 20,
    boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
  },
  row: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
  },
  input: {
    padding: 12,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    minWidth: 200,
  },
  textarea: {
    width: "100%",
    minHeight: 180,
    padding: 14,
    borderRadius: 14,
    border: "1px solid #cbd5e1",
    marginBottom: 12,
  },
  primary: {
    background: "#111827",
    color: "white",
    border: "none",
    borderRadius: 12,
    padding: "12px 16px",
    cursor: "pointer",
    fontWeight: 700,
    marginRight: 8,
  },
  secondary: {
    background: "#e5e7eb",
    color: "#111827",
    border: "none",
    borderRadius: 12,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
    marginRight: 8,
  },
  danger: {
    background: "#fee2e2",
    color: "#991b1b",
    border: "none",
    borderRadius: 12,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },
  folderBtn: {
    border: "none",
    borderRadius: 999,
    padding: "10px 16px",
    cursor: "pointer",
    fontWeight: 700,
  },
  questionCard: {
    background: "white",
    padding: 24,
    borderRadius: 22,
    marginBottom: 18,
    boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
  },
  questionHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  choices: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    marginTop: 16,
    marginBottom: 16,
  },
  choice: {
    padding: 16,
    borderRadius: 14,
    border: "1px solid #cbd5e1",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 700,
  },
  explanation: {
    background: "#f1f5f9",
    padding: 14,
    borderRadius: 14,
    marginTop: 12,
    lineHeight: 1.5,
  },
};