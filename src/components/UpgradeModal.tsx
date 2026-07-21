export type CheckoutPlan = "weekly" | "semester" | "lifetime";

interface UpgradeModalProps {
  title: string;
  subtitle: string;
  referralCode: string;
  checkoutError: string;
  onClose: () => void;
  onReferralCodeChange: (value: string) => void;
  onCheckout: (plan: CheckoutPlan) => Promise<void>;
}

export function UpgradeModal({
  title,
  subtitle,
  referralCode,
  checkoutError,
  onClose,
  onReferralCodeChange,
  onCheckout,
}: UpgradeModalProps) {
  return (
    <div className="rm-upgrade-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title" className="glass-card rm-modal-card rm-upgrade-card" style={{ padding: "32px", position: "relative" }} onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Close upgrade dialog" onClick={onClose} style={{ position: "absolute", top: "12px", right: "12px", width: "34px", height: "34px", border: 0, borderRadius: "999px", background: "rgba(101,153,131,0.08)", color: "#2d5a47", cursor: "pointer", fontSize: "1.2rem" }}>×</button>
        <h3 id="upgrade-modal-title" style={{ fontSize: "1.25rem", fontWeight: 700, color: "#2d5a47", marginBottom: "4px", paddingRight: "32px" }}>{title || "Unlock the full toolkit"}</h3>
        <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "20px" }}>{subtitle || "Every finding, every question, the email checker, and the professor email finder."}</p>
        <details open={Boolean(referralCode)} style={{ marginBottom: "14px", borderRadius: "16px", background: "rgba(255,255,255,0.48)", border: "1px solid rgba(101, 153, 131,0.1)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.65)", overflow: "hidden" }}>
          <summary style={{ listStyle: "none", cursor: "pointer", padding: "12px 14px", color: "#2d5a47", fontSize: "0.82rem", fontWeight: 750, letterSpacing: "0.01em", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            Have a Research Buddy Pass?
            <span style={{ fontSize: "0.68rem", color: "#557065", fontWeight: 750, padding: "5px 9px", borderRadius: "999px", background: "rgba(101, 153, 131,0.08)", whiteSpace: "nowrap" }}>Optional</span>
          </summary>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", padding: "0 14px 14px" }}>
            <input
              type="text"
              placeholder="Enter friend code"
              value={referralCode}
              onChange={(event) => onReferralCodeChange(event.target.value)}
              style={{ width: "100%", minWidth: 0, border: "1px solid rgba(101, 153, 131,0.12)", outline: "none", background: "rgba(255,255,255,0.64)", color: "#1f3f32", fontSize: "0.9rem", fontWeight: 650, letterSpacing: "0.02em", fontFamily: "inherit", padding: "12px 13px", borderRadius: "12px", textTransform: "uppercase" }}
            />
          </div>
        </details>
        {checkoutError && (
          <p style={{ fontSize: "0.78rem", color: "#a24646", background: "rgba(196,92,92,0.08)", border: "1px solid rgba(196,92,92,0.14)", padding: "9px 12px", borderRadius: "12px", marginBottom: "14px" }}>
            {checkoutError}
          </p>
        )}

        <div style={{ padding: "20px", borderRadius: "16px", border: "2px solid rgba(101, 153, 131,0.5)", boxShadow: "0 10px 30px rgba(101, 153, 131,0.16)", background: "linear-gradient(135deg, rgba(101, 153, 131,0.08), rgba(101, 153, 131,0.03))", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
            <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.1em" }}>Weekly Sprint</p>
            <span style={{ fontSize: "0.55rem", fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #659983, #557f6c)", padding: "3px 9px", borderRadius: "999px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Most Popular</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "2px" }}>
            <span style={{ fontSize: "2.1rem", fontWeight: 800, color: "#2d5a47" }}>$7</span>
            <span style={{ fontSize: "0.85rem", color: "#2d5a47", fontWeight: 600 }}>/ week</span>
          </div>
          <p style={{ fontSize: "0.78rem", color: "#6b7280", marginBottom: "12px" }}>Full access while you run your outreach. Cancel anytime.</p>
          <ul style={{ listStyle: "none", padding: 0, marginBottom: "16px" }}>
            {["Unlimited research summaries", "Email checker with red-flag detection", "Professor email finder", "Professor responsiveness indicator", "Cold Email Playbook"].map((feature) => (
              <li key={feature} style={{ fontSize: "0.82rem", color: "#6b7280", padding: "3px 0", display: "flex", gap: "8px" }}>
                <span style={{ color: "#2d5a47" }}>✓</span> {feature}
              </li>
            ))}
          </ul>
          <button onClick={async () => onCheckout("weekly")} className="btn-cta rm-search-btn" style={{ width: "100%", padding: "13px", fontSize: "0.95rem", background: "linear-gradient(135deg, #659983, #557f6c)", boxShadow: "0 8px 24px rgba(101, 153, 131,0.3)", textShadow: "0 1px 2px rgba(18, 54, 39,0.24)" }}>
            Start Weekly for $7
          </button>
          <p style={{ fontSize: "0.74rem", color: "#9b7d40", textAlign: "center", marginTop: "8px", fontWeight: 600 }}>Cancel recurring plans from your profile.</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "14px 18px", borderRadius: "12px", border: "1px solid rgba(101, 153, 131,0.18)", background: "rgba(101, 153, 131,0.03)", flexWrap: "wrap", marginBottom: "10px" }}>
          <div>
            <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>Semester</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
              <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "#2d5a47" }}>$29</span>
              <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>/ 4 months · full semester access</span>
            </div>
          </div>
          <button onClick={async () => onCheckout("semester")} className="btn-cta" style={{ padding: "10px 22px", fontSize: "0.85rem", background: "rgba(101, 153, 131, 0.1)", color: "#2d5a47", border: "none", whiteSpace: "nowrap" }}>
            Get Semester for $29
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "11px 16px", borderRadius: "12px", border: "1px solid rgba(101, 153, 131,0.1)", background: "rgba(255,255,255,0.45)", flexWrap: "wrap", marginBottom: "12px" }}>
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            Prefer to pay once? <strong style={{ color: "#2d5a47", fontWeight: 700 }}>Lifetime for $59</strong>, never pay again.
          </span>
          <button onClick={async () => onCheckout("lifetime")} style={{ fontSize: "0.8rem", fontWeight: 700, color: "#2d5a47", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "underline", fontFamily: "inherit" }}>
            Get Lifetime →
          </button>
        </div>

        <div style={{ padding: "10px 14px", background: "rgba(101, 153, 131,0.04)", borderRadius: "10px", border: "1px solid rgba(101, 153, 131,0.1)", display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {["Email Template (professor-tested)", "Emails That Worked (real examples)", "Follow-Up Guide"].map((bonus) => (
            <p key={bonus} style={{ fontSize: "0.72rem", color: "#6b7280", display: "flex", gap: "5px", margin: 0 }}>
              <span style={{ color: "#a8853e" }}>✓</span> {bonus}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
