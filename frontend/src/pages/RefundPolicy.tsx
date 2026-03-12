import { LegalLayout } from '../components/LegalLayout';

export default function RefundPolicy() {
  return (
    <LegalLayout title="Refund Policy" lastUpdated="March 08, 2026">
      <section>
        <p className="lead text-lg text-slate-200">
          We want you to be fully satisfied with Ubiq-Editor. If our platform doesn't meet your expectations, we offer a transparent refund process.
        </p>
      </section>

      <section>
        <h2>1. 7-Day Money-Back Guarantee</h2>
        <p>
          New subscribers are eligible for a full refund within **7 days** of their initial purchase of the Pro Plan ($9.00/mo). This "cooling-off" period allows you to explore our AI coding tools and server integrations risk-free.
        </p>
      </section>

      <section>
        <h2>2. Eligibility Criteria</h2>
        <p>To prevent abuse of our AI resources, refunds are subject to the following conditions:</p>
        <ul>
          <li><strong>Fair Use:</strong> You must not have exceeded 50 AI-generated code requests during the trial period.</li>
          <li><strong>One-Time Offer:</strong> The guarantee applies only to your first subscription. Subsequent renewals or re-subscriptions are not eligible for refunds.</li>
          <li><strong>Violations:</strong> Accounts suspended for violating our Terms of Service (e.g., unauthorized server usage) forfeit their right to a refund.</li>
        </ul>
      </section>

      <section>
        <h2>3. Renewals and Cancellations</h2>
        <ul>
          <li><strong>Automatic Renewals:</strong> Subscriptions renew automatically every month. We do not offer refunds for forgotten renewals once the 7-day initial window has passed.</li>
          <li><strong>Cancellation:</strong> You may cancel at any time via the <strong>Settings &gt; Billing</strong> tab. You will continue to have Pro access until the end of your current billing period.</li>
        </ul>
      </section>

      <section>
        <h2>4. How to Request a Refund</h2>
        <p>
          To initiate a refund, please email our support team at <strong>support@ubiq-editor.space</strong>. Please include:
        </p>
        <ol>
          <li>Your account email address.</li>
          <li>The Transaction ID from your PayPal or card receipt.</li>
          <li>A brief reason for the request (this helps us improve the platform).</li>
        </ol>
      </section>

      <section>
        <h2>5. Processing Time</h2>
        <p>
          Once approved, refunds are typically processed within 5-10 business days. The funds will be returned via the original payment method used during checkout.
        </p>
      </section>
    </LegalLayout>
  );
}