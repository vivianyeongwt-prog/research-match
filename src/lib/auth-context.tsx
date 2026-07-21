"use client";
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "./supabase";
import type { User, AuthError } from "@supabase/supabase-js";
import { generateReferralCode } from "./buddy-pass";
import { track } from "./analytics";
import { apiFetch } from "./client-fetch";

// Free summaries allowed across a user's lifetime on the free tier. Shared
// between the anonymous (pre-account) and free-account states so creating an
// account can't reset the budget. Mirrors FREE_LIMIT / ANON_LIMIT in /api/summarize.
const FREE_SUMMARY_LIMIT = 2;

/** Free summaries this device already used while signed out. */
function readAnonSummariesUsed(): number {
  if (typeof window === "undefined") return 0;
  const stored = localStorage.getItem("rm-anon-summaries-used");
  if (stored !== null) return parseInt(stored, 10) || 0;
  // Legacy single-summary boolean flag.
  if (localStorage.getItem("hasViewedFreeSummary") === "true") return 1;
  return 0;
}

// Build the initial profiles row. Shared by signUp and the lazy-create path in
// fetchProfile, so the row shape can't drift between the two.
function newProfileRow(userId: string, email: string) {
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
  nextMonth.setHours(0, 0, 0, 0);
  // Carry over summaries already used while signed out, so the free tier is
  // FREE_SUMMARY_LIMIT total across anon + account (not both budgets).
  const carriedSummariesUsed = Math.min(readAnonSummariesUsed(), FREE_SUMMARY_LIMIT);
  return {
    id: userId,
    email,
    plan_type: "free",
    referral_code: generateReferralCode(userId),
    searches_used: 0,
    searches_reset_at: nextMonth.toISOString(),
    summaries_used: carriedSummariesUsed,
    summaries_reset_at: nextMonth.toISOString(),
  };
}

interface Profile {
  id: string;
  email: string;
  plan_type: "free" | "weekly" | "semester" | "student_monthly" | "student_annual" | "lifetime";
  plan_expires_at: string | null;
  searches_used: number;
  searches_reset_at: string;
  summaries_used: number;
  summaries_reset_at: string;
  referral_code: string | null;
  buddy_pass_weeks_available: number;
  buddy_pass_weeks_earned: number;
  buddy_pass_weeks_used: number;
  buddy_pass_active_until: string | null;
  framework_used: boolean;
  created_at: string;
  email_checker_grandfathered: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, promoCode?: string) => Promise<{
    error: AuthError | null;
    promoApplied: boolean;
    promoPending: boolean;
    confirmationRequired: boolean;
  }>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signUp: async () => ({
    error: null,
    promoApplied: false,
    promoPending: false,
    confirmationRequired: false,
  }),
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) {
      setProfile(data as Profile);
      return;
    }
    // No row. The signup insert can be lost (e.g. with email confirmation
    // enabled it runs before a session exists, so RLS rejects it as anon).
    // Create it now that we're authenticated, then re-read. A duplicate-key
    // failure from a racing tab is fine — the re-read picks up the winner's row.
    const { data: userData } = await supabase.auth.getUser();
    const authUser = userData?.user;
    if (!authUser || authUser.id !== userId || !authUser.email) return;
    await supabase.from("profiles").insert(newProfileRow(userId, authUser.email));
    const { data: created } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (created) setProfile(created as Profile);
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        const pendingPromo = localStorage.getItem("rm-pending-promo");
        if (pendingPromo && session.access_token) {
          // Email-confirmation signups do not receive a session immediately. Redeem
          // their pending code once confirmation produces a verified access token.
          void apiFetch("/api/promo", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ code: pendingPromo }),
          }).then(() => {
            localStorage.removeItem("rm-pending-promo");
            return fetchProfile(session.user.id);
          }).catch(() => undefined);
        }
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signUp = async (email: string, password: string, promoCode?: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (!error && data.user) {
      // Create profile row. If this insert is rejected (no session yet under
      // email confirmation), fetchProfile lazily creates the row on first
      // authenticated sign-in.
      await supabase.from("profiles").insert(newProfileRow(data.user.id, email));

      // Funnel: a free account was created (fires for every signup entry point).
      track("account_created");

      // Apply promo code if provided
      let promoApplied = false;
      let promoPending = false;
      if (promoCode?.trim()) {
        const normalizedPromo = promoCode.trim().toUpperCase();
        const token = data.session?.access_token;
        if (!token) {
          localStorage.setItem("rm-pending-promo", normalizedPromo);
          promoPending = true;
        } else {
          try {
            const res = await apiFetch("/api/promo", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ code: normalizedPromo }),
            });
            const promoData = await res.json();
            if (promoData.success) promoApplied = true;
          } catch { /* promo failed, user still gets a free account */ }
        }
      }

      await fetchProfile(data.user.id);
      return {
        error,
        promoApplied,
        promoPending,
        confirmationRequired: !data.session,
      };
    }
    return {
      error,
      promoApplied: false,
      promoPending: false,
      confirmationRequired: false,
    };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signUp, signIn, signOut: handleSignOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
