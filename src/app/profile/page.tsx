"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { formatBuddyPassDate, hasActiveBuddyPass, hasPaidAccess, planLabelFor } from "@/lib/buddy-pass";
import { apiFetch } from "@/lib/client-fetch";
import { readSavedProfessors } from "@/lib/browser-storage";
import styles from "./profile.module.css";

type BuddyReferral = {
  id: string;
  friendEmail: string;
  createdAt: string;
  rewardWeeks: number;
  discountPercent: number;
};

type BuddyPassData = {
  referralCode: string;
  referralUrl: string;
  weeksAvailable: number;
  weeksEarned: number;
  weeksUsed: number;
  activeUntil: string | null;
  active: boolean;
  successfulReferrals: number;
  referrals: BuddyReferral[];
};

const EMPTY_BUDDY_PASS: BuddyPassData = {
  referralCode: "",
  referralUrl: "",
  weeksAvailable: 0,
  weeksEarned: 0,
  weeksUsed: 0,
  activeUntil: null,
  active: false,
  successfulReferrals: 0,
  referrals: [],
};

function formatMemberSince(date?: string) {
  if (!date) return "Recently";
  return new Date(date).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function daysSince(date?: string) {
  if (!date) return 1;
  const created = new Date(date).getTime();
  return Math.max(1, Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24)));
}

export default function ProfilePage() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [savedCount, setSavedCount] = useState(0);
  const [buddyPass, setBuddyPass] = useState<BuddyPassData>(EMPTY_BUDDY_PASS);
  const [buddyLoading, setBuddyLoading] = useState(true);
  const [buddyError, setBuddyError] = useState("");
  const [activationLoading, setActivationLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "code" | "link">("idle");
  const [resetRequested, setResetRequested] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const isPaid = hasPaidAccess(profile);
  const buddyActive = buddyPass.active || hasActiveBuddyPass(profile);
  const planLabel = planLabelFor(profile);
  const initial = user?.email?.charAt(0).toUpperCase() || "?";
  const summariesUsed = profile?.summaries_used ?? 0;
  const summariesLeft = isPaid ? "∞" : `${Math.max(0, 2 - summariesUsed)}/2`;

  const memberSince = useMemo(() => formatMemberSince(profile?.created_at), [profile?.created_at]);
  const activeDays   = useMemo(() => daysSince(profile?.created_at),        [profile?.created_at]);

  const fetchBuddyPass = useCallback(async () => {
    if (!user) return;
    setBuddyError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Missing auth session");
      const res = await apiFetch("/api/buddy-pass", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load Buddy Pass.");
      setBuddyPass(data);
    } catch (err) {
      setBuddyError(err instanceof Error ? err.message : "Could not load Buddy Pass.");
    } finally {
      setBuddyLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setSavedCount(readSavedProfessors().length);
    refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    setResetRequested(new URLSearchParams(window.location.search).get("reset") === "1");
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchBuddyPass();
    const interval = window.setInterval(fetchBuddyPass, 15000);
    return () => window.clearInterval(interval);
  }, [fetchBuddyPass, user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await apiFetch("/api/billing-status", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (active && res.ok) setHasSubscription(data.hasSubscription === true);
      } catch { /* hide billing actions when ownership cannot be verified */ }
    })();
    return () => { active = false; };
  }, [user]);

  async function copyBuddyPass(value: string, kind: "code" | "link") {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopyState(kind);
    window.setTimeout(() => setCopyState("idle"), 1600);
  }

  async function activateBuddyWeek() {
    if (buddyActive) return;
    if (buddyPass.weeksAvailable <= 0) {
      setBuddyError("You do not have a Buddy Week ready yet.");
      return;
    }
    setActivationLoading(true);
    setBuddyError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Missing auth session");
      const res = await apiFetch("/api/buddy-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "activate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not activate Buddy Pass.");
      await Promise.all([fetchBuddyPass(), refreshProfile()]);
    } catch (err) {
      setBuddyError(err instanceof Error ? err.message : "Could not activate Buddy Pass.");
    } finally {
      setActivationLoading(false);
    }
  }

  async function startSemesterCheckout() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { alert("Please sign in again to continue."); return; }
      const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_SEMESTER;
      if (!priceId) { alert("Checkout is not configured for this plan."); return; }
      const res = await apiFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || "Could not open checkout.");
    } catch {
      alert("Something went wrong. Please try again.");
    }
  }

  async function cancelSubscription() {
    const confirmed = window.confirm("Cancel your Research Match subscription? You will not be charged again.");
    if (!confirmed) return;
    setCancelLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { alert("Please sign in again to cancel your subscription."); return; }
      const res = await apiFetch("/api/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Could not cancel subscription. Please contact support."); return; }
      setHasSubscription(false);
      await refreshProfile();
      alert("Subscription canceled. You will not be charged again.");
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setCancelLoading(false);
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 8) {
      setResetMessage("Use at least 8 characters.");
      return;
    }
    setResetLoading(true);
    setResetMessage("");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setResetLoading(false);
    if (error) {
      setResetMessage(error.message);
      return;
    }
    setNewPassword("");
    setResetRequested(false);
    setResetMessage("Password updated.");
    window.history.replaceState({}, "", "/profile");
  }

  /* ── Signed-out gate ─────────────────────────────────────────── */
  if (!user) {
    return (
      <main className={styles.profileMount}>
        <section className="pro-signed-out glass">
          <div className="pro-signed-out-mark">RM</div>
          <h1>Sign in to view your profile</h1>
          <p>Your plan, saved professors, and Buddy Pass rewards live here.</p>
          <Link href="/app" className="pro-go-btn">Go to app</Link>
        </section>
      </main>
    );
  }

  /* ── Features list ───────────────────────────────────────────── */
  const features: [string, boolean][] = [
    ["Full research summaries",   true],
    ["Suggested questions",       true],
    ["Author position labels",    true],
    ["Save professors",           true],
    ["Paper links",               true],
    ["Unlimited summaries",       isPaid],
    ["Email checker",             isPaid],
    ["Professor email finder",    isPaid],
    ["Nearby professor access",   isPaid],
  ];

  /* ── Main render ─────────────────────────────────────────────── */
  return (
    <main className={styles.profileMount}>
      {/* Ambient blobs */}
      <div className="pro-ambient pro-ambient-a" aria-hidden="true" />
      <div className="pro-ambient pro-ambient-b" aria-hidden="true" />

      <div className="pro-shell">

        {/* ── Nav ─────────────────────────────────────────────── */}
        <nav className="pro-nav" aria-label="Profile navigation">
          <Link href="/app" className="pro-back">
            <span aria-hidden="true">←</span> Back to search
          </Link>
          <Link href="/" className="pro-brand">Research Match</Link>
        </nav>

        {/* ══ HERO CARD ══════════════════════════════════════════ */}
        <section className="pro-hero glass" aria-label="Account overview">
          <div className="pro-hero-left">
            <div className="pro-avatar" aria-hidden="true">{initial}</div>
            <div className="pro-hero-text">
              <p className="pro-eyebrow">Account</p>
              <h1 className="pro-name">Profile Settings</h1>
              <p className="pro-email">{user.email}</p>
              <p className="pro-since">Member since {memberSince}</p>
            </div>
          </div>

          <div className="pro-plan-badge" aria-label={`Current plan: ${planLabel}`}>
            <span className={`pro-plan-dot${isPaid ? " is-live" : ""}`} aria-hidden="true" />
            <div className="pro-plan-info">
              <span className="pro-plan-lbl">Current plan</span>
              <span className="pro-plan-name">{planLabel}</span>
            </div>
          </div>
        </section>

        {/* ══ STATS STRIP ════════════════════════════════════════ */}
        <div className="pro-stats" aria-label="Account stats">
          <div className="pro-stat glass">
            <span className="pro-stat-label">Summaries</span>
            <strong className="pro-stat-value">{summariesLeft}</strong>
            <p className="pro-stat-note">
              {isPaid ? "Unlimited while active" : "2 free total"}
            </p>
          </div>
          <div className="pro-stat glass">
            <span className="pro-stat-label">Saved</span>
            <strong className="pro-stat-value">{savedCount}</strong>
            <p className="pro-stat-note">Professors saved</p>
          </div>
          <div className="pro-stat glass">
            <span className="pro-stat-label">Days active</span>
            <strong className="pro-stat-value">{activeDays}</strong>
            <p className="pro-stat-note">Since you joined</p>
          </div>
          <div className="pro-stat glass">
            <span className="pro-stat-label">Buddy weeks</span>
            <strong className="pro-stat-value">{buddyLoading ? "-" : buddyPass.weeksAvailable}</strong>
            <p className="pro-stat-note">
              {buddyActive
                ? `Active until ${formatBuddyPassDate(buddyPass.activeUntil || profile?.buddy_pass_active_until)}`
                : "Ready to activate"}
            </p>
          </div>
        </div>

        {/* ══ CONTENT GRID ═══════════════════════════════════════ */}
        <div className="pro-grid">

          {/* ── LEFT COL: Buddy Pass ──────────────────────────── */}
          <div className="pro-col-main">
            <section className="pro-panel glass" aria-label="Buddy Pass">
              <div className="pro-panel-head">
                <div>
                  <p className="pro-kicker">Referral Program</p>
                  <h2 className="pro-panel-title">Buddy Pass</h2>
                </div>
                <span className="pro-badge">Stackable</span>
              </div>

              <p className="pro-desc">
                Share your code, friends get 25% off any plan. You earn one free week per successful referral. Weeks never expire.
              </p>

              {/* Share card — code + link */}
              <div className="bp-share">
                <div className="bp-row">
                  <div className="bp-meta">
                    <span className="bp-lbl">Referral code</span>
                    <strong className="bp-code">
                      {buddyLoading ? "Loading…" : buddyPass.referralCode}
                    </strong>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyBuddyPass(buddyPass.referralCode, "code")}
                    className={`bp-copy${copyState === "code" ? " copied" : ""}`}
                  >
                    {copyState === "code" ? "✓ Copied" : "Copy code"}
                  </button>
                </div>
                <hr className="bp-sep" aria-hidden="true" />
                <div className="bp-row">
                  <span className="bp-url">
                    {buddyPass.referralUrl || "Loading share link…"}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyBuddyPass(buddyPass.referralUrl, "link")}
                    className={`bp-copy${copyState === "link" ? " copied" : ""}`}
                  >
                    {copyState === "link" ? "✓ Copied" : "Copy link"}
                  </button>
                </div>
              </div>

              {/* Activation toggle */}
              <div className={`bp-activate${buddyActive ? " is-on" : ""}`}>
                <div className="bp-activate-text">
                  <h3>{buddyActive ? "Buddy Week is running" : "Activate a stored week"}</h3>
                  <p>
                    {buddyActive
                      ? `Stays on until ${formatBuddyPassDate(buddyPass.activeUntil || profile?.buddy_pass_active_until)}. Cannot be paused.`
                      : buddyPass.weeksAvailable > 0
                        ? "Turn it on when you need a focused research sprint."
                        : "Refer a friend to earn your first free week."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={buddyActive}
                  aria-label={buddyActive ? "Buddy Week is active" : "Activate one Buddy Week"}
                  disabled={activationLoading || buddyActive || buddyPass.weeksAvailable <= 0}
                  onClick={activateBuddyWeek}
                  className={`bp-toggle${buddyActive ? " is-on" : ""}`}
                  title={buddyActive ? "Buddy Weeks cannot be paused once started." : "Start one stored Buddy Week."}
                >
                  <span />
                </button>
              </div>

              {buddyError && <p className="pro-error">{buddyError}</p>}

              {/* Stats pills */}
              <div className="bp-stats">
                <div className="bp-pill">
                  <strong>{buddyPass.successfulReferrals}</strong>
                  <span>referrals</span>
                </div>
                <div className="bp-pill">
                  <strong>{buddyPass.weeksEarned}</strong>
                  <span>earned</span>
                </div>
                <div className="bp-pill">
                  <strong>{buddyPass.weeksUsed}</strong>
                  <span>used</span>
                </div>
              </div>
            </section>
          </div>

          {/* ── RIGHT COL: Plan · Referrals · Settings ────────── */}
          <div className="pro-col-side">

            {/* Your plan */}
            <section className="pro-panel glass" aria-label="Plan features">
              <div className="pro-panel-head">
                <div>
                  <p className="pro-kicker">Access</p>
                  <h2 className="pro-panel-title">Your plan</h2>
                </div>
              </div>
              <div className="pro-features">
                {features.map(([name, included]) => (
                  <div key={name} className={`pro-feature${!included ? " locked" : ""}`}>
                    <span className="pro-feature-icon" aria-hidden="true">
                      {included ? "✓" : "·"}
                    </span>
                    <p className="pro-feature-name">{name}</p>
                  </div>
                ))}
              </div>
              {!isPaid && profile?.plan_type !== "lifetime" && (
                <button type="button" onClick={startSemesterCheckout} className="pro-upgrade">
                  Get Semester Access
                </button>
              )}
            </section>

            {/* Recent referrals */}
            <section className="pro-panel glass" aria-label="Referral history">
              <div className="pro-panel-head">
                <div>
                  <p className="pro-kicker">Referrals</p>
                  <h2 className="pro-panel-title">Recent rewards</h2>
                </div>
              </div>
              <div className="pro-referrals">
                {buddyPass.referrals.length > 0 ? (
                  buddyPass.referrals.map((r) => (
                    <div className="pro-referral-row" key={r.id}>
                      <div>
                        <p className="pro-referral-email">{r.friendEmail}</p>
                        <p className="pro-referral-date">{formatBuddyPassDate(r.createdAt)}</p>
                      </div>
                      <span className="pro-referral-reward">+{r.rewardWeeks}w</span>
                    </div>
                  ))
                ) : (
                  <div className="pro-referral-empty">
                    <strong>No referrals yet</strong>
                    <p>Your first reward appears here automatically after a friend checks out with your code.</p>
                  </div>
                )}
              </div>
            </section>

            {/* Account settings */}
            <section className="pro-panel glass" aria-label="Account settings">
              <div className="pro-panel-head">
                <div>
                  <p className="pro-kicker">Account</p>
                  <h2 className="pro-panel-title">Settings</h2>
                </div>
              </div>
              <div className="pro-actions">
                {resetRequested && (
                  <form onSubmit={updatePassword} style={{ padding: "14px 0" }}>
                    <label htmlFor="new-account-password" style={{ display: "block", fontSize: "0.84rem", fontWeight: 700, marginBottom: "8px" }}>
                      Choose a new password
                    </label>
                    <input
                      id="new-account-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      style={{ width: "100%", padding: "11px 13px", border: "1px solid rgba(101,153,131,.28)", borderRadius: "12px", font: "inherit", marginBottom: "9px" }}
                    />
                    <button type="submit" disabled={resetLoading} className="pro-upgrade" style={{ width: "100%" }}>
                      {resetLoading ? "Updating…" : "Update password"}
                    </button>
                  </form>
                )}
                {resetMessage && <p role="status" className={resetMessage === "Password updated." ? undefined : "pro-error"}>{resetMessage}</p>}
                <Link href="/feedback" className="pro-action">
                  Give feedback
                  <span className="pro-action-arrow" aria-hidden="true">→</span>
                </Link>

                {hasSubscription && (
                  <button
                    id="cancel-subscription-btn"
                    type="button"
                    disabled={cancelLoading}
                    onClick={cancelSubscription}
                    className="pro-action danger"
                  >
                    {cancelLoading ? "Canceling…" : "Cancel subscription"}
                    {!cancelLoading && <span className="pro-action-arrow" aria-hidden="true">→</span>}
                  </button>
                )}

                <button
                  type="button"
                  onClick={async () => { await signOut(); window.location.href = "/"; }}
                  className="pro-action danger"
                >
                  Sign out
                  <span className="pro-action-arrow" aria-hidden="true">→</span>
                </button>
              </div>
            </section>

          </div>
        </div>
      </div>
    </main>
  );
}
