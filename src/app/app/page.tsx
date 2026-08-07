"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Suspense, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import confetti from "canvas-confetti";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { hasPaidAccess, isReferralCode, normalizeReferralCode, planLabelFor } from "@/lib/buddy-pass";
import { track } from "@/lib/analytics";
import { looksLikePersonName } from "@/lib/author-normalize";
import { useMobile } from "@/lib/use-mobile";
import { signupSuccessMessage } from "@/lib/auth-copy";
import { apiFetch } from "@/lib/client-fetch";
import {
  ANON_SUMMARY_LIMIT,
  MAX_CITATIONS,
  MAX_PAPERS,
  PLACEHOLDER_EXAMPLES,
  PROFESSORS_PER_PAGE,
  RateLimitError,
  THROTTLE_MSG,
  dedupeAuthors,
  formatCitations,
  formatInstitutionLocation,
  homeInstitutionFirst,
  isThrottle,
  lookupAuthorsByIds,
  lookupAuthorsByName,
  oaFetch,
  promoteMatchedInstitution,
  topicRelevanceRank,
  type Author,
  type EmailFlag,
  type OpenAlexInstitutionRef,
  type OpenAlexWork,
  type SummaryData,
} from "@/lib/research-match-domain";
import {
  STORAGE_KEYS,
  emailCheckStorageKey,
  readAnonSummariesUsed,
  readPendingReferralCode,
  readSavedProfessors,
  storePendingReferralCode,
} from "@/lib/browser-storage";
import {
  ResearchSearchForm,
  SearchModeToggle,
  type SearchMode,
} from "@/components/ResearchSearchForm";
import { ResearchAppNav } from "@/components/ResearchAppNav";
import { AccountModal, type AuthMode } from "@/components/AccountModal";
import { UpgradeModal, type CheckoutPlan } from "@/components/UpgradeModal";
import { EmailComposerModal } from "@/components/EmailComposerModal";

export default function AppPageWrapper() {
  return <Suspense><AppPageInner /></Suspense>;
}

const RESEARCH_SUGGESTIONS = [
  // Physical Sciences — Astronomy & Astrophysics
  "Astronomy", "Astrophysics", "Cosmology", "Gravitational Physics", "Planetary Science",
  "Radio Astronomy", "Solar Physics", "Space Physics", "Stellar Astrophysics",
  "Exoplanets", "Black Holes", "Dark Matter", "Dark Energy", "Galactic Astronomy",
  // Physical Sciences — Physics
  "Acoustics", "Applied Physics", "Atomic Physics", "Biophysics", "Classical Mechanics",
  "Computational Physics", "Condensed Matter Physics", "Fluid Dynamics",
  "High Energy Physics", "Mathematical Physics", "Nuclear Physics", "Optics",
  "Particle Physics", "Photonics", "Plasma Physics", "Quantum Information",
  "Quantum Mechanics", "Quantum Optics", "Quantum Physics", "Semiconductors",
  "Statistical Mechanics", "Thermodynamics",
  // Physical Sciences — Chemistry
  "Analytical Chemistry", "Astrochemistry", "Atmospheric Chemistry",
  "Catalysis", "Chemical Biology", "Computational Chemistry", "Electrochemistry",
  "Environmental Chemistry", "Food Chemistry", "Geochemistry", "Green Chemistry",
  "Inorganic Chemistry", "Materials Chemistry", "Medicinal Chemistry",
  "Nuclear Chemistry", "Organic Chemistry", "Organometallic Chemistry",
  "Photochemistry", "Physical Chemistry", "Polymer Chemistry", "Supramolecular Chemistry",
  "Surface Chemistry", "Theoretical Chemistry",
  // Physical Sciences — Materials Science
  "Biomaterials", "Ceramics", "Composite Materials", "Electronic Materials",
  "Metamaterials", "Nanomaterials", "Nanoscience", "Nanotechnology",
  "Polymers", "Semiconductor Materials", "Smart Materials", "Soft Matter",
  "Thin Films", "Two-Dimensional Materials",
  // Physical Sciences — Mathematics
  "Algebra", "Algebraic Geometry", "Algebraic Topology", "Analysis",
  "Applied Mathematics", "Category Theory", "Combinatorics", "Complex Analysis",
  "Computational Mathematics", "Differential Equations", "Differential Geometry",
  "Discrete Mathematics", "Dynamical Systems", "Functional Analysis",
  "Game Theory", "Geometry", "Graph Theory", "Logic", "Mathematics",
  "Number Theory", "Numerical Analysis", "Operations Research",
  "Optimization", "Probability Theory", "Real Analysis", "Set Theory",
  "Statistics", "Stochastic Processes", "Topology",
  // Physical Sciences — Computer Science
  "Algorithms", "Artificial Intelligence", "Augmented Reality",
  "Bioinformatics", "Blockchain", "Cloud Computing", "Computer Architecture",
  "Computer Engineering", "Computer Graphics", "Computer Networks",
  "Computer Science", "Computer Security", "Computer Vision", "Cryptography",
  "Cybersecurity", "Data Mining", "Data Science", "Database Systems",
  "Deep Learning", "Distributed Computing", "Edge Computing",
  "Formal Methods", "Human-Computer Interaction", "Information Retrieval",
  "Information Theory", "Internet of Things", "Machine Learning",
  "Natural Language Processing", "Operating Systems", "Parallel Computing",
  "Privacy", "Programming Languages", "Quantum Computing",
  "Reinforcement Learning", "Robotics", "Software Engineering",
  "Speech Recognition", "Systems Biology", "Theoretical Computer Science",
  "Virtual Reality", "Visualization",
  // Physical Sciences — Engineering
  "Aerospace Engineering", "Biomedical Engineering", "Chemical Engineering",
  "Civil Engineering", "Control Engineering", "Control Systems",
  "Electrical Engineering", "Environmental Engineering",
  "Geotechnical Engineering", "Industrial Engineering",
  "Manufacturing Engineering", "Mechanical Engineering",
  "Mechatronics", "Nuclear Engineering", "Petroleum Engineering",
  "Power Systems", "Process Engineering", "Signal Processing",
  "Structural Engineering", "Systems Engineering",
  "Transportation Engineering", "VLSI Design", "Wireless Communications",
  // Physical Sciences — Earth & Planetary Sciences
  "Atmospheric Science", "Climate Science", "Earth Science",
  "Economic Geology", "Geodesy", "Geography", "Geology",
  "Geomorphology", "Geophysics", "Glaciology", "Hydrology",
  "Mineralogy", "Oceanography", "Paleoclimatology", "Paleontology",
  "Petrology", "Seismology", "Soil Science", "Volcanology",
  // Physical Sciences — Energy
  "Battery Technology", "Bioenergy", "Energy Engineering",
  "Energy Policy", "Energy Storage", "Fuel Cells",
  "Nuclear Energy", "Renewable Energy", "Solar Energy",
  "Thermoelectrics", "Wind Energy",
  // Physical Sciences — Environmental Science
  "Air Quality", "Biodiversity", "Climate Change", "Conservation Biology",
  "Ecology", "Ecotoxicology", "Environmental Policy", "Environmental Science",
  "Forest Ecology", "GIS", "Landscape Ecology", "Marine Conservation",
  "Pollution", "Remote Sensing", "Sustainability", "Waste Management",
  "Water Quality",
  // Life Sciences — Agricultural & Biological Sciences
  "Agricultural Economics", "Agricultural Engineering", "Agricultural Science",
  "Agronomy", "Animal Behavior", "Animal Breeding", "Animal Science",
  "Aquaculture", "Botany", "Crop Science", "Entomology",
  "Evolutionary Biology", "Food Science", "Food Safety",
  "Forestry", "Horticulture", "Limnology", "Marine Biology",
  "Mycology", "Ornithology", "Plant Biology", "Plant Breeding",
  "Plant Ecology", "Plant Pathology", "Plant Science",
  "Soil Biology", "Veterinary Science", "Wildlife Biology", "Zoology",
  // Life Sciences — Biochemistry, Genetics & Molecular Biology
  "Biochemistry", "Biotechnology", "Cell Biology",
  "Cell Signaling", "Chemical Biology", "Chromatin Biology",
  "Computational Biology", "Developmental Biology", "Epigenetics",
  "Evolutionary Genetics", "Gene Editing", "Gene Expression",
  "Gene Therapy", "Genetics", "Genomics", "Metabolomics",
  "Molecular Biology", "Molecular Genetics", "Plant Genetics",
  "Population Genetics", "Proteomics", "RNA Biology",
  "Single Cell Biology", "Stem Cell Biology", "Structural Biology",
  "Synthetic Biology", "Systems Biology",
  // Life Sciences — Immunology & Microbiology
  "Bacteriology", "Clinical Microbiology", "Immunology",
  "Medical Microbiology", "Microbiology", "Microbiome",
  "Mycology", "Parasitology", "Virology",
  // Life Sciences — Neuroscience
  "Behavioral Neuroscience", "Clinical Neuroscience",
  "Cognitive Neuroscience", "Computational Neuroscience",
  "Developmental Neuroscience", "Molecular Neuroscience",
  "Neural Engineering", "Neurochemistry", "Neuroimaging",
  "Neurology", "Neurophysiology", "Neuroscience",
  "Psychophysics", "Systems Neuroscience",
  // Life Sciences — Pharmacology & Toxicology
  "Clinical Pharmacology", "Drug Delivery", "Drug Design",
  "Drug Discovery", "Pharmacokinetics", "Pharmacology",
  "Pharmacy", "Toxicology",
  // Social Sciences — Arts & Humanities
  "African American Studies", "Anthropology", "Archaeology",
  "Art History", "Asian Studies", "Classical Studies",
  "Classics", "Comparative Literature", "Cultural Anthropology",
  "Cultural Studies", "Digital Humanities", "Ethics",
  "Film Studies", "Gender Studies", "History",
  "Indigenous Studies", "Language and Linguistics", "Latin American Studies",
  "Literary Theory", "Media Studies", "Medieval Studies",
  "Music Theory", "Philosophy", "Religious Studies",
  "Rhetoric", "Theater Studies", "Visual Arts",
  // Social Sciences — Business, Management & Accounting
  "Accounting", "Business Analytics", "Business Ethics",
  "Corporate Finance", "Entrepreneurship", "Finance",
  "Human Resource Management", "Innovation Management",
  "International Business", "Logistics", "Management",
  "Marketing", "Nonprofit Management", "Operations Management",
  "Organizational Behavior", "Risk Management",
  "Strategic Management", "Supply Chain Management",
  // Social Sciences — Decision Sciences & Economics
  "Behavioral Economics", "Decision Theory", "Development Economics",
  "Econometrics", "Economic History", "Economic Theory",
  "Economics", "Financial Economics", "Health Economics",
  "Industrial Organization", "International Economics",
  "Labor Economics", "Macroeconomics", "Microeconomics",
  "Political Economy", "Public Economics", "Urban Economics",
  // Social Sciences — Psychology
  "Behavioral Psychology", "Child Psychology", "Clinical Psychology",
  "Cognitive Psychology", "Community Psychology", "Counseling Psychology",
  "Developmental Psychology", "Educational Psychology",
  "Environmental Psychology", "Experimental Psychology",
  "Forensic Psychology", "Health Psychology",
  "Neuropsychology", "Organizational Psychology",
  "Personality Psychology", "Positive Psychology",
  "Psycholinguistics", "Psychology", "School Psychology",
  "Social Psychology", "Sports Psychology",
  // Social Sciences — Social Sciences & Law
  "Communication Studies", "Criminology", "Demography",
  "Geography", "Human Geography", "International Relations",
  "Law", "Constitutional Law", "Criminal Law", "Environmental Law",
  "Family Law", "Health Law", "Intellectual Property",
  "International Law", "Labor Law", "Legal Theory",
  "Library Science", "Political Science", "Public Administration",
  "Public Policy", "Science Policy", "Social Work",
  "Sociology", "Urban Planning", "Women's Studies",
  // Health Sciences — Medicine
  "Addiction Medicine", "Allergy and Immunology", "Anesthesiology",
  "Cardiology", "Cardiovascular Medicine", "Clinical Medicine",
  "Clinical Trials", "Critical Care", "Dermatology",
  "Emergency Medicine", "Endocrinology", "Epidemiology",
  "Family Medicine", "Gastroenterology", "General Surgery",
  "Geriatrics", "Global Health", "Hematology",
  "Hospital Medicine", "Infectious Disease", "Internal Medicine",
  "Medical Genetics", "Medical Imaging", "Medical Oncology",
  "Mental Health", "Nephrology", "Neurosurgery",
  "Obstetrics and Gynecology", "Oncology", "Ophthalmology",
  "Orthopedics", "Otolaryngology", "Palliative Care",
  "Pathology", "Pediatrics", "Physical Medicine",
  "Plastic Surgery", "Preventive Medicine", "Primary Care",
  "Psychiatry", "Public Health", "Pulmonology",
  "Radiation Oncology", "Radiology", "Reproductive Medicine",
  "Rheumatology", "Sleep Medicine", "Sports Medicine",
  "Surgery", "Transplantation", "Urology", "Vascular Surgery",
  // Health Sciences — Nursing & Health Professions
  "Community Health", "Community Health Nursing",
  "Critical Care Nursing", "Dental Public Health",
  "Dentistry", "Dietetics", "Emergency Nursing",
  "Geriatric Nursing", "Health Informatics", "Health Policy",
  "Health Professions", "Health Services Research",
  "Kinesiology", "Midwifery", "Nursing",
  "Nutrition Science", "Occupational Therapy",
  "Oral Health", "Orthodontics", "Pediatric Dentistry",
  "Pediatric Nursing", "Pharmacy", "Physical Therapy",
  "Public Health Nutrition", "Radiography",
  "Respiratory Therapy", "Speech Pathology",
  // Interdisciplinary
  "Astrobiology", "Bioethics", "Cognitive Science",
  "Computational Social Science", "Digital Health",
  "Environmental Justice", "Global Studies", "Health Equity",
  "Human Factors", "Medical Anthropology", "Medical Ethics",
  "Neuroeconomics", "Science Communication",
  "Science and Technology Studies", "Social Epidemiology",
].sort();

function AppPageInner() {
  const { user, profile, loading: authLoading2, signUp, signIn, signOut, refreshProfile } = useAuth();
  const searchParams = useSearchParams();
  const [searchMode, setSearchMode] = useState<SearchMode>("interest");
  // Mobile: the full search form collapses into a one-line pill once there are
  // results; tapping the pill reopens it. Desktop ignores this entirely.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const isMobile = useMobile();
  const [query, setQuery] = useState("");
  const [queryTags, setQueryTags] = useState<string[]>([]);
  const [university, setUniversity] = useState("");
  const [uniTags, setUniTags] = useState<string[]>([]);
  const [profName, setProfName] = useState("");
  const [profUniversity, setProfUniversity] = useState("");
  const [results, setResults] = useState<Author[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resolvedTopic, setResolvedTopic] = useState("");
  const [resolvedInstitution, setResolvedInstitution] = useState("");
  const [summaries, setSummaries] = useState<Record<string, SummaryData>>({});
  const [loadingSummary, setLoadingSummary] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Author[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [toast, setToast] = useState<{ msg: string; duration: number } | null>(null);
  const [starBounce, setStarBounce] = useState<string | null>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  const btnInterestRef = useRef<HTMLButtonElement>(null);
  const btnNameRef = useRef<HTMLButtonElement>(null);

  // Auth modals
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeModalTitle, setUpgradeModalTitle] = useState("");
  const [upgradeModalSubtitle, setUpgradeModalSubtitle] = useState("");
  const [checkoutReferralCode, setCheckoutReferralCode] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [authModalCopy, setAuthModalCopy] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const authModalRef = useRef<HTMLDivElement>(null);

  const DEFAULT_PLACEHOLDER = PLACEHOLDER_EXAMPLES[0];
  const suggestionsRef = useRef<HTMLDivElement>(null);
  // Bumped on every new search; the background responsiveness pass checks it so a
  // stale run can't write badges onto a newer result set.
  const searchRunIdRef = useRef(0);
  // Always-current email-modal target id, so an in-flight email check can detect
  // that the user switched professors and not render its result under the wrong one.
  const emailTargetIdRef = useRef<string | null>(null);

  const [emailTarget, setEmailTarget] = useState<Author | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailFlags, setEmailFlags] = useState<EmailFlag[]>([]);
  const [emailTotalFlags, setEmailTotalFlags] = useState(0);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [showFramework, setShowFramework] = useState(false);
  const [mobileEmailTab, setMobileEmailTab] = useState<"compose" | "reference">("compose");
  const [freeEmailCheckUsed, setFreeEmailCheckUsed] = useState(false);
  // True when the current result is a no-account "taste" (top flag shown, rest
  // gated behind signup). Set per-check; cleared once revealed in full.
  const [resultGated, setResultGated] = useState(false);

  // Citation + Paper filter
  const [citationRange, setCitationRange] = useState<[number, number]>([0, MAX_CITATIONS]);
  const [paperRange, setPaperRange] = useState<[number, number]>([0, MAX_PAPERS]);
  const [showCitationFilter, setShowCitationFilter] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Email finder
  const [emailLookup, setEmailLookup] = useState<Record<string, { emails: { email: string; source: string; confidence: string }[]; searchUrls: { google: string; scholar: string; directory: string | null }; homepageUrl: string | null; orcidUrl: string | null } | null>>({});
  const [emailLookupLoading, setEmailLookupLoading] = useState<Record<string, boolean>>({});

  // Nearby professors
  const [nearbyProfs, setNearbyProfs] = useState<Author[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);

  // Professor responsiveness badges
  const [responsiveness, setResponsiveness] = useState<Record<string, { level: "green" | "yellow" | "red"; label: string; tooltip: string }>>({});

  // Plan helpers
  const isPaid = hasPaidAccess(profile);
  const isFree = !isPaid;
  const planLabel = planLabelFor(profile);

  // Tag helpers
  function addQueryTag() {
    const val = query.trim();
    if (val && !queryTags.includes(val)) setQueryTags(prev => [...prev, val]);
    setQuery("");
  }
  function addUniTag() {
    const val = university.trim();
    if (val && !uniTags.includes(val)) setUniTags(prev => [...prev, val]);
    setUniversity("");
  }
  function removeQueryTag(idx: number) { setQueryTags(prev => prev.filter((_, i) => i !== idx)); }
  function removeUniTag(idx: number) { setUniTags(prev => prev.filter((_, i) => i !== idx)); }

  // Force re-render after mount so toggle slider refs are measured
  const [, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Persist free email check usage in localStorage, scoped per user
  useEffect(() => {
    if (user?.id) {
      setFreeEmailCheckUsed(localStorage.getItem(emailCheckStorageKey(user.id)) === "1");
    } else {
      setFreeEmailCheckUsed(false);
    }
  }, [user?.id]);

  // Handle ?upgrade=true or ?upgrade=lifetime or ?upgrade=weekly from landing page
  useEffect(() => {
    if (authLoading2) return;
    const upgradeParam = searchParams.get("upgrade");
    if (upgradeParam === "true" || upgradeParam === "lifetime" || upgradeParam === "weekly") {
      if (!user) {
        setShowAuthModal(true);
        setAuthMode("signup");
        setAuthError("");
      } else {
        setShowUpgradeModal(true);
      }
    }
  }, [authLoading2, user, searchParams]);

  // Handle ?signup=true from other pages (e.g. follow-up auth wall)
  useEffect(() => {
    if (authLoading2) return;
    if (searchParams.get("signup") !== "true") return;
    if (!user) {
      setShowAuthModal(true);
      setAuthMode("signup");
      setAuthError("");
    }
  }, [authLoading2, user, searchParams]);

  useEffect(() => {
    if (authLoading2) return;
    const buddyParam = searchParams.get("buddy");
    const buddyCode = buddyParam
      ? normalizeReferralCode(buddyParam)
      : readPendingReferralCode();
    if (!isReferralCode(buddyCode)) return;

    setCheckoutReferralCode(buddyCode);
    if (!buddyParam) return;
    storePendingReferralCode(buddyCode);
    if (!user) {
      setShowAuthModal(true);
      setAuthMode("signup");
      setAuthError("");
      setAuthModalCopy("Create your account, then apply your friend's Buddy Pass during checkout.");
    } else {
      setShowUpgradeModal(true);
    }
  }, [authLoading2, user, searchParams]);

  async function startCheckout(priceId: string | undefined) {
    if (!priceId) {
      setCheckoutError("Checkout is not configured for this plan.");
      return;
    }
    // Funnel: user clicked an upgrade/checkout button on the paywall.
    const plan =
      priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_WEEKLY ? "weekly" :
      priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_SEMESTER ? "semester" :
      priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME ? "lifetime" :
      "unknown";
    track("upgrade_clicked", { plan });

    if (!user) {
      setShowUpgradeModal(false);
      setShowAuthModal(true);
      setAuthMode("signup");
      return;
    }

    setCheckoutError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Missing auth session");

      const cleanReferralCode = normalizeReferralCode(checkoutReferralCode);
      const res = await apiFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          priceId,
          referralCode: cleanReferralCode || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutError(data.error || "Could not apply that Buddy Pass code.");
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      showToast("Something went wrong. Try again.");
    }
  }

  async function startPlanCheckout(plan: CheckoutPlan) {
    const priceId =
      plan === "weekly" ? process.env.NEXT_PUBLIC_STRIPE_PRICE_WEEKLY :
      plan === "semester" ? process.env.NEXT_PUBLIC_STRIPE_PRICE_SEMESTER :
      process.env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME;
    await startCheckout(priceId);
  }

  // Auto-search from landing page URL params
  const [autoSearched, setAutoSearched] = useState(false);
  useEffect(() => {
    if (autoSearched) return;
    const q = searchParams.get("q");
    const u = searchParams.get("u");
    if (q) {
      setQuery(q);
      if (u) setUniversity(u);
      setAutoSearched(true);
      // Delay to let state settle
      setTimeout(() => {
        const btn = document.querySelector("[data-search-btn]") as HTMLButtonElement;
        if (btn) btn.click();
      }, 100);
    }
  }, [searchParams, autoSearched]);

  // Close the hamburger menu on outside click or Escape. Returning focus to
  // the trigger keeps keyboard and switch-control navigation predictable.
  useEffect(() => {
    if (!showMenu) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setShowMenu(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showMenu]);

  useEffect(() => {
    if (!showAuthModal && !showUpgradeModal && !emailTarget) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const first = authModalRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (showAuthModal) setShowAuthModal(false);
        else if (showUpgradeModal) setShowUpgradeModal(false);
        else if (emailTarget) {
          setEmailTarget(null);
          setEmailDraft("");
          setEmailFlags([]);
          setEmailTotalFlags(0);
          setHasChecked(false);
        }
        return;
      }
      if (event.key !== "Tab" || !showAuthModal || !authModalRef.current) return;
      const focusable = Array.from(authModalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [showAuthModal, showUpgradeModal, emailTarget]);

  // Grand reveal / welcome back
  const [revealPhase, setRevealPhase] = useState<"curtain" | "content" | "done">("curtain");
  const [welcomeSubtitle, setWelcomeSubtitle] = useState("Your research journey starts here.");
  const [anonSummariesUsed, setAnonSummariesUsed] = useState(0);
  useEffect(() => {
    const visitCount = parseInt(localStorage.getItem(STORAGE_KEYS.visits) || "0", 10);
    localStorage.setItem(STORAGE_KEYS.visits, String(visitCount + 1));
    localStorage.setItem(STORAGE_KEYS.lastVisit, new Date().toISOString());
    setWelcomeSubtitle(visitCount === 0 ? "Your research journey starts here." : "Welcome back. Let\u2019s keep going.");

    if (visitCount === 0) {
      // First visit — grand reveal
      setShowWelcome(true);
      setTimeout(() => setRevealPhase("content"), 2200);
      setTimeout(() => { setShowWelcome(false); setRevealPhase("done"); }, 3600);
    } else {
      // Returning users should land straight in the app without an extra animated pause.
      setShowWelcome(false);
      setRevealPhase("done");
    }
  }, []);

  useEffect(() => {
    setAnonSummariesUsed(readAnonSummariesUsed());
  }, []);

  // Exit intent — subtle goodbye on mouse leave (desktop only)
  useEffect(() => {
    function handleMouseLeave(e: MouseEvent) {
      if (e.clientY < 5 && !document.querySelector(".exit-hint-active")) {
        document.body.classList.add("exit-hint-active");
        setTimeout(() => document.body.classList.remove("exit-hint-active"), 2000);
      }
    }
    document.addEventListener("mouseleave", handleMouseLeave);
    return () => document.removeEventListener("mouseleave", handleMouseLeave);
  }, []);

  useEffect(() => {
    setSaved(readSavedProfessors<Author>());
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // After signup: clear any pending summarize flag (don't auto-fire — let user click manually so it properly deducts their credit)
  useEffect(() => {
    if (!user) return;
    sessionStorage.removeItem(STORAGE_KEYS.pendingSummary);
  }, [user]);

  // Reset modal copy state when modals close
  useEffect(() => { if (!showAuthModal) setAuthModalCopy(""); }, [showAuthModal]);
  useEffect(() => {
    if (!showUpgradeModal) {
      setUpgradeModalTitle("");
      setUpgradeModalSubtitle("");
      setCheckoutError("");
    }
  }, [showUpgradeModal]);

  // Lock body scroll AND hide the floating nav when the email modal is open, so
  // the focused composer never collides with the nav. The modal has its own ✕.
  useEffect(() => {
    if (!emailTarget) return;
    // iOS-safe scroll lock: body { overflow: hidden } does NOT stop the document
    // scrolling on iOS Safari, so the professor list scrolled behind the modal.
    // Pin the body with position: fixed at the current offset and restore on close.
    const scrollY = window.scrollY;
    const b = document.body;
    const html = document.documentElement;
    b.style.position = "fixed";
    b.style.top = `-${scrollY}px`;
    b.style.left = "0";
    b.style.right = "0";
    b.style.width = "100%";
    b.style.overflow = "hidden";
    // Disable the browser's pull-to-refresh at the root so a slightly-off dismiss
    // drag can't accidentally reload the page.
    b.style.overscrollBehavior = "none";
    html.style.overscrollBehavior = "none";
    b.classList.add("rm-email-open");
    return () => {
      b.style.position = "";
      b.style.top = "";
      b.style.left = "";
      b.style.right = "";
      b.style.width = "";
      b.style.overflow = "";
      b.style.overscrollBehavior = "";
      html.style.overscrollBehavior = "";
      b.classList.remove("rm-email-open");
      window.scrollTo(0, scrollY);
    };
  }, [emailTarget]);

  useEffect(() => {
    emailTargetIdRef.current = emailTarget ? emailTarget.id.split("/").pop()! : null;
  }, [emailTarget]);

  // (Removed the per-pointer liquid-glass sheen + animated SVG molten filter:
  // it caused mobile lag and a cursor-following white hot-spot. Mobile buttons
  // are now a solid calm green with a fixed gloss and a cheap CSS :active press
  // — see the mobile button block in globals.css.)

  // Toast helper
  const showToast = useCallback((msg: string, duration = 2200) => {
    setToast({ msg, duration });
    setTimeout(() => setToast(null), duration);
  }, []);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      if (authMode === "signup") {
        const { error: signUpError, confirmationRequired } = await signUp(
          authEmail,
          authPassword
        );
        if (signUpError) {
          setAuthError(signUpError.message);
        } else {
          setShowAuthModal(false);
          showToast(signupSuccessMessage({ confirmationRequired }));
        }
      } else {
        const { error: signInError } = await signIn(authEmail, authPassword);
        if (signInError) {
          setAuthError(signInError.message);
        } else {
          setShowAuthModal(false);
          showToast("Welcome back!");
        }
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAuthLoading(false);
    }
  }

  async function sendPasswordReset() {
    const email = authEmail.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setAuthError("Enter your email address first.");
      return;
    }
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/profile?reset=1`,
    });
    setAuthLoading(false);
    if (resetError) {
      setAuthError(resetError.message);
      return;
    }
    setShowAuthModal(false);
    showToast("Password reset link sent. Check your email.", 3500);
  }

  async function logSearch(researchInterest: string, searchedUniversity: string | null) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await apiFetch("/api/log-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ research_interest: researchInterest, university: searchedUniversity }),
        keepalive: true,
      });
    } catch { /* analytics must never interrupt a search */ }
  }

  // Opens the upgrade/paywall modal and records which free-tier limit triggered it.
  const hitPaywall = useCallback((limitType: "summary" | "email_checker" | "professor_results") => {
    track("paywall_hit", { limit_type: limitType });
    setShowUpgradeModal(true);
  }, []);

  function toggleSave(author: Author) {
    const id = author.id.split("/").pop()!;
    setStarBounce(id);
    setTimeout(() => setStarBounce(null), 500);
    setSaved((prev) => {
      const exists = prev.some((a) => a.id === author.id);
      const next = exists ? prev.filter((a) => a.id !== author.id) : [...prev, author];
      localStorage.setItem(STORAGE_KEYS.savedProfessors, JSON.stringify(next));
      if (!exists) showToast("Professor saved!");
      return next;
    });
  }

  const savedIds = useMemo(() => new Set(saved.map((a) => a.id)), [saved]);
  const isSaved = useCallback((author: Author) => savedIds.has(author.id), [savedIds]);

  // Summary limit:
  //   Anon: ANON_SUMMARY_LIMIT free summaries, tracked via rm-anon-summaries-used localStorage counter
  //   Free account: 2 summaries total before upgrade paywall
  //   Paid: unlimited
  function getSummariesRemaining(): number {
    if (isPaid) return Infinity;
    if (!user) {
      return Math.max(0, ANON_SUMMARY_LIMIT - anonSummariesUsed);
    }
    // Free account: 2 total for the life of the account — no monthly reset.
    return Math.max(0, 2 - (profile?.summaries_used ?? 0));
  }

  function canSummarize(): boolean {
    if (isPaid) return true;
    if (!user) {
      // Anon gets ANON_SUMMARY_LIMIT free summaries — no account prompt here.
      // When exhausted, the locked overlay in the UI handles the upsell.
      return anonSummariesUsed < ANON_SUMMARY_LIMIT;
    }
    // Free account: 2 total for the life of the account — no monthly reset.
    if (profile && (profile.summaries_used ?? 0) >= 2) {
      setUpgradeModalTitle("You've used your 2 free summaries.");
      setUpgradeModalSubtitle("Keep reading every finding and question, and check your email before you send.");
      hitPaywall("summary");
      return false;
    }
    return true;
  }

  async function search() {
    // Collect all topics and universities (tags + current input)
    // Split by comma so "UCI, UCLA, Caltech" works even without tagging each one
    const allTopics = [...queryTags, ...query.split(",").map(s => s.trim()).filter(Boolean)];
    const allUnis = [...uniTags, ...university.split(",").map(s => s.trim()).filter(Boolean)];
    if (allTopics.length === 0) return;
    // Each search claims a run id. If the user fires another search while this one's
    // awaits are still in flight, runId goes stale and every terminal write below
    // bails — so an older, slower search can never overwrite newer results/state.
    const runId = ++searchRunIdRef.current;
    setMobileSearchOpen(false);
    setLoading(true);
    setError("");
    setResults([]);
    setSummaries({});
    setResolvedTopic("");
    setResolvedInstitution("");
    setShowSaved(false);
    setCitationRange([0, MAX_CITATIONS]);
    setPaperRange([0, MAX_PAPERS]);
    setCurrentPage(1);
    // Log search (fire and forget)
    void logSearch(allTopics.join(", "), allUnis.join(", ") || null);
    try {
      const resolveRes = await apiFetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: allTopics, universities: allUnis }),
        signal: AbortSignal.timeout(20000),
      });
      const resolved = await resolveRes.json();
      if (runId !== searchRunIdRef.current) return; // a newer search superseded this one
      if (!resolveRes.ok) { setError(isThrottle(resolveRes.status) ? THROTTLE_MSG : (resolved.error || "Failed to resolve search terms.")); setLoading(false); return; }
      const { topicIds, topicNames, institutionIds, institutionNames } = resolved;
      setResolvedTopic(topicNames.join(", ") || allTopics.join(", "));
      if (institutionNames.length > 0) setResolvedInstitution(institutionNames.join(", "));
      // If universities were typed but none resolved, note it in the institution display
      if (allUnis.length > 0 && institutionIds.length === 0) {
        setResolvedInstitution(`"${allUnis.join(", ")}" not found. Searching all universities`);
      }

      let authors: Author[] = [];

      if (topicIds.length === 0) {
        const fullInstIds = institutionIds.map((id: string) => `https://openalex.org/${id}`);
        // If the typed query is actually a person's name (OpenAlex found no matching
        // topic), look the professor up by name instead of text-searching paper
        // bodies — works?search= matches abstract words, not author names.
        if (looksLikePersonName(allTopics[0])) {
          authors = await lookupAuthorsByName(allTopics[0], fullInstIds);
        }
        if (authors.length === 0) {
        // Text search fallback — use first topic
        const instFilter = institutionIds.length > 0 ? `&filter=authorships.institutions.id:${institutionIds[0]}` : "";
        const worksRes = await oaFetch(`https://api.openalex.org/works?search=${encodeURIComponent(allTopics[0])}${instFilter}&sort=publication_date:desc&per_page=20&select=authorships`);
        if (isThrottle(worksRes.status)) throw new RateLimitError();
        const worksData = await worksRes.json();
        const works = worksData.results ?? [];
        
        const authorIdsToFetch = new Map<string, string>();
        for (const work of works) {
          for (const authorship of (work.authorships ?? [])) {
            const authorId = authorship.author?.id;
            if (!authorId) continue;
            const shortId = authorId.split("/").pop()!;
            if (fullInstIds.length > 0 && !authorship.institutions?.some((inst: OpenAlexInstitutionRef) => inst.id ? fullInstIds.includes(inst.id) : false)) continue;
            if (!authorIdsToFetch.has(shortId)) authorIdsToFetch.set(shortId, authorId);
            if (authorIdsToFetch.size >= 20) break;
          }
          if (authorIdsToFetch.size >= 20) break;
        }

        const shortIds = Array.from(authorIdsToFetch.keys());
        if (shortIds.length > 0) {
          // Batch all author lookups into ONE OpenAlex call (ids.openalex: takes a
          // pipe-list) instead of one request per author — far fewer calls, far less
          // chance of tripping the rate limit.
          authors = await lookupAuthorsByIds(shortIds, fullInstIds);
        }
        }
      } else {
        // OR filter across all resolved topic IDs (now up to 6 per query = broad synonym coverage)
        const topicFilter = topicIds.join("|");
        const fullInstIds = institutionIds.map((id: string) => `https://openalex.org/${id}`);

        if (institutionIds.length > 0) {
          // Search WITH institution filter first
          const instFilter = `last_known_institutions.id:${institutionIds.join("|")}`;
          const res = await oaFetch(`https://api.openalex.org/authors?filter=topics.id:${topicFilter},${instFilter}&per_page=200&sort=cited_by_count:desc`);
          if (isThrottle(res.status)) throw new RateLimitError();
          const data = await res.json();
          authors = (data.results || []).filter((a: Author) => promoteMatchedInstitution(a, fullInstIds));

          // If still no results, try a text-based works search at that institution
          if (authors.length === 0) {
            const worksRes = await oaFetch(`https://api.openalex.org/works?search=${encodeURIComponent(allTopics[0])}&filter=authorships.institutions.id:${institutionIds.join("|")}&sort=cited_by_count:desc&per_page=50&select=authorships`);
            const worksData = await worksRes.json();
            
            const authorIdsToFetch = new Map<string, string>();
            for (const work of (worksData.results ?? [])) {
              for (const authorship of (work.authorships ?? [])) {
                const authorId = authorship.author?.id;
                if (!authorId) continue;
                const shortId = authorId.split("/").pop()!;
                if (!authorship.institutions?.some((inst: OpenAlexInstitutionRef) => inst.id ? fullInstIds.includes(inst.id) : false)) continue;
                if (!authorIdsToFetch.has(shortId)) authorIdsToFetch.set(shortId, authorId);
                if (authorIdsToFetch.size >= 20) break;
              }
              if (authorIdsToFetch.size >= 20) break;
            }

            const shortIds = Array.from(authorIdsToFetch.keys());
            if (shortIds.length > 0) {
              authors = await lookupAuthorsByIds(shortIds, fullInstIds);
            }
          }

          // If still nothing, fall back to global results with a note
          if (authors.length === 0) {
            const globalRes = await oaFetch(`https://api.openalex.org/authors?filter=topics.id:${topicFilter}&per_page=20&sort=cited_by_count:desc`);
            const globalData = await globalRes.json();
            authors = globalData.results || [];
            if (authors.length > 0) {
              setResolvedInstitution(`No professors found at ${institutionNames.join(", ")} for this topic. Showing top professors at other universities`);
            }
          }
        } else {
          // No institution filter — global search
          const res = await oaFetch(`https://api.openalex.org/authors?filter=topics.id:${topicFilter}&per_page=50&sort=cited_by_count:desc`);
          if (isThrottle(res.status)) throw new RateLimitError();
          const data = await res.json();
          authors = data.results || [];
        }
      }
      // Collapse OpenAlex author fragments (one person split across entities) and drop
      // ghost records, so a real professor never surfaces as a "2 papers / 0 citations"
      // stub in place of their canonical, ORCID-backed profile.
      authors = dedupeAuthors(authors);
      // When no university was searched, show each professor's home institution
      // (longest-tenured) on the card instead of OpenAlex's possibly-secondary primary.
      // (With a university, the matched one is already promoted to the front.)
      if (institutionIds.length === 0) authors.forEach(homeInstitutionFirst);
      // Specificity filter: keep professors where the searched topic appears in their top topics.
      // Be more lenient when searching a specific university (smaller faculty pool).
      // With multiple topic IDs (synonyms), this is already much broader than before.
      if (topicIds.length > 0 && authors.length > 0) {
        const filterByTopN = (n: number) =>
          authors.filter((a) => {
            const topIds = (a.topics ?? []).slice(0, n).map((t) => t.id?.split("/").pop());
            return topicIds.some((id: string) => topIds.includes(id));
          });
        // When searching a university, use a wider window since faculty at smaller
        // schools may have the topic further down their list
        const topNStrict = institutionIds.length > 0 ? 8 : 3;
        const topNMedium = institutionIds.length > 0 ? 25 : 5;
        const minStrict = institutionIds.length > 0 ? 1 : 3;
        const strict = filterByTopN(topNStrict);
        if (strict.length >= minStrict) {
          authors = strict;
        } else {
          const medium = filterByTopN(topNMedium);
          if (medium.length >= 1) {
            authors = medium;
          }
          // else keep all — topic too niche to enforce
        }
        // Re-rank by topic centrality so the actual specialists in the searched
        // topic rise to the top, instead of career-citation giants who merely
        // touch it. Critical: scoring below only keeps the top 20, so without
        // this the real experts get truncated away before they're ever shown.
        authors = [...authors].sort(
          (a, b) =>
            topicRelevanceRank(a, topicIds) - topicRelevanceRank(b, topicIds) ||
            b.cited_by_count - a.cited_by_count
        );
      }
      // Score authors to filter out non-professors
      if (authors.length > 0) {
        try {
          // Drastically reduce OpenAlex API bottleneck by only scoring top 20 candidates
          const authorsToScore = authors.slice(0, 20);
          const scoreRes = await apiFetch("/api/score-authors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              authors: authorsToScore.map((a) => ({
                id: a.id,
                works_count: a.works_count,
                cited_by_count: a.cited_by_count,
                has_institution: !!(a.last_known_institutions?.length > 0),
              })),
            }),
            signal: AbortSignal.timeout(15000),
          });
          const scoreData = await scoreRes.json().catch(() => ({}));
          const scored = Array.isArray(scoreData?.scored) ? scoreData.scored : [];
          if (!scoreRes.ok || scored.length === 0) {
            // Scoring failed or returned nothing usable (e.g. score-authors hit an
            // OpenAlex rate limit). DO NOT empty the results: keep the
            // relevance-ranked candidates, lightly filtered. Emptying here is what
            // made every professor "disappear" on a transient scoring hiccup.
            authors = authorsToScore.filter((a) => a.works_count >= 10);
          } else {
            const scoreMap = new Map<string, number>();
            for (const s of scored) scoreMap.set(s.id, s.score);
            const kept = authorsToScore
              .filter((a) => (scoreMap.get(a.id) ?? 0) >= 1)
              .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
            // If scoring would drop everyone, fall back rather than show nothing.
            authors = kept.length > 0 ? kept : authorsToScore.filter((a) => a.works_count >= 10);
          }
        } catch {
          // Fallback: simple filter if scoring throws (network error / timeout)
          authors = authors.slice(0, 20).filter((a) => a.works_count >= 10);
        }
      }
      if (runId !== searchRunIdRef.current) return; // results arrived stale — a newer search is active
      if (authors.length === 0) setError(`No professors found for "${topicNames.join(", ") || allTopics.join(", ")}"${institutionNames.length > 0 ? ` at ${institutionNames.join(", ")}` : ""}. Try a more specific topic like "machine learning" or "quantum computing".`);
      setResults(authors);
      // Fetch responsiveness badges in background
      if (authors.length > 0) fetchResponsiveness(authors);
      // Fetch nearby professors — only when searching a single institution
      if (isPaid && authors.length > 0 && institutionIds.length === 1 && institutionNames.length === 1) {
        setNearbyProfs([]);
        setNearbyLoading(true);
        const resolveTopicId = topicIds[0] ?? await oaFetch(`https://api.openalex.org/topics?search=${encodeURIComponent(allTopics[0])}&per_page=1`)
          .then(r => r.json()).then(d => d.results?.[0]?.id?.split("/").pop() ?? null).catch(() => null);
        if (resolveTopicId) {
          fetchNearby(resolveTopicId, institutionNames[0], authors.map(a => a.id), runId);
        } else {
          setNearbyLoading(false);
          setNearbyProfs([]);
        }
      } else {
        setNearbyProfs([]);
      }
    } catch (e) { if (runId === searchRunIdRef.current) setError(e instanceof RateLimitError ? THROTTLE_MSG : "Something went wrong. Please try again."); }
    finally { if (runId === searchRunIdRef.current) setLoading(false); }
  }

  async function fetchNearby(topicId: string, institutionName: string, excludeIds: string[], runId: number) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await apiFetch("/api/nearby-authors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ institutionName, topicId, excludeIds }),
      });
      if (!res.ok || runId !== searchRunIdRef.current) return;
      const data = await res.json();
      if (runId === searchRunIdRef.current) setNearbyProfs(data.authors ?? []);
    } catch { /* ignore nearby failures */ }
    finally { if (runId === searchRunIdRef.current) setNearbyLoading(false); }
  }

  async function fetchResponsiveness(authors: Author[]) {
    const runId = searchRunIdRef.current;
    for (const author of authors) {
      if (runId !== searchRunIdRef.current) return; // a newer search started — stop painting stale badges
      const authorId = author.id.split("/").pop()!;
      try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const threeYearsAgo = currentYear - 3;
        const twoYearsAgo = currentYear - 2;

        const worksRes = await oaFetch(
          `https://api.openalex.org/works?filter=author.id:${authorId},publication_year:>${threeYearsAgo}&per_page=50&select=publication_year`
        );
        if (!worksRes.ok) continue;
        const worksData = await worksRes.json();
        const works = (worksData.results ?? []) as OpenAlexWork[];

        if (works.length === 0) {
          setResponsiveness(prev => ({ ...prev, [authorId]: { level: "red", label: "No recent publications", tooltip: "OpenAlex lists no papers in this three-year window. This measures publication activity, not whether the lab has openings." } }));
          continue;
        }

        // Check if published in last 12 months
        const recentWorks = works.filter((w) => (w.publication_year ?? 0) >= currentYear - 1);
        const publishedRecently = recentWorks.length > 0;

        // Check for no publications in last 2 years
        const last2YearWorks = works.filter((w) => (w.publication_year ?? 0) >= twoYearsAgo);
        if (last2YearWorks.length === 0) {
          const lastYear = Math.max(...works.map((w) => w.publication_year ?? 0));
          const yearsAgo = currentYear - lastYear;
          setResponsiveness(prev => ({ ...prev, [authorId]: { level: "red", label: "No recent publications", tooltip: `The latest OpenAlex paper in this window is from ${lastYear}, ${yearsAgo} year${yearsAgo !== 1 ? "s" : ""} ago. This does not indicate whether the lab has openings.` } }));
          continue;
        }

        let level: "green" | "yellow" | "red";
        let label: string;
        let tooltip: string;

        if (publishedRecently) {
          level = "green";
          label = "Recently active";
          tooltip = `OpenAlex lists ${recentWorks.length} paper${recentWorks.length !== 1 ? "s" : ""} from the last two calendar years. This measures publication activity, not whether the lab has openings.`;
        } else {
          level = "yellow";
          label = "Limited recent activity";
          const lastYear = Math.max(...works.map((w) => w.publication_year ?? 0));
          const yearsAgo = currentYear - lastYear;
          tooltip = `The most recent OpenAlex paper in this three-year window is from ${lastYear}, ${yearsAgo} year${yearsAgo !== 1 ? "s" : ""} ago. This does not indicate whether the lab has openings.`;
        }

        if (runId !== searchRunIdRef.current) return; // results changed during the awaits above
        setResponsiveness(prev => ({ ...prev, [authorId]: { level, label, tooltip } }));
      } catch {
        // Skip on error — don't show badge
      }
    }
  }

  async function searchByName() {
    if (!profName.trim()) return;
    const runId = ++searchRunIdRef.current;
    setMobileSearchOpen(false);
    setLoading(true);
    setError("");
    setResults([]);
    setSummaries({});
    setResolvedTopic("");
    setResolvedInstitution("");
    setShowSaved(false);
    void logSearch(profName, profUniversity || null);
    try {
      // Optional university narrows common-name collisions and surfaces the right
      // affiliation (when OpenAlex's record for that person actually has it).
      let fullInstIds: string[] = [];
      if (profUniversity.trim()) {
        try {
          const r = await apiFetch("/api/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ universities: [profUniversity] }),
            signal: AbortSignal.timeout(15000),
          });
          const d = await r.json();
          fullInstIds = (d.institutionIds ?? []).map((id: string) => `https://openalex.org/${id}`);
          if (d.institutionNames?.length) setResolvedInstitution(d.institutionNames.join(", "));
        } catch { /* fall back to an unfiltered name search */ }
      }
      const authors = await lookupAuthorsByName(profName, fullInstIds);
      if (runId !== searchRunIdRef.current) return; // a newer search superseded this one
      if (authors.length === 0) setError(`No professors found matching "${profName}"${profUniversity ? ` at ${profUniversity}` : ""}.`);
      // searches are now unlimited
      setResults(authors);
      if (authors.length > 0) fetchResponsiveness(authors);
    } catch (e) { if (runId === searchRunIdRef.current) setError(e instanceof RateLimitError ? THROTTLE_MSG : "Something went wrong. Please try again."); }
    finally { if (runId === searchRunIdRef.current) setLoading(false); }
  }

  async function loadSummary(author: Author, retry = false) {
    const id = author.id.split("/").pop()!;
    if (!retry && (summaries[id] || loadingSummary[id])) return;
    // Quick client-side UX check (server is the real gate)
    if (!canSummarize()) return;
    if (retry) setSummaries((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setLoadingSummary((prev) => ({ ...prev, [id]: true }));
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await apiFetch("/api/summarize", { method: "POST", headers, body: JSON.stringify({ authorId: id }) });
      if (res.status === 403) {
        if (!user) {
          // Anon hit server limit — sync local state so locked overlay appears, no modal
          localStorage.setItem(STORAGE_KEYS.anonymousSummariesUsed, String(ANON_SUMMARY_LIMIT));
          setAnonSummariesUsed(ANON_SUMMARY_LIMIT);
          // Record the drop-off even though we don't pop the modal for anon.
          track("paywall_hit", { limit_type: "summary" });
        } else {
          hitPaywall("summary");
        }
        return;
      }
      const data = await res.json();
      // Retryable server failure (e.g. 503 when OpenAlex is throttled): show a
      // retry state and do NOT count it against the anon allotment — no summary
      // was generated and the server didn't count it either. The "unavailable"
      // wording is what triggers the Retry button below.
      if (!res.ok) {
        setSummaries((prev) => ({ ...prev, [id]: { summary: "Summary temporarily unavailable. The paper database may be busy. Try again in a moment.", highlights: [], questions: [] } }));
        return;
      }
      const summaryText = data.summary || data.error || "Summary unavailable. Try again or visit their faculty page.";
      const highlights = data.highlights || [];
      setSummaries((prev) => ({ ...prev, [id]: { summary: summaryText, highlights, questions: data.questions || [] } }));
      // Count this anon summary toward their free allotment — only when a real
      // summary came back, mirroring the server-side counting rule.
      if (!user && highlights.length > 0 && !data.error) {
        const wasFirstSummary = anonSummariesUsed === 0;
        setAnonSummariesUsed((prev) => {
          const next = prev + 1;
          localStorage.setItem(STORAGE_KEYS.anonymousSummariesUsed, String(next));
          return next;
        });
        // After the very first summary, nudge with what's left (no paywall yet).
        if (wasFirstSummary) {
          showToast("1 free summary + 1 email check left", 5000);
        }
      }
      // Funnel: free user reached the core value moment (a real summary).
      if (isFree && highlights.length > 0 && !data.error) track("summary_used");
      // Refresh profile so client UI reflects updated count
      if (highlights.length > 0 && !data.error) refreshProfile();
    } catch { setSummaries((prev) => ({ ...prev, [id]: { summary: "Summary unavailable. Try again or visit their faculty page.", highlights: [], questions: [] } })); }
    finally { setLoadingSummary((prev) => ({ ...prev, [id]: false })); }
  }

  function openEmailDraft(author: Author) {
    const id = author.id.split("/").pop()!;
    if (!summaries[id]) loadSummary(author);
    setEmailTarget(author); setEmailDraft(""); setEmailFlags([]); setEmailTotalFlags(0); setHasChecked(false); setResultGated(false);
  }

  // Opens signup from the gated taste result ("create a free account to see them all").
  function openCheckerSignup() {
    setAuthModalCopy("Create a free account to see every issue in this email.");
    setShowAuthModal(true);
    setAuthMode("signup");
    setAuthError("");
  }

  // Opens the summary paywall (used by the locked-content overlays).
  function openSummaryPaywall() {
    setUpgradeModalTitle("Unlock this professor's full summary");
    setUpgradeModalSubtitle("Every finding, every question, and the email checker before you send.");
    hitPaywall("summary");
  }

  // Render helpers so locked items can be shown both inline and inside the blurred overlay.
  const renderFinding = (h: SummaryData["highlights"][number], i: number) => (
    <div key={i} className="finding-border" style={{ paddingLeft: "20px", marginBottom: "16px" }}>
      <p style={{ fontSize: "1rem", color: "#6b7280", lineHeight: 1.6 }}>{h.detail}</p>
      <p style={{ fontSize: "0.85rem", color: "#6b7280", fontStyle: "italic", marginTop: "4px" }}>
        {h.paper}
        {h.authorPosition && h.authorPosition !== "unknown" && (
          <span style={{ fontStyle: "normal", fontSize: "0.75rem", marginLeft: "8px", padding: "2px 8px", borderRadius: "999px", background: h.authorPosition === "first" ? "rgba(101, 153, 131,0.1)" : h.authorPosition === "last" ? "rgba(196, 151, 60,0.1)" : "rgba(149, 173, 163,0.1)", color: h.authorPosition === "first" ? "#659983" : h.authorPosition === "last" ? "#a8853e" : "#6b7280" }}>
            {h.authorPosition === "first" ? "1st author" : h.authorPosition === "last" ? "last author" : "middle author"}
          </span>
        )}
        {h.doi && (
          <a href={h.doi} target="_blank" rel="noopener noreferrer" style={{ fontStyle: "normal", fontSize: "0.8rem", marginLeft: "10px", color: "#2d5a47", textDecoration: "none" }}>
            Read paper →
          </a>
        )}
      </p>
    </div>
  );
  const renderQuestion = (q: string, i: number) => (
    <p key={i} style={{ fontSize: "1rem", color: "#6b7280", paddingLeft: "20px", borderLeft: "3px solid #9dbfb1", marginBottom: "12px", lineHeight: 1.6 }}>{q}</p>
  );

  function showEmailCheckFailure(suggestion: string) {
    setEmailFlags([{ type: "error", issue: "Check failed", suggestion }]);
    setEmailTotalFlags(1);
    setResultGated(false);
    setHasChecked(true);
  }

  async function checkEmail() {
    if (!emailTarget || !emailDraft.trim()) return;
    // Funnel: user pressed Check, at the moment of value, before any signup gate.
    track("check_started");
    const id = emailTarget.id.split("/").pop()!;
    const summary = summaries[id];
    setCheckingEmail(true);
    try {
      // Anonymous checks are allowed (the no-account taste). Send the auth token
      // only when signed in.
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

      const res = await apiFetch("/api/email", {
        method: "POST",
        headers,
        body: JSON.stringify({ draft: emailDraft, professorName: emailTarget.display_name, institution: emailTarget.last_known_institutions?.[0]?.display_name || "", topics: emailTarget.topics?.slice(0, 4).map((t) => t.display_name), highlights: summary?.highlights || [], questions: summary?.questions || [] }),
      });
      const data = await res.json();
      // If the user closed the modal or switched professors while this was in
      // flight, drop the result so it never renders under the wrong professor
      // (and doesn't wrongly consume the free check).
      if (emailTargetIdRef.current !== id) return;
      if (!res.ok) {
        if (data.error === "signup_required") {
          openCheckerSignup();
          return;
        }
        if (data.error === "upgrade_required") {
          setEmailTarget(null);
          setShowUpgradeModal(true);
          return;
        }
        showEmailCheckFailure(data.message || data.error || "Something went wrong. Try again.");
        return;
      }
      const flags = data.flags ?? [];
      setEmailFlags(flags);
      setEmailTotalFlags(Number.isFinite(data.totalFlags) ? data.totalFlags : flags.length);
      setHasChecked(true);

      // Entitlement for THIS result:
      //  - paid: full, unlimited.
      //  - signed-in free, first check: full reveal; consume their one free check
      //    so the next email hits the paywall.
      //  - anonymous: a gated taste (top flag + count shown, rest behind signup).
      if (data.gated === true) {
        setResultGated(true);
      } else if (user?.id && !isPaid) {
        setResultGated(false);
        if (!freeEmailCheckUsed) {
          localStorage.setItem(emailCheckStorageKey(user.id), "1");
          setFreeEmailCheckUsed(true);
        }
      } else setResultGated(false);

      // Perfect email celebration!
      if (flags.length === 0) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#659983", "#8aaa9d", "#9dbfb1", "#659983", "#f4f0ea"],
        });
        setTimeout(() => {
          confetti({
            particleCount: 50,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ["#659983", "#8aaa9d", "#9dbfb1"],
          });
          confetti({
            particleCount: 50,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ["#659983", "#8aaa9d", "#9dbfb1"],
          });
        }, 300);
      }
    } catch {
      showEmailCheckFailure("Something went wrong. Try again.");
    }
    finally { setCheckingEmail(false); }
  }

  function handleCopy() {
    navigator.clipboard.writeText(emailDraft);
    showToast("Copied to clipboard!");
  }

  async function lookupEmail(author: Author) {
    const id = author.id.split("/").pop()!;
    if (emailLookup[id] || emailLookupLoading[id]) return;
    setEmailLookupLoading(prev => ({ ...prev, [id]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await apiFetch("/api/find-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          authorId: id,
          authorName: author.display_name,
          institution: author.last_known_institutions?.[0]?.display_name || "",
        }),
      });
      // A transient failure (429 rate limit, 5xx) must NOT be cached as a result —
      // the guard above would then present it as "no email found" for the rest of
      // the session with no way to retry.
      if (res.status === 403) {
        setShowUpgradeModal(true);
        return;
      }
      if (!res.ok) {
        showToast(res.status === 429 ? "Email lookup is busy — try again in a minute." : "Email lookup failed. Try again.");
        return;
      }
      const data = await res.json();
      // Normalize: a malformed response must not be stored raw, because the
      // renderer reads lookup.emails.length / lookup.searchUrls.google unconditionally.
      if (!Array.isArray(data?.emails) || !data?.searchUrls) {
        setEmailLookup(prev => ({ ...prev, [id]: { emails: [], searchUrls: { google: "", scholar: "", directory: null }, homepageUrl: null, orcidUrl: null } }));
        return;
      }
      setEmailLookup(prev => ({ ...prev, [id]: data }));
    } catch {
      // Network error — leave uncached so the user can retry.
      showToast("Email lookup failed. Try again.");
    } finally {
      setEmailLookupLoading(prev => ({ ...prev, [id]: false }));
    }
  }

  const filteredSuggestions = (query.trim()
    ? RESEARCH_SUGGESTIONS.filter((s) => s.toLowerCase().includes(query.toLowerCase()))
    : RESEARCH_SUGGESTIONS
  ).slice().sort((a, b) => a.localeCompare(b));

  const profileUrl = (author: Author) => `https://openalex.org/authors/${author.id.split("/").pop()}`;

  const displayList = useMemo(() => (showSaved ? saved : results), [showSaved, saved, results]);
  // Citation filter
  const filteredList = useMemo(() => (
    displayList.filter(a =>
      a.cited_by_count >= citationRange[0] &&
      (citationRange[1] >= MAX_CITATIONS || a.cited_by_count <= citationRange[1]) &&
      a.works_count >= paperRange[0] &&
      (paperRange[1] >= MAX_PAPERS || a.works_count <= paperRange[1])
    )
  ), [displayList, citationRange, paperRange]);
  // Pagination — only for paid users on search results
  const totalPages = useMemo(() => (
    isPaid && !showSaved ? Math.ceil(filteredList.length / PROFESSORS_PER_PAGE) : 1
  ), [isPaid, showSaved, filteredList.length]);
  const pagedList = useMemo(() => (
    isPaid && !showSaved
      ? filteredList.slice((currentPage - 1) * PROFESSORS_PER_PAGE, currentPage * PROFESSORS_PER_PAGE)
      : filteredList
  ), [isPaid, showSaved, filteredList, currentPage]);
  const wordCount = useMemo(() => emailDraft.trim().split(/\s+/).filter(Boolean).length, [emailDraft]);

  // ── Email sheet: close + pull-down-to-dismiss (mobile bottom sheet) ──────────
  // Closing just unmounts the overlay, so the professor list underneath is revealed
  // exactly where it was left.
  const closeEmailModal = () => { setEmailTarget(null); setEmailDraft(""); setEmailFlags([]); setEmailTotalFlags(0); setHasChecked(false); };
  const emailSheetRef = useRef<HTMLDivElement | null>(null);
  const emailDragStartY = useRef<number | null>(null);
  const emailDragDY = useRef(0);
  const emailDragRaf = useRef<number | null>(null);
  const onSheetDragStart = (e: React.TouchEvent) => {
    emailDragStartY.current = e.touches[0].clientY;
    emailDragDY.current = 0;
    const el = emailSheetRef.current;
    if (el) {
      // The open animation (modalSlideUp, fill: forwards) pins `transform`, which
      // overrides anything we set inline — clearing it is what lets the drag move at all.
      el.style.animation = "none";
      el.style.transition = "none";
      el.style.willChange = "transform"; // promote to a GPU layer up front
    }
  };
  const onSheetDragMove = (e: React.TouchEvent) => {
    if (emailDragStartY.current == null) return;
    emailDragDY.current = Math.max(0, e.touches[0].clientY - emailDragStartY.current);
    // Coalesce to one paint per frame and use translate3d so the move is composited, not repainted.
    if (emailDragRaf.current == null) {
      emailDragRaf.current = requestAnimationFrame(() => {
        emailDragRaf.current = null;
        const el = emailSheetRef.current;
        if (el) el.style.transform = `translate3d(0, ${emailDragDY.current}px, 0)`;
      });
    }
  };
  const onSheetDragEnd = () => {
    if (emailDragStartY.current == null) return;
    if (emailDragRaf.current != null) { cancelAnimationFrame(emailDragRaf.current); emailDragRaf.current = null; }
    const el = emailSheetRef.current;
    const dy = emailDragDY.current;
    emailDragStartY.current = null;
    if (!el) { if (dy > 90) closeEmailModal(); return; }
    if (dy > 90) {
      // Pulled far enough — slide the rest of the way down, then unmount (real sheet dismiss).
      el.style.transition = "transform 0.22s cubic-bezier(0.4, 0, 1, 1)";
      el.style.transform = `translate3d(0, ${el.offsetHeight}px, 0)`;
      window.setTimeout(closeEmailModal, 200);
    } else {
      // Spring back to rest.
      el.style.transition = "transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "translate3d(0, 0, 0)";
      el.style.willChange = "";
    }
  };

  // ── Hero transition ──────────────────────────────────────────────────────
  const [heroExiting, setHeroExiting] = useState(false);

  // SVG melt filter refs
  const meltTurbulenceRef = useRef<SVGFETurbulenceElement | null>(null);
  const meltDisplacementRef = useRef<SVGFEDisplacementMapElement | null>(null);
  const meltRafRef = useRef<number | null>(null);

  // Animate the SVG displacement filter while hero is exiting
  useEffect(() => {
    if (heroExiting) {
      // Skip the heavy SVG distortion when the user prefers reduced motion or the
      // tab is hidden — the CSS titleMelt still carries the transition.
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion || document.hidden) return;
      const startTime = performance.now();
      const duration = 460;
      let lastUpdate = 0;
      const animate = (now: number) => {
        const t = Math.min((now - startTime) / duration, 1);
        // Throttle filter mutations to ~30fps — re-evaluating feTurbulence every
        // frame on a large heading is the main-thread cost; 30fps is plenty here.
        if (now - lastUpdate >= 32 || t >= 1) {
          lastUpdate = now;
          // Accelerate: starts slow, ends fast
          const eased = t * t * (3 - 2 * t);
          const scale = eased * 130;
          const freq = 0.015 + eased * 0.055;
          if (meltTurbulenceRef.current) {
            meltTurbulenceRef.current.setAttribute("baseFrequency", `${freq.toFixed(4)} ${(freq * 1.8).toFixed(4)}`);
          }
          if (meltDisplacementRef.current) {
            meltDisplacementRef.current.setAttribute("scale", `${scale.toFixed(1)}`);
          }
        }
        if (t < 1) {
          meltRafRef.current = requestAnimationFrame(animate);
        }
      };
      meltRafRef.current = requestAnimationFrame(animate);
    } else {
      if (meltRafRef.current) {
        cancelAnimationFrame(meltRafRef.current);
        meltRafRef.current = null;
      }
      if (meltTurbulenceRef.current) {
        meltTurbulenceRef.current.setAttribute("baseFrequency", "0.015 0.027");
      }
      if (meltDisplacementRef.current) {
        meltDisplacementRef.current.setAttribute("scale", "0");
      }
    }
    return () => {
      if (meltRafRef.current) cancelAnimationFrame(meltRafRef.current);
    };
  }, [heroExiting]);

  const triggerSearch = () => {
    if (results.length === 0 && !loading && !heroExiting) {
      setHeroExiting(true);
      setTimeout(() => { setHeroExiting(false); search(); }, 480);
    } else {
      search();
    }
  };

  const triggerSearchByName = () => {
    if (results.length === 0 && !loading && !heroExiting) {
      setHeroExiting(true);
      setTimeout(() => { setHeroExiting(false); searchByName(); }, 480);
    } else {
      searchByName();
    }
  };
  const modeToggleSliderStyle = {
    left: searchMode === "interest"
      ? `${btnInterestRef.current?.offsetLeft ?? 4}px`
      : `${btnNameRef.current?.offsetLeft ?? 100}px`,
    width: searchMode === "interest"
      ? `${btnInterestRef.current?.offsetWidth ?? 110}px`
      : `${btnNameRef.current?.offsetWidth ?? 95}px`,
  };
  const searchFormProps = {
    mode: searchMode,
    query,
    setQuery,
    queryTags,
    university,
    setUniversity,
    universityTags: uniTags,
    professorName: profName,
    setProfessorName: setProfName,
    professorUniversity: profUniversity,
    setProfessorUniversity: setProfUniversity,
    defaultPlaceholder: DEFAULT_PLACEHOLDER,
    suggestions: filteredSuggestions,
    showSuggestions,
    setShowSuggestions,
    suggestionsRef,
    addQueryTag,
    addUniversityTag: addUniTag,
    removeQueryTag,
    removeUniversityTag: removeUniTag,
  };
  // ────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Grand reveal / welcome back */}
      {showWelcome && (
        <div className={`grand-reveal ${revealPhase === "content" ? "grand-reveal-lifting" : ""}`}>
          <div className="grand-reveal-inner">
            <div className="grand-reveal-logo">
              <svg className="grand-reveal-icon" width="64" height="64" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M50 84 C30 78 22 60 24 38 C36 42 46 52 50 70" fill="none" stroke="#2d5a47" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M50 84 C70 78 78 60 76 38 C64 42 54 52 50 70" fill="none" stroke="#2d5a47" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="50" cy="32" r="9.5" fill="#c9ad77" />
              </svg>
              <h2 className="grand-reveal-title">Research Match</h2>
            </div>
            <div className="grand-reveal-line" />
            <p className="grand-reveal-subtitle">{welcomeSubtitle}</p>
          </div>
        </div>
      )}

      <div className="splotches">
        <div className="splotch splotch-1" />
        <div className="splotch splotch-2" />
        <div className="splotch splotch-3" />
        <div className="splotch splotch-4" />
        <div className="splotch splotch-5" />
      </div>

      {/* ====== SVG FILTER DEFS (melt effect) ====== */}
      <svg style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
        <defs>
          <filter id="meltFilter" x="-40%" y="-40%" width="180%" height="220%">
            <feTurbulence
              ref={meltTurbulenceRef}
              type="turbulence"
              baseFrequency="0.015 0.027"
              numOctaves="2"
              seed="5"
              result="noise"
            />
            <feDisplacementMap
              ref={meltDisplacementRef}
              in="SourceGraphic"
              in2="noise"
              scale="0"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <ResearchAppNav
        loggedIn={Boolean(user)}
        userEmail={user?.email ?? null}
        isFree={isFree}
        isPaid={isPaid}
        isLifetime={profile?.plan_type === "lifetime"}
        planLabel={planLabel}
        savedCount={saved.length}
        showingSaved={showSaved}
        menuOpen={showMenu}
        menuRef={menuRef}
        menuButtonRef={menuButtonRef}
        onToggleMenu={() => setShowMenu((open) => !open)}
        onCloseMenu={() => setShowMenu(false)}
        onToggleSaved={() => setShowSaved(!showSaved)}
        onLogin={() => { setShowAuthModal(true); setAuthMode("login"); setAuthError(""); }}
        onSignup={() => { setShowAuthModal(true); setAuthMode("signup"); setAuthError(""); }}
        onUpgrade={() => setShowUpgradeModal(true)}
        onSignOut={() => { void signOut(); setShowMenu(false); }}
      />

      <main className={`rm-page rm-app-body ${revealPhase === "done" ? "rm-page-revealed" : revealPhase === "content" ? "rm-page-revealing" : "rm-page-hidden"}`}>

        {/* ====== HERO (empty / initial state) ====== */}
        {(!showSaved && results.length === 0 && !loading) || heroExiting ? (
          <div className={`rm-hero${heroExiting ? " rm-hero-exit" : ""}`}>
            {/* Atmospheric background glow — premium */}
            <div className="rm-hero-glow" aria-hidden="true" />
            <h1
              className="rm-hero-title"
              style={heroExiting && !isMobile ? { filter: "url(#meltFilter)" } : {}}
            >
              <span className="rm-hero-title-black" style={{ display: "block" }}>Find your</span>
              <span className="rm-hero-title-green" style={{ display: "block", whiteSpace: "nowrap" }}>research professor.</span>
            </h1>
            <SearchModeToggle
              mode={searchMode}
              onChange={setSearchMode}
              sliderStyle={modeToggleSliderStyle}
              containerRef={toggleRef}
              interestButtonRef={btnInterestRef}
              nameButtonRef={btnNameRef}
            />
            <ResearchSearchForm
              {...searchFormProps}
              hero
              onInterestSearch={triggerSearch}
              onNameSearch={triggerSearchByName}
            />

            {error && <p style={{ textAlign: "center", fontSize: "1rem", color: "#c45c5c", marginTop: "20px" }}>{error}</p>}

            {/* Saved pill — hero state, centred directly below search bar; hidden during exit */}
            {!heroExiting && (
              <div style={{ display: "flex", justifyContent: "center", width: "100%", maxWidth: "760px", marginTop: "12px" }}>
                <button
                  className="rm-saved-pill"
                  onClick={() => { if (saved.length > 0) setShowSaved(true); }}
                  aria-label={saved.length > 0 ? `View ${saved.length} saved professors` : "Your saved professors shortlist"}
                  style={saved.length === 0 ? { opacity: 0.45, cursor: "default" } : {}}
                >
                  <span aria-hidden="true">★</span>
                  {saved.length > 0 ? `${saved.length} saved` : "Saved"}
                </button>
              </div>
            )}
          </div>

        ) : (
          /* ====== COMPACT SEARCH + RESULTS ====== */
          <>
            {/* Mobile: collapsed search pill (tap to reopen the full form) */}
            {!showSaved && results.length > 0 && (
              <button
                type="button"
                className="rm-mobile-searchbar lg-glass"
                aria-expanded={mobileSearchOpen}
                aria-label="Edit search"
                onClick={() => setMobileSearchOpen((v) => !v)}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, position: "relative", zIndex: 1 }}>
                  <circle cx="11" cy="11" r="7" stroke="#659983" strokeWidth="2" />
                  <path d="M21 21l-4-4" stroke="#659983" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span className="rm-mobile-searchbar-q">
                  {searchMode === "name" ? (profName || "Search by name") : (resolvedTopic || "Edit search")}
                </span>
                <span className="rm-mobile-searchbar-edit" aria-hidden="true">✎</span>
              </button>
            )}
            <div className={`rm-compact-header${(!showSaved && results.length > 0 && !mobileSearchOpen) ? " rm-compact-collapsed" : ""}`}>
              <div className="rm-compact-inner">
              {!showSaved && (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <SearchModeToggle
                      mode={searchMode}
                      onChange={setSearchMode}
                      sliderStyle={modeToggleSliderStyle}
                      containerRef={toggleRef}
                      interestButtonRef={btnInterestRef}
                      nameButtonRef={btnNameRef}
                      compact
                    />
                    <button
                      className="rm-saved-pill"
                      onClick={() => { if (saved.length > 0) setShowSaved(true); }}
                      style={saved.length === 0 ? { opacity: 0.45, cursor: "default" } : {}}
                      aria-label={saved.length > 0 ? `View ${saved.length} saved professors` : "Saved professors shortlist"}
                    >
                      <span aria-hidden="true">★</span>
                      {saved.length > 0 ? `${saved.length} saved` : "Saved"}
                    </button>
                  </div>
                  <ResearchSearchForm
                    {...searchFormProps}
                    showIcon
                    onInterestSearch={search}
                    onNameSearch={searchByName}
                  />
                </>
              )}
              {showSaved && (
                <button
                  className="rm-saved-pill rm-saved-pill-active"
                  onClick={() => setShowSaved(false)}
                >
                  <span aria-hidden="true">←</span> Back to search
                </button>
              )}
              </div>
            </div>

            {/* STATUS */}
            {loading && (
              <div style={{ textAlign: "center", marginBottom: "32px" }}>
                <p style={{ fontSize: "1.1rem", color: "#6b7280" }}>Searching<span className="rm-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
              </div>
            )}
            {error && <p style={{ textAlign: "center", fontSize: "1.1rem", color: "#c45c5c", marginBottom: "32px" }}>{error}</p>}

            {!showSaved && results.length > 0 && (
              <div className="rm-results-header" style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
                <p className="rm-results-verbose" style={{ fontSize: "1rem", color: "#6b7280", margin: 0 }}>
                  Results for <span style={{ color: "#2d5a47", fontWeight: 700 }}>{resolvedTopic}</span>
                  {resolvedInstitution && <> at <span style={{ color: "#2d5a47", fontWeight: 700 }}>{resolvedInstitution}</span></>}
                  {filteredList.length < results.length && (
                    <span style={{ color: "#9ca3af" }}> · {filteredList.length} of {results.length} match filter</span>
                  )}
                </p>
                <span className="rm-results-count" aria-hidden="true">{filteredList.length} professors</span>

                {/* Filter button */}
                <div style={{ position: "relative", marginLeft: "auto" }}>
                  {(() => {
                    const citActive = citationRange[0] > 0 || citationRange[1] < MAX_CITATIONS;
                    const paperActive = paperRange[0] > 0 || paperRange[1] < MAX_PAPERS;
                    const activeCount = (citActive ? 1 : 0) + (paperActive ? 1 : 0);
                    const anyActive = activeCount > 0;
                    return (
                      <button
                        onClick={() => setShowCitationFilter(v => !v)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: "8px",
                          padding: "8px 16px",
                          background: anyActive ? "#659983" : "rgba(101, 153, 131,0.07)",
                          color: anyActive ? "#fff" : "#659983",
                          border: "1.5px solid rgba(101, 153, 131,0.25)",
                          borderRadius: "999px", cursor: "pointer",
                          fontSize: "0.82rem", fontWeight: 600,
                          fontFamily: "DM Sans, Inter, sans-serif",
                          transition: "all 0.2s ease",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span>📊</span>
                        <span>Filters{activeCount > 0 ? ` (${activeCount})` : ""}</span>
                        <span style={{ fontSize: "0.7rem", transition: "transform 0.2s", transform: showCitationFilter ? "rotate(180deg)" : "none", display: "inline-block" }}>▾</span>
                      </button>
                    );
                  })()}

                  {showCitationFilter && (
                    <div style={{
                      position: "absolute", right: 0, top: "calc(100% + 8px)",
                      background: "rgba(255,255,255,0.97)",
                      backdropFilter: "blur(20px)",
                      border: "1.5px solid rgba(101, 153, 131,0.15)",
                      borderRadius: "18px",
                      padding: "20px 24px",
                      width: "310px",
                      boxShadow: "0 8px 32px rgba(101, 153, 131,0.12)",
                      zIndex: 100,
                    }}>

                      {/* ── Citations ── */}
                      <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "2px" }}>Citations</p>
                      <p style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1a1a1a", marginBottom: "12px" }}>
                        {formatCitations(citationRange[0])} – {citationRange[1] >= MAX_CITATIONS ? "100k+" : formatCitations(citationRange[1])}
                      </p>
                      <div className="dual-range-container">
                        <div className="dual-range-track" />
                        <div className="dual-range-fill" style={{
                          left: `${(citationRange[0] / MAX_CITATIONS) * 100}%`,
                          right: `${100 - (citationRange[1] / MAX_CITATIONS) * 100}%`,
                        }} />
                        <input type="range" min={0} max={MAX_CITATIONS} step={1000} value={citationRange[0]}
                          onChange={e => { const v = Math.min(Number(e.target.value), citationRange[1] - 1000); setCitationRange([Math.max(0, v), citationRange[1]]); setCurrentPage(1); }}
                          className="dual-range-input" />
                        <input type="range" min={0} max={MAX_CITATIONS} step={1000} value={citationRange[1]}
                          onChange={e => { const v = Math.max(Number(e.target.value), citationRange[0] + 1000); setCitationRange([citationRange[0], Math.min(MAX_CITATIONS, v)]); setCurrentPage(1); }}
                          className="dual-range-input" />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "#9ca3af", marginTop: "4px" }}>
                        <span>0</span><span>50k</span><span>100k+</span>
                      </div>

                      {/* Divider */}
                      <div style={{ height: "1px", background: "rgba(101, 153, 131,0.1)", margin: "18px 0" }} />

                      {/* ── Papers ── */}
                      <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "2px" }}>Papers Published</p>
                      <p style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1a1a1a", marginBottom: "12px" }}>
                        {paperRange[0]} – {paperRange[1] >= MAX_PAPERS ? "500+" : String(paperRange[1])}
                      </p>
                      <div className="dual-range-container">
                        <div className="dual-range-track" />
                        <div className="dual-range-fill" style={{
                          left: `${(paperRange[0] / MAX_PAPERS) * 100}%`,
                          right: `${100 - (paperRange[1] / MAX_PAPERS) * 100}%`,
                        }} />
                        <input type="range" min={0} max={MAX_PAPERS} step={5} value={paperRange[0]}
                          onChange={e => { const v = Math.min(Number(e.target.value), paperRange[1] - 5); setPaperRange([Math.max(0, v), paperRange[1]]); setCurrentPage(1); }}
                          className="dual-range-input" />
                        <input type="range" min={0} max={MAX_PAPERS} step={5} value={paperRange[1]}
                          onChange={e => { const v = Math.max(Number(e.target.value), paperRange[0] + 5); setPaperRange([paperRange[0], Math.min(MAX_PAPERS, v)]); setCurrentPage(1); }}
                          className="dual-range-input" />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "#9ca3af", marginTop: "4px" }}>
                        <span>0</span><span>250</span><span>500+</span>
                      </div>

                      {/* Clear all */}
                      {(citationRange[0] > 0 || citationRange[1] < MAX_CITATIONS || paperRange[0] > 0 || paperRange[1] < MAX_PAPERS) && (
                        <button
                          onClick={() => { setCitationRange([0, MAX_CITATIONS]); setPaperRange([0, MAX_PAPERS]); setCurrentPage(1); }}
                          style={{ marginTop: "16px", fontSize: "0.78rem", color: "#c45c5c", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                        >✕ Clear all filters</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            {showSaved && <p style={{ fontSize: "1rem", color: "#6b7280", marginBottom: "32px" }}>Your saved professors ({saved.length})</p>}


        {/* CARDS */}
        <div className="rm-results-stack">
          {pagedList.map((author, pageIndex) => {
            const authorIndex = isPaid && !showSaved
              ? (currentPage - 1) * PROFESSORS_PER_PAGE + pageIndex
              : pageIndex;
            const id = author.id.split("/").pop()!;
            const summary = summaries[id];
            const isLoadingSummary = loadingSummary[id];
            const resp = responsiveness[id];
            // Non-paid users: professor 4+ gets restricted
            // Anon users: completely hidden (show exactly 3, no friction)
            // Free account: locked stub with upgrade prompt
            const isLockedStub = !isPaid && !showSaved && authorIndex >= 3;
            if (isLockedStub) {
              return (
                <div key={author.id} className="glass-card card-enter rm-card rm-card-locked" style={{ position: "relative", overflow: "hidden" }}>
                  {/* Blurred content behind */}
                  <div style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none", opacity: 0.5 }}>
                    <div className="rm-card-top">
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span className="rm-card-name" style={{ cursor: "default" }}>{author.display_name}</span>
                        </div>
                        <p style={{ fontSize: "0.9rem", color: "#6b7280", marginTop: "6px" }}>
                          {formatInstitutionLocation(author.last_known_institutions?.[0]) || "Unknown institution"}
                        </p>
                      </div>
                      <div className="rm-card-stats">
                        <div className="rm-stat-pill">
                          <span className="rm-stat-num">{author.works_count.toLocaleString()}</span>
                          <span className="rm-stat-label">papers</span>
                        </div>
                      </div>
                    </div>
                    {author.topics?.length > 0 && (
                      <>
                        <hr className="rm-card-divider" />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                          {author.topics.slice(0, 4).map((t, i) => <span key={i} className="tag">{t.display_name}</span>)}
                        </div>
                      </>
                    )}
                    <div style={{ marginTop: "28px", height: "60px", background: "rgba(101, 153, 131,0.06)", borderRadius: "12px" }} />
                  </div>
                  {/* Lock overlay */}
                  <div
                    onClick={() => hitPaywall("professor_results")}
                    style={{
                      position: "absolute", inset: 0,
                      background: "linear-gradient(to bottom, rgba(245,240,230,0.55) 0%, rgba(245,240,230,0.97) 50%)",
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                      cursor: "pointer", padding: "20px",
                    }}
                  >
                    <span
                      style={{
                        background: "#659983", color: "#fff", fontSize: "0.8rem", fontWeight: 700,
                        padding: "8px 20px", borderRadius: "10px",
                      }}
                    >
                      See this match →
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div key={author.id} className="glass-card card-enter rm-card">
                <div className="rm-card-top">
                  <div className="rm-card-identity">
                    <div className="rm-card-title-row">
                      <a href={profileUrl(author)} target="_blank" rel="noopener noreferrer" className="rm-card-name">
                        {author.display_name}
                      </a>
                      <button
                        onClick={() => toggleSave(author)}
                        style={{ fontSize: "1.4rem", color: isSaved(author) ? "#a8853e" : "#8aaa9d", background: "none", border: "none", cursor: "pointer", transition: "color 0.2s, transform 0.2s" }}
                        className={`rm-save-btn ${starBounce === id ? "star-bounce" : ""}`}
                        title={isSaved(author) ? "Remove from saved" : "Save professor"}
                      >
                        {isSaved(author) ? "\u2605" : "\u2606"}
                      </button>
                    </div>
                    <p className="rm-card-affiliation">
                      {formatInstitutionLocation(author.last_known_institutions?.[0]) || "Unknown institution"}
                    </p>
                    {/* Responsiveness \u2014 a quiet flowy line, not a crowded pill */}
                    {resp && (
                      (isPaid || !!summaries[id]) ? (
                        <div className="rm-resp-line" title={resp.tooltip}>
                          <span className="rm-resp-dot" style={{ background: resp.level === "green" ? "#659983" : resp.level === "yellow" ? "#c9ad77" : "#c45c5c" }} />
                          <span style={{ color: resp.level === "green" ? "#659983" : resp.level === "yellow" ? "#a8853e" : "#c45c5c" }}>{resp.label}</span>
                        </div>
                      ) : (
                        <div className="rm-resp-line rm-resp-locked">
                          <span className="rm-resp-dot" style={{ background: "#c4cdc6" }} />
                          <span>Summarize to see if they take students</span>
                        </div>
                      )
                    )}
                  </div>
                  <div className="rm-card-stats">
                    <div className="rm-stat-pill">
                      <span className="rm-stat-num">{author.works_count.toLocaleString()}</span>
                      <span className="rm-stat-label">papers</span>
                    </div>
                    <div className="rm-stat-pill">
                      <span className="rm-stat-num">{author.cited_by_count.toLocaleString()}</span>
                      <span className="rm-stat-label">citations</span>
                    </div>
                  </div>
                </div>

                {author.topics?.length > 0 && (
                  <>
                    <hr className="rm-card-divider" />
                    <div className="rm-topic-row">
                      {author.topics.slice(0, 4).map((t, i) => <span key={i} className="tag">{t.display_name}</span>)}
                    </div>
                  </>
                )}

                {/* Professor Email Finder — paid plans only; the API enforces this too. */}
                {isPaid ? (() => {
                  const lookup = emailLookup[id];
                  const isLookingUp = emailLookupLoading[id];
                  return (
                    <div className="rm-email-lookup">
                      {!lookup && !isLookingUp && (
                        <button onClick={() => lookupEmail(author)} className="btn-secondary" style={{ padding: "10px 22px", fontSize: "0.85rem" }}>
                          Find professor email →
                        </button>
                      )}
                      {isLookingUp && (
                        <div style={{ padding: "14px 18px", background: "rgba(101, 153, 131,0.03)", borderRadius: "12px", border: "1px solid rgba(101, 153, 131,0.2)", display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>Searching ORCID, OpenAlex, and faculty pages<span className="rm-dots" aria-hidden="true"><i></i><i></i><i></i></span></span>
                        </div>
                      )}
                      {lookup && (
                        <div style={{ padding: "14px 18px", background: "rgba(101, 153, 131,0.03)", borderRadius: "12px", border: "1px solid rgba(101, 153, 131,0.2)" }}>
                          {lookup.emails.length > 0 ? (
                            <>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                                <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.1em" }}>Email results</span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {lookup.emails.map((e, i) => (
                                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                    <span style={{
                                      fontSize: "0.6rem", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
                                      color: e.confidence === "verified" ? "#659983" : e.confidence === "likely" ? "#c9ad77" : "#6b7280",
                                      background: e.confidence === "verified" ? "rgba(101, 153, 131,0.1)" : e.confidence === "likely" ? "rgba(201, 173, 119,0.1)" : "rgba(122,142,136,0.1)",
                                    }}>
                                      {e.confidence === "verified" ? "verified" : e.confidence === "likely" ? "likely" : "guess"} &middot; {e.source}
                                    </span>
                                    <span style={{ fontSize: "0.85rem", color: "#2d5a47", fontWeight: e.confidence === "verified" ? 600 : 400, fontFamily: "monospace" }}>{e.email}</span>
                                    <button onClick={() => { navigator.clipboard.writeText(e.email); showToast("Email copied!"); }} style={{ fontSize: "0.65rem", color: "#ffffff", background: "#659983", border: "none", borderRadius: "6px", padding: "3px 10px", cursor: "pointer", transition: "all 0.2s" }}>
                                      Copy
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "8px" }}>No verified emails found in public databases.</p>
                          )}
                          {/* Search links */}
                          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "10px", paddingTop: "10px", borderTop: "1px solid rgba(101, 153, 131,0.2)" }}>
                            {lookup.searchUrls.google && (
                              <a href={lookup.searchUrls.google} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.7rem", color: "#2d5a47", textDecoration: "underline" }}>
                                Search Google →
                              </a>
                            )}
                            {lookup.searchUrls.directory && (
                              <a href={lookup.searchUrls.directory} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.7rem", color: "#2d5a47", textDecoration: "underline" }}>
                                University directory →
                              </a>
                            )}
                            {lookup.homepageUrl && (
                              <a href={lookup.homepageUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.7rem", color: "#2d5a47", textDecoration: "underline" }}>
                                Faculty page →
                              </a>
                            )}
                            {lookup.orcidUrl && (
                              <a href={lookup.orcidUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.7rem", color: "#2d5a47", textDecoration: "underline" }}>
                                ORCID profile →
                              </a>
                            )}
                          </div>
                          <p style={{ fontSize: "0.65rem", color: "#8aaa9d", fontStyle: "italic", marginTop: "8px" }}>
                            Sources: ORCID, OpenAlex, faculty pages. Pattern guesses marked accordingly.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <div className="rm-locked-row rm-feature-lock" style={{ marginTop: "18px" }}>
                    <span style={{ fontSize: "0.85rem", color: "#6b7280", flex: 1 }}>Professor email finder</span>
                    <span className="rm-locked-tag">Paid plans</span>
                  </div>
                )}

                {/* Summary section */}
                {summary ? (
                  <div className="summary-enter rm-summary-block" style={{ marginTop: "28px" }}>
                    <p className="rm-summary-copy">{summary.summary}</p>
                    {summary.highlights.length === 0 && summary.summary.includes("unavailable") && (
                      <button
                        onClick={() => loadSummary(author, true)}
                        className="btn-secondary"
                        style={{ marginTop: "12px", padding: "8px 20px", fontSize: "0.85rem" }}
                      >
                        Retry summary
                      </button>
                    )}
                    {summary.highlights.length > 0 && (
                      <div style={{ marginTop: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                          <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.1em" }}>Key Findings</p>
                          <button
                            onClick={(e) => {
                              const el = e.currentTarget.nextElementSibling as HTMLElement;
                              if (el) el.style.display = el.style.display === "none" ? "block" : "none";
                            }}
                            style={{ fontSize: "0.7rem", fontWeight: 700, color: "#6b7280", cursor: "pointer", background: "rgba(101, 153, 131,0.15)", border: "1px solid #8aaa9d", borderRadius: "999px", width: "18px", height: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-playfair), Georgia, serif", transition: "all 0.2s ease" }}
                          >?</button>
                          <div style={{ display: "none", padding: "14px 18px", background: "rgba(255,255,255,0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(101, 153, 131,0.3)", borderRadius: "12px", fontSize: "0.85rem", color: "#6b7280", lineHeight: 1.6, marginTop: "4px", marginBottom: "8px" }}>
                            In most lab sciences (biology, chemistry, medicine, etc.), <strong>1st author</strong> did the hands-on work and <strong>last author</strong> runs the lab. In many other fields (math, CS, economics, humanities), author order is often alphabetical and doesn&apos;t indicate contribution level. When in doubt, check if the professor lists the paper prominently on their own website. That usually means it&apos;s important to them.
                          </div>
                        </div>
                        {(isFree ? summary.highlights.slice(0, 1) : summary.highlights).map((h, i) => renderFinding(h, i))}
                        {isFree && summary.highlights.length > 1 && (
                          <div className="rm-locked-wrap">
                            <div className="rm-locked-blur" aria-hidden="true">
                              {summary.highlights.slice(1).map((h, i) => renderFinding(h, i + 1))}
                            </div>
                            <button type="button" className="rm-locked-overlay" onClick={openSummaryPaywall}>
                              See the other {summary.highlights.length - 1} finding{summary.highlights.length - 1 === 1 ? "" : "s"}
                              <span className="rm-locked-overlay-sub">Unlock with any plan</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Suggested questions — first one free; the rest blurred for free users */}
                    {summary.questions.length > 0 && (
                      <div style={{ marginTop: "24px" }}>
                        <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "14px" }}>Questions to Ask</p>
                        {(isFree ? summary.questions.slice(0, 1) : summary.questions).map((q, i) => renderQuestion(q, i))}
                        {isFree && summary.questions.length > 1 && (
                          <div className="rm-locked-wrap">
                            <div className="rm-locked-blur" aria-hidden="true">
                              {summary.questions.slice(1).map((q, i) => renderQuestion(q, i + 1))}
                            </div>
                            <button type="button" className="rm-locked-overlay" onClick={openSummaryPaywall}>
                              See all {summary.questions.length} questions
                              <span className="rm-locked-overlay-sub">Unlock with any plan</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Closing tip — only if highlights exist */}
                    {summary.highlights.length > 0 && (
                      <div style={{ marginTop: "24px", padding: "16px 20px", background: "rgba(101, 153, 131,0.15)", border: "1px solid rgba(101, 153, 131,0.3)", borderRadius: "14px" }}>
                        <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#2d5a47", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>Closing Tip</p>
                        <p style={{ fontSize: "0.9rem", color: "#6b7280", lineHeight: 1.6 }}>
                          End your email with: &ldquo;If you&apos;re not currently taking students, is there someone in your group you&apos;d recommend I reach out to?&rdquo;
                        </p>
                      </div>
                    )}
                    {/* Email checker CTA — the primary next step after reading the summary */}
                    {isPaid || (!!summaries[id] && !!user) ? (
                      <>
                        <button onClick={() => openEmailDraft(author)} className="rm-email-cta" style={{ marginTop: "28px" }}>
                          <span className="rm-email-cta-icon" aria-hidden="true">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>
                          </span>
                          <span className="rm-email-cta-text">
                            <span className="rm-email-cta-title">Draft &amp; check your email</span>
                            <span className="rm-email-cta-sub">Designed with advice from 30+ professors</span>
                          </span>
                          <span className="rm-email-cta-arrow" aria-hidden="true">&rarr;</span>
                        </button>
                        {/* Summary usage notices — only for free logged-in users */}
                        {!isPaid && !!user && getSummariesRemaining() === 1 && (
                          <div style={{ marginTop: "10px", padding: "10px 14px", background: "rgba(101, 153, 131,0.055)", border: "1px solid rgba(101, 153, 131,0.13)", borderRadius: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "0.82rem", color: "#2d5a47", opacity: 0.6, flexShrink: 0 }}>ℹ</span>
                            <span style={{ fontSize: "0.8rem", color: "#2d5a47", fontWeight: 500 }}>1 free summary left.</span>
                          </div>
                        )}
                        {!isPaid && !!user && getSummariesRemaining() === 0 && (
                          <div style={{ marginTop: "10px", padding: "10px 14px", background: "rgba(101, 153, 131,0.055)", border: "1px solid rgba(101, 153, 131,0.13)", borderRadius: "10px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontSize: "0.82rem", color: "#2d5a47", opacity: 0.6, flexShrink: 0 }}>ℹ</span>
                              <span style={{ fontSize: "0.8rem", color: "#2d5a47", fontWeight: 500 }}>You&apos;ve used your 2 free summaries.</span>
                            </div>
                            <p style={{ fontSize: "0.74rem", color: "#8aaa9d", marginTop: "3px", paddingLeft: "21px" }}>Upgrade for unlimited access to all professors.</p>
                          </div>
                        )}
                      </>
                    ) : !user && !!summaries[id] ? (
                      <button
                        onClick={() => openEmailDraft(author)}
                        className="rm-email-cta"
                        style={{ marginTop: "28px" }}
                      >
                        <span className="rm-email-cta-icon" aria-hidden="true">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>
                        </span>
                        <span className="rm-email-cta-text">
                          <span className="rm-email-cta-title">Check your email before you send</span>
                          <span className="rm-email-cta-sub">Free to try. No account needed</span>
                        </span>
                        <span className="rm-email-cta-arrow" aria-hidden="true">&rarr;</span>
                      </button>
                    ) : (
                      <div className="rm-locked-row" style={{ marginTop: "16px" }}>
                        <span style={{ fontSize: "0.85rem", color: "#6b7280", flex: 1 }}>Email checker</span>
                        <span className="rm-locked-tag">Summarize to unlock</span>
                      </div>
                    )}
                  </div>
                ) : (
                  /* No summary loaded yet — show summarize button (free for all), or upgrade overlay */
                  !user && getSummariesRemaining() > 0 ? (
                    /* Anon with free summaries left: show real summarize button — full summary is the wow moment */
                    <div style={{ marginTop: "28px" }}>
                      <button onClick={() => loadSummary(author)} disabled={isLoadingSummary} className="rm-summarize-btn">
                        {isLoadingSummary ? (
                          <>Generating summary<span className="rm-dots" aria-hidden="true"><i></i><i></i><i></i></span></>
                        ) : (
                          <>Summarize research <span style={{ fontSize: "1.1em", marginLeft: "2px" }}>→</span></>
                        )}
                      </button>
                    </div>
                  ) : getSummariesRemaining() <= 0 && !isPaid ? (
                    /* Free user, out of uses */
                    <div style={{ marginTop: "24px", position: "relative", borderRadius: "14px", overflow: "visible" }}>
                      <div style={{ padding: "80px 24px", filter: "blur(6px)", userSelect: "none", pointerEvents: "none", borderRadius: "14px", overflow: "hidden" }}>
                        <p style={{ fontSize: "1.05rem", lineHeight: 1.7, color: "#6b7280" }}>
                          This professor studies the intersection of computational methods and experimental techniques to advance understanding in their field. Their recent work focuses on developing novel approaches that combine interdisciplinary insights.
                        </p>
                      </div>
                      <div
                        className="locked-summary-overlay"
                        style={{ paddingBottom: "28px" }}
                        onClick={() => {
                          setUpgradeModalTitle("See what this professor studies");
                          setUpgradeModalSubtitle("Their key findings, the questions worth asking, and your email checked before you send.");
                          hitPaywall("summary");
                        }}
                      >
                        <p style={{ fontSize: "1rem", fontWeight: 700, color: "#2d5a47", marginBottom: "6px" }}>
                          See this professor&apos;s research
                        </p>
                        <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "14px" }}>
                          Their key findings and the questions worth asking.
                        </p>
                        <span className="locked-upgrade-btn" style={{ padding: "10px 24px", fontSize: "0.85rem" }}>
                          Reveal this summary →
                        </span>
                      </div>
                    </div>
                  ) : (
                    /* Has remaining uses: show Summarize button */
                    <div style={{ marginTop: "28px" }}>
                      <button onClick={() => loadSummary(author)} disabled={isLoadingSummary} className="rm-summarize-btn">
                        {isLoadingSummary ? (
                          <>Generating summary<span className="rm-dots" aria-hidden="true"><i></i><i></i><i></i></span></>
                        ) : (
                          <>Summarize research <span style={{ fontSize: "1.1em", marginLeft: "2px" }}>→</span></>
                        )}
                      </button>
                      {!isPaid && !isLoadingSummary && (
                        <span className="rm-free-hint">
                          {getSummariesRemaining()} free {getSummariesRemaining() === 1 ? "use" : "uses"} remaining. Each unlocks all features for this professor
                        </span>
                      )}
                      {isPaid && !isLoadingSummary && (
                        <button onClick={() => openEmailDraft(author)} className="btn-secondary" style={{ marginTop: "12px", padding: "12px 28px", fontSize: "0.95rem", display: "block" }}>
                          Draft email to professor &rarr;
                        </button>
                      )}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>

        {/* PAGINATION */}
        {isPaid && !showSaved && totalPages > 1 && (
          <div className="rm-pagination">
            <button
              className="rm-page-btn"
              disabled={currentPage === 1}
              onClick={() => { setCurrentPage(p => p - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            >← Prev</button>
            <span className="rm-page-info">Page {currentPage} of {totalPages}</span>
            <button
              className="rm-page-btn"
              disabled={currentPage === totalPages}
              onClick={() => { setCurrentPage(p => p + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            >Next →</button>
          </div>
        )}

        {/* LOCKED PROFESSORS PROMPT — shown when there are more than 3 results */}
        {!isPaid && !showSaved && displayList.length > 3 && (
          <div style={{
            marginTop: "8px",
            background: "linear-gradient(135deg, rgba(101, 153, 131,0.06) 0%, rgba(101, 153, 131,0.03) 100%)",
            border: "1.5px solid rgba(101, 153, 131,0.15)",
            borderRadius: "20px",
            padding: "32px 28px",
            textAlign: "center",
          }}>
            <p style={{ fontWeight: 700, fontSize: "1.05rem", color: "#2d5a47", marginBottom: "8px" }}>
              {displayList.length - 3} more professor{displayList.length - 3 === 1 ? "" : "s"} found for your search
            </p>
            <p style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "22px", maxWidth: "420px", margin: "0 auto 22px" }}>
              Upgrade to see all results, get unlimited searches, and access every email tool.
            </p>
            <button
              onClick={() => hitPaywall("professor_results")}
              style={{
                background: "#659983",
                color: "#fff",
                border: "none",
                borderRadius: "14px",
                padding: "14px 32px",
                fontSize: "0.95rem",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(101, 153, 131,0.25)",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 24px rgba(101, 153, 131,0.35)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ""; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 16px rgba(101, 153, 131,0.25)"; }}
            >
              {`Unlock all ${displayList.length} professors →`}
            </button>
          </div>
        )}

        {/* NEARBY PROFESSORS */}
        {!showSaved && results.length > 0 && (nearbyLoading || nearbyProfs.length > 0) && (
          <div style={{ marginTop: "60px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px", marginBottom: "28px" }}>
              <div style={{ flex: 1, height: "1px", background: "linear-gradient(to right, transparent, rgba(101, 153, 131,0.5), transparent)" }} />
              <h2 style={{
                fontSize: "1.4rem", fontWeight: 700, color: "#2d5a47",
                letterSpacing: "-0.01em",
              }}>
                Nearby researchers
              </h2>
              <div style={{ flex: 1, height: "1px", background: "linear-gradient(to right, transparent, rgba(101, 153, 131,0.5), transparent)" }} />
            </div>

            {nearbyLoading && (
              <div style={{ textAlign: "center", padding: "30px 0" }}>
                <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>Finding similar researchers<span className="rm-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px" }}>
              {nearbyProfs.map((author, i) => (
                <div key={author.id} className="glass-card card-enter" style={{
                  padding: "28px",
                  position: "relative",
                  overflow: "hidden",
                  animationDelay: `${i * 0.12}s`,
                }}>
                  {/* Lock overlay for free users who haven't summarized anyone yet */}
                  {isFree && Object.keys(summaries).length === 0 && (
                    <div style={{
                      position: "absolute", inset: 0, zIndex: 2,
                      background: "rgba(245,240,230,0.7)",
                      backdropFilter: "blur(6px)",
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                      borderRadius: "inherit", padding: "24px",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      // Anon just needs to summarize (free) — no account prompt here.
                      // Logged-in free users get the upgrade path.
                      if (user) setShowUpgradeModal(true);
                    }}
                    >
                      <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#2d5a47", textAlign: "center", marginBottom: "6px" }}>
                        Summarize a professor to unlock
                      </p>
                      <p style={{ fontSize: "0.8rem", color: "#6b7280", textAlign: "center" }}>
                        Use your free Summarize on any professor above to see nearby researchers
                      </p>
                    </div>
                  )}

                  {/* Card content (visible but blurred for free) */}
                  <a href={profileUrl(author)} target="_blank" rel="noopener noreferrer" style={{
                    fontSize: "1.2rem", fontWeight: 700, color: "#2d5a47",
                    textDecoration: "none", display: "block", marginBottom: "4px",
                    transition: "color 0.2s",
                  }}>
                    {author.display_name}
                  </a>
                  <p style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "12px" }}>
                    {formatInstitutionLocation(author.last_known_institutions?.[0])}
                  </p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                    {author.topics?.slice(0, 3).map((t, j) => (
                      <span key={j} className="tag" style={{ fontSize: "0.75rem", padding: "4px 10px" }}>{t.display_name}</span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "16px", fontSize: "0.85rem", color: "#6b7280" }}>
                    <span><strong>{author.works_count}</strong> papers</span>
                    <span><strong>{author.cited_by_count.toLocaleString()}</strong> citations</span>
                  </div>

                  {/* For paid users: show summarize button */}
                  {isPaid && (
                    <button
                      onClick={() => loadSummary(author)}
                      className="btn-secondary"
                      style={{ marginTop: "16px", padding: "8px 20px", fontSize: "0.8rem", width: "100%" }}
                    >
                      {loadingSummary[author.id.split("/").pop()!] ? (
                        <>Summarizing<span className="rm-dots" aria-hidden="true"><i></i><i></i><i></i></span></>
                      ) : summaries[author.id.split("/").pop()!] ? "View summary ↓" : "Summarize research →"}
                    </button>
                  )}

                  {/* Show summary if loaded (paid only) */}
                  {isPaid && summaries[author.id.split("/").pop()!] && (
                    <div className="summary-enter" style={{ marginTop: "16px" }}>
                      <p style={{ fontSize: "0.9rem", lineHeight: 1.65, color: "#6b7280" }}>
                        {summaries[author.id.split("/").pop()!].summary}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

          </>
        )}

        {/* EMAIL MODAL */}
        {emailTarget && (
          <EmailComposerModal
            target={emailTarget}
            summary={summaries[emailTarget.id.split("/").pop()!]}
            loadingSummary={Boolean(loadingSummary[emailTarget.id.split("/").pop()!])}
            draft={emailDraft}
            flags={emailFlags}
            totalFlags={emailTotalFlags}
            checking={checkingEmail}
            checked={hasChecked}
            resultGated={resultGated}
            frameworkOpen={showFramework}
            activeTab={mobileEmailTab}
            freeEmailCheckUsed={freeEmailCheckUsed}
            loggedIn={Boolean(user)}
            isPaid={isPaid}
            isFree={isFree}
            wordCount={wordCount}
            sheetRef={emailSheetRef}
            onDragStart={onSheetDragStart}
            onDragMove={onSheetDragMove}
            onDragEnd={onSheetDragEnd}
            onClose={closeEmailModal}
            onTabChange={setMobileEmailTab}
            onToggleFramework={() => setShowFramework((open) => !open)}
            onFrameworkSignup={() => {
              setShowAuthModal(true);
              setAuthMode("signup");
              setAuthError("");
            }}
            onDraftChange={(draft) => {
              setEmailDraft(draft);
              setHasChecked(false);
            }}
            onCheck={checkEmail}
            onCopy={handleCopy}
            onCheckerSignup={openCheckerSignup}
            onSummaryPaywall={openSummaryPaywall}
          />
        )}
        {/* TOAST */}
        {toast && (
          <div className="toast" key={toast.msg}>
            {toast.msg}
            <div className="toast-timer" style={{ animationDuration: `${toast.duration}ms` }} />
          </div>
        )}
      </main>

      {/* AUTH MODAL */}
      {showAuthModal && (
        <AccountModal
          mode={authMode}
          copy={authModalCopy}
          email={authEmail}
          password={authPassword}
          error={authError}
          loading={authLoading}
          dialogRef={authModalRef}
          onClose={() => setShowAuthModal(false)}
          onSubmit={handleAuthSubmit}
          onEmailChange={setAuthEmail}
          onPasswordChange={setAuthPassword}
          onPasswordReset={sendPasswordReset}
          onModeChange={(mode) => { setAuthMode(mode); setAuthError(""); }}
        />
      )}

      {/* UPGRADE MODAL */}
      {showUpgradeModal && (
        <UpgradeModal
          title={upgradeModalTitle}
          subtitle={upgradeModalSubtitle}
          referralCode={checkoutReferralCode}
          checkoutError={checkoutError}
          onClose={() => setShowUpgradeModal(false)}
          onReferralCodeChange={(value) => {
            const normalized = normalizeReferralCode(value);
            setCheckoutReferralCode(normalized);
            storePendingReferralCode(normalized);
            setCheckoutError("");
          }}
          onCheckout={startPlanCheckout}
        />
      )}
    </>
  );
}
