import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Shield, Code2, Cpu, CloudLightning, Key, Lock, Download,
  CheckCircle2, ArrowRight, Play, GitBranch, Activity, HeartPulse,
} from 'lucide-react';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';

/**
 * New dedicated Features page. The old single-page LandingPage.tsx had
 * a "Features" section, but it only ever described the original
 * BYOK-AI-editor pitch (local Ollama + cloud keys) — Sandboxes (F1,
 * live run/preview/health/vitals) and GitHub Connectors (F3, OAuth
 * repo import + push) didn't exist yet when that copy was written, and
 * nothing was ever added to the marketing site after they shipped.
 * Both get real sections here.
 *
 * Provider list fixed to match AiKeyController::ALLOWED_PROVIDERS
 * exactly (google, openai, openrouter, mistral) — the old copy claimed
 * direct "Claude" and "Grok" support, which the backend has never
 * actually had. OpenRouter is real and does proxy to Claude/many other
 * models, so it's mentioned as the path to those, not claimed as a
 * first-class BYOK provider on its own.
 */
export default function FeaturesPage() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#050509] text-slate-300 font-sans selection:bg-ubiq-accent/30 selection:text-ubiq-accent">
      <MarketingNavbar />

      {/* HERO */}
      <section className="relative pt-40 pb-20 px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight mb-6">
              Everything you need to <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">ship, not just write.</span>
            </h1>
            <p className="text-lg text-slate-400 max-w-xl mx-auto">
              An editor, a live sandbox, and a GitHub connection — all in one place, backed by whichever AI you trust with your code.
            </p>
          </motion.div>
        </div>
      </section>

      {/* SANDBOXES — new, wasn't on the site before */}
      <section className="py-24 border-y border-white/5 bg-[#0B0B10]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <div className="text-indigo-400 font-semibold tracking-wider text-sm mb-2 uppercase flex items-center gap-2">
                <Play className="w-4 h-4" /> Live Sandboxes
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">Run it. See it. Ship it.</h2>
              <p className="text-slate-400 mb-8 leading-relaxed">
                Every project gets a real, running sandbox — not just a code editor. Click Run and watch your app boot live, with a shareable preview link the moment it's ready.
              </p>
              <div className="space-y-4">
                <FeatureRow icon={<Activity className="w-5 h-5 text-emerald-400" />} title="Live server logs" desc="Watch your app build and boot in real time, right next to your code." />
                <FeatureRow icon={<HeartPulse className="w-5 h-5 text-emerald-400" />} title="Health & vitals at a glance" desc="CPU, memory, and network for every sandbox — across every project — from one Sandboxes view." />
                <FeatureRow icon={<Shield className="w-5 h-5 text-emerald-400" />} title="Full control" desc="Stop or remove any sandbox with one click when you're done with it." />
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-600 to-indigo-600 blur-[100px] opacity-20" />
              <div className="relative bg-[#050509] border border-white/10 rounded-2xl p-6 shadow-2xl font-mono text-xs">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-emerald-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Running</span>
                  <span className="text-slate-600">:5173</span>
                </div>
                <div className="space-y-1.5 text-slate-500">
                  <div>[Ubiq] Booting react on internal port 5173...</div>
                  <div>[Ubiq] npm install complete.</div>
                  <div className="text-emerald-400">VITE ready in 367 ms</div>
                  <div>➜ Local: http://localhost:5173/</div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/5">
                  <div className="bg-white/5 rounded-lg p-2"><div className="text-slate-600 text-[10px]">CPU</div><div className="text-slate-300">4.2%</div></div>
                  <div className="bg-white/5 rounded-lg p-2"><div className="text-slate-600 text-[10px]">MEM</div><div className="text-slate-300">180MB</div></div>
                  <div className="bg-white/5 rounded-lg p-2"><div className="text-slate-600 text-[10px]">HEALTH</div><div className="text-emerald-400">Good</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GITHUB CONNECTORS — new, wasn't on the site before */}
      <section className="py-24 bg-[#050509]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div className="order-2 md:order-1 relative">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-purple-600 blur-[100px] opacity-20" />
              <div className="relative bg-[#0B0B10] border border-white/10 rounded-2xl p-6 shadow-2xl">
                <div className="flex items-center gap-2 mb-4 text-sm text-white font-semibold"><GitBranch className="w-4 h-4 text-indigo-400" /> Browse repos</div>
                <div className="space-y-2">
                  {['your-org/api-service', 'your-org/marketing-site', 'your-org/mobile-app'].map((r, i) => (
                    <div key={r} className={`px-3 py-2.5 rounded-lg text-xs font-mono flex items-center justify-between ${i === 0 ? 'bg-indigo-500/10 border border-indigo-500/30 text-indigo-300' : 'bg-white/5 text-slate-400'}`}>
                      {r}
                      {i === 0 && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="order-1 md:order-2">
              <div className="text-indigo-400 font-semibold tracking-wider text-sm mb-2 uppercase flex items-center gap-2">
                <GitBranch className="w-4 h-4" /> GitHub Connectors
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">Your repos, one click away.</h2>
              <p className="text-slate-400 mb-8 leading-relaxed">
                Connect your GitHub account once — from your Ubiq account settings, not buried in a dialog — and every new project starts with a searchable list of your actual repos, not a URL you have to go copy.
              </p>
              <div className="space-y-4">
                <FeatureRow icon={<CheckCircle2 className="w-5 h-5 text-indigo-400" />} title="No pasted tokens" desc="Private repos import automatically using your connected account." />
                <FeatureRow icon={<CheckCircle2 className="w-5 h-5 text-indigo-400" />} title="Push straight from the editor" desc="Commit and open pull requests without leaving Ubiq." />
                <FeatureRow icon={<CheckCircle2 className="w-5 h-5 text-indigo-400" />} title="Manage anytime" desc="Connect or disconnect from Settings, in full view of what you've granted access to." />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AI: LOCAL + CLOUD — kept, provider list corrected */}
      <section className="py-24 bg-[#0B0B10] border-y border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Your AI, Your Rules</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              Switch seamlessly between offline privacy and cloud performance. You control the keys.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 mb-16">
            <div className="p-8 rounded-2xl border border-white/10 bg-[#050509] hover:border-green-500/30 transition-colors">
              <div className="w-14 h-14 rounded-xl bg-green-500/10 flex items-center justify-center mb-6">
                <Cpu className="w-7 h-7 text-green-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Local Intelligence</h3>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Run models like Llama 3, Mistral, and Deepseek directly on your machine via <strong>Ollama</strong>. Perfect for sensitive code that cannot leave your device.
              </p>
              <ul className="space-y-3 text-sm text-slate-400">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> 100% Private & Offline</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Zero API Costs (Free Forever)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Uncensored & Custom Models</li>
              </ul>
            </div>

            <div className="p-8 rounded-2xl border border-white/10 bg-[#050509] hover:border-indigo-500/30 transition-colors">
              <div className="w-14 h-14 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-6">
                <CloudLightning className="w-7 h-7 text-indigo-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Cloud Power (BYOK)</h3>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Need reasoning capability? Connect <strong>OpenAI, Google, or Mistral</strong> directly — or route through <strong>OpenRouter</strong> for dozens more models, including Claude. Bring Your Own Key means you pay providers directly, no markup from us.
              </p>
              <ul className="space-y-3 text-sm text-slate-400">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-500" /> GPT-4o, Gemini, Mistral, and more via OpenRouter</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-500" /> Direct Billing (Cheapest Rates)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-500" /> Keys Encrypted &amp; Never Sent Back to Your Browser</li>
              </ul>
            </div>
          </div>

          <div className="max-w-4xl mx-auto border-t border-white/5 pt-16">
            <div className="grid md:grid-cols-3 gap-8 text-center">
              <div>
                <div className="w-12 h-12 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center mx-auto mb-4 border border-white/10">1</div>
                <h4 className="text-white font-semibold mb-2 flex items-center justify-center gap-2"><Download className="w-4 h-4" /> Install Ollama</h4>
                <p className="text-sm text-slate-500">Download and run Ollama locally to enable free, offline models.</p>
              </div>
              <div>
                <div className="w-12 h-12 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center mx-auto mb-4 border border-white/10">2</div>
                <h4 className="text-white font-semibold mb-2 flex items-center justify-center gap-2"><Key className="w-4 h-4" /> Get API Keys</h4>
                <p className="text-sm text-slate-500">Get keys from OpenAI, Google AI Studio, Mistral, or OpenRouter.</p>
              </div>
              <div>
                <div className="w-12 h-12 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center mx-auto mb-4 border border-white/10">3</div>
                <h4 className="text-white font-semibold mb-2 flex items-center justify-center gap-2"><Lock className="w-4 h-4" /> Connect Securely</h4>
                <p className="text-sm text-slate-500">Enter keys in Ubiq Settings. They're encrypted at rest and never sent back to your browser.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CONTEXT-AWARE EDITOR */}
      <section className="py-24 bg-[#050509]">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <div className="w-14 h-14 rounded-xl bg-purple-500/10 flex items-center justify-center mb-6 mx-auto">
            <Code2 className="w-7 h-7 text-purple-400" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Context-aware, not just autocomplete</h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Ubiq reads your entire project structure — ask questions about files you haven't even opened, and get answers grounded in how your codebase actually fits together.
          </p>
        </div>
      </section>

      {/* COMPARISON — "Keys on Device" contradiction fixed */}
      <section className="py-24 bg-[#0B0B10] border-t border-white/5">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Stop paying for AI markup</h2>
            <p className="text-slate-400">Compare Ubiq with other AI editors.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-4 px-6 text-sm font-medium text-slate-500 uppercase tracking-wider">Feature</th>
                  <th className="py-4 px-6 text-sm font-bold text-white bg-indigo-500/10 border-t-2 border-indigo-500">Ubiq Editor</th>
                  <th className="py-4 px-6 text-sm font-medium text-slate-400">Cursor / Copilot</th>
                  <th className="py-4 px-6 text-sm font-medium text-slate-400">VS Code (Vanilla)</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                <tr className="border-b border-white/5">
                  <td className="py-4 px-6 text-slate-300 font-medium">Live sandbox to run & preview</td>
                  <td className="py-4 px-6 text-green-400 font-bold bg-indigo-500/5">✅ Built in</td>
                  <td className="py-4 px-6 text-slate-500">❌ No</td>
                  <td className="py-4 px-6 text-slate-500">❌ No</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-4 px-6 text-slate-300 font-medium">Local AI (Offline)</td>
                  <td className="py-4 px-6 text-green-400 font-bold bg-indigo-500/5">✅ Yes (Native)</td>
                  <td className="py-4 px-6 text-slate-500">❌ No</td>
                  <td className="py-4 px-6 text-slate-500">❌ No</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-4 px-6 text-slate-300 font-medium">Cost Model</td>
                  <td className="py-4 px-6 text-green-400 font-bold bg-indigo-500/5">Wholesale (BYOK)</td>
                  <td className="py-4 px-6 text-slate-400">$20/mo subscription</td>
                  <td className="py-4 px-6 text-slate-400">Free</td>
                </tr>
                <tr className="border-b border-white/5">
                  {/* Was "Keys on Device" — directly contradicted the FAQ's
                      own accurate answer just below it on the old single
                      page ("encrypted at rest on our servers"). Keys are
                      NOT stored on-device; fixed to say what's actually
                      true and still a genuine differentiator vs. a
                      fully cloud-managed competitor. */}
                  <td className="py-4 px-6 text-slate-300 font-medium">Key Storage</td>
                  <td className="py-4 px-6 text-green-400 font-bold bg-indigo-500/5">Encrypted, Never Sent to Browser</td>
                  <td className="py-4 px-6 text-slate-400">Cloud Managed</td>
                  <td className="py-4 px-6 text-slate-400">N/A</td>
                </tr>
                <tr>
                  <td className="py-4 px-6 text-slate-300 font-medium">Model Choice</td>
                  <td className="py-4 px-6 text-green-400 font-bold bg-indigo-500/5">GPT-4o, Gemini, Mistral, OpenRouter</td>
                  <td className="py-4 px-6 text-slate-400">Locked to Provider</td>
                  <td className="py-4 px-6 text-slate-400">Extensions needed</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 border-t border-white/5 bg-[#0B0B10]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">Ready to build something amazing?</h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/register" className="px-10 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-full transition-all shadow-xl shadow-indigo-600/20 text-lg flex items-center gap-2">
              Get Started for Free <ArrowRight className="w-5 h-5" />
            </Link>
            <span className="text-slate-500 text-sm">No credit card required for local use.</span>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function FeatureRow({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex gap-4">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <h4 className="text-white font-semibold mb-1">{title}</h4>
        <p className="text-slate-400 text-sm">{desc}</p>
      </div>
    </div>
  );
}
