import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import axios from 'axios';
import { 
  Terminal, Zap, Shield, Cpu, 
  Code2, Sparkles, Globe, ArrowRight, 
  CheckCircle2, Play, CloudLightning, Key, Lock, Download,
  BookOpenIcon // <--- Fixed Import
} from 'lucide-react';

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
    <div className="h-screen w-full overflow-y-auto overflow-x-hidden bg-[#050509] text-slate-300 font-sans selection:bg-ubiq-accent/30 selection:text-ubiq-accent scroll-smooth">
      
      {/* --- NAVBAR --- */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#050509]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-500/20">
              U
            </div>
            <span className="font-semibold text-white tracking-tight text-lg">Ubiq Editor</span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#use-cases" className="hover:text-white transition-colors">Use Cases</a>
            <Link to="/guide" className="hover:text-white transition-colors flex items-center gap-1.5">
               <BookOpenIcon className="w-4 h-4" /> Guide
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium hover:text-white transition-colors">Sign In</Link>
            <Link to="/register" className="text-sm font-semibold bg-white text-black px-4 py-2 rounded-full hover:bg-slate-200 transition-colors flex items-center gap-2">
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </nav>

      {/* --- HERO SECTION --- */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-6 overflow-hidden">
        {/* Background Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium mb-6"
          >
            <Sparkles className="w-3 h-3" />
            <span>The Future of Hybrid Coding is Here</span>
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
            The first IDE that seamlessly blends <strong>Local Privacy</strong> with <strong>Cloud Power</strong>. 
            Connect Ollama, Grok, Claude, and Gemini in one unified workspace.
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
            <Link to="/guide" className="w-full md:w-auto px-8 py-3.5 bg-white/5 border border-white/10 text-white font-semibold rounded-lg hover:bg-white/10 transition-all flex items-center justify-center gap-2 backdrop-blur-sm">
              <BookOpenIcon className="w-4 h-4" /> Setup Guide
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
          {/* Editor Mockup */}
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
                   <div className="pl-4 text-slate-400">// Connect to any model seamlessly</div>
                   <div className="pl-4">
                      <span className="text-purple-400">const</span> models = [<span className="text-green-400">'Ollama'</span>, <span className="text-green-400">'Claude'</span>, <span className="text-green-400">'Gemini'</span>];
                   </div>
                   <div className="pl-4 text-slate-300">
                      <span className="text-indigo-400 animate-pulse">|</span>
                   </div>
                   <div className="mt-4 p-4 border border-indigo-500/30 bg-indigo-500/5 rounded-lg max-w-md">
                      <div className="flex items-center gap-2 text-indigo-300 text-xs mb-1">
                         <Sparkles className="w-3 h-3" /> AI Assistant
                      </div>
                      <p className="text-slate-300">I can help you refactor this function to run locally using Llama 3 or scale it via Claude 3.5 Sonnet.</p>
                   </div>
                </div>
             </div>
          </div>
        </motion.div>
      </section>

      {/* --- FEATURES GRID --- */}
      <section id="features" className="py-24 bg-[#050509]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Why Developers Choose Ubiq</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">We've stripped away the bloat and added intelligence exactly where you need it.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<Shield className="w-6 h-6 text-green-400" />}
              title="Private by Default"
              description="Run local models like Llama 3 and Mistral directly on your machine via Ollama. Your code never leaves your device."
            />
            <FeatureCard 
              icon={<Globe className="w-6 h-6 text-blue-400" />}
              title="Cloud Intelligence"
              description="Need more power? Switch instantly to GPT-4o, Claude 3.5, or Gemini Pro for complex architectural reasoning."
            />
            <FeatureCard 
              icon={<Code2 className="w-6 h-6 text-purple-400" />}
              title="Context Aware"
              description="Ubiq reads your entire project structure. Ask questions about files you haven't even opened."
            />
          </div>
        </div>
      </section>

      {/* --- USE CASES --- */}
      <section id="use-cases" className="py-24 border-y border-white/5 bg-[#0B0B10]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <div className="text-indigo-400 font-semibold tracking-wider text-sm mb-2 uppercase">Built for Everyone</div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">From Learning to Shipping</h2>
              
              <div className="space-y-6">
                <UseCaseItem 
                  title="For Students"
                  desc="A patient tutor that runs locally. Learn Python or JS without expensive API costs using free local models."
                />
                <UseCaseItem 
                  title="For Professionals"
                  desc="Refactor legacy codebases securely. Use local AI for proprietary code and Cloud AI for open-source libraries."
                />
                <UseCaseItem 
                  title="For Indie Hackers"
                  desc="Ship faster. Generate boilerplate, write documentation, and debug errors in seconds."
                />
              </div>
            </div>
            <div className="relative">
               {/* Abstract Grid Visual */}
               <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-purple-600 blur-[100px] opacity-20" />
               <div className="relative bg-[#050509] border border-white/10 rounded-2xl p-8 shadow-2xl">
                  <div className="flex items-center gap-4 mb-6">
                     <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-2xl">🎓</div>
                     <div>
                        <div className="text-white font-bold">Student Mode</div>
                        <div className="text-slate-500 text-sm">Learning React Basics</div>
                     </div>
                  </div>
                  <div className="space-y-3">
                     <div className="p-3 rounded-lg bg-white/5 border border-white/5 text-sm text-slate-300">
                        "Explain how `useEffect` works in this component."
                     </div>
                     <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-sm text-indigo-200">
                        "Sure! `useEffect` is a hook that runs after the render. In your code, it's fetching data..."
                     </div>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- HOW IT WORKS (HYBRID ENGINE) --- */}
      <section id="how-it-works" className="py-24 bg-[#050509]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Your AI, Your Rules</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
                Switch seamlessly between offline privacy and cloud performance. You control the keys.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 mb-16">
            {/* Local Card */}
            <div className="p-8 rounded-2xl border border-white/10 bg-[#0B0B10] hover:border-green-500/30 transition-colors group">
              <div className="w-14 h-14 rounded-xl bg-green-500/10 flex items-center justify-center mb-6">
                <Cpu className="w-7 h-7 text-green-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Local Intelligence</h3>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Run models like Llama 3, Mistral, and Deepseek directly on your machine via <strong>Ollama</strong>. 
                Perfect for sensitive code that cannot leave your device.
              </p>
              <ul className="space-y-3 text-sm text-slate-400">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> 100% Private & Offline</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Zero API Costs (Free Forever)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Uncensored & Custom Models</li>
              </ul>
            </div>

            {/* Cloud Card */}
            <div className="p-8 rounded-2xl border border-white/10 bg-[#0B0B10] hover:border-indigo-500/30 transition-colors group">
              <div className="w-14 h-14 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-6">
                <CloudLightning className="w-7 h-7 text-indigo-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Cloud Power (BYOK)</h3>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Need reasoning capability? Connect <strong>OpenAI, Anthropic, Google, or Grok</strong> directly. 
                Bring Your Own Key (BYOK) means you pay providers directly—no markup from us.
              </p>
              <ul className="space-y-3 text-sm text-slate-400">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-500" /> Access GPT-4o, Claude 3.5, Gemini</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-500" /> Direct Billing (Cheapest Rates)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-500" /> Keys Stored Locally in Browser</li>
              </ul>
            </div>
          </div>

          {/* Connection Steps */}
          <div className="max-w-4xl mx-auto border-t border-white/5 pt-16">
             <div className="grid md:grid-cols-3 gap-8 text-center">
                <div className="relative">
                   <div className="w-12 h-12 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center mx-auto mb-4 border border-white/10">1</div>
                   <h4 className="text-white font-semibold mb-2 flex items-center justify-center gap-2"><Download className="w-4 h-4" /> Install Ollama</h4>
                   <p className="text-sm text-slate-500">Download and run Ollama locally to enable free, offline models.</p>
                </div>
                <div className="relative">
                   <div className="w-12 h-12 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center mx-auto mb-4 border border-white/10">2</div>
                   <h4 className="text-white font-semibold mb-2 flex items-center justify-center gap-2"><Key className="w-4 h-4" /> Get API Keys</h4>
                   <p className="text-sm text-slate-500">Get keys from OpenAI, Anthropic, or Google AI Studio.</p>
                </div>
                <div className="relative">
                   <div className="w-12 h-12 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center mx-auto mb-4 border border-white/10">3</div>
                   <h4 className="text-white font-semibold mb-2 flex items-center justify-center gap-2"><Lock className="w-4 h-4" /> Connect Securely</h4>
                   <p className="text-sm text-slate-500">Enter keys in Ubiq Settings. They are encrypted and stored only on your device.</p>
                </div>
             </div>
          </div>
        </div>
      </section>

      {/* --- COMPARISON SECTION (NEW) --- */}
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
                  <td className="py-4 px-6 text-slate-300 font-medium">Privacy</td>
                  <td className="py-4 px-6 text-green-400 font-bold bg-indigo-500/5">Keys on Device</td>
                  <td className="py-4 px-6 text-slate-400">Cloud Managed</td>
                  <td className="py-4 px-6 text-slate-400">N/A</td>
                </tr>
                <tr>
                  <td className="py-4 px-6 text-slate-300 font-medium">Model Choice</td>
                  <td className="py-4 px-6 text-green-400 font-bold bg-indigo-500/5">Any (Grok, Mistral, GPT)</td>
                  <td className="py-4 px-6 text-slate-400">Locked to Provider</td>
                  <td className="py-4 px-6 text-slate-400">Extensions needed</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* --- FAQ SECTION (NEW) --- */}
      <section className="py-24 bg-[#050509]">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-white mb-12 text-center">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <FaqItem 
              question="Is my API Key safe?" 
              answer="Yes. We use a 'Bring Your Own Key' architecture. Your API keys are stored in your browser's LocalStorage and are never saved to our database. They are only used to proxy requests to the AI providers." 
            />
            <FaqItem 
              question="Can I use this offline?" 
              answer="Absolutely. If you install Ollama and switch Ubiq to 'Local Mode', you can code, get autocompletions, and chat with AI without an internet connection." 
            />
            <FaqItem 
              question="Which models are supported?" 
              answer="For Cloud: GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro, Grok Beta, and Mistral Large. For Local: Anything Ollama supports (Llama 3, Deepseek, Codellama, etc)." 
            />
          </div>
        </div>
      </section>

      {/* --- CTA FOOTER --- */}
      <section className="py-24 px-6 border-t border-white/5 bg-[#0B0B10]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">Ready to build something amazing?</h2>
          <p className="text-slate-400 text-lg mb-10">Join thousands of developers coding smarter with Ubiq Editor.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
             <Link to="/register" className="px-10 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-full transition-all shadow-xl shadow-indigo-600/20 text-lg">
                Get Started for Free
             </Link>
             <span className="text-slate-500 text-sm">No credit card required for local use.</span>
          </div>
        </div>
      </section>

      {/* --- FOOTER --- */}
      <footer className="py-16 border-t border-white/5 bg-[#050509]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-12">
            
            {/* Brand Column */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xs">
                  U
                </div>
                <span className="font-bold text-white tracking-tight">Ubiq Editor</span>
              </div>
              <p className="text-slate-500 text-sm leading-relaxed mb-4">
                The hybrid AI code editor bridging the gap between local privacy and cloud intelligence.
              </p>
            </div>

            {/* Product Column */}
            <div>
              <h4 className="text-white font-bold mb-4 text-sm uppercase tracking-wider">Product</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><a href="#features" className="hover:text-indigo-400 transition-colors">Features</a></li>
                <li><a href="#use-cases" className="hover:text-indigo-400 transition-colors">Use Cases</a></li>
                <li><Link to="/guide" className="hover:text-indigo-400 transition-colors">Guide</Link></li>
              </ul>
            </div>

            {/* Legal Column - REQUIRED BY COMPLIANCE */}
            <div>
              <h4 className="text-white font-bold mb-4 text-sm uppercase tracking-wider">Legal</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><Link to="/terms" className="hover:text-indigo-400 transition-colors">Terms of Service</Link></li>
                <li><Link to="/privacy" className="hover:text-indigo-400 transition-colors">Privacy Policy</Link></li>
                <li><Link to="/refund" className="hover:text-indigo-400 transition-colors">Refund Policy</Link></li>
              </ul>
            </div>

            {/* Contact Column */}
            <div>
              <h4 className="text-white font-bold mb-4 text-sm uppercase tracking-wider">Support</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><a href="mailto:support@ubiq-editor.space" className="hover:text-indigo-400 transition-colors">Contact Support</a></li>
                <li className="text-xs italic mt-4 text-slate-600">Built for developers, by developers.</li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-slate-600 text-xs">
            <p>&copy; {new Date().getFullYear()} Ubiq Editor. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-1.5"><Shield className="w-3 h-3" /> PCI Compliant</span>
              <span className="flex items-center gap-1.5"><Lock className="w-3 h-3" /> Secure Checkout</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// --- SUB-COMPONENTS ---

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
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

function UseCaseItem({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="flex gap-4">
      <div className="mt-1">
        <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/50">
          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
        </div>
      </div>
      <div>
        <h4 className="text-white font-bold text-lg">{title}</h4>
        <p className="text-slate-400">{desc}</p>
      </div>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string, answer: string }) {
  return (
    <div className="border border-white/10 rounded-xl p-6 bg-[#0B0B10]">
      <h3 className="text-lg font-semibold text-white mb-2">{question}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">{answer}</p>
    </div>
  );
}