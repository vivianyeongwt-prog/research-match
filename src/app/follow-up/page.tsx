"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { hasPaidAccess } from "@/lib/buddy-pass";
import { apiFetch } from "@/lib/client-fetch";

const STORAGE_KEY = "rm_followup_used";

function formatDate(dateStr: string, addDays: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + addDays);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export default function FollowUpPage() {
  const { user, profile } = useAuth();
  const [originalEmail, setOriginalEmail] = useState("");
  const [sentDate, setSentDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ followUp1: string; followUp2: string; date1: string; date2: string } | null>(null);
  const [error, setError] = useState("");
  const [copied1, setCopied1] = useState(false);
  const [copied2, setCopied2] = useState(false);
  const [freeUsed, setFreeUsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setFreeUsed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const isPaid = hasPaidAccess(profile);

  async function handleSubmit() {
    if (!originalEmail.trim()) { setError("Paste your original email first."); return; }
    if (!sentDate) { setError("Pick the date you sent it."); return; }
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data: { session } } = await supabase.auth.getSession();
      const res = await apiFetch("/api/follow-up", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ email: originalEmail }),
      });
      const data = await res.json();
      if (res.status === 403 && data.error === "upgrade_required") {
        localStorage.setItem(STORAGE_KEY, "true");
        setFreeUsed(true);
        throw new Error("You've used your free follow-up. Upgrade for unlimited follow-ups.");
      }
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setResult({
        followUp1: data.followUp1,
        followUp2: data.followUp2,
        date1: formatDate(sentDate, 7),
        date2: formatDate(sentDate, 14),
      });
      if (!isPaid) {
        localStorage.setItem(STORAGE_KEY, "true");
        setFreeUsed(true);
      }
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string, which: 1 | 2) {
    navigator.clipboard.writeText(text);
    if (which === 1) { setCopied1(true); setTimeout(() => setCopied1(false), 2000); }
    else { setCopied2(true); setTimeout(() => setCopied2(false), 2000); }
  }

  const canSubmit = mounted && !!user && (isPaid || !freeUsed);
  const showUpgradeWall = mounted && !!user && !isPaid && freeUsed;
  const showAuthWall = mounted && !user;

  return (
    <div style={{ minHeight: "100vh", background: "#f4f0ea" }}>
      {/* Nav */}
      <nav className="sp-nav">
        <Link href="/app" className="sp-nav-back">
          ← Research Match
        </Link>
        <span className="sp-nav-title">Follow-Up</span>
        <Link href="/app" className="sp-nav-cta">
          Search Profs
        </Link>
      </nav>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 720, margin: "0 auto", padding: "40px 20px 100px" }}>
        {/* Hero */}
        <div className="sp-hero">
          <div className="sp-eyebrow">Follow-Up Timeline</div>
          <h1 className="sp-heading">
            <em>Don&apos;t let a good email</em> go to waste.
          </h1>
          <p className="sp-subheading">
            Paste the email you sent. We&apos;ll generate two follow-ups timed perfectly, each one written to feel like it came from you.
          </p>
        </div>

        {/* Form card */}
        <div className="sp-card" style={{ padding: "36px 32px", marginBottom: 36 }}>
          <div style={{ marginBottom: 28 }}>
            <label className="sp-label">
              Your Original Email
            </label>
            <textarea
              value={originalEmail}
              onChange={e => setOriginalEmail(e.target.value)}
              placeholder="Paste the full email you sent to the professor here..."
              className="sp-input"
              style={{ minHeight: 200, resize: "vertical" }}
            />
          </div>

          <div style={{ marginBottom: 32 }}>
            <label className="sp-label">
              Date You Sent It
            </label>
            <input
              type="date"
              value={sentDate}
              onChange={e => setSentDate(e.target.value)}
              className="sp-input"
            />
          </div>

          {error && (
            <p className="sp-error">
              {error}
            </p>
          )}

          {/* Auth wall */}
          {showAuthWall && (
            <div style={{ textAlign: "center", padding: "20px 0 4px" }}>
              <p style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: 16 }}>Create a free account to generate your follow-ups.</p>
              <Link href="/app?signup=true" className="sp-btn-gold">
                Create free account
              </Link>
            </div>
          )}

          {/* Upgrade wall */}
          {showUpgradeWall && (
            <div style={{ textAlign: "center", padding: "20px 0 4px" }}>
              <p style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: 6 }}>You&apos;ve used your free follow-up.</p>
              <p style={{ fontSize: "0.82rem", color: "#9b7d40", marginBottom: 16 }}>Upgrade for unlimited use.</p>
              <Link href="/app?upgrade=true" className="sp-btn-gold">
                Get unlimited follow-ups
              </Link>
            </div>
          )}

          {/* Submit button */}
          {!showAuthWall && !showUpgradeWall && (
            <button
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              className="sp-btn-primary"
              style={{ width: "100%", opacity: loading || !canSubmit ? 0.75 : 1 }}
            >
              {loading ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <span className="fu-spinner" /> Generating your timeline...
                </span>
              ) : (
                "Generate Follow-Up Timeline →"
              )}
            </button>
          )}

          {!isPaid && canSubmit && !freeUsed && (
            <p style={{ textAlign: "center", fontSize: "0.75rem", color: "#9ca3af", marginTop: 10 }}>
              Free accounts get 1 use. Upgrade for unlimited.
            </p>
          )}
        </div>

        {/* Timeline result */}
        {result && (
          <div ref={resultRef} className="fu-timeline-enter">
            {/* Timeline container */}
            <div style={{ position: "relative", paddingLeft: 40 }}>
              {/* Vertical line */}
              <div style={{ position: "absolute", left: 14, top: 24, bottom: 24, width: 2, background: "linear-gradient(180deg, #c9ad77 0%, rgba(201, 173, 119,0.3) 50%, rgba(101, 153, 131,0.2) 100%)", borderRadius: 999 }} />

              {/* Follow-Up 1 */}
              <div style={{ position: "relative", marginBottom: 32 }} className="fu-card-enter-1">
                {/* Node */}
                <div style={{ position: "absolute", left: -33, top: 24, width: 18, height: 18, borderRadius: "50%", background: "linear-gradient(135deg, #c9ad77, #a8853e)", boxShadow: "0 0 0 4px rgba(201, 173, 119,0.18), 0 2px 8px rgba(201, 173, 119,0.35)" }} />
                {/* Card */}
                <div className="fu-timeline-card fu-timeline-card-gold">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <span style={{ fontSize: "0.62rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "#c9ad77" }}>Follow-Up #1</span>
                      <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "#2d5a47", marginTop: 4 }}>Send on {result.date1}</p>
                    </div>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#c9ad77", background: "rgba(201, 173, 119,0.1)", border: "1px solid rgba(201, 173, 119,0.2)", borderRadius: 999, padding: "4px 12px" }}>7 days later</span>
                  </div>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.88rem", color: "#374151", lineHeight: 1.75, margin: 0, marginBottom: 20 }}>{result.followUp1}</pre>
                  <button
                    onClick={() => copy(result.followUp1, 1)}
                    className="fu-copy-btn fu-copy-btn-gold"
                  >
                    {copied1 ? "✓ Copied!" : "Copy email"}
                  </button>
                </div>
              </div>

              {/* Follow-Up 2 */}
              <div style={{ position: "relative", marginBottom: 36 }} className="fu-card-enter-2">
                {/* Node */}
                <div style={{ position: "absolute", left: -33, top: 24, width: 18, height: 18, borderRadius: "50%", background: "linear-gradient(135deg, #659983, #2e9e6f)", boxShadow: "0 0 0 4px rgba(101, 153, 131,0.12), 0 2px 8px rgba(101, 153, 131,0.25)" }} />
                {/* Card */}
                <div className="fu-timeline-card fu-timeline-card-green">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <span style={{ fontSize: "0.62rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "#2d5a47" }}>Follow-Up #2</span>
                      <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "#2d5a47", marginTop: 4 }}>Send on {result.date2}</p>
                    </div>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#2d5a47", background: "rgba(101, 153, 131,0.07)", border: "1px solid rgba(101, 153, 131,0.15)", borderRadius: 999, padding: "4px 12px" }}>14 days later</span>
                  </div>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.88rem", color: "#374151", lineHeight: 1.75, margin: 0, marginBottom: 20 }}>{result.followUp2}</pre>
                  <button
                    onClick={() => copy(result.followUp2, 2)}
                    className="fu-copy-btn fu-copy-btn-green"
                  >
                    {copied2 ? "✓ Copied!" : "Copy email"}
                  </button>
                </div>
              </div>
            </div>

            {/* Move on message */}
            <div className="fu-move-on-card fu-card-enter-3">
              <div style={{ fontSize: "1.4rem", marginBottom: 10 }}>🤝</div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#2d5a47", marginBottom: 10 }}>
                After 2 follow-ups, it&apos;s time to move on.
              </h3>
              <p style={{ fontSize: "0.88rem", color: "#6b7280", lineHeight: 1.7, maxWidth: 420, margin: "0 auto 24px" }}>
                If you haven&apos;t heard back, it&apos;s not about you. Professors are busy, timing is off, or they&apos;re not taking students. Your energy is better spent finding someone who&apos;s excited about you.
              </p>
              <Link href="/app" className="fu-btn-green">
                Search for more professors →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
