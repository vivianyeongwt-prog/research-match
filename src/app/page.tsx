"use client";
import { useState, useEffect, useRef, startTransition } from "react";
import Link from "next/link";
import { ResearchMatchLogo } from "@/components/ResearchMatchLogo";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { normalizeReferralCode } from "@/lib/buddy-pass";
import { isPlausibleEmail } from "@/lib/rate-limit";
import { apiFetch } from "@/lib/client-fetch";

const HERO_PLACEHOLDERS = [
  "e.g. machine learning",
  "e.g. neuroscience",
  "e.g. organic chemistry",
  "e.g. political science",
  "e.g. cardiology",
  "e.g. astrophysics",
  "e.g. behavioral economics",
];

const TESTIMONIALS = [
  { quote: "Just wanted to say thanks, like no joke. I got like 6 research internship opportunities now for this summer😭 (IU, Purdue, UIUC, UChicago).", author: "Jedrek N., College Student", avatar: "JN" },
  { quote: "I got a reply in 3 days. Never happened before.", author: "Undergraduate student", avatar: "U" },
  { quote: "I was skeptical at first, but after purchasing the semester plan, I was really impressed with what Research Match had to offer. It has been genuinely helpful as a student trying to get involved with research.", author: "Chetana R., College Student", avatar: "CR" },
  { quote: "Endorse this advice 💯. If an email smells of AI I will not answer it.", author: "Research Professor", avatar: "RP" },
  { quote: "First time I've gotten real advice on my emails. I've sent 10 emails so far using this.", author: "Student user", avatar: "S" },
  { quote: "This website is goated. I'm saving this for future use.", author: "Student user", avatar: "S" },
];

export default function LandingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [heroQuery, setHeroQuery] = useState("");
  const [heroUni, setHeroUni] = useState("");
  const [heroFocused, setHeroFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [, setBillingMounted] = useState(false);
  const [inlineWaitlistEmail, setInlineWaitlistEmail] = useState("");
  const [inlineWaitlistDone, setInlineWaitlistDone] = useState(false);
  const [inlineWaitlistLoading, setInlineWaitlistLoading] = useState(false);
  const [inlineWaitlistError, setInlineWaitlistError] = useState("");
  const [searchCount, setSearchCount] = useState<number | null>(null);
  const [activePricingIndex, setActivePricingIndex] = useState(0);
  const [activePricingTab, setActivePricingTab] = useState<string>("free");
  const [testimonialPaused, setTestimonialPaused] = useState(false);
  const [buddyPassOpen, setBuddyPassOpen] = useState(false);
  const [referralCode, setReferralCode] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const pricingOptions = ["free", "weekly", "semester", "lifetime"] as const;
  const paidPricingOptions = [
    { key: "weekly", label: "Weekly", detail: "$7", price: "$7", period: "1 week access", cta: "Start 1-Week Sprint for $7", badge: null },
    { key: "semester", label: "Semester", detail: "$29", price: "$29", period: "4 months access", cta: "Get Semester Access for $29", badge: "Best value" },
    { key: "lifetime", label: "Lifetime", detail: "$59", price: "$59", period: "Yours forever.", cta: "Get lifetime access for $59", badge: null },
  ] as const;
  const activePaidPlan =
    activePricingTab === "weekly" || activePricingTab === "semester" || activePricingTab === "lifetime"
      ? activePricingTab
      : "semester";
  const activePaidPlanIndex = paidPricingOptions.findIndex((plan) => plan.key === activePaidPlan);
  const paidToggleHighlightTransform =
    activePaidPlanIndex === 1
      ? "translateX(calc(100% + 6px))"
      : activePaidPlanIndex === 2
        ? "translateX(calc(200% + 12px))"
        : "translateX(0)";
  const paidPlan = paidPricingOptions[activePaidPlanIndex >= 0 ? activePaidPlanIndex : 1];
  const paidFeatures: { label: string; locked?: boolean }[] = [
    ...(activePaidPlan === "lifetime" ? [{ label: "Never pay again" }] : []),
    { label: "Unlimited professor searches" },
    { label: "Unlimited summaries" },
    { label: "Professor email finder" },
    { label: "Email checker" },
    { label: "Responsiveness scores" },
    { label: "Cold Email Playbook" },
  ];
  const buddyInputRef = useRef<HTMLInputElement | null>(null);

  const setPricingItem = (index: number) => {
    setActivePricingIndex(index);
    setActivePricingTab(pricingOptions[index]);
  };

  const toggleBuddyPass = () => {
    setBuddyPassOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        window.setTimeout(() => buddyInputRef.current?.focus(), 180);
      }
      return nextOpen;
    });
  };

  // Swipe handling
  const touchStart = useRef<number | null>(null);
  const touchEnd = useRef<number | null>(null);
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientX;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    touchEnd.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = () => {
    if (touchStart.current === null || touchEnd.current === null) return;
    const distance = touchStart.current - touchEnd.current;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && activePricingIndex < pricingOptions.length - 1) {
      setPricingItem(activePricingIndex + 1);
    }
    if (isRightSwipe && activePricingIndex > 0) {
      setPricingItem(activePricingIndex - 1);
    }
    touchStart.current = null;
    touchEnd.current = null;
  };

  const pauseTestimonials = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (!target.closest(".lp-quote-card")) return;
    setTestimonialPaused(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const resumeTestimonials = (e: React.PointerEvent<HTMLDivElement>) => {
    setTestimonialPaused(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  useEffect(() => { setBillingMounted(true); }, []);

  // First-visit sleeve animation gate
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!sessionStorage.getItem("rm-landing-seen")) {
      sessionStorage.setItem("rm-landing-seen", "1");
      setShouldAnimate(true);
    }
  }, []);
  useEffect(() => {
    apiFetch("/api/stats").then(async (r) => {
      if (!r.ok) return null;
      return r.json() as Promise<{ searches?: unknown }>;
    }).then(d => {
      if (!d || typeof d.searches !== "number" || !Number.isFinite(d.searches) || d.searches < 0) return;
      startTransition(() => setSearchCount(d.searches as number));
    }).catch(() => { });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      startTransition(() => setPlaceholderIdx((i) => (i + 1) % HERO_PLACEHOLDERS.length));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("lp-revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Pause the testimonial marquee when it scrolls off-screen or the tab is
  // hidden, so it stops compositing a transform forever (battery/heat).
  useEffect(() => {
    const section = document.querySelector(".lp-social-section");
    if (!section) return;
    const io = new IntersectionObserver(
      ([entry]) => section.classList.toggle("lp-offscreen", !entry.isIntersecting),
      { threshold: 0 }
    );
    io.observe(section);
    const onVis = () => document.body.classList.toggle("lp-tab-hidden", document.hidden);
    document.addEventListener("visibilitychange", onVis);
    onVis();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      document.body.classList.remove("lp-tab-hidden");
    };
  }, []);

  function heroSearch() {
    if (!heroQuery.trim()) return;
    const params = new URLSearchParams();
    params.set("q", heroQuery.trim());
    if (heroUni.trim()) params.set("u", heroUni.trim());
    router.push(`/app?${params.toString()}`);
  }

  async function handleCheckout(plan: "weekly" | "semester" | "lifetime") {
    const cleanReferralCode = normalizeReferralCode(referralCode);
    if (!user) {
      // Not logged in — send to app to sign up then upgrade
      const param = plan === "semester" ? "true" : plan;
      router.push(`/app?upgrade=${param}${cleanReferralCode ? `&buddy=${encodeURIComponent(cleanReferralCode)}` : ""}`);
      return;
    }
    setCheckoutLoading(plan);
    setCheckoutError("");
    try {
      const priceId =
        plan === "weekly"   ? process.env.NEXT_PUBLIC_STRIPE_PRICE_WEEKLY :
        plan === "semester" ? process.env.NEXT_PUBLIC_STRIPE_PRICE_SEMESTER :
                              process.env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME;
      if (!priceId) {
        setCheckoutError("Checkout is not configured for this plan.");
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Missing auth session");
      const res = await apiFetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ priceId, referralCode: cleanReferralCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutError(data.error || "Could not apply that Buddy Pass code.");
        setBuddyPassOpen(true);
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      router.push(`/app?upgrade=${plan === "semester" ? "true" : plan}${cleanReferralCode ? `&buddy=${encodeURIComponent(cleanReferralCode)}` : ""}`);
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function joinInlineWaitlist() {
    const email = inlineWaitlistEmail.trim();
    if (!email || inlineWaitlistLoading) return;
    // Same validator the /api/waitlist route enforces, so a client-accepted email
    // can't come back as a server 400 shown as a generic failure.
    if (!isPlausibleEmail(email)) {
      setInlineWaitlistError("Enter a valid email address.");
      return;
    }
    setInlineWaitlistError("");
    setInlineWaitlistLoading(true);
    try {
      const res = await apiFetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tier: "general" }),
      });
      if (!res.ok) throw new Error("Waitlist signup failed");
      setInlineWaitlistDone(true);
    } catch {
      setInlineWaitlistError("Something went wrong. Try again.");
    } finally {
      setInlineWaitlistLoading(false);
    }
  }

  return (
    <div className="lp-root" style={{ overflowX: 'hidden' }}>
      <style>{`
        /* ── Universal Enforcements ── */
        .lp-pricing-slider-viewport {
          width: 100% !important;
          position: relative !important;
        }
        .lp-pricing-slider-track {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: nowrap !important;
          width: 100% !important;
          transition: transform 0.5s cubic-bezier(0.2, 1.6, 0.4, 1) !important;
          will-change: transform !important;
          align-items: stretch !important;
        }
        .lp-pricing-slider-slide {
          flex: 0 0 100% !important;
          width: 100% !important;
          padding: 0 24px !important;
          box-sizing: border-box !important;
        }
        .lp-price-card {
          width: 100% !important;
          box-sizing: border-box !important;
        }
        
        .lp-pricing-tabs {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: nowrap !important;
        }
        .lp-pricing-tab {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          margin: 0 !important;
          padding: 0 !important;
          font-size: clamp(0.65rem, 2.8vw, 0.85rem) !important;
          flex: 1 1 0% !important;
        }
        .lp-pricing-tab.lp-pricing-tab-active {
          background: transparent !important;
          transform: none !important;
          border: none !important;
          box-shadow: none !important;
        }

        .lp-pricing-dots {
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          gap: 8px !important;
          margin-top: 28px !important;
          margin-bottom: 36px !important;
        }
        .lp-pricing-dot {
          width: 8px !important;
          height: 8px !important;
          border-radius: 999px !important;
          background: rgba(101, 153, 131, 0.18) !important;
          cursor: pointer !important;
          transition: all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
        }
        .lp-pricing-dot:hover {
          background: rgba(101, 153, 131, 0.35) !important;
        }
        .lp-pricing-dot.active {
          width: 28px !important;
          background: #659983 !important;
          box-shadow: 0 2px 8px rgba(101, 153, 131, 0.28) !important;
        }

        /* ── Mobile Layout (<= 900px) ── */
        @media (max-width: 900px) {
          .lp-pricing-slider-viewport {
            max-width: 500px !important;
            margin: 0 auto !important;
            overflow: hidden !important;
            padding-top: 24px !important;
            padding-bottom: 40px !important;
          }
        }

        /* ── Desktop Layout (> 900px) ── */
        @media (min-width: 901px) {
          #lp-pricing-slider-viewport {
            max-width: none !important;
            overflow: visible !important;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
          }
          #lp-pricing-slider-track {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 24px !important;
            transform: none !important;
            width: auto !important;
          }
          .lp-pricing-slider-slide {
            flex: none !important;
            width: auto !important;
            padding: 0 !important;
          }
          #lp-mobile-pricing-tabs {
            display: none !important;
          }
          #lp-mobile-pricing-dots {
            display: none !important;
          }
        }
      `}</style>


      {/* ── Animated background orbs ── */}

      {/* ── Floating pill nav ── */}
      <nav className="lp-nav">
        <div className="lp-nav-pill">
          <Link href="/" className="lp-nav-logo">
            <ResearchMatchLogo />
          </Link>
          <div className="lp-nav-spacer" />
          <div className="lp-nav-links">
            <Link href="/research" className="lp-nav-link">Research</Link>
            <Link href="/blog" className="lp-nav-link">Blog</Link>
            <a href="#pricing" className="lp-nav-link">Pricing</a>
            <Link href="/feedback" className="lp-nav-link">Feedback</Link>
          </div>
          <Link href="/app" className="lp-nav-cta px-3 py-1.5 text-xs md:text-sm md:px-4 md:py-2" onPointerUp={(e) => e.currentTarget.blur()}>
            Start free
            <span className="lp-nav-cta-arrow">→</span>
          </Link>
        </div>
      </nav>

      {/* ══════════════════════════════════════════
          HERO
      ══════════════════════════════════════════ */}
      <section className={`lp-hero${shouldAnimate ? " lp-hero-intro" : ""}`}>
        <div className="lp-hero-inner">
          <div className="lp-hero-eyebrow text-emerald-950/80 font-medium text-[10px] md:text-xs tracking-wider uppercase">
            <span className="lp-eyebrow-dot" />
            Trusted by students at Stanford, MIT, and beyond.
          </div>

          <h1 className="lp-hero-title text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
            Your research position is<br />
            <em className="lp-hero-title-em">one email away.</em>
          </h1>

          <p className="lp-hero-sub">
            Cold emails to professors get ignored. Yours won&apos;t.
          </p>

          {/* Hero search */}
          <div
            className={`lp-search-bar ${heroFocused ? "lp-search-focused" : ""}`}
          >
            <div className="lp-search-field">
              <label className="lp-search-label">Research Interest</label>
              <input
                type="text"
                value={heroQuery}
                onChange={(e) => setHeroQuery(e.target.value)}
                onFocus={() => setHeroFocused(true)}
                onBlur={() => setHeroFocused(false)}
                onKeyDown={(e) => e.key === "Enter" && heroSearch()}
                placeholder={HERO_PLACEHOLDERS[placeholderIdx]}
                className="lp-search-input"
              />
            </div>
            <div className="lp-search-divider" />
            <div className="lp-search-field" style={{ flex: "0.75" }}>
              <label className="lp-search-label">University</label>
              <input
                type="text"
                value={heroUni}
                onChange={(e) => setHeroUni(e.target.value)}
                onFocus={() => setHeroFocused(true)}
                onBlur={() => setHeroFocused(false)}
                onKeyDown={(e) => e.key === "Enter" && heroSearch()}
                placeholder="e.g. MIT, Stanford…"
                className="lp-search-input"
              />
            </div>
            <button onClick={heroSearch} className="lp-search-btn">
              <span>Search</span>
            </button>
          </div>

        </div>

        {/* Scroll cue */}
        <div className="lp-scroll-cue">
          <svg className="lp-scroll-chevron" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 9l6 6 6-6" stroke="#659983" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          DARK CALLOUT
      ══════════════════════════════════════════ */}
      <section className="lp-dark-callout" data-reveal>
        <div className="lp-dark-callout-inner">
          <p className="lp-dark-callout-eyebrow">The truth about cold emails</p>
          <h2 className="lp-dark-callout-title">
            Professors delete 90% of student emails<br />
            <span className="lp-dark-callout-em">before finishing the first line.</span>
          </h2>
          <div className="lp-dark-reasons">
            {[
              "Professors can spot AI-written emails instantly.",
              "Generic emails that could be sent to anyone get ignored.",
              "Name-dropping papers without understanding them backfires.",
            ].map((r, i) => (
              <div key={i} className="lp-dark-reason">
                <span className="lp-dark-reason-x">✕</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
          <Link href="/app" className="lp-dark-cta">
            Write one that gets read →
          </Link>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          SOCIAL PROOF STRIP
      ══════════════════════════════════════════ */}
      <div className="lp-proof-strip" data-reveal>
        {[
          { num: "250M+", label: "papers indexed" },
          { num: "1,000+", label: "universities" },
          { num: searchCount !== null ? searchCount.toLocaleString() : "-", label: "searches run" },
          { num: "< 24h", label: "first professor response" },
        ].map((s, i) => (
          <div key={i} className="lp-proof-item">
            <span className="lp-proof-num">{s.num}</span>
            <span className="lp-proof-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════
          WHY NOT CHATGPT
      ══════════════════════════════════════════ */}
      <section className="lp-chatgpt-section" style={{ background: "linear-gradient(to bottom, #ffffff, rgba(255,255,255,0))", padding: "100px 24px", margin: "0 0 20px 0", borderTop: "1px solid rgba(101, 153, 131,0.06)", borderBottom: "1px solid rgba(101, 153, 131,0.06)" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto" }} data-reveal>
          <h2 style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontSize: "clamp(1.8rem, 3vw, 2.4rem)", fontWeight: 700, color: "#2d5a47", textAlign: "center", marginBottom: "64px", letterSpacing: "-0.02em" }}>
            Why not just use ChatGPT?
          </h2>

          <div style={{ background: "#ffffff", borderRadius: "24px", padding: "40px 48px", boxShadow: "0 20px 60px rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.05)" }}>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0", marginBottom: "0", paddingBottom: "0" }} className="lp-vs-header">
              <div style={{ padding: "0 28px 20px 0", borderBottom: "2px solid #e5e7eb" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: "#9ca3af" }}>ChatGPT</span>
              </div>
              <div style={{ padding: "0 0 20px 28px", borderBottom: "2px solid #659983", borderLeft: "none" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: "#2d5a47" }}>Research Match</span>
              </div>
            </div>

            {/* Rows */}
            {[
              {
                bad: "Hallucinates professors, fake papers, and wrong citation counts.",
                good: "Every professor and paper is pulled from 250M+ verified academic works. All real.",
              },
              {
                bad: "Writes your email for you; professors delete those instantly.",
                good: "Gives you the research so you write the email yourself; that's why it gets replies.",
              },
              {
                bad: "Takes 20 back-and-forth prompts to find professors and read their work.",
                good: "One search; professors, summaries, and email checker all in front of you.",
              },
            ].map((row, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0" }} className="lp-vs-row">
                <div style={{ padding: "32px 28px 32px 0", borderBottom: i === 2 ? "none" : "1px solid #f3f4f6", display: "flex", gap: "16px", alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, marginTop: "3px", fontSize: "0.85rem", color: "#d1d5db", fontWeight: 700 }}>✕</span>
                  <p style={{ margin: 0, fontSize: "0.95rem", color: "#9ca3af", lineHeight: 1.7 }}>{row.bad}</p>
                </div>
                <div style={{ padding: "32px 0 32px 28px", borderBottom: i === 2 ? "none" : "1px solid rgba(101, 153, 131,0.08)", borderLeft: "1px solid rgba(101, 153, 131,0.08)", display: "flex", gap: "16px", alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, marginTop: "3px", fontSize: "0.85rem", color: "#2d5a47", fontWeight: 700 }}>✓</span>
                  <p style={{ margin: 0, fontSize: "0.95rem", color: "#1a1a1a", lineHeight: 1.7, fontWeight: 500 }}>{row.good}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FEATURES
      ══════════════════════════════════════════ */}
      <section className="lp-features-section px-4 sm:px-6 md:px-12 lg:px-24">
        <div className="lp-features-label" data-reveal>The Platform</div>

        {/* Feature 1 */}
        <div className="lp-feature" data-reveal>
          <div className="lp-feature-text">
            <div className="lp-feature-num">01</div>
            <h2 className="lp-feature-title text-2xl font-bold sm:text-3xl md:text-4xl">Search any research interest.</h2>
            <p className="lp-feature-desc text-sm leading-relaxed md:text-base">
              Type what you care about: quantum computing, cognitive neuroscience, climate policy.
              We surface the top professors publishing in that exact space, ranked by impact.
            </p>
            <Link href="/app" className="lp-feature-link">Try a search →</Link>
          </div>
          <div className="lp-feature-visual">
            <div className="lp-mockup">
              <div className="lp-mockup-bar">
                <div className="lp-dot" style={{ background: "#ff5f57" }} />
                <div className="lp-dot" style={{ background: "#febc2e" }} />
                <div className="lp-dot" style={{ background: "#28c840" }} />
                <span className="lp-mockup-url">researchmatch.site/app</span>
              </div>
              <div className="lp-mockup-body">
                <div className="lp-mock-search">
                  <span className="lp-mock-pill">neuroscience</span>
                  <span className="lp-mock-pill lp-mock-pill-uni">Harvard</span>
                </div>
                {[
                  { name: "Dr. Emily Nakamura", uni: "Harvard Medical School", topics: ["Memory", "fMRI"] },
                  { name: "Prof. James Miller", uni: "MIT", topics: ["Neural Circuits", "AI"] },
                  { name: "Dr. Aisha Patel", uni: "Stanford", topics: ["Computational", "BCI"] },
                ].map((p, i) => (
                  <div key={i} className="lp-mock-card" style={{ animationDelay: `${i * 0.12}s` }}>
                    <div className="lp-mock-card-name">{p.name}</div>
                    <div className="lp-mock-card-uni">{p.uni}</div>
                    <div className="lp-mock-card-tags">
                      {p.topics.map((t, j) => <span key={j} className="lp-mock-tag">{t}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Feature 2 — reversed */}
        <div className="lp-feature lp-feature-rev" data-reveal>
          <div className="lp-feature-text">
            <div className="lp-feature-num">02</div>
            <h2 className="lp-feature-title text-2xl font-bold sm:text-3xl md:text-4xl">Understand their research in plain English.</h2>
            <p className="lp-feature-desc text-sm leading-relaxed md:text-base">
              Every professor gets an AI summary of their key findings, written so a new researcher
              can understand it and use it in their email. No more pretending to read papers.
            </p>
            <Link href="/app" className="lp-feature-link">See an example →</Link>
          </div>
          <div className="lp-feature-visual">
            <div className="lp-mockup">
              <div className="lp-mockup-bar">
                <div className="lp-dot" style={{ background: "#ff5f57" }} />
                <div className="lp-dot" style={{ background: "#febc2e" }} />
                <div className="lp-dot" style={{ background: "#28c840" }} />
                <span className="lp-mockup-url">researchmatch.site/app</span>
              </div>
              <div className="lp-mockup-body" style={{ padding: 0 }}>
                <div
                  className="p-6 md:p-8 w-full mx-auto"
                  style={{ padding: "clamp(24px, calc(8px + 3vw), 32px)" }}
                >
                  <div className="lp-mock-summary-header">
                    <div className="lp-mock-summary-name">Dr. Emily Nakamura</div>
                    <span className="lp-mock-tag" style={{ fontSize: "0.6rem" }}>Harvard</span>
                  </div>
                  <p className="lp-mock-summary-text text-sm leading-relaxed md:text-base">
                    Studies how memories form and consolidate during sleep using fMRI.
                    Recent work shows neural oscillation patterns predict next-day recall accuracy
                    in elderly patients with early cognitive decline.
                  </p>
                  <div className="lp-mock-finding">
                    <div className="lp-mock-finding-label">Key Finding</div>
                    <p className="lp-mock-finding-text text-sm leading-relaxed md:text-base">
                      Theta oscillations during REM sleep increased memory consolidation by 34%.
                      Published 2024, first-author.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature 3 */}
        <div className="lp-feature" data-reveal>
          <div className="lp-feature-text">
            <div className="lp-feature-num">03</div>
            <h2 className="lp-feature-title text-2xl font-bold sm:text-3xl md:text-4xl">Write emails that get read.</h2>
            <p className="lp-feature-desc text-sm leading-relaxed md:text-base">
              Our email checker, built from real professor feedback, catches every mistake
              before you hit send. Generic tone, AI language, vague ask. Fixed before it costs you.
            </p>
            <Link href="/app" className="lp-feature-link">Check your email →</Link>
          </div>
          <div className="lp-feature-visual">
            <div className="lp-mockup">
              <div className="lp-mockup-bar">
                <div className="lp-dot" style={{ background: "#ff5f57" }} />
                <div className="lp-dot" style={{ background: "#febc2e" }} />
                <div className="lp-dot" style={{ background: "#28c840" }} />
                <span className="lp-mockup-url">researchmatch.site/app</span>
              </div>
              <div className="lp-mockup-body flex flex-col gap-6 md:flex-row md:gap-12" style={{ alignItems: "center", padding: "24px 20px" }}>
                <div className="lp-mock-email">
                  <div className="lp-mock-email-line">
                    <span className="lp-mock-strike">I found your work fascinating and groundbreaking.</span>
                  </div>
                  <div className="lp-mock-email-line" style={{ marginTop: "8px" }}>
                    <span className="lp-mock-good">I read your 2024 paper on theta oscillations. The 34% improvement in memory consolidation surprised me because...</span>
                  </div>
                </div>
                <div className="lp-mock-flags">
                  <div className="lp-mock-flag lp-mock-flag-bad">
                    <span>⚠</span>
                    <span>Sycophantic tone</span>
                    <span className="lp-mock-flag-action">Remove flattery</span>
                  </div>
                  <div className="lp-mock-flag lp-mock-flag-good">
                    <span>✓</span>
                    <span>Specific reference</span>
                    <span className="lp-mock-flag-action">Cites real data</span>
                  </div>
                  <div className="lp-mock-flag lp-mock-flag-good">
                    <span>✓</span>
                    <span>Original voice</span>
                    <span className="lp-mock-flag-action">No AI detected</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FOUNDER NOTE
      ══════════════════════════════════════════ */}
      <section className="lp-founder-section" data-reveal>
        <div className="lp-founder-inner">
          <div className="lp-founder-quote-mark">&ldquo;</div>
          <blockquote className="lp-founder-quote">
            Early in my research journey, I used this approach to cold email 5 professors.
            A Princeton astrophysics professor responded within 24 hours and said I was
            &lsquo;way ahead of the curve.&rsquo; That&apos;s why I built Research Match.
          </blockquote>
          <div className="lp-founder-sig">
            <div className="lp-founder-avatar">J</div>
            <div>
              <div className="lp-founder-name">Jace</div>
              <div className="lp-founder-role">Founder, Research Match</div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TESTIMONIALS (directly above pricing)
      ══════════════════════════════════════════ */}
      <section className="lp-social-section" data-reveal>
        <div className="lp-social-label">What users said</div>
        <div
          className={`lp-testimonial-viewport ${testimonialPaused ? "lp-testimonial-paused" : ""}`}
          aria-label="Student testimonials"
          onPointerDown={pauseTestimonials}
          onPointerUp={resumeTestimonials}
          onPointerCancel={resumeTestimonials}
          onPointerLeave={resumeTestimonials}
          onLostPointerCapture={resumeTestimonials}
        >
          <div className="lp-quotes-track">
            {[0, 1].map((setIndex) => (
              <div
                key={setIndex}
                className="lp-quotes-group"
                aria-hidden={setIndex === 1}
              >
                {TESTIMONIALS.map((item, i) => (
                  <article key={`${setIndex}-${i}`} className="lp-quote-card">
                    <div className="lp-quote-avatar" aria-hidden="true">{item.avatar}</div>
                    <div className="lp-quote-mark">&ldquo;</div>
                    <p className="lp-quote-text">{item.quote}</p>
                    <p className="lp-quote-author">{item.author}</p>
                  </article>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          PRICING
      ══════════════════════════════════════════ */}
      <section id="pricing" className="lp-pricing-section" data-reveal>
        <div className="lp-pricing-header">
          <h2 className="lp-pricing-title">Pick your plan.</h2>
          <p className="lp-pricing-guarantee">Cancel recurring plans from your profile.</p>
        </div>

        {/* Mobile: Tab toggle */}
        <div
          id="lp-mobile-pricing-tabs"
          className="lp-pricing-tabs"
          style={{
            display: 'flex',
            position: 'relative',
            justifyContent: 'center',
            alignItems: 'center',
            flexWrap: 'nowrap',
            background: 'rgba(101, 153, 131, 0.08)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(101, 153, 131, 0.1)',
            borderRadius: '100px',
            padding: '0',
            margin: '0 auto 40px',
            maxWidth: '440px',
            width: 'calc(100% - 40px)',
            overflow: 'hidden',
            height: '52px'
          }}
        >
          <div 
            className="lp-pricing-tabs-highlight" 
            style={{ 
              position: 'absolute',
              top: 0, bottom: 0, left: 0,
              width: `${100 / pricingOptions.length}%`,
              transform: `translateX(${activePricingIndex * 100}%)`,
              transition: 'transform 0.5s cubic-bezier(0.2, 1.6, 0.4, 1)',
              zIndex: 1,
              pointerEvents: 'none',
              padding: '4px',
              boxSizing: 'border-box'
            }} 
          >
            <div style={{
              width: '100%',
              height: '100%',
              background: '#659983',
              borderRadius: '100px',
              boxShadow: '0 4px 12px rgba(101, 153, 131, 0.3)'
            }} />
          </div>
          {pricingOptions.map((tab, idx) => (
            <button
              key={tab}
              className={`lp-pricing-tab${activePricingTab === tab ? " lp-pricing-tab-active" : ""}`}
              onClick={() => setPricingItem(idx)}
              style={{
                flex: '1',
                position: 'relative',
                zIndex: 2,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                color: activePricingTab === tab ? '#ffffff' : '#4b5563',
                fontWeight: '700',
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'color 0.4s ease',
                WebkitTapHighlightColor: 'transparent',
                margin: 0,
                boxShadow: 'none'
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Desktop: two-card comparison */}
        <div className="lp-pricing-desktop-duo" data-reveal>
          <div className="lp-price-card lp-price-card-free lp-price-card-duo-free">
            <div className="lp-duo-card-head">
              <div className="lp-duo-card-meta">
                <div className="lp-price-tier">Free</div>
              </div>
              <div className="lp-price-amount">$0</div>
              <div className="lp-price-period">forever</div>
            </div>
            <ul className="lp-price-features lp-price-features-duo">
              {[
                "Unlimited professor searches",
                "2 professor summaries",
                "1 email check",
                "Blurred email finder + responsiveness",
              ].map((f) => (
                <li key={f}><span className="lp-check">✓</span>{f}</li>
              ))}
            </ul>
            <Link href="/app" className="lp-price-btn lp-price-btn-ghost">
              Start free
            </Link>
          </div>

          <div className="lp-price-card lp-price-card-paid">
            <div className="lp-duo-card-head">
              <div className="lp-duo-card-meta">
                <div className="lp-price-tier">Paid</div>
                <div className="lp-paid-toggle" role="tablist" aria-label="Choose a paid plan">
                  <span
                    className="lp-paid-toggle-highlight"
                    aria-hidden="true"
                    style={{ transform: paidToggleHighlightTransform }}
                  />
                  {paidPricingOptions.map((plan) => (
                    <button
                      key={plan.key}
                      type="button"
                      role="tab"
                      aria-selected={activePaidPlan === plan.key}
                      className={`lp-paid-toggle-option${activePaidPlan === plan.key ? " lp-paid-toggle-option-active" : ""}`}
                      onClick={() => setPricingItem(pricingOptions.indexOf(plan.key))}
                    >
                      <span>{plan.label}</span>
                      <small>{plan.detail}</small>
                      {plan.badge ? <em>{plan.badge}</em> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="lp-paid-price-row">
                <div>
                  <div className="lp-price-amount" style={{ color: "#2d5a47" }}>{paidPlan.price}</div>
                  <div className="lp-price-period" style={{ opacity: 0.7 }}>{paidPlan.period}</div>
                </div>
                <p className="lp-paid-promise">Everything you need to find, judge, and contact professors without getting stuck.</p>
              </div>
            </div>
            <ul className="lp-price-features lp-price-features-duo lp-paid-feature-grid">
              {paidFeatures.map((f) => (
                <li key={f.label} className={f.locked ? "lp-feature-locked" : ""}>
                  <span className="lp-check">{f.locked ? "✗" : "✓"}</span>
                  {f.locked ? (
                    <span style={{ textDecoration: "line-through" }}>{f.label}</span>
                  ) : f.label}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleCheckout(activePaidPlan)}
              disabled={checkoutLoading === activePaidPlan}
              className="lp-price-btn"
              style={{ background: "rgba(101, 153, 131, 0.08)", color: "#2d5a47", border: "1px solid rgba(101, 153, 131, 0.2)", cursor: "pointer", width: "100%" }}
            >
              {checkoutLoading === activePaidPlan ? "Loading…" : paidPlan.cta}
            </button>
          </div>
        </div>

        {/* Mobile: single active card */}
        <div id="lp-pricing-slider-viewport" className="lp-pricing-slider-viewport" data-reveal>
          <div 
            id="lp-pricing-slider-track"
            className="lp-pricing-slider-track"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{ 
              transform: `translateX(-${activePricingIndex * 100}%)`,
            }}
          >
            {/* Free */}
            <div className="lp-pricing-slider-slide">
              <div className="lp-price-card lp-price-card-free">
                <div className="lp-price-tier">Free</div>
                <div className="lp-price-amount">$0</div>
                <div className="lp-price-period">forever</div>
                <ul className="lp-price-features">
                  {[
                    "Unlimited professor searches",
                    "2 professor summaries",
                    "1 email check",
                    "Blurred email finder + responsiveness",
                  ].map((f) => (
                    <li key={f}><span className="lp-check">✓</span>{f}</li>
                  ))}
                </ul>
                <Link href="/app" className="lp-price-btn lp-price-btn-ghost">
                  Start free
                </Link>
              </div>
            </div>

            {/* Weekly Sprint */}
            <div className="lp-pricing-slider-slide">
              <div className="lp-price-card">
                <div className="lp-price-tier">Weekly Sprint</div>
                <div className="lp-price-amount" style={{ color: "#2d5a47" }}>$7</div>
                <div className="lp-price-period" style={{ opacity: 0.7 }}>1 week access</div>
                <ul className="lp-price-features">
                  <li style={{ fontWeight: 700 }}><span className="lp-check">✓</span>Finish the outreach job:</li>
                  {[
                    "Unlimited professor searches",
                    "Unlimited summaries",
                    "Professor email finder",
                    "Email checker",
                    "Responsiveness scores",
                    "Cold Email Playbook",
                  ].map((f) => (
                    <li key={f}><span className="lp-check">✓</span>{f}</li>
                  ))}
                </ul>
                <button
                  onClick={() => handleCheckout("weekly")}
                  disabled={checkoutLoading === "weekly"}
                  className="lp-price-btn"
                  style={{ background: "rgba(101, 153, 131, 0.08)", color: "#2d5a47", border: "1px solid rgba(101, 153, 131, 0.2)", cursor: "pointer", width: "100%" }}
                >
                  {checkoutLoading === "weekly" ? "Loading…" : "Start 1-Week Sprint for $7"}
                </button>
              </div>
            </div>

            {/* Semester */}
            <div className="lp-pricing-slider-slide">
              <div className="lp-price-card lp-price-card-best">
                <div className="lp-best-value-badge">Best Value</div>
                <div className="lp-price-tier">Semester</div>
                <div className="lp-price-amount" style={{ color: "#2d5a47" }}>$29</div>
                <div className="lp-price-period" style={{ opacity: 0.7 }}>4 months access</div>
                <ul className="lp-price-features">
                  <li style={{ fontWeight: 700 }}><span className="lp-check">✓</span>Finish the outreach job:</li>
                  {[
                    "Unlimited professor searches",
                    "Unlimited summaries",
                    "Professor email finder",
                    "Email checker",
                    "Responsiveness scores",
                    "Cold Email Playbook",
                  ].map((f) => (
                    <li key={f}><span className="lp-check">✓</span>{f}</li>
                  ))}
                </ul>
                <button
                  onClick={() => handleCheckout("semester")}
                  disabled={checkoutLoading === "semester"}
                  className="lp-price-btn"
                  style={{ background: "rgba(101, 153, 131, 0.08)", color: "#2d5a47", border: "1px solid rgba(101, 153, 131, 0.2)", cursor: "pointer", width: "100%" }}
                >
                  {checkoutLoading === "semester" ? "Loading…" : "Get Semester Access for $29"}
                </button>
              </div>
            </div>

            {/* Lifetime */}
            <div className="lp-pricing-slider-slide">
              <div className="lp-price-card lp-price-card-lifetime lp-price-card-lifetime-hero">
                <div className="lp-price-tier">Lifetime</div>
                <div className="lp-price-amount" style={{ color: "#2d5a47" }}>$59</div>
                <div className="lp-price-period" style={{ opacity: 0.7 }}>Yours forever.</div>
                <ul className="lp-price-features">
                  <li style={{ fontWeight: 700 }}><span className="lp-check">✓</span>Everything in Semester, plus:</li>
                  {[
                    "Never pay again",
                    "Unlimited professor searches",
                    "Unlimited summaries",
                    "Professor email finder",
                    "Email checker",
                    "Responsiveness scores",
                    "Cold Email Playbook",
                  ].map((f) => (
                    <li key={f}><span className="lp-check">✓</span>{f}</li>
                  ))}
                </ul>
                <button
                  onClick={() => handleCheckout("lifetime")}
                  disabled={checkoutLoading === "lifetime"}
                  className="lp-price-btn"
                  style={{ background: "rgba(101, 153, 131, 0.08)", color: "#2d5a47", border: "1px solid rgba(101, 153, 131, 0.2)", cursor: "pointer", width: "100%" }}
                >
                  {checkoutLoading === "lifetime" ? "Loading…" : "Get lifetime access for $59"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Dot Indicators */}
        <div id="lp-mobile-pricing-dots" className="lp-pricing-dots">
          {pricingOptions.map((_, idx) => (
            <div 
              key={idx} 
              className={`lp-pricing-dot ${activePricingIndex === idx ? 'active' : ''}`}
              onClick={() => setPricingItem(idx)}
            />
          ))}
        </div>

        <div
          style={{
            width: "min(440px, calc(100% - 40px))",
            margin: "30px auto 28px",
            borderRadius: "20px",
            background: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(101, 153, 131,0.10)",
            boxShadow: "0 10px 32px rgba(101, 153, 131,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            overflow: "hidden",
            transition: "all 420ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <button
            type="button"
            aria-expanded={buddyPassOpen}
            onClick={toggleBuddyPass}
            style={{
              width: "100%",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              transition: "all 300ms ease",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ textAlign: "left" }}>
              <span style={{ display: "block", fontSize: "0.95rem", fontWeight: 700, color: "#1a2e26", letterSpacing: "-0.01em" }}>Have a referral code?</span>
              <span style={{ display: "block", fontSize: "0.82rem", color: "#6b7280", marginTop: "2px" }}>Enter it here and you both get a reward</span>
            </span>
            <span
              aria-hidden="true"
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "999px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background: "rgba(101, 153, 131,0.08)",
                color: "#2d5a47",
                fontSize: "1.1rem",
                transform: buddyPassOpen ? "rotate(45deg)" : "rotate(0deg)",
                transition: "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              +
            </span>
          </button>
          <div
            style={{
              maxHeight: buddyPassOpen ? "116px" : "0px",
              opacity: buddyPassOpen ? 1 : 0,
              transform: buddyPassOpen ? "translateY(0)" : "translateY(-8px)",
              transition: "max-height 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms ease, transform 360ms cubic-bezier(0.22, 1, 0.36, 1)",
              padding: buddyPassOpen ? "0 12px 12px" : "0 12px",
            }}
          >
            <input
              ref={buddyInputRef}
              value={referralCode}
              onChange={(e) => { setReferralCode(normalizeReferralCode(e.target.value)); setCheckoutError(""); }}
              placeholder="Enter friend code"
              aria-label="Research Buddy Pass code"
              style={{
                width: "100%",
                minWidth: 0,
                border: "1px solid rgba(101, 153, 131,0.12)",
                outline: "none",
                background: "rgba(255,255,255,0.68)",
                color: "#1f3f32",
                fontSize: "0.92rem",
                fontWeight: 750,
                fontFamily: "inherit",
                padding: "13px 14px",
                borderRadius: "15px",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.68)",
                transition: "border-color 240ms ease, box-shadow 240ms ease, background 240ms ease",
              }}
            />
            {checkoutError && (
              <p style={{
                color: "#9a4343",
                background: "rgba(196,92,92,0.08)",
                border: "1px solid rgba(196,92,92,0.14)",
                borderRadius: "12px",
                fontSize: "0.78rem",
                fontWeight: 650,
                margin: "10px 2px 0",
                padding: "9px 11px",
                textAlign: "center",
              }}>
                {checkoutError}
              </p>
            )}
          </div>
        </div>

        {/* Global Bonus Strip (Moved out of cards for a cleaner UI) */}
        <div style={{ maxWidth: "800px", margin: "40px auto 30px", padding: "20px 24px", background: "rgba(101, 153, 131, 0.03)", borderRadius: "16px", border: "1px solid rgba(101, 153, 131, 0.1)", textAlign: "center" }} data-reveal>
          <p style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#2d5a47", marginBottom: "8px" }}>🎁 Included with Paid Plans</p>
          <p style={{ fontSize: "1.05rem", color: "#1a1a1a", fontWeight: 500, margin: 0 }}>
            The <strong>Cold Email Playbook</strong>: Annotated winning emails, a proven paragraph template, and the follow-up guide.
          </p>
        </div>

        {/* Inline waitlist */}
        <div className="lp-waitlist" data-reveal>
          <p className="lp-waitlist-text">Guaranteed response plan coming soon, join the waitlist</p>
          {inlineWaitlistDone ? (
            <p style={{ color: "#2d5a47", fontWeight: 600 }}>You&apos;re on the list.</p>
          ) : (
            <>
              <div className="lp-waitlist-form">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={inlineWaitlistEmail}
                  onChange={(e) => { setInlineWaitlistEmail(e.target.value); setInlineWaitlistError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && joinInlineWaitlist()}
                  className="lp-waitlist-input"
                />
                <button onClick={joinInlineWaitlist} disabled={inlineWaitlistLoading} style={{ padding: "14px 28px", fontSize: "0.9rem", fontWeight: 700, fontFamily: "var(--font-inter), sans-serif", background: "#659983", color: "#fff", border: "none", borderRadius: "999px", cursor: inlineWaitlistLoading ? "wait" : "pointer", opacity: inlineWaitlistLoading ? 0.75 : 1, whiteSpace: "nowrap", transition: "all 0.2s ease", boxShadow: "0 4px 16px rgba(101, 153, 131,0.25)" }}>
                  {inlineWaitlistLoading ? "Joining…" : "Join waitlist"}
                </button>
              </div>
              {inlineWaitlistError && (
                <p style={{ color: "#9a4343", fontSize: "0.82rem", fontWeight: 600, marginTop: "10px" }}>
                  {inlineWaitlistError}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FINAL CTA
      ══════════════════════════════════════════ */}
      <section className="lp-final-cta" data-reveal>
        <div className="lp-final-cta-inner">
          <div className="lp-final-cta-eyebrow">Ready?</div>
          <h2 className="lp-final-cta-title">
            Your research position<br />is one email away.
          </h2>
          <p className="lp-final-cta-sub">
            Start searching free. No credit card required.
          </p>
          <div className="lp-final-cta-actions">
            <Link href="/app" className="lp-final-btn">
              Start searching free
              <span className="lp-final-btn-arrow">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-logo">
            <svg width="26" height="26" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ verticalAlign: "-6px", marginRight: "5px" }}>
              <path d="M50 84 C30 78 22 60 24 38 C36 42 46 52 50 70" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M50 84 C70 78 78 60 76 38 C64 42 54 52 50 70" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="50" cy="32" r="9.5" fill="#c9ad77" />
            </svg>Research Match
          </div>
          <div className="lp-footer-links">
            <Link href="/app">Tool</Link>
            <Link href="/research">Research</Link>
            <Link href="/examples">Examples</Link>
            <Link href="/blog">Blog</Link>
            <a href="#pricing">Pricing</a>
            <Link href="/feedback">Feedback</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
          <div className="lp-footer-copy">
            Built for the student who reaches out.
          </div>
        </div>
      </footer>
    </div>
  );
}
