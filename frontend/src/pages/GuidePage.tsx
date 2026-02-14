import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Terminal, Cloud, Cpu, Code2, 
  MessageSquare, Key, BookOpen, 
  ArrowLeft, CheckCircle2, ChevronRight,
  Menu, X, AlertTriangle, ShieldAlert, Globe, Download // <-- Added Download Icon
} from 'lucide-react';

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState('intro');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Handle Scroll Spy to highlight TOC items
  useEffect(() => {
    const handleScroll = () => {
      const sections = ['intro', 'cloud-ai', 'local-ai', 'editor', 'chat', 'troubleshooting', 'shortcuts'];
      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.top >= 0 && rect.top <= 300) {
            setActiveSection(section);
            break;
          }
        }
      }
    };
    const container = document.getElementById('guide-container');
    if (container) container.addEventListener('scroll', handleScroll);
    return () => container?.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMobileMenuOpen(false);
    }
  };

  const navItems = [
    { id: 'intro', label: 'Introduction', icon: BookOpen },
    { id: 'cloud-ai', label: 'Cloud AI (BYOK)', icon: Cloud },
    { id: 'local-ai', label: 'Local AI (Ollama)', icon: Cpu },
    { id: 'editor', label: 'Editor Features', icon: Code2 },
    { id: 'chat', label: 'AI Chat Tools', icon: MessageSquare },
    { id: 'troubleshooting', label: 'Troubleshooting', icon: AlertTriangle },
    { id: 'shortcuts', label: 'Shortcuts', icon: Key },
  ];

  return (
    <div id="guide-container" className="h-screen w-full overflow-y-auto overflow-x-hidden bg-[#050509] text-slate-300 font-sans selection:bg-ubiq-accent/30 selection:text-ubiq-accent scroll-smooth">
      
      {/* --- NAVBAR --- */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#050509]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-sm font-medium">
              <ArrowLeft className="w-4 h-4" /> Back
            </Link>
            <div className="h-4 w-px bg-white/10 hidden md:block"></div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded flex items-center justify-center text-white font-bold text-xs shadow-lg">
                U
              </div>
              <span className="font-semibold text-white tracking-tight">Documentation</span>
            </div>
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium hover:text-white transition-colors">Sign In</Link>
            <Link to="/register" className="text-sm font-semibold bg-white text-black px-4 py-2 rounded-full hover:bg-slate-200 transition-colors">
              Open Editor
            </Link>
          </div>

          {/* Mobile Menu Toggle */}
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden text-slate-400 hover:text-white">
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 pt-32 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-12 relative">
        
        {/* --- LEFT SIDEBAR (TOC) --- */}
        <div className={`lg:col-span-3 lg:block ${mobileMenuOpen ? 'fixed inset-0 z-40 bg-[#050509] p-6 pt-24' : 'hidden'}`}>
          <div className="lg:sticky lg:top-32 space-y-8">
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 px-3">Table of Contents</h3>
              <nav className="space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => scrollTo(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all ${
                      activeSection === item.id 
                        ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' 
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>

        {/* --- MAIN CONTENT --- */}
        <div className="lg:col-span-9 space-y-24">
          
          {/* 1. INTRO */}
          <Section id="intro" title="Welcome to Ubiq" icon={BookOpen} active={activeSection === 'intro'}>
            <p className="text-lg text-slate-400 leading-relaxed mb-6">
              Ubiq Editor is a <strong>Hybrid AI Code Editor</strong>. Unlike other editors that lock you into a single AI provider, 
              Ubiq lets you choose between powerful cloud models for complex reasoning and local models for absolute privacy.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-6 rounded-2xl bg-[#0B0B10] border border-white/10 hover:border-indigo-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded bg-indigo-500/10 text-indigo-400"><Cloud className="w-5 h-5"/></div>
                  <h4 className="font-bold text-white">Cloud Mode</h4>
                </div>
                <ul className="text-sm text-slate-400 space-y-2">
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0"/> Uses API Keys (BYOK)</li>
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0"/> Best for complex logic</li>
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0"/> Paid per usage (cheap)</li>
                </ul>
              </div>
              <div className="p-6 rounded-2xl bg-[#0B0B10] border border-white/10 hover:border-emerald-500/30 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded bg-emerald-500/10 text-emerald-400"><Cpu className="w-5 h-5"/></div>
                  <h4 className="font-bold text-white">Local Mode</h4>
                </div>
                <ul className="text-sm text-slate-400 space-y-2">
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0"/> Runs on Ollama</li>
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0"/> 100% Private & Offline</li>
                  <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0"/> Free forever</li>
                </ul>
              </div>
            </div>
          </Section>

          {/* 2. CLOUD SETUP */}
          <Section id="cloud-ai" title="Setup Cloud AI (BYOK)" icon={Key} active={activeSection === 'cloud-ai'}>
            <p className="text-slate-400 mb-6">
              We use a <strong>Bring Your Own Key</strong> model. Your keys are stored in your browser's LocalStorage and sent directly to the provider via our secure proxy. We never store them.
            </p>
            <div className="space-y-4">
              <div className="bg-[#0B0B10] border border-white/10 rounded-xl p-6">
                <h4 className="text-white font-bold mb-4">Step 1: Get an API Key</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-indigo-500/50 transition-all text-sm text-slate-300">
                    <span>OpenRouter (Claude/GPT)</span> <ChevronRight className="w-4 h-4 opacity-50"/>
                  </a>
                  <a href="https://console.mistral.ai/" target="_blank" rel="noreferrer" className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-indigo-500/50 transition-all text-sm text-slate-300">
                    <span>Mistral AI</span> <ChevronRight className="w-4 h-4 opacity-50"/>
                  </a>
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-indigo-500/50 transition-all text-sm text-slate-300">
                    <span>Google Gemini</span> <ChevronRight className="w-4 h-4 opacity-50"/>
                  </a>
                  <a href="https://console.x.ai/" target="_blank" rel="noreferrer" className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-indigo-500/50 transition-all text-sm text-slate-300">
                    <span>xAI (Grok)</span> <ChevronRight className="w-4 h-4 opacity-50"/>
                  </a>
                </div>
              </div>
            </div>
          </Section>

          {/* 3. LOCAL SETUP */}
          <Section id="local-ai" title="Setup Local AI (Ollama)" icon={Terminal} active={activeSection === 'local-ai'}>
            <p className="text-slate-400 mb-6">
              To use AI locally and privately, you need to run <strong>Ollama</strong> on your machine. Since Ubiq runs in your browser, you must explicitly allow the browser to connect to your local Ollama instance.
            </p>

            <div className="space-y-6">
              
              {/* --- NEW OS-SPECIFIC INSTALLATION UI --- */}
              <div className="step">
                <h4 className="text-white font-bold mb-3">1. Install Ollama</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                  {/* Windows */}
                  <div className="bg-[#0B0B10] border border-white/10 rounded-xl p-5 flex flex-col justify-between hover:border-emerald-500/30 transition-colors">
                    <div>
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Windows</h5>
                      <p className="text-xs text-slate-500 mb-4 leading-relaxed">Download the official installer for Windows 10 and 11.</p>
                    </div>
                    <a href="https://ollama.com/download/OllamaSetup.exe" className="w-full flex items-center justify-center gap-2 text-sm bg-white/5 hover:bg-emerald-600 hover:text-white text-slate-300 py-2 px-4 rounded-lg transition-all border border-white/5 hover:border-transparent">
                      <Download className="w-4 h-4"/> Download .exe
                    </a>
                  </div>

                  {/* macOS */}
                  <div className="bg-[#0B0B10] border border-white/10 rounded-xl p-5 flex flex-col justify-between hover:border-emerald-500/30 transition-colors">
                    <div>
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">macOS</h5>
                      <p className="text-xs text-slate-500 mb-4 leading-relaxed">Download for Apple Silicon (M1/M2/M3) or Intel Macs.</p>
                    </div>
                    <a href="https://ollama.com/download/Ollama-darwin.zip" className="w-full flex items-center justify-center gap-2 text-sm bg-white/5 hover:bg-emerald-600 hover:text-white text-slate-300 py-2 px-4 rounded-lg transition-all border border-white/5 hover:border-transparent">
                      <Download className="w-4 h-4"/> Download .zip
                    </a>
                  </div>

                  {/* Linux */}
                  <div className="bg-[#0B0B10] border border-white/10 rounded-xl p-5 flex flex-col justify-between hover:border-emerald-500/30 transition-colors">
                    <div>
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Linux</h5>
                      <p className="text-xs text-slate-500 mb-4 leading-relaxed">Run this command in your terminal to install via script.</p>
                    </div>
                    <code className="block w-full bg-black/50 border border-white/10 rounded-lg p-2.5 text-[10px] text-emerald-400 font-mono select-all text-center">
                      curl -fsSL https://ollama.com/install.sh | sh
                    </code>
                  </div>
                </div>
              </div>

              <div className="step">
                <h4 className="text-white font-bold mb-2">2. Pull Code-Optimized Models</h4>
                <p className="text-sm text-slate-400 mb-3">Open your terminal and pull one or more of these recommended models for coding:</p>
                <div className="bg-black/50 border border-white/10 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-sm text-slate-300">
                        <thead className="bg-white/5 text-xs uppercase text-slate-500">
                            <tr><th className="px-4 py-2">Model</th><th className="px-4 py-2 hidden sm:table-cell">Size</th><th className="px-4 py-2 text-right">Command</th></tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-mono">
                            <tr><td className="px-4 py-3">qwen2.5-coder:7b</td><td className="px-4 py-3 hidden sm:table-cell">4.7 GB</td><td className="px-4 py-3 text-right text-emerald-400 select-all">ollama pull qwen2.5-coder:7b</td></tr>
                            <tr><td className="px-4 py-3">qwen2.5-coder:1.5b</td><td className="px-4 py-3 hidden sm:table-cell">986 MB</td><td className="px-4 py-3 text-right text-emerald-400 select-all">ollama pull qwen2.5-coder:1.5b</td></tr>
                            <tr><td className="px-4 py-3">starcoder2:7b</td><td className="px-4 py-3 hidden sm:table-cell">4.0 GB</td><td className="px-4 py-3 text-right text-emerald-400 select-all">ollama pull starcoder2:7b</td></tr>
                            <tr><td className="px-4 py-3">deepseek-coder:6.7b</td><td className="px-4 py-3 hidden sm:table-cell">3.8 GB</td><td className="px-4 py-3 text-right text-emerald-400 select-all">ollama pull deepseek-coder:6.7b</td></tr>
                            <tr><td className="px-4 py-3">codellama:7b</td><td className="px-4 py-3 hidden sm:table-cell">3.8 GB</td><td className="px-4 py-3 text-right text-emerald-400 select-all">ollama pull codellama:7b</td></tr>
                        </tbody>
                    </table>
                </div>
              </div>

              <div className="step relative overflow-hidden rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-6">
                <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500/50"></div>
                <h4 className="text-yellow-200 font-bold mb-3 flex items-center gap-2">
                  3. Allow Browser Connection (CRITICAL)
                </h4>
                <p className="text-sm text-slate-300 mb-4">
                  By default, Ollama blocks external web pages from accessing it. You must restart Ollama and set the <code>OLLAMA_ORIGINS</code> variable to our domain. <strong>First, make sure the Ollama app is closed from your system tray.</strong> Then run the appropriate command:
                </p>
                
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-bold text-slate-500 uppercase mb-1">Windows (PowerShell)</div>
                    <code className="block bg-black/40 border border-white/5 rounded-lg p-3 font-mono text-xs text-emerald-400 select-all">
                      $env:OLLAMA_ORIGINS="https://ubiq-editor.space"; ollama serve
                    </code>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-500 uppercase mb-1">Mac / Linux (Terminal)</div>
                    <code className="block bg-black/40 border border-white/5 rounded-lg p-3 font-mono text-xs text-emerald-400 select-all">
                      OLLAMA_ORIGINS="https://ubiq-editor.space" ollama serve
                    </code>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-4 italic">Note: Keep this terminal window open while using Ubiq Local Mode. No router port forwarding is required.</p>
              </div>
            </div>
          </Section>

          {/* 4. EDITOR FEATURES */}
          <Section id="editor" title="Using the Editor" icon={Code2} active={activeSection === 'editor'}>
            <p className="text-slate-400 mb-6">
              Our editor is built on Monaco (the same core as VS Code), so it supports standard shortcuts and features.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <FeatureBox title="File Management" desc="Create folders, drag-and-drop uploads, and organize your project tree." />
              <FeatureBox title="AI Autocomplete" desc="If you add a Cloud API key, you get ghost-text completions as you type." />
              <FeatureBox title="Diff View" desc="Safely review AI code changes before accepting them into your file." />
              <FeatureBox title="Multi-Language" desc="Syntax highlighting for JS, TS, Python, PHP, Java, Go, and more." />
            </div>
          </Section>

          {/* 5. CHAT TOOLS */}
          <Section id="chat" title="AI Chat Tools" icon={MessageSquare} active={activeSection === 'chat'}>
            <p className="text-slate-400 mb-6">
              The chat sidebar is context-aware. It knows about the file you are currently editing and the project structure.
            </p>
            <div className="bg-[#0B0B10] border border-white/10 rounded-xl p-6">
              <h4 className="text-white font-bold mb-4">Context Menu Actions</h4>
              <p className="text-sm text-slate-400 mb-4">
                Right-click any code selection in the editor to access quick AI actions:
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded bg-white/5 border border-white/10 text-xs text-indigo-300 font-mono">Explain</span>
                <span className="px-3 py-1 rounded bg-white/5 border border-white/10 text-xs text-green-300 font-mono">Refactor</span>
                <span className="px-3 py-1 rounded bg-white/5 border border-white/10 text-xs text-red-300 font-mono">Debug</span>
                <span className="px-3 py-1 rounded bg-white/5 border border-white/10 text-xs text-yellow-300 font-mono">Add Docs</span>
              </div>
            </div>
          </Section>

          {/* 6. TROUBLESHOOTING */}
          <Section id="troubleshooting" title="Troubleshooting" icon={AlertTriangle} active={activeSection === 'troubleshooting'}>
            <div className="space-y-6">
              
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
                <h4 className="text-red-400 font-bold mb-2 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5"/> Ollama Network or CORS Error
                </h4>
                <p className="text-sm text-slate-300 mb-4">
                  If Ubiq cannot connect to your local Ollama instance, it is almost always due to CORS security policies or a local firewall blocking the browser.
                </p>
                <div className="bg-black/40 p-4 rounded-lg space-y-4">
                  <div>
                    <p className="text-xs text-slate-400 uppercase font-bold mb-1">1. Check OLLAMA_ORIGINS</p>
                    <p className="text-sm text-slate-300">Ensure you have completely quit the Ollama app from your system tray, and started it via the terminal using the command in Step 3 above.</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase font-bold mb-1">2. Check Browser Shields & Ad-Blockers</p>
                    <p className="text-sm text-slate-300">Browsers like <strong>Brave</strong>, or extensions like <strong>uBlock Origin</strong>, often block websites from talking to `localhost` to prevent tracking. Try disabling shields or ad-blockers for `ubiq-editor.space`.</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase font-bold mb-1">3. Check Windows Defender / Firewall</p>
                    <p className="text-sm text-slate-300">Your OS firewall might be blocking port `11434`. Ensure Ollama is allowed through your local firewall for private networks. (Note: You do NOT need to open ports on your router).</p>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-6">
                <h4 className="text-yellow-400 font-bold mb-2 flex items-center gap-2">
                  <Globe className="w-5 h-5"/> Mixed Content & Sandbox Previews
                </h4>
                <p className="text-sm text-slate-300">
                  When you run a project sandbox, it launches on a specific port without SSL (HTTP). Because Ubiq is hosted securely on HTTPS, your browser will block the sandbox iframe from loading inside the editor. Simply click the <strong>"Open Sandbox in New Tab"</strong> button to view your live app safely.
                </p>
              </div>

            </div>
          </Section>

          {/* 7. SHORTCUTS */}
          <Section id="shortcuts" title="Keyboard Shortcuts" icon={Code2} active={activeSection === 'shortcuts'}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ShortcutItem keys={['Ctrl', 'S']} desc="Save current file" />
              <ShortcutItem keys={['Ctrl', 'Space']} desc="Trigger AI Autocomplete" />
              <ShortcutItem keys={['Right Click']} desc="AI Context Menu (Explain/Refactor)" />
              <ShortcutItem keys={['Ctrl', 'F']} desc="Search in file" />
              <ShortcutItem keys={['Plus', 'Click']} desc="Create new file" />
            </div>
          </Section>

        </div>
      </div>

      {/* --- FOOTER --- */}
      <footer className="py-8 border-t border-white/5 bg-[#050509] text-center text-slate-600 text-sm">
        <p>&copy; {new Date().getFullYear()} Ubiq Editor. Built for the future of coding.</p>
      </footer>
    </div>
  );
}

// --- SUB-COMPONENTS ---

const Section = ({ id, title, icon: Icon, children, active }: any) => (
  <motion.section 
    id={id} 
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-100px" }}
    className="scroll-mt-32"
  >
    <div className="flex items-center gap-4 mb-6">
      <div className={`p-3 rounded-xl transition-colors ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 text-slate-400'}`}>
        <Icon className="w-6 h-6" />
      </div>
      <h2 className={`text-3xl font-bold tracking-tight ${active ? 'text-white' : 'text-slate-300'}`}>
        {title}
      </h2>
    </div>
    <div className="pl-0 lg:pl-16">
      {children}
    </div>
  </motion.section>
);

const FeatureBox = ({ title, desc }: any) => (
  <div className="p-4 rounded-lg bg-white/5 border border-white/5">
    <h4 className="text-white font-bold text-sm mb-1">{title}</h4>
    <p className="text-xs text-slate-400">{desc}</p>
  </div>
);

const ShortcutItem = ({ keys, desc }: { keys: string[], desc: string }) => (
  <div className="flex items-center justify-between p-3 bg-[#0B0B10] border border-white/5 rounded-lg">
    <span className="text-slate-400 text-sm">{desc}</span>
    <div className="flex gap-1">
      {keys.map(k => (
        <kbd key={k} className="bg-white/10 px-2 py-1 rounded text-xs font-mono text-slate-200 min-w-[24px] text-center border border-white/10">
          {k}
        </kbd>
      ))}
    </div>
  </div>
);