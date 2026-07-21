import type { Metadata } from "next";
import Link from "next/link";
import { LegalSection, LegalShell } from "../legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service | Research Match",
  description: "Terms governing use of Research Match.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalShell eyebrow="Terms of Service" title="Use the tool thoughtfully." intro="These terms govern access to Research Match, including its professor search, research summaries, email tools, and paid plans.">
      <LegalSection title="Eligibility and accounts">
        <p>You must be at least 13 to use Research Match. If you are under the age of majority where you live, a parent or guardian must permit your use. Keep account credentials secure and provide accurate account and billing information.</p>
      </LegalSection>
      <LegalSection title="What the service provides">
        <p>Research Match organizes public research information and provides AI-assisted summaries and outreach tools. Results may be incomplete, outdated, or incorrect. Labels about publication activity do not indicate that a professor is accepting students, has funding, or will reply. Verify important details through official university and faculty sources before acting.</p>
        <p>Research Match does not make admissions, employment, funding, academic, or professional decisions and does not guarantee a response or opportunity.</p>
      </LegalSection>
      <LegalSection title="Plans and billing">
        <p>Prices, billing frequency, included features, and renewal terms are shown before checkout. Subscription plans continue until canceled. You can cancel an active subscription from your profile and retain access through the paid period unless a refund or dispute reverses that payment.</p>
        <p>Lifetime access is a one-time license to use the purchased Research Match features for as long as Research Match operates those features. It is personal, non-transferable, and does not promise that the service will operate forever without change.</p>
        <p>Refunds are provided only when required by law or when a written offer shown at purchase expressly applies. Approved full refunds revoke the access provided by that payment.</p>
      </LegalSection>
      <LegalSection title="Acceptable use">
        <p>You may not abuse rate limits, bypass access controls, scrape or resell the service, probe security, automate bulk outreach, impersonate another person, submit unlawful material, or use results for harassment, spam, discrimination, or decisions that produce legal or similarly significant effects.</p>
      </LegalSection>
      <LegalSection title="Your content and AI features">
        <p>You retain rights in content you submit. You grant Research Match and its service providers permission to process that content only as needed to operate, secure, and improve the requested service. You are responsible for reviewing generated material before using it and for having the right to submit the content.</p>
      </LegalSection>
      <LegalSection title="Public information and intellectual property">
        <p>Professor, publication, institution, and contact information may come from third-party public sources with their own terms. The Research Match interface, branding, original text, code, and product design remain protected by applicable intellectual-property law. No ownership transfers merely because you use the service.</p>
      </LegalSection>
      <LegalSection title="Suspension and availability">
        <p>We may restrict or terminate access for abuse, fraud, security risk, nonpayment, or material violation of these terms. The service may change, pause, or discontinue, and specific third-party data or features may become unavailable.</p>
      </LegalSection>
      <LegalSection title="Disclaimers and responsibility">
        <p>To the extent permitted by law, the service is provided “as is” and “as available.” Research Match is not responsible for decisions made by professors, universities, payment providers, public-data sources, or other third parties. Nothing here limits rights that cannot legally be waived.</p>
      </LegalSection>
      <LegalSection title="Questions">
        <p>Questions about these terms, billing, or account access can be submitted through the <Link href="/contact">contact page</Link>. We may update these terms as the service changes; continued use after an effective-date change means the updated terms apply.</p>
      </LegalSection>
    </LegalShell>
  );
}
