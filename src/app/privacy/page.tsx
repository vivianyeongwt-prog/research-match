import type { Metadata } from "next";
import Link from "next/link";
import { LegalSection, LegalShell } from "../legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy | Research Match",
  description: "How Research Match collects, uses, and protects information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalShell eyebrow="Privacy Policy" title="Your research interests are personal." intro="This policy explains what Research Match receives, why it is needed, and the choices available to you.">
      <LegalSection title="Information you provide">
        <p>We may receive your account email, research interests, universities, saved preferences, feedback, support messages, referral activity, and content you submit to tools such as the research summarizer, email checker, email finder, or follow-up generator.</p>
        <p>Payments are processed by Stripe. Research Match does not receive or store your complete payment-card number.</p>
      </LegalSection>
      <LegalSection title="Information collected automatically">
        <p>We may collect basic device, browser, page-view, referral, error, and usage information. We also use an IP-derived pseudonymous identifier to prevent abuse and enforce free-use limits. Search interests and selected universities may be logged to understand product usage.</p>
      </LegalSection>
      <LegalSection title="How information is used">
        <ul>
          <li>Provide professor search, summaries, email tools, account access, billing, and referrals.</li>
          <li>Protect the service, enforce usage limits, prevent fraud, and diagnose failures.</li>
          <li>Measure and improve product performance and communicate about support or account issues.</li>
          <li>Meet legal obligations and enforce the Terms of Service.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Service providers">
        <p>Information is processed only as needed by providers that help operate the service. These may include Supabase for authentication and data storage, Vercel for hosting and performance analytics, Stripe for payments, PostHog for product analytics, Anthropic for AI-assisted features, Serper for web search, and OpenAlex or ORCID for public research information.</p>
        <p>Email drafts and other content submitted to an AI feature are sent to the provider used for that request. Do not submit sensitive personal, health, financial, or confidential research information.</p>
      </LegalSection>
      <LegalSection title="Sharing and sale of data">
        <p>We do not sell personal information for money. We share information with service providers, when you direct us to do so, to protect users and the service, or when required by law. If the business is transferred, relevant information may transfer with it subject to this policy and applicable law.</p>
      </LegalSection>
      <LegalSection title="Retention and your choices">
        <p>We keep information only as long as reasonably needed for the purposes above, including security, billing, dispute, and legal-record obligations. You may request access, correction, export, or deletion through the <Link href="/contact">contact page</Link>. Some billing, fraud-prevention, or legal records may need to be retained.</p>
        <p>You may disable optional analytics through browser controls. Essential authentication, security, and billing storage is required for the service to work.</p>
      </LegalSection>
      <LegalSection title="Children">
        <p>Research Match is not directed to children under 13, and users under 13 may not create an account. If you believe a child under 13 provided personal information, contact us so it can be reviewed and removed.</p>
      </LegalSection>
      <LegalSection title="Security and changes">
        <p>We use administrative, technical, and organizational safeguards designed to protect information, but no online system is completely secure. We may update this policy as the service changes. Material updates will be posted here with a new effective date.</p>
      </LegalSection>
    </LegalShell>
  );
}
