import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import axios from 'axios';
import {
  Zap, Sparkles, ArrowRight, Play, GitBranch, Cpu, CheckCircle2,
} from 'lucide-react';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';

/**
 * Home (`/`) — rewritten from the old single-page mega-scroll that used
 * to BE the entire marketing site (Hero + Features + Use Cases + How It
 * Works + Comparison + FAQ + CTA, all in one file, one route). Per the
 * decision to split into a real multi-page site (Home/Features/Use
 * Cases/Pricing), this is now a proper homepage: a strong hero, a brief
 * "3 pillars" teaser of what the product actually does today (Editor,
 * Sandboxes, GitHub Connectors — the latter two didn't exist when the
 * original copy was written and were completely absent from the site
 * until now), and clear paths into the three other pages rather than
 * trying to explain everything on one screen.
 *
 * Old FAQ/Comparison content moved to FeaturesPage.tsx/PricingPage.tsx
 * respectively — not duplicated here, so there's exactly one place each
 * lives and no risk of the two copies drifting apart.
 */
export default function LandingPage() {

  useEffect(() => {
    // Fire and forget visit tracking
    const trackVisit = async () => {
        try {
            await axios.post(`${import.meta.env.VITE_API_URL}/visit`);
        } catch (e) { /* ignore errors for analytics */ }
    };
    trackVisit();
  }, []);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#050509] text-slate-300 font-sans selection:bg-ubiq-accent/30 selection:text-ubiq-accent">
      <MarketingNavbar />

      {/* --- HERO SECTION --- */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-6 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium mb-6"
          >
            <Sparkles className="w-3 h-3" />
            <span>Code, run, and ship — without leaving the editor</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold text-white tracking-tight leading-[1.1] mb-6"
          >
            Code at the Speed of <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">Thought.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed"
          >
            The AI editor that blends <strong>Local Privacy</strong> with <strong>Cloud Power</strong> — then actually runs your code
            in a live sandbox and imports straight from GitHub, so you can see it work, not just write it.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col md:flex-row items-center justify-center gap-4"
          >
            <Link to="/register" className="w-full md:w-auto px-8 py-3.5 bg-white text-black font-semibold rounded-lg hover:bg-slate-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)] flex items-center justify-center gap-2">
              <Zap className="w-4 h-4" /> Start Coding Free
            </Link>
            <Link to="/features" className="w-full md:w-auto px-8 py-3.5 bg-white/5 border border-white/10 text-white font-semibold rounded-lg hover:bg-white/10 transition-all flex items-center justify-center gap-2 backdrop-blur-sm">
              See How It Works <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>

        {/* Hero Visual */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-20 max-w-6xl mx-auto rounded-xl border border-white/10 shadow-2xl bg-[#0B0B10] overflow-hidden relative group"
        >
          <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/5 to-purple-500/5 pointer-events-none" />
          <div className="h-8 border-b border-white/5 flex items-center px-4 gap-2 bg-[#121218]">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
              <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
            </div>
            <div className="ml-4 px-3 py-0.5 rounded-md bg-white/5 border border-white/5 text-[10px] font-mono text-slate-500">
              ubiq-editor.space
            </div>
          </div>
          <div className="aspect-[16/9] bg-[#0B0B10] relative p-8 font-mono text-sm text-left">
             <div className="flex h-full gap-4">
                <div className="w-1/4 border-r border-white/5 pr-4 hidden md:block opacity-50">
                   <div className="h-4 w-2/3 bg-white/10 rounded mb-4" />
                   <div className="h-3 w-full bg-white/5 rounded mb-2" />
                   <div className="h-3 w-4/5 bg-white/5 rounded mb-2" />
                   <div className="h-3 w-3/4 bg-white/5 rounded mb-2" />
                </div>
                <div className="flex-1">
                   <div className="text-purple-400">const <span className="text-blue-400">UbiqEditor</span> = <span className="text-yellow-400">async</span> () ={'>'} {'{'}</div>
                   <div className="pl-4 text-slate-400">// Import from GitHub, run it live</div>
                   <div className="pl-4">
                      <span className="text-purple-400">const</span> repo = <span className="text-green-400">'your-org/api-service'</span>;
                   </div>
                   <div className="pl-4 text-slate-300">
                      <span className="text-indigo-400 animate-pulse">|</span>
                   </div>
                   <div className="mt-4 p-4 border border-indigo-500/30 bg-indigo-500/5 rounded-lg max-w-md">
                      <div className="flex items-center gap-2 text-indigo-300 text-xs mb-1">
                         <Sparkles className="w-3 h-3" /> AI Assistant
                      </div>
                      <p className="text-slate-300">I can help you refactor this function to run locally using Llama 3 or scale it via GPT-4o.</p>
                   </div>
                </div>
             </div>
          </div>
        </motion.div>
      </section>

      {/* --- 3 PILLARS TEASER --- */}
      <section className="py-24 bg-[#050509]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Not just an editor</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">Write, run, and ship — all in one workspace.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <PillarCard
              icon={<Cpu className="w-6 h-6 text-green-400" />}
              title="Local + Cloud AI"
              description="Run local models via Ollama for free and fully offline, or bring your own OpenAI, Google, or Mistral key for more power — no markup, ever."
            />
            <PillarCard
              icon={<Play className="w-6 h-6 text-indigo-400" />}
              title="Live Sandboxes"
              description="Click Run and watch your app actually boot — live logs, health checks, CPU/memory vitals, and a shareable preview link, all built in."
            />
            <PillarCard
              icon={<GitBranch className="w-6 h-6 text-purple-400" />}
              title="GitHub Connectors"
              description="Connect your GitHub account once, then browse and import your repos with one click — no pasted tokens, no copy-pasted URLs."
            />
          </div>

          <div className="text-center mt-12">
            <Link to="/features" className="inline-flex items-center gap-2 text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
              See everything Ubiq can do <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* --- USE CASES TEASER --- */}
      <section className="py-24 border-y border-white/5 bg-[#0B0B10]">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <div className="text-indigo-400 font-semibold tracking-wider text-sm mb-2 uppercase">Built for Everyone</div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">From Learning to Shipping</h2>
          <p className="text-slate-400 max-w-2xl mx-auto mb-10">
            Students learning to code, professionals refactoring legacy systems, indie hackers shipping fast, and small teams importing a teammate's repo to see it run — Ubiq adapts to how you work.
          </p>
          <Link to="/use-cases" className="inline-flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 text-white font-semibold rounded-full hover:bg-white/10 transition-all">
            Explore Use Cases <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* --- PRICING TEASER --- */}
      <section className="py-24 bg-[#050509]">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Simple, wholesale pricing</h2>
          <p className="text-slate-400 max-w-2xl mx-auto mb-10">
            Bring your own AI keys and pay providers directly — no markup from us. Free tier included, no credit card required.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-slate-400 mb-10">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> Free tier with local AI</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> Cancel anytime</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-indigo-400" /> No AI markup, ever</span>
          </div>
          <Link to="/pricing" className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-full transition-all shadow-lg shadow-indigo-600/20">
            View Pricing <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* --- CTA FOOTER --- */}
      <section className="py-24 px-6 border-t border-white/5 bg-[#0B0B10]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">Ready to build something amazing?</h2>
          <p className="text-slate-400 text-lg mb-10">Join developers coding smarter with Ubiq Editor.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
             <Link to="/register" className="px-10 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-full transition-all shadow-xl shadow-indigo-600/20 text-lg">
                Get Started for Free
             </Link>
             <span className="text-slate-500 text-sm">No credit card required for local use.</span>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function PillarCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="p-6 rounded-2xl bg-[#0B0B10] border border-white/5 hover:border-white/10 transition-colors group">
      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
      <p className="text-slate-400 leading-relaxed">{description}</p>
    </div>
  );
}
