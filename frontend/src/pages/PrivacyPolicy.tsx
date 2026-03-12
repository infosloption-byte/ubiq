import { LegalLayout } from '../components/LegalLayout';

export default function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="March 08, 2026">
      <section>
        <p className="lead text-lg text-slate-200">
          At Ubiq-Editor, we respect your privacy and are committed to protecting the personal data and intellectual property you entrust to our platform.
        </p>
      </section>

      <section>
        <h2>1. Information We Collect</h2>
        <ul>
          <li><strong>Account Information:</strong> Name, email address, and authentication identifiers provided through Google or GitHub.</li>
          <li><strong>Project Data:</strong> Source code, folder structures, and configuration files stored within your project workspace.</li>
          <li><strong>AI Interaction Logs:</strong> Prompts sent to our AI models and the resulting code generations to facilitate undo/redo and history features.</li>
          <li><strong>Billing Data:</strong> Transaction IDs and subscription status. Note: We do not store credit card details; these are handled by PCI-compliant processors like PayPal.</li>
        </ul>
      </section>

      <section>
        <h2>2. How We Use Your Data</h2>
        <p>Your data is used strictly to provide the core IDE experience, including:</p>
        <ul>
          <li>Managing your AWS EC2 server instances and deployments.</li>
          <li>Authenticating your access to "ubiq" coding tools.</li>
          <li>Providing bilingual support (English and Sinhala) for voice and text commands.</li>
        </ul>
      </section>

      <section>
        <h2>3. Data Security & Hosting</h2>
        <p>
          We host your data on secure Amazon Web Services (AWS) infrastructure. We implement industry-standard encryption for data at rest and in transit. However, as an online platform, we cannot guarantee absolute security against all unauthorized access.
        </p>
      </section>

      <section>
        <h2>4. Data Retention & Deletion</h2>
        <p>
          We retain your project data as long as your account is active. If you choose to delete your account, all associated source code and project metadata will be purged from our active databases within 30 days.
        </p>
      </section>

      <section>
        <h2>5. Your Rights</h2>
        <p>
          You have the right to access, correct, or delete your personal information at any time through your Account Settings. For data portability requests regarding your project files, you may use our built-in export tools.
        </p>
      </section>
    </LegalLayout>
  );
}