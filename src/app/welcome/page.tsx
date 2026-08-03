"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WelcomeScreen from "./WelcomeScreen";
import { clearPendingReferralCode } from "@/lib/browser-storage";

const WELCOME_KEY = "rm_welcomed";

export default function WelcomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    clearPendingReferralCode();
    const alreadySeen = localStorage.getItem(WELCOME_KEY);
    if (alreadySeen) {
      router.replace("/app");
      return;
    }
    // Mark immediately — refreshing won't show this again
    localStorage.setItem(WELCOME_KEY, "1");
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [router]);

  // While checking localStorage (or redirecting), show the same dark green
  // background so there's zero flash of white
  if (!ready) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#659983",
        }}
      />
    );
  }

  return <WelcomeScreen />;
}
