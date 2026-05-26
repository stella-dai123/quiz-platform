import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export default function App() {
  const [session, setSession] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [subjects, setSubjects] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      loadSubjects();
    }
  }, [session]);

  async function loadSubjects() {
    const { data, error } = await supabase
      .from("subjects")
      .select("*");

    if (error) {
      console.error(error);
      return;
    }

    setSubjects(data || []);

    if (data?.length) {
      setSelectedSubject(data[0].id);
    }
  }

  async function signUp() {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert("Account created");
  }

  async function signIn() {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert("Signed in");
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function addSubject() {
    const name = prompt("Subject name");

    if (!name) return;

    const { data, error } = await supabase
      .from("subjects")
      .insert({
        user_id: session.user.id,
        name,
      })
      .select()
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    setSubjects((prev) => [...prev, data]);
  }

  if (!session) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1>Quiz Platform</h1>

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

          <button style={styles.button} onClick={signIn}>
            Sign In
          </button>

          <button style={styles.button} onClick={signUp}>
            Create Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1>Quiz Platform</h1>

        <button style={styles.button} onClick={signOut}>
          Sign Out
        </button>

        <button style={styles.button} onClick={addSubject}>
          Add Subject
        </button>

        <select
          style={styles.input}
          value={selectedSubject}
          onChange={(e) => setSelectedSubject(e.target.value)}
        >
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    padding: 40,
    fontFamily: "Arial",
  },

  card: {
    maxWidth: 500,
    margin: "0 auto",
    background: "white",
    padding: 24,
    borderRadius: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },

  input: {
    padding: 12,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
  },

  button: {
    padding: 12,
    border: "none",
    borderRadius: 12,
    background: "#111827",
    color: "white",
    cursor: "pointer",
    fontWeight: 700,
  },
};