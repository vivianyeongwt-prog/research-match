"use client";
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client-fetch";

export default function ContactPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await apiFetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      if (!res.ok) throw new Error("Failed");
      setSubmitted(true);
    } catch {
      setSubmitError("Something went wrong. Try emailing us directly.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f0ea", fontFamily: "DM Sans, Inter, sans-serif" }}>
      <nav className="sp-nav">
        <Link href="/app" className="sp-nav-back">← Research Match</Link>
        <span className="sp-nav-title">Contact</span>
        <Link href="/app" className="sp-nav-cta">Open App</Link>
      </nav>

      {/* Content — centered */}
      <div style={{
        minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        padding: "80px 24px",
      }}>
        <div className="sp-card" style={{ width: "100%", maxWidth: "520px", padding: "48px 44px" }}>
          <h1 className="sp-heading" style={{ fontSize: "2rem", marginBottom: "10px" }}>
            Get in Touch
          </h1>
          <p style={{ fontSize: "0.95rem", color: "#6b7280", lineHeight: 1.6, marginBottom: "28px" }}>
            Questions, feedback, partnership inquiries, or just want to say hi.
          </p>

          {/* Email link */}
          {supportEmail && <a
            href={`mailto:${supportEmail}`}
            className="contact-email-link"
          >
            {supportEmail}
          </a>}

          <div style={{ height: "1px", background: "rgba(101, 153, 131,0.15)", marginBottom: "28px" }} />

          {submitted ? (
            <div style={{
              textAlign: "center", padding: "32px 20px",
              background: "rgba(101, 153, 131,0.06)", borderRadius: "14px",
              border: "1px solid rgba(101, 153, 131,0.15)",
            }}>
              <p style={{ fontSize: "1.5rem", marginBottom: "12px" }}>&#10003;</p>
              <p style={{
                fontFamily: "var(--font-playfair), Georgia, serif",
                fontSize: "1.1rem", fontWeight: 700, color: "#2d5a47", marginBottom: "8px",
              }}>
                Thanks! We&apos;ll get back to you soon.
              </p>
              <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                We typically respond within 24–48 hours.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>
                  Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  className="contact-input"
                />
              </div>
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="contact-input"
                />
              </div>
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>
                  Message
                </label>
                <textarea
                  required
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={5}
                  className="contact-input"
                  style={{ resize: "vertical", lineHeight: 1.6 }}
                />
              </div>
              {submitError && (
                <p style={{ fontSize: "0.85rem", color: "#c45c5c", marginTop: "4px" }}>{submitError}</p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="sp-btn-primary"
                style={{ marginTop: "4px", opacity: submitting ? 0.7 : 1, cursor: submitting ? "not-allowed" : "pointer" }}
              >
                {submitting ? "Sending..." : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
