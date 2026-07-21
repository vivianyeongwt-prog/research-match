"use client";
import { useState, useEffect, useCallback, useRef, startTransition } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/client-fetch";

interface FeedbackItem {
  id: string;
  content: string;
  category: string;
  author_name: string;
  upvotes: number;
  created_at: string;
  resolved: boolean;
}

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const CATEGORIES = ["Feature Request", "Bug Report", "General Feedback"];

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"upvotes" | "newest">("upvotes");
  const btnVotedRef = useRef<HTMLButtonElement>(null);
  const btnNewestRef = useRef<HTMLButtonElement>(null);
  const [, setSortMounted] = useState(false);
  useEffect(() => { setSortMounted(true); }, []);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("Feature Request");
  const [authorName, setAuthorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [voteBounce, setVoteBounce] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("research-match-votes");
    if (stored) {
      try { setVoted(new Set(JSON.parse(stored))); } catch { /* ignore */ }
    }
  }, []);

  // Sequence counter so a slow, out-of-order response can't clobber a newer one.
  const fetchSeqRef = useRef(0);

  async function fetchFeedback() {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/feedback?sort=${sort}`);
      const data = await res.json();
      if (seq !== fetchSeqRef.current) return;
      if (Array.isArray(data)) startTransition(() => setItems(data));
    } catch { /* ignore */ }
    finally { if (seq === fetchSeqRef.current) setLoading(false); }
  }

  // Runs on mount and whenever the sort changes (single fetch on first render).
  useEffect(() => { fetchFeedback(); }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, category, author_name: authorName }),
      });
      if (res.ok) {
        setContent("");
        setAuthorName("");
        setSubmitted(true);
        setTimeout(() => setSubmitted(false), 3000);
        fetchFeedback();
        showToast("Feedback posted!");
        // Mini celebration — lazy load so it doesn't block initial page
        import("canvas-confetti").then(({ default: confetti }) => confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.7 },
          colors: ["#659983", "#8aaa9d", "#9dbfb1"],
          gravity: 1.2,
        }));
      }
    } catch { /* ignore */ }
    finally { setSubmitting(false); }
  }

  const votesInFlightRef = useRef<Set<string>>(new Set());

  async function handleUpvote(id: string) {
    if (voted.has(id) || votesInFlightRef.current.has(id)) return;
    votesInFlightRef.current.add(id);

    // Bounce animation
    setVoteBounce(id);
    setTimeout(() => setVoteBounce(null), 500);

    // Optimistic count; only commit the vote once the server accepts it.
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, upvotes: item.upvotes + 1 } : item));

    try {
      const res = await apiFetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Upvote failed");
      // Functional update: `voted` in this closure is stale after the await, and
      // two in-flight votes on different items would overwrite each other's commit.
      setVoted((prev) => {
        const next = new Set(prev);
        next.add(id);
        localStorage.setItem("research-match-votes", JSON.stringify([...next]));
        return next;
      });
    } catch {
      // Revert the optimistic count and leave the button usable.
      setItems((prev) => prev.map((item) => item.id === id ? { ...item, upvotes: item.upvotes - 1 } : item));
      showToast("Couldn't save your vote. Try again.");
    } finally {
      votesInFlightRef.current.delete(id);
    }
  }

  async function handleResolve(id: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showToast("Sign in again to resolve feedback");
        return;
      }

      const res = await apiFetch("/api/feedback", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id, resolved: true }),
      });
      if (!res.ok) {
        showToast("Only admins can resolve feedback");
        return;
      }

      setItems((prev) => prev.map((item) => item.id === id ? { ...item, resolved: true } : item));
      showToast("Marked as resolved");
    } catch {
      showToast("Could not resolve feedback");
    }
  }

  const categoryStyle = (cat: string) => {
    if (cat === "Feature Request") return { background: "rgba(101, 153, 131,0.1)", color: "#2d5a47", border: "1px solid rgba(101, 153, 131,0.2)" };
    if (cat === "Bug Report") return { background: "rgba(196, 92, 92,0.1)", color: "#c45c5c", border: "1px solid rgba(196, 92, 92,0.2)" };
    return { background: "rgba(149, 173, 163,0.1)", color: "#6b7280", border: "1px solid rgba(149, 173, 163,0.2)" };
  };

  return (
    <>
      <div className="splotches">
        <div className="splotch splotch-1" />
        <div className="splotch splotch-2" />
        <div className="splotch splotch-3" />
        <div className="splotch splotch-4" />
        <div className="splotch splotch-5" />
      </div>

      <main className="rm-page" style={{ maxWidth: "800px" }}>
        <div className="rm-header" style={{ marginBottom: "40px" }}>
          <div>
            <Link href="/" style={{ textDecoration: "none" }}>
              <h1 className="rm-title" style={{ fontSize: "2.4rem" }}>Feedback Board</h1>
            </Link>
            <p style={{ fontSize: "1.05rem", color: "#6b7280", marginTop: "8px" }}>
              Help shape Research Match. Suggest features, report bugs, or share your thoughts.
            </p>
          </div>
          <Link href="/" className="btn-cta" style={{ padding: "12px 28px", fontSize: "0.9rem", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", whiteSpace: "nowrap", textAlign: "center" }}>
            &larr; Back to tool
          </Link>
        </div>

        {/* SUBMIT FORM */}
        <form onSubmit={handleSubmit} className="glass-card" style={{ padding: "28px 32px", marginBottom: "40px" }}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What would make Research Match better?"
            className="modal-textarea"
            style={{
              width: "100%", minHeight: "100px",
              padding: "16px 20px", fontSize: "1rem",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: "12px", marginTop: "16px", flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                padding: "10px 16px", fontSize: "0.9rem", borderRadius: "12px",
                border: "1.5px solid rgba(101, 153, 131,0.35)", background: "rgba(255,255,255,0.5)",
                color: "#1a1a1a", fontFamily: "var(--font-playfair), Georgia, serif",
                cursor: "pointer", outline: "none", transition: "all 0.3s ease",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#659983"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(101, 153, 131,0.08)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(101, 153, 131,0.35)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Your name (optional)"
              style={{
                padding: "10px 16px", fontSize: "0.9rem", borderRadius: "12px",
                border: "1.5px solid rgba(101, 153, 131,0.35)", background: "rgba(255,255,255,0.5)",
                color: "#1a1a1a", fontFamily: "var(--font-playfair), Georgia, serif",
                outline: "none", flex: 1, minWidth: "150px", transition: "all 0.3s ease",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#659983"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(101, 153, 131,0.08)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(101, 153, 131,0.35)"; e.currentTarget.style.boxShadow = "none"; }}
            />
            <button type="submit" disabled={!content.trim() || submitting} className="btn-cta" style={{ padding: "12px 32px", fontSize: "0.95rem" }}>
              {submitting ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <span className="loading-spinner" style={{ fontSize: "0.9rem" }}>&#127807;</span>
                  Posting...
                </span>
              ) : "Post"}
            </button>
          </div>
          {submitted && (
            <div className="email-pass" style={{ marginTop: "16px", padding: "12px 18px", textAlign: "center" }}>
              <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#2d5a47" }}>&#10003; Thanks for your feedback!</p>
            </div>
          )}
        </form>

        {/* SORT TOGGLE */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>{items.length} suggestion{items.length !== 1 ? "s" : ""}</p>
          <div className="mode-toggle">
            <div
              className="mode-toggle-slider"
              style={{
                left: sort === "upvotes"
                  ? (btnVotedRef.current?.offsetLeft ?? 4) + "px"
                  : (btnNewestRef.current?.offsetLeft ?? 100) + "px",
                width: sort === "upvotes"
                  ? (btnVotedRef.current?.offsetWidth ?? 110) + "px"
                  : (btnNewestRef.current?.offsetWidth ?? 95) + "px",
              }}
            />
            <button ref={btnVotedRef} onClick={() => setSort("upvotes")} className={`mode-toggle-btn ${sort === "upvotes" ? "mode-toggle-btn-active" : ""}`} style={{ padding: "8px 20px", fontSize: "0.8rem" }}>
              Most voted
            </button>
            <button ref={btnNewestRef} onClick={() => setSort("newest")} className={`mode-toggle-btn ${sort === "newest" ? "mode-toggle-btn-active" : ""}`} style={{ padding: "8px 20px", fontSize: "0.8rem" }}>
              Newest
            </button>
          </div>
        </div>

        {/* FEEDBACK LIST */}
        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <span className="loading-spinner">&#127807;</span>
            <p style={{ fontSize: "1rem", color: "#6b7280", marginTop: "12px" }}>Loading feedback...</p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {items.map((item, idx) => {
            const hasVoted = voted.has(item.id);
            const isBouncing = voteBounce === item.id;
            return (
              <div key={item.id} className="glass-card card-enter" style={{
                padding: "24px 28px", display: "flex", gap: "20px", alignItems: "flex-start",
                animationDelay: `${idx * 0.06}s`,
                opacity: item.resolved ? 0.7 : 1,
                borderColor: item.resolved ? "rgba(101, 153, 131,0.25)" : undefined,
              }}>
                {/* Upvote */}
                <button
                  onClick={() => !item.resolved && handleUpvote(item.id)}
                  disabled={hasVoted || item.resolved}
                  className={isBouncing ? "star-bounce" : ""}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
                    background: hasVoted ? "rgba(101, 153, 131,0.12)" : "rgba(101, 153, 131,0.12)",
                    border: `1.5px solid ${hasVoted ? "rgba(101, 153, 131,0.3)" : "rgba(101, 153, 131,0.3)"}`,
                    borderRadius: "14px", padding: "12px 16px", cursor: hasVoted ? "default" : "pointer",
                    transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)", minWidth: "56px",
                    boxShadow: hasVoted ? "inset 0 1px 3px rgba(101, 153, 131,0.08)" : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!hasVoted) {
                      e.currentTarget.style.transform = "translateY(-3px)";
                      e.currentTarget.style.boxShadow = "0 6px 16px rgba(101, 153, 131,0.12)";
                      e.currentTarget.style.background = "rgba(101, 153, 131,0.08)";
                      e.currentTarget.style.borderColor = "rgba(101, 153, 131,0.3)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!hasVoted) {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "none";
                      e.currentTarget.style.background = "rgba(101, 153, 131,0.12)";
                      e.currentTarget.style.borderColor = "rgba(101, 153, 131,0.3)";
                    }
                  }}
                >
                  <span style={{
                    fontSize: "1.1rem",
                    color: hasVoted ? "#659983" : "#6b7280",
                    transition: "all 0.3s ease",
                    transform: hasVoted ? "scale(1.1)" : "scale(1)",
                    display: "inline-block",
                  }}>&#9650;</span>
                  <span style={{
                    fontSize: "1rem", fontWeight: 700,
                    color: hasVoted ? "#659983" : "#1a1a1a",
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    transition: "all 0.3s ease",
                  }}>{item.upvotes}</span>
                </button>

                {/* Content */}
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: "1rem", color: "#1a1a1a", lineHeight: 1.7 }}>{item.content}</p>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "12px", flexWrap: "wrap" }}>
                    <span className="tag" style={{
                      fontSize: "0.72rem", fontWeight: 700, padding: "4px 12px",
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      animation: "none", opacity: 1,
                      ...categoryStyle(item.category),
                    }}>
                      {item.category}
                    </span>
                    <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{item.author_name}</span>
                    <span style={{ fontSize: "0.8rem", color: "#8aaa9d" }}>&middot;</span>
                    <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{timeAgo(item.created_at)}</span>
                    {item.resolved && (
                      <span style={{
                        fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px",
                        borderRadius: "999px", background: "rgba(101, 153, 131,0.12)",
                        color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.06em",
                      }}>
                        ✓ Resolved
                      </span>
                    )}
                    {isAdmin && !item.resolved && (
                      <button
                        onClick={() => handleResolve(item.id)}
                        style={{
                          fontSize: "0.72rem", fontWeight: 600, padding: "3px 10px",
                          borderRadius: "999px", background: "rgba(101, 153, 131,0.06)",
                          color: "#6b7280", border: "1px solid rgba(101, 153, 131,0.3)",
                          cursor: "pointer", transition: "all 0.2s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(101, 153, 131,0.15)";
                          e.currentTarget.style.color = "#659983";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(101, 153, 131,0.06)";
                          e.currentTarget.style.color = "#6b7280";
                        }}
                      >
                        Mark resolved
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!loading && items.length === 0 && (
          <div className="glass-card card-enter" style={{ textAlign: "center", padding: "60px 20px" }}>
            <p style={{ fontSize: "2.5rem", marginBottom: "16px" }}>&#127793;</p>
            <p style={{ fontSize: "1.2rem", color: "#1a1a1a", fontWeight: 600 }}>No feedback yet</p>
            <p style={{ fontSize: "0.95rem", color: "#6b7280", marginTop: "8px" }}>Be the first to share your thoughts!</p>
          </div>
        )}
      </main>

      {/* TOAST */}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
