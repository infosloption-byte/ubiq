import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, ArrowRight, GraduationCap, Briefcase, Rocket, Users } from 'lucide-react';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';

/**
 * New dedicated Use Cases page. The old single-page site had three
 * personas (Students/Professionals/Indie Hackers) written entirely
 * around the original BYOK-editor pitch. Kept all three (still
 * accurate), added a fourth ("Small teams shipping fast") that's
 * specifically about Sandboxes + GitHub Connectors working together —
 * neither existed when the original three were written, and "import a
 * repo, run it live, share a preview link, push back" is a genuinely
 * different use case from the original three, not just a features list
 * item.
 */
export default function UseCasesPage() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#050509] text-slate-300 font-sans selection:bg-ubiq-accent/30 selection:text-ubiq-accent">
      <MarketingNavbar />

      <section className="relative pt-40 pb-20 px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="text-indigo-400 font-semibold tracking-wider text-sm mb-2 uppercase">Built for Everyone</div>
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight mb-6">From Learning to Shipping</h1>
            <p className="text-lg text-slate-400 max-w-xl mx-auto">
              Whoever you are, Ubiq adapts — free local models to learn on, cloud power when you need it, and a live sandbox to actually see your work run.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="pb-24 px-6">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-8">
          <UseCaseCard
            icon={<GraduationCap className="w-7 h-7 text-emerald-400" />}
            title="For Students"
            desc="A patient tutor that runs locally. Learn Python or JS without expensive API costs using free local models — then click Run and actually see your project work, not just read about it."
            points={['Free forever with local models', 'No API costs while you\'re learning', 'Live preview so mistakes are obvious, not abstract']}
          />
          <UseCaseCard
            icon={<Briefcase className="w-7 h-7 text-indigo-400" />}
            title="For Professionals"
            desc="Refactor legacy codebases securely. Use local AI for proprietary code and cloud AI for open-source libraries — your call, project by project."
            points={['Keep sensitive code fully offline', 'Switch to cloud power only when you need it', 'Context-aware answers across your whole codebase']}
          />
          <UseCaseCard
            icon={<Rocket className="w-7 h-7 text-purple-400" />}
            title="For Indie Hackers"
            desc="Ship faster. Generate boilerplate, write documentation, and debug errors in seconds — then run it live and share a preview link before you've even pushed to GitHub."
            points={['Boilerplate and docs generated in seconds', 'Live preview links to share early feedback', 'Wholesale AI pricing, no subscription markup']}
          />
          <UseCaseCard
            icon={<Users className="w-7 h-7 text-amber-400" />}
            title="For Small Teams Shipping Fast"
            desc="Import a teammate's repo straight from your connected GitHub account, run it in a live sandbox to see exactly what they built, and push your own changes back — no local setup, no 'works on my machine.'"
            points={['One-click repo import via GitHub Connectors', 'Live sandboxes with health & vitals, not guesswork', 'Push commits and open PRs without leaving Ubiq']}
          />
        </div>
      </section>

      <section className="py-24 px-6 border-t border-white/5 bg-[#0B0B10]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">Find your workflow.</h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/register" className="px-10 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-full transition-all shadow-xl shadow-indigo-600/20 text-lg flex items-center gap-2">
              Get Started for Free <ArrowRight className="w-5 h-5" />
            </Link>
            <Link to="/features" className="px-10 py-4 bg-white/5 border border-white/10 text-white font-semibold rounded-full hover:bg-white/10 transition-all text-lg">
              See All Features
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function UseCaseCard({ icon, title, desc, points }: { icon: React.ReactNode; title: string; desc: string; points: string[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="p-8 rounded-2xl border border-white/10 bg-[#0B0B10] hover:border-white/20 transition-colors"
    >
      <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center mb-6">{icon}</div>
      <h3 className="text-2xl font-bold text-white mb-3">{title}</h3>
      <p className="text-slate-400 mb-6 leading-relaxed">{desc}</p>
      <ul className="space-y-2.5 text-sm text-slate-400">
        {points.map(p => (
          <li key={p} className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" /> {p}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
