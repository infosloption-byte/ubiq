import { LegalLayout } from '../components/LegalLayout';

export default function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="March 08, 2026">
      <section>
        <p className="lead text-lg text-slate-200">
          Welcome to Ubiq-Editor. These Terms of Service ("Terms") govern your use of our AI-powered coding platform and infrastructure.
        </p>
      </section>

      <section>
        <h2>1. Account Responsibility</h2>
        <p>
          You are responsible for all activities that occur under your account. You must maintain the confidentiality of your credentials. 
          While we allow account management for personal use, sharing access to bypass subscription tiers is strictly prohibited.
        </p>
      </section>

      <section>
        <h2>2. AI Generation & Intellectual Property</h2>
        <ul>
          <li><strong>Ownership:</strong> You retain full ownership of the code snippets and projects you create or generate using Ubiq-Editor.</li>
          <li><strong>AI Output:</strong> Our AI models provide suggestions based on large datasets. We do not claim intellectual property rights over code generated specifically for your prompts.</li>
          <li><strong>Validation:</strong> You acknowledge that AI-generated code may contain errors, security vulnerabilities, or bugs. You are solely responsible for reviewing and testing code before production deployment.</li>
        </ul>
      </section>

      <section>
        <h2>3. Acceptable Use of Infrastructure</h2>
        <p>
          Ubiq-Editor provides server environments (e.g., AWS EC2 integrations). You agree NOT to use these resources for:
        </p>
        <ul>
          <li>Cryptocurrency mining or unauthorized stress-testing.</li>
          <li>Hosting or distributing malicious software or illegal content.</li>
          <li>Attempting to reverse-engineer our proprietary AI pipelines.</li>
        </ul>
      </section>

      <section>
        <h2>4. Subscription Billing & Payments</h2>
        <p>
          Our Pro Plan ($9.00/mo) is a recurring subscription. By subscribing, you authorize our payment processors (PayPal/Stripe) to charge the designated payment method at the start of each billing cycle.
        </p>
      </section>

      <section>
        <h2>5. Limitation of Liability</h2>
        <p>
          Ubiq-Editor is provided "as is." We are not liable for any data loss, server downtime, or damages resulting from the use of AI-generated code or server configurations. Your use of the platform is at your own risk.
        </p>
      </section>

      <section>
        <h2>6. Modifications to Service</h2>
        <p>
          We reserve the right to modify or discontinue features of the platform at any time. Significant changes to billing will be communicated via the email associated with your account.
        </p>
      </section>
    </LegalLayout>
  );
}