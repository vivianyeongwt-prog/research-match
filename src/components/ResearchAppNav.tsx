import Link from "next/link";
import type { RefObject } from "react";
import { ResearchMatchLogo } from "./ResearchMatchLogo";

interface ResearchAppNavProps {
  loggedIn: boolean;
  userEmail: string | null;
  isFree: boolean;
  isPaid: boolean;
  isLifetime: boolean;
  planLabel: string;
  savedCount: number;
  showingSaved: boolean;
  menuOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggleSaved: () => void;
  onLogin: () => void;
  onSignup: () => void;
  onUpgrade: () => void;
  onSignOut: () => void;
}

export function ResearchAppNav({
  loggedIn,
  userEmail,
  isFree,
  isPaid,
  isLifetime,
  planLabel,
  savedCount,
  showingSaved,
  menuOpen,
  menuRef,
  menuButtonRef,
  onToggleMenu,
  onCloseMenu,
  onToggleSaved,
  onLogin,
  onSignup,
  onUpgrade,
  onSignOut,
}: ResearchAppNavProps) {
  return (
    <nav className="rm-floating-nav">
      <div className="rm-nav-pill" ref={menuRef}>
        <button
          ref={menuButtonRef}
          type="button"
          className={`rm-hamburger${menuOpen ? " rm-hamburger-open" : ""}`}
          onClick={onToggleMenu}
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="research-match-menu"
        >
          <span className="rm-hamburger-line" />
          <span className="rm-hamburger-line" />
          <span className="rm-hamburger-line" />
        </button>

        <Link href="/" className="rm-nav-logo">
          <ResearchMatchLogo />
        </Link>
        <div className="rm-nav-spacer" />

        {savedCount > 0 && (
          <button
            onClick={onToggleSaved}
            className={`rm-nav-saved${showingSaved ? " rm-nav-saved-active" : ""}`}
          >
            Saved ({savedCount})
          </button>
        )}

        {!loggedIn ? (
          <>
            <button onClick={onLogin} className="rm-nav-btn">Log in</button>
            <button onClick={onSignup} className="btn-cta rm-nav-cta">Sign up</button>
          </>
        ) : (
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {isFree && (
              <button onClick={onUpgrade} style={{ fontSize: "0.78rem", fontWeight: 700, color: "#a8853e", background: "rgba(201, 173, 119, 0.12)", padding: "7px 14px", borderRadius: "999px", border: "1px solid rgba(201, 173, 119, 0.25)", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)", fontFamily: "var(--font-playfair), Georgia, serif", whiteSpace: "nowrap" }}>
                Upgrade
              </button>
            )}
            {isPaid && isLifetime && (
              <span className="rm-nav-badge" style={{ color: "#fff", background: "linear-gradient(135deg, #659983, #2e9e6f)" }}>{planLabel}</span>
            )}
            {isPaid && !isLifetime && (
              <span className="rm-nav-badge" style={{ color: "#fff", background: "#659983" }}>{planLabel}</span>
            )}
            <Link href="/profile" style={{
              width: "36px", height: "36px", borderRadius: "50%",
              background: "linear-gradient(135deg, #659983, #2e9e6f)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: "0.82rem", fontWeight: 700,
              textDecoration: "none", transition: "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease",
              boxShadow: "0 2px 8px rgba(101, 153, 131, 0.25)",
              border: "2px solid rgba(255,255,255,0.45)",
              flexShrink: 0,
            }} className="profile-avatar">
              {userEmail?.charAt(0).toUpperCase()}
            </Link>
          </div>
        )}

        <div id="research-match-menu" aria-hidden={!menuOpen} inert={!menuOpen} className={`rm-nav-dropdown${menuOpen ? " rm-nav-dropdown-open" : ""}`}>
          <div className="rm-nav-dropdown-inner">
            <div className="rm-nav-section-label">Tools</div>
            <Link href="/app" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">⬡</span>
              Professor Search
              <span className="rm-nav-item-badge rm-nav-item-badge-tool" style={{ marginLeft: "auto" }}>App</span>
            </Link>
            <Link href="/how-it-works" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">◎</span>
              How It Works
            </Link>

            <div className="rm-nav-section-divider" />
            <div className="rm-nav-section-label">Email Playbook</div>
            <Link href="/framework" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">⊞</span>
              Email Framework
            </Link>
            <Link href="/examples" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">✦</span>
              Emails That Worked
            </Link>
            <Link href="/follow-up" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">⟳</span>
              Follow-Up Generator
            </Link>

            <div className="rm-nav-section-divider" />
            <div className="rm-nav-section-label">Resources</div>
            <Link href="/blog" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">✒</span>
              Blog
            </Link>
            <Link href="/feedback" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">↗</span>
              Feedback
            </Link>
            <Link href="/contact" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">✉</span>
              Contact
            </Link>

            <div className="rm-nav-section-divider" />
            <Link href="/profile" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">⚙</span>
              Account Settings
            </Link>
            <Link href="/?#pricing" className="rm-nav-dropdown-item" onClick={onCloseMenu}>
              <span className="rm-nav-dropdown-icon">◈</span>
              Pricing
            </Link>
            {loggedIn && (
              <>
                <div className="rm-nav-dropdown-divider" />
                <button className="rm-nav-dropdown-item rm-nav-dropdown-logout" onClick={onSignOut}>
                  <span className="rm-nav-dropdown-icon">⏏</span>
                  Log Out
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
