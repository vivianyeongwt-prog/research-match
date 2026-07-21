import type { RefObject, TouchEventHandler } from "react";
import {
  formatInstitutionLocation,
  type Author,
  type EmailFlag,
  type SummaryData,
} from "@/lib/research-match-domain";

type EmailTab = "compose" | "reference";

interface EmailComposerModalProps {
  target: Author;
  summary?: SummaryData;
  loadingSummary: boolean;
  draft: string;
  flags: EmailFlag[];
  totalFlags: number;
  checking: boolean;
  checked: boolean;
  resultGated: boolean;
  frameworkOpen: boolean;
  activeTab: EmailTab;
  freeEmailCheckUsed: boolean;
  loggedIn: boolean;
  isPaid: boolean;
  isFree: boolean;
  wordCount: number;
  sheetRef: RefObject<HTMLDivElement | null>;
  onDragStart: TouchEventHandler<HTMLDivElement>;
  onDragMove: TouchEventHandler<HTMLDivElement>;
  onDragEnd: TouchEventHandler<HTMLDivElement>;
  onClose: () => void;
  onTabChange: (tab: EmailTab) => void;
  onToggleFramework: () => void;
  onFrameworkSignup: () => void;
  onDraftChange: (draft: string) => void;
  onCheck: () => void;
  onCopy: () => void;
  onCheckerSignup: () => void;
  onSummaryPaywall: () => void;
}

function ReferenceHighlight({ highlight }: { highlight: SummaryData["highlights"][number] }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#2d5a47" }}>
        {highlight.paper}
        {highlight.doi && (
          <a href={highlight.doi} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 400, fontSize: "0.75rem", marginLeft: "8px", color: "#2d5a47" }}>
            Read &rarr;
          </a>
        )}
      </p>
      <p style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "3px" }}>{highlight.detail}</p>
    </div>
  );
}

function ReferenceQuestion({ question }: { question: string }) {
  return (
    <p style={{ fontSize: "0.8rem", color: "#6b7280", paddingLeft: "14px", borderLeft: "2px solid #9dbfb1", marginBottom: "12px", lineHeight: 1.6 }}>
      {question}
    </p>
  );
}

function FlagCard({ flag }: { flag: EmailFlag }) {
  return (
    <div className={`flag-enter ${flag.type === "error" ? "flag-error" : "flag-warning"}`} style={{ padding: "16px 20px" }}>
      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: flag.type === "error" ? "#c45c5c" : "#a8853e" }}>
        {flag.type === "error" ? "\u26A0" : "\u25CF"} {flag.issue}
      </span>
      <p style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "4px" }}>{flag.suggestion}</p>
    </div>
  );
}

export function EmailComposerModal({
  target,
  summary,
  loadingSummary,
  draft,
  flags,
  totalFlags,
  checking,
  checked,
  resultGated,
  frameworkOpen,
  activeTab,
  freeEmailCheckUsed,
  loggedIn,
  isPaid,
  isFree,
  wordCount,
  sheetRef,
  onDragStart,
  onDragMove,
  onDragEnd,
  onClose,
  onTabChange,
  onToggleFramework,
  onFrameworkSignup,
  onDraftChange,
  onCheck,
  onCopy,
  onCheckerSignup,
  onSummaryPaywall,
}: EmailComposerModalProps) {
  const visibleFlags = resultGated ? flags.slice(0, 1) : flags;
  const hiddenFlagCount = resultGated ? Math.max(0, totalFlags - visibleFlags.length) : 0;
  const accountButton = (
    <button onClick={onCheckerSignup} className="btn-cta" style={{ marginTop: "14px", padding: "11px 26px", fontSize: "0.9rem" }}>
      Create free account &rarr;
    </button>
  );

  return (
    <div className="modal-bg rm-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-glass rm-modal" ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="email-modal-title">
        <div className="rm-modal-grab" aria-hidden="true" onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd}>
          <span className="rm-modal-grab-bar" />
        </div>
        <div className="rm-modal-tabs" onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd}>
          <button className={`rm-modal-tab${activeTab === "compose" ? " rm-modal-tab-active" : ""}`} onClick={() => onTabChange("compose")}>✏️ Compose</button>
          <button className={`rm-modal-tab${activeTab === "reference" ? " rm-modal-tab-active" : ""}`} onClick={() => onTabChange("reference")}>📄 Reference</button>
        </div>

        <div className={`rm-modal-left${activeTab === "reference" ? " rm-modal-panel-hidden" : ""}`}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 id="email-modal-title" className="rm-modal-title">Email to {target.display_name}</h2>
            <button onClick={onClose} aria-label="Close" style={{ flexShrink: 0, width: "36px", height: "36px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", lineHeight: 1, color: "#6b7280", background: "none", border: "none", borderRadius: "999px", cursor: "pointer", transition: "background 0.15s ease, color 0.15s ease" }} onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(101,153,131,0.12)"; event.currentTarget.style.color = "#2d5a47"; }} onMouseLeave={(event) => { event.currentTarget.style.background = "none"; event.currentTarget.style.color = "#6b7280"; }}>&times;</button>
          </div>

          <div className="rm-email-tip rm-email-tip-before" style={{ padding: "14px 18px", background: "rgba(101, 153, 131,0.08)", border: "1.5px solid rgba(101, 153, 131,0.18)", borderRadius: "14px", marginBottom: "16px", display: "flex", alignItems: "flex-start", gap: "10px" }}>
            <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>&#128161;</span>
            <p style={{ fontSize: "0.85rem", color: "#2d5a47", lineHeight: 1.6 }}>
              <strong>Before emailing</strong>, check the professor&apos;s faculty page for specific contact instructions. Less than 5% of students do this and it instantly sets you apart.
            </p>
          </div>

          <div className="rm-email-tip rm-email-tip-volunteer" style={{ padding: "12px 18px", background: "rgba(101, 153, 131,0.12)", border: "1px solid rgba(101, 153, 131,0.25)", borderRadius: "14px", marginBottom: "16px" }}>
            <p style={{ fontSize: "0.82rem", color: "#2d5a47", lineHeight: 1.6 }}>
              <strong>Tip:</strong> Consider saying you&apos;d like to <em>volunteer</em> rather than asking for a position. It lowers the commitment for professors and makes them more likely to say yes.
            </p>
          </div>

          <div style={{ marginBottom: "16px" }}>
            {loggedIn ? (
              <button onClick={onToggleFramework} style={{ width: "100%", padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "1.5px solid rgba(101, 153, 131,0.35)", borderRadius: "12px", cursor: "pointer", fontFamily: "DM Sans, Inter, sans-serif", fontSize: "0.88rem", fontWeight: 600, color: "#2d5a47", transition: "background 0.2s" }}>
                <span>✦ Email Framework</span>
                <span style={{ fontSize: "0.8rem", transition: "transform 0.2s", transform: frameworkOpen ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>↓</span>
              </button>
            ) : (
              <button onClick={onFrameworkSignup} style={{ width: "100%", padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "1.5px solid rgba(101, 153, 131,0.2)", borderRadius: "12px", cursor: "pointer", fontFamily: "DM Sans, Inter, sans-serif", fontSize: "0.88rem", fontWeight: 600, color: "#6b7280", transition: "background 0.2s" }}>
                <span>✦ Email Framework</span>
              </button>
            )}

            {frameworkOpen && (
              <div style={{ marginTop: "10px", background: "rgba(255,255,255,0.7)", border: "1px solid rgba(101, 153, 131,0.15)", borderRadius: "14px", padding: "20px" }}>
                <p style={{ fontSize: "0.78rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>Template</p>
                <p style={{ fontSize: "0.85rem", lineHeight: 1.8, color: "#1a1a1a", marginBottom: "16px" }}>
                  &ldquo;I came across your recent work on <span style={{ background: "rgba(101, 153, 131,0.1)", color: "#2d5a47", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }}>[SPECIFIC TOPIC]</span> and was particularly struck by <span style={{ background: "rgba(101, 153, 131,0.1)", color: "#2d5a47", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }}>[SPECIFIC FINDING]</span>. This connects directly to my interest in <span style={{ background: "rgba(101, 153, 131,0.1)", color: "#2d5a47", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }}>[YOUR RESEARCH ANGLE]</span> because <span style={{ background: "rgba(101, 153, 131,0.1)", color: "#2d5a47", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }}>[ONE GENUINE REASON]</span>. I&apos;m especially curious whether <span style={{ background: "rgba(101, 153, 131,0.1)", color: "#2d5a47", padding: "2px 6px", borderRadius: "4px", fontWeight: 600 }}>[INTELLIGENT QUESTION]</span>.&rdquo;
                </p>
                <div style={{ height: "1px", background: "rgba(101, 153, 131,0.12)", marginBottom: "14px" }} />
                <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#c45c5c", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Avoid These Phrases</p>
                {[
                  { phrase: "I found your work fascinating", reason: "Name the specific finding instead." },
                  { phrase: "I am highly motivated", reason: "Show it through what you've done." },
                  { phrase: "Your research aligns with my interests", reason: "Explain the specific connection." },
                  { phrase: "I would love to learn from you", reason: "Ask about their research instead." },
                  { phrase: "I am passionate about this field", reason: "Describe what you've actually done." },
                ].map((item) => (
                  <div key={item.phrase} style={{ marginBottom: "8px" }}>
                    <p style={{ fontSize: "0.82rem", fontStyle: "italic", color: "#9b2c2c", margin: "0 0 2px" }}>&ldquo;{item.phrase}&rdquo;</p>
                    <p style={{ fontSize: "0.77rem", color: "#9ca3af", margin: 0 }}>{item.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Paste the email you're about to send." className="modal-textarea" style={{ flex: 1, padding: "24px", lineHeight: 1.7 }} />
          {!loggedIn && !checked && (
            <div style={{ margin: "12px 0 4px", padding: "10px 14px", background: "rgba(101, 153, 131,0.055)", border: "1px solid rgba(101, 153, 131,0.13)", borderRadius: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.82rem", color: "#2d5a47", opacity: 0.6, flexShrink: 0 }}>ℹ</span>
              <span style={{ fontSize: "0.8rem", color: "#2d5a47" }}>Free to try. No account needed.</span>
            </div>
          )}
          {!isPaid && !freeEmailCheckUsed && loggedIn && (
            <div style={{ margin: "12px 0 4px", padding: "10px 14px", background: "rgba(101, 153, 131,0.055)", border: "1px solid rgba(101, 153, 131,0.13)", borderRadius: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.82rem", color: "#2d5a47", opacity: 0.6, flexShrink: 0 }}>ℹ</span>
              <span style={{ fontSize: "0.8rem", color: "#2d5a47" }}>You have 1 free email check. Use it on your best draft.</span>
            </div>
          )}

          <div className="rm-modal-actions rm-modal-sticky-footer">
            {!isPaid && freeEmailCheckUsed ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: 1, background: "rgba(101, 153, 131,0.055)", border: "1px solid rgba(101, 153, 131,0.13)", borderRadius: "12px", padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "0.82rem", color: "#2d5a47", opacity: 0.6, flexShrink: 0 }}>ℹ</span>
                  <span style={{ fontSize: "0.82rem", color: "#2d5a47", fontWeight: 500 }}>You&apos;ve used your free email check.</span>
                </div>
                <p style={{ fontSize: "0.74rem", color: "#8aaa9d", paddingLeft: "21px", margin: 0 }}>Upgrade to keep checking emails before you send.</p>
              </div>
            ) : (
              <button onClick={onCheck} disabled={checking || !draft.trim()} className="btn-cta" style={{ padding: "14px 36px", fontSize: "1rem" }}>
                {checking ? <span style={{ display: "inline-flex", alignItems: "center" }}>Checking<span className="rm-dots" aria-hidden="true"><i></i><i></i><i></i></span></span> : "Check email"}
              </button>
            )}
            <button onClick={onCopy} disabled={!draft.trim()} style={{ fontSize: "1rem", color: "#6b7280", background: "none", border: "none", cursor: draft.trim() ? "pointer" : "default", opacity: draft.trim() ? 1 : 0.3, fontFamily: "var(--font-playfair), Georgia, serif", transition: "color 0.2s" }} onMouseEnter={(event) => { if (draft.trim()) event.currentTarget.style.color = "#659983"; }} onMouseLeave={(event) => { event.currentTarget.style.color = "#6b7280"; }}>
              Copy to clipboard
            </button>
            <span style={{ marginLeft: "auto", fontSize: "0.9rem", fontWeight: 700, color: wordCount > 200 ? "#c45c5c" : "#6b7280", background: wordCount > 200 ? "rgba(196, 92, 92,0.08)" : "transparent", padding: "6px 14px", borderRadius: "999px", transition: "all 0.3s ease" }}>
              {wordCount} words
            </span>
          </div>

          {checked && totalFlags === 0 && (
            <div className="email-pass" style={{ marginTop: "20px", padding: "20px 24px", textAlign: "center" }}>
              <p style={{ fontSize: "1.4rem", marginBottom: "6px" }}>&#127881;</p>
              <p style={{ fontWeight: 700, fontSize: "1.05rem", color: "#2d5a47" }}>Perfect email! No issues found.</p>
              <p style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "6px" }}>{resultGated ? "Clean. Checking your next email needs a free account." : "Copy it and send it with confidence."}</p>
              {resultGated && accountButton}
            </div>
          )}

          {checked && totalFlags > 0 && (
            <div style={{ marginTop: "20px" }}>
              {resultGated && <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#2d5a47", marginBottom: "10px" }}>{totalFlags} {totalFlags === 1 ? "issue" : "issues"} found.</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {visibleFlags.map((flag, index) => <FlagCard key={index} flag={flag} />)}
              </div>
              {hiddenFlagCount > 0 && (
                <div style={{ position: "relative", marginTop: "10px" }}>
                  <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "10px", filter: "blur(6px)", userSelect: "none", pointerEvents: "none" }}>
                    {Array.from({ length: Math.min(hiddenFlagCount, 3) }, (_, index) => (
                      <div key={index} className="flag-enter flag-warning" style={{ padding: "16px 20px" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#a8853e" }}>● Additional issue</span>
                        <p style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "4px" }}>Create an account to reveal the complete review.</p>
                      </div>
                    ))}
                  </div>
                  <div onClick={onCheckerSignup} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", cursor: "pointer", background: "linear-gradient(to bottom, rgba(245,240,230,0.55) 0%, rgba(245,240,230,0.96) 55%)", padding: "16px", borderRadius: "12px" }}>
                    <p style={{ fontSize: "0.92rem", fontWeight: 700, color: "#2d5a47", marginBottom: "4px" }}>{hiddenFlagCount} more {hiddenFlagCount === 1 ? "issue" : "issues"} found</p>
                    <p style={{ fontSize: "0.82rem", color: "#6b7280", marginBottom: "12px" }}>Create a free account to see them all.</p>
                    <span className="btn-cta" style={{ padding: "10px 24px", fontSize: "0.88rem" }}>Create free account &rarr;</span>
                  </div>
                </div>
              )}
              {resultGated && hiddenFlagCount === 0 && (
                <div style={{ marginTop: "14px", padding: "12px 16px", background: "rgba(101, 153, 131,0.055)", border: "1px solid rgba(101, 153, 131,0.13)", borderRadius: "12px" }}>
                  <p style={{ fontSize: "0.85rem", color: "#2d5a47", fontWeight: 500, margin: 0 }}>Clean otherwise. Checking your next email needs a free account.</p>
                  {accountButton}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`modal-sidebar rm-modal-right${activeTab === "compose" ? " rm-modal-panel-hidden" : ""}`}>
          <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "24px" }}>Reference</p>
          <div style={{ marginBottom: "24px" }}>
            <p style={{ fontSize: "1.4rem", fontWeight: 700, color: "#1a1a1a" }}>{target.display_name}</p>
            <p style={{ fontSize: "0.9rem", color: "#6b7280", marginTop: "4px" }}>{formatInstitutionLocation(target.last_known_institutions?.[0])}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
              {target.topics?.slice(0, 4).map((topic, index) => <span key={index} className="tag" style={{ fontSize: "0.7rem" }}>{topic.display_name}</span>)}
            </div>
          </div>
          <div style={{ height: "1px", background: "linear-gradient(to right, transparent, #8aaa9d, transparent)", opacity: 0.5, marginBottom: "24px" }} />
          {loadingSummary && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <p style={{ fontSize: "0.9rem", color: "#6b7280" }}>Loading research info<span className="rm-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
            </div>
          )}
          {summary && (
            <>
              <div style={{ marginBottom: "24px" }}>
                <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>Their Research</p>
                <p style={{ fontSize: "0.9rem", color: "#6b7280", lineHeight: 1.7 }}>{summary.summary}</p>
              </div>
              {summary.highlights.length > 0 && (
                <div style={{ marginBottom: "24px" }}>
                  <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "14px" }}>Papers to Mention</p>
                  {(isFree ? summary.highlights.slice(0, 1) : summary.highlights).map((highlight, index) => <ReferenceHighlight key={index} highlight={highlight} />)}
                  {isFree && summary.highlights.length > 1 && (
                    <div className="rm-locked-wrap">
                      <div className="rm-locked-blur" aria-hidden="true">
                        {summary.highlights.slice(1).map((highlight, index) => <ReferenceHighlight key={index} highlight={highlight} />)}
                      </div>
                      <button type="button" className="rm-locked-overlay" onClick={onSummaryPaywall}>
                        See the other {summary.highlights.length - 1} paper{summary.highlights.length - 1 === 1 ? "" : "s"}
                        <span className="rm-locked-overlay-sub">Unlock with any plan</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
              {summary.questions.length > 0 && (
                <div>
                  <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "14px" }}>Questions to Ask</p>
                  {(isFree ? summary.questions.slice(0, 1) : summary.questions).map((question, index) => <ReferenceQuestion key={index} question={question} />)}
                  {isFree && summary.questions.length > 1 && (
                    <div className="rm-locked-wrap">
                      <div className="rm-locked-blur" aria-hidden="true">
                        {summary.questions.slice(1).map((question, index) => <ReferenceQuestion key={index} question={question} />)}
                      </div>
                      <button type="button" className="rm-locked-overlay" onClick={onSummaryPaywall}>
                        See all {summary.questions.length} questions
                        <span className="rm-locked-overlay-sub">Unlock with any plan</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
