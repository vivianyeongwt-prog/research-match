import type { FormEventHandler, RefObject } from "react";

export type AuthMode = "login" | "signup";

interface AccountModalProps {
  mode: AuthMode;
  copy: string;
  email: string;
  password: string;
  promoCode: string;
  error: string;
  loading: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPromoCodeChange: (value: string) => void;
  onPasswordReset: () => void;
  onModeChange: (mode: AuthMode) => void;
}

const inputStyle = {
  width: "100%",
  padding: "12px 16px",
  fontSize: "1rem",
  border: "1.5px solid rgba(101, 153, 131,0.4)",
  borderRadius: "12px",
  background: "rgba(255,255,255,0.5)",
  color: "#1a1a1a",
  fontFamily: "inherit",
  marginBottom: "12px",
  outline: "none",
} as const;

export function AccountModal({
  mode,
  copy,
  email,
  password,
  promoCode,
  error,
  loading,
  dialogRef,
  onClose,
  onSubmit,
  onEmailChange,
  onPasswordChange,
  onPromoCodeChange,
  onPasswordReset,
  onModeChange,
}: AccountModalProps) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(245,240,230,0.85)", backdropFilter: "blur(12px)" }} onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" className="glass-card rm-modal-card" style={{ padding: "40px", maxWidth: "400px", width: "90%", position: "relative" }} onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Close account dialog" onClick={onClose} style={{ position: "absolute", top: "14px", right: "14px", width: "36px", height: "36px", border: 0, borderRadius: "999px", background: "rgba(101,153,131,0.08)", color: "#2d5a47", cursor: "pointer", fontSize: "1.25rem" }}>×</button>
        <h3 id="auth-modal-title" style={{ fontSize: "1.4rem", fontWeight: 700, color: "#2d5a47", marginBottom: "8px" }}>
          {mode === "signup" ? "Create your free account" : "Welcome back"}
        </h3>
        <p style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "24px" }}>
          {copy || (mode === "signup" ? "Free access to research summaries, email checker, and more." : "Log in to your account.")}
        </p>
        <form onSubmit={onSubmit}>
          {error && <p role="alert" style={{ fontSize: "0.85rem", color: "#c45c5c", marginBottom: "16px", background: "rgba(196, 92, 92,0.08)", padding: "10px 14px", borderRadius: "10px" }}>{error}</p>}
          <input aria-label="Email address" autoComplete="email" required type="email" placeholder="Email" value={email} onChange={(event) => onEmailChange(event.target.value)} style={inputStyle} />
          <input aria-label="Password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={6} type="password" placeholder="Password" value={password} onChange={(event) => onPasswordChange(event.target.value)} style={inputStyle} />
          {mode === "signup" && (
            <input aria-label="Promo code (optional)" autoComplete="off" type="text" placeholder="Promo code (optional)" value={promoCode} onChange={(event) => onPromoCodeChange(event.target.value)} style={{ ...inputStyle, marginBottom: "20px" }} />
          )}
          {mode !== "signup" && <div style={{ marginBottom: "8px" }} />}
          <button type="submit" disabled={loading} className="btn-cta rm-search-btn" style={{ width: "100%", padding: "14px", fontSize: "1rem" }}>
            {loading ? "Loading..." : mode === "signup" ? "Sign up" : "Log in"}
          </button>
          {mode === "login" && (
            <button type="button" disabled={loading} onClick={onPasswordReset} style={{ display: "block", margin: "12px auto 0", color: "#2d5a47", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem" }}>
              Forgot password?
            </button>
          )}
        </form>
        <p style={{ fontSize: "0.85rem", color: "#6b7280", textAlign: "center", marginTop: "16px" }}>
          {mode === "signup" ? "Already have an account?" : "Don't have an account?"}{" "}
          <button onClick={() => onModeChange(mode === "signup" ? "login" : "signup")} style={{ color: "#2d5a47", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>
            {mode === "signup" ? "Log in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
}
