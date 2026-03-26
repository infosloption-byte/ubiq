import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiService, AiApiConfig } from '../services/aiService';
import { projectAPI } from '../services/api';
import { Sparkles, X, Loader2, Cloud, Cpu, Globe, Settings, Save } from 'lucide-react';
import ModelSelector from './ModelSelector'; 

interface AiGeneratorModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// Shared localStorage key for Ollama URL across all components
const OLLAMA_URL_KEY = 'ubiq_ollama_url';

// Docker-hosted Ollama: use host.docker.internal so the container can reach
// the host machine's Ollama process. Falls back to localhost for non-Docker envs.
const LOCAL_OLLAMA_URL = 'http://host.docker.internal:11434';

export default function AiGeneratorModal({ isOpen, onClose }: AiGeneratorModalProps) {
    const navigate = useNavigate();
    
    // --- STATE ---
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    
    // AI Configuration
    const [aiMode, setAiMode] = useState<'cloud' | 'local' | 'remote'>('cloud');
    const [selectedModel, setSelectedModel] = useState('gpt-4o'); 
    
    // Remote Connection Settings — shared key with ChatInterface
    const [showSettings, setShowSettings] = useState(false);
    const [remoteUrl, setRemoteUrl] = useState(localStorage.getItem(OLLAMA_URL_KEY) || 'http://localhost:11434');
    const [rawModelOutput, setRawModelOutput] = useState<string | null>(null); // shown on parse failure

    // Save remote URL to local storage (shared key)
    const handleSaveSettings = () => {
        localStorage.setItem(OLLAMA_URL_KEY, remoteUrl);
        setShowSettings(false);
    };

    // Auto-select defaults when switching modes
    useEffect(() => {
        if (aiMode === 'cloud') setSelectedModel('gpt-4o');
    }, [aiMode]);

    // ── Universal Response Parser ──────────────────────────────────────────────
    // 8 strategies covering every known model output style.
    // Tries each in order; first one that yields ≥1 file wins.
    const parseResponse = (rawOutput: string) => {
        const raw = rawOutput.trim();
        type FileEntry = { path: string; content: string };

        /** Helpers **/
        const isValidFilename = (s: string) =>
            /^[\w\-./]+\.[a-zA-Z0-9]{1,10}$/.test(s) && !s.includes(' ');

        const guessFilename = (code: string): string => {
            if (/<\s*!DOCTYPE|<\s*html/i.test(code))  return 'index.html';
            if (/^\s*\{[\s\S]*"runtime"/m.test(code)) return 'ubiq.json';
            if (/"name"\s*:\s*"/.test(code))           return 'package.json';
            if (/^import |^from |^export /m.test(code)) return 'main.js';
            if (/^<\?php/m.test(code))                  return 'index.php';
            if (/^def |^class |^import /m.test(code))   return 'main.py';
            if (/^body\s*\{|^\*/m.test(code))           return 'style.css';
            return 'output.txt';
        };

        // ── S1: ---START_FILE: filename--- ... ---END_FILE--- ─────────────────────
        if (raw.includes('---START_FILE:')) {
            const files: FileEntry[] = [];
            for (const part of raw.split('---START_FILE:')) {
                if (!part.trim()) continue;
                const dash = part.indexOf('---');
                if (dash === -1) continue;
                const fileName = part.substring(0, dash).trim();
                const endIdx = part.lastIndexOf('---END_FILE---');
                const content = (endIdx !== -1
                    ? part.substring(dash + 3, endIdx)
                    : part.substring(dash + 3)).trim();
                if (isValidFilename(fileName) && content) files.push({ path: fileName, content });
            }
            if (files.length > 0) return files;
        }

        // ── S2: === filename === or ==== filename ==== separators ─────────────────
        if (raw.includes('===')) {
            const sepRegex = /={2,}\s*([\w\-./ ]+\.[a-zA-Z0-9]{1,10})\s*={2,}/g;
            const matches = [...raw.matchAll(sepRegex)];
            if (matches.length > 0) {
                const files: FileEntry[] = [];
                matches.forEach((match, i) => {
                    const start = match.index! + match[0].length;
                    const end = matches[i + 1]?.index ?? raw.length;
                    const content = raw.substring(start, end).replace(/```[a-z]*/g, '').replace(/```/g, '').trim();
                    const path = match[1].trim();
                    if (content) files.push({ path, content });
                });
                if (files.length > 0) return files;
            }
        }

        // ── S3: Markdown header (##/###) or bold (**name**) before a fence ────────
        // e.g.  ### src/App.jsx
```jsx
...
```
        const headerFenceRegex = /(?:#{1,4}\s+|\*{1,2})([\w\-./]+\.[a-zA-Z0-9]{1,10})(?:\*{1,2})?\s*\n```[a-z]*\n([\s\S]*?)```/gi;
        {
            const files: FileEntry[] = [];
            let m: RegExpExecArray | null;
            while ((m = headerFenceRegex.exec(raw)) !== null) {
                const path = m[1].trim();
                const content = m[2].trim();
                if (isValidFilename(path) && content) files.push({ path, content });
            }
            if (files.length > 0) return files;
        }

        // ── S4: "File: filename" or "// filename" or "/* filename */" label before fence ─
        const labelFenceRegex = /(?:(?:File|filename|path):\s*|(?:\/\/|#)\s*)([\w\-./]+\.[a-zA-Z0-9]{1,10})\s*\n```[a-z]*\n([\s\S]*?)```/gi;
        {
            const files: FileEntry[] = [];
            let m: RegExpExecArray | null;
            while ((m = labelFenceRegex.exec(raw)) !== null) {
                const path = m[1].trim();
                const content = m[2].trim();
                if (isValidFilename(path) && content) files.push({ path, content });
            }
            if (files.length > 0) return files;
        }

        // ── S5: Fenced block with filename ON the opening fence line ─────────────
        // e.g. ```jsx src/App.jsx  OR  ```src/App.jsx
        const fenceWithNameRegex = /```(?:[a-z]+\s+)?([\w\-./]+\.[a-zA-Z0-9]{1,10})\n([\s\S]*?)```/gi;
        {
            const files: FileEntry[] = [];
            let m: RegExpExecArray | null;
            while ((m = fenceWithNameRegex.exec(raw)) !== null) {
                const path = m[1].trim();
                const content = m[2].trim();
                if (isValidFilename(path) && content) files.push({ path, content });
            }
            if (files.length > 0) return files;
        }

        // ── S6: JSON array [{path, content}] or [{filename, code}] ───────────────
        const jsonStart = raw.indexOf('[');
        const jsonEnd   = raw.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            const jsonStr = raw.substring(jsonStart, jsonEnd + 1)
                .replace(/```json/g, '').replace(/```/g, '');
            try {
                const parsed = JSON.parse(jsonStr);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const normalised = parsed.map((f: any) => ({
                        path:    f.path || f.filename || f.name || f.file,
                        content: f.content || f.code || f.body || ''
                    })).filter((f: any) => f.path && f.content);
                    if (normalised.length > 0) return normalised;
                }
            } catch (_) { /* fall through */ }
        }

        // ── S7: Multiple unnamed fenced blocks — pair with implied filenames ───────
        const unnamedFences = [...raw.matchAll(/```[a-z]*\n([\s\S]*?)```/gi)];
        if (unnamedFences.length > 1) {
            const files: FileEntry[] = [];
            unnamedFences.forEach(m => {
                const content = m[1].trim();
                if (content.length > 10) files.push({ path: guessFilename(content), content });
            });
            // Deduplicate paths by appending index
            const seen: Record<string, number> = {};
            files.forEach(f => {
                if (seen[f.path] !== undefined) {
                    const ext = f.path.split('.').pop()!;
                    const base = f.path.slice(0, -ext.length - 1);
                    f.path = `${base}_${++seen[f.path]}.${ext}`;
                } else { seen[f.path] = 0; }
            });
            if (files.length > 0) return files;
        }

        // ── S8: Whole output is a single file (last resort) ───────────────────────
        const stripped = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
        if (stripped.length > 30) {
            return [{ path: guessFilename(stripped), content: stripped }];
        }

        throw new Error("The model returned an empty or unrecognisable response. Try a different model or rephrase your prompt.");
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setLoading(true);
        setStatus('Initializing Workspace...');
        setRawModelOutput(null);

        try {
            // 1. Create Project Container
            const projectRes = await projectAPI.create({
                name: "AI App " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                description: prompt.substring(0, 50) + "...",
                visibility: 'private',
                source: 'manual'
            });
            const projectId = projectRes.data.project.id;

            setStatus(`Architecting with ${selectedModel}...`);
            
            // 2. Universal system prompt — same format for ALL models (cloud + local + remote).
            //    The parser handles whatever format the model actually returns.
            const systemPrompt = `You are a code generator. Your only job is to output file blocks.

OUTPUT FORMAT (use this exactly):
---START_FILE: filename.ext---
file contents here
---END_FILE---

EXAMPLE:
---START_FILE: index.html---
<!DOCTYPE html>
<html><body><h1>Hello World</h1></body></html>
---END_FILE---
---START_FILE: ubiq.json---
{"runtime":"static"}
---END_FILE---

STRICT RULES:
1. Output ONLY file blocks — no explanations, no greetings, no comments outside blocks
2. ALWAYS include ubiq.json: {"runtime":"static"} for HTML, {"runtime":"node"} for React/Node, {"runtime":"php"} for PHP, {"runtime":"python"} for Python
3. For React/Node apps: include package.json with "dev": "vite --port 5173 --host 0.0.0.0"
4. Write COMPLETE code — never use TODO, placeholder, ellipsis (...)
5. Every ---START_FILE: must have a matching ---END_FILE---`;

            const fullMessage = `${systemPrompt}\n\nBuild this: ${prompt}`;

            // 3. Prepare Config based on Mode
            //    - cloud:  no ollama_url needed, BYOK keys come from chatCloud() via localStorage
            //    - local:  explicitly pass Docker host URL so container can reach host Ollama
            //    - remote: pass user-configured EC2/Azure URL (shared key with ChatInterface)
            const apiConfig: AiApiConfig = {
                project_id: projectId
            };

            if (aiMode === 'local') {
                const localUrl = localStorage.getItem('ubiq_local_url') || LOCAL_OLLAMA_URL;
                apiConfig.api_keys = { ollama_url: localUrl };
            } else if (aiMode === 'remote') {
                const currentRemoteUrl = localStorage.getItem(OLLAMA_URL_KEY);
                if (!currentRemoteUrl) throw new Error("Please configure your Remote URL in settings.");
                apiConfig.api_keys = { ollama_url: currentRemoteUrl };
            }

            // 4. Call AI — with one automatic retry using a simpler prompt
            setRawModelOutput(null);

            const callAI = async (message: string) => {
                const res = await aiService.chat(message, [], aiMode, selectedModel, apiConfig);
                return res.content?.trim() ?? '';
            };

            const FALLBACK_PROMPT = `You are a code generator. Create the requested app.
Use EXACTLY this format for every file:
---START_FILE: filename.ext---
code here
---END_FILE---
Always include ubiq.json as: ---START_FILE: ubiq.json---\n{"runtime":"static"}\n---END_FILE---
Request: ${prompt}`;

            let rawContent = await callAI(fullMessage);

            // Detect empty / refusal / too-short response
            const looksEmpty = (s: string) => {
                const cleaned = s.replace(/[\s\n]+/g, ' ').trim();
                return cleaned.length < 30 ||
                    /^(sorry|i (can't|cannot|don't|am unable)|i'm sorry|as an ai)/i.test(cleaned);
            };

            if (looksEmpty(rawContent)) {
                setStatus(`Model returned nothing — retrying with simpler prompt...`);
                rawContent = await callAI(FALLBACK_PROMPT);
            }

            // Store raw output so user can inspect it if parsing still fails
            setRawModelOutput(rawContent);

            if (looksEmpty(rawContent)) {
                throw new Error(
                    `${selectedModel} returned an empty or refused response. ` +
                    `Try a different model, or check that it's fully loaded on the server.`
                );
            }

            setStatus('Extracting Files...');
            let files: { path: string; content: string }[] = [];

            try {
                files = parseResponse(rawContent);
                files = files.map((f: any) => {
                    let fileContent = f.content;
                    if (Array.isArray(fileContent)) fileContent = fileContent.join('\n');
                    else if (typeof fileContent === 'object') fileContent = JSON.stringify(fileContent, null, 2);
                    return { path: f.path, content: String(fileContent) };
                });
            } catch (e: any) {
                console.error("Parsing Error:", e);
                // rawModelOutput is already set — UI will show it
                throw new Error(e.message || "Failed to parse AI output.");
            }

            setStatus(`Saving ${files.length} files...`);
            await projectAPI.scaffold(projectId, files);

            // 5. Dynamic Title Update
            try {
                const ubiqFile = files.find((f: any) => f.path === 'ubiq.json');
                if (ubiqFile) {
                    const parsedUbiq = JSON.parse(ubiqFile.content);
                    if (parsedUbiq.title) {
                        setStatus(`Renaming to "${parsedUbiq.title}"...`);
                        await projectAPI.update(projectId, { name: parsedUbiq.title });
                    }
                }
            } catch (e) {}

            setStatus('Saving conversation...');
            const fileList = files.map((f: any) => `- \`${f.path}\``).join('\n');
            const summary = `I have generated the project structure based on your request.\n\n**Created Files:**\n${fileList}\n\nYou can now select a file to start editing!`;

            await projectAPI.seedChat(projectId, prompt, summary, selectedModel);

            setStatus('Done! Redirecting...');
            setTimeout(() => navigate(`/projects/${projectId}`), 1000);

        } catch (e: any) {
            console.error(e);
            setStatus('Error: ' + (e.message || "Failed"));
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg bg-ubiq-900 border border-white/10 rounded-xl shadow-2xl overflow-visible flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5 shrink-0">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-400" /> Generate with AI
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-5 h-5"/>
                    </button>
                </div>
                
                <div className="p-6 space-y-5 overflow-visible">
                    
                    {/* Model Selection UI */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">AI Provider</label>
                            
                            {/* 3-WAY TOGGLE */}
                            <div className="flex bg-black/30 rounded-lg p-0.5 border border-white/5">
                                <button 
                                    onClick={() => setAiMode('cloud')} 
                                    className={`px-3 py-1 rounded-md text-[10px] font-medium flex items-center gap-1.5 transition-all ${aiMode === 'cloud' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    <Cloud className="w-3 h-3" /> Cloud
                                </button>
                                <button 
                                    onClick={() => setAiMode('local')} 
                                    className={`px-3 py-1 rounded-md text-[10px] font-medium flex items-center gap-1.5 transition-all ${aiMode === 'local' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    <Cpu className="w-3 h-3" /> Local
                                </button>
                                <button 
                                    onClick={() => setAiMode('remote')} 
                                    className={`px-3 py-1 rounded-md text-[10px] font-medium flex items-center gap-1.5 transition-all ${aiMode === 'remote' ? 'bg-amber-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    <Globe className="w-3 h-3" /> Remote
                                </button>
                            </div>
                        </div>

                        {/* Model Selector Row */}
                        <div className="flex items-center gap-2">
                            <div className="flex-1">
                                <ModelSelector 
                                    aiMode={aiMode} 
                                    selectedModel={selectedModel} 
                                    onSelectModel={setSelectedModel} 
                                    menuPosition="bottom" 
                                />
                            </div>
                            
                            {/* Settings Toggle (Only for Remote) */}
                            {aiMode === 'remote' && (
                                <button 
                                    onClick={() => setShowSettings(!showSettings)}
                                    className={`p-2.5 rounded-lg border transition-all ${showSettings ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-black/30 border-white/10 text-slate-400 hover:bg-white/5 hover:text-white'}`}
                                    title="Configure Remote URL"
                                >
                                    <Settings className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        {/* Inline Settings Panel (Only for Remote) */}
                        {showSettings && aiMode === 'remote' && (
                            <div className="mt-2 p-3 bg-black/40 border border-white/10 rounded-lg animate-fade-in">
                                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase">Remote Server URL (EC2 / Azure)</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        value={remoteUrl} 
                                        onChange={(e) => setRemoteUrl(e.target.value)}
                                        placeholder="http://54.123.x.x:11434"
                                        className="flex-1 bg-ubiq-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:border-amber-500 outline-none placeholder:text-slate-600 font-mono"
                                    />
                                    <button 
                                        onClick={handleSaveSettings} 
                                        className="bg-amber-600 px-3 py-1 text-xs text-white rounded font-medium hover:bg-amber-500 flex items-center gap-1"
                                    >
                                        <Save className="w-3 h-3" /> Save
                                    </button>
                                </div>
                                <p className="text-[9px] text-slate-500 mt-1.5 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"/>
                                    URL is shared with Chat settings — configure once, works everywhere.
                                </p>
                            </div>
                        )}
                        
                        {/* Info Banner for Local Mode */}
                        {aiMode === 'local' && (
                            <div className="text-[10px] text-emerald-400 bg-emerald-900/20 border border-emerald-900/50 p-2 rounded flex items-center gap-2">
                                <Cpu className="w-3 h-3" />
                                <span>Connecting via <span className="font-mono">host.docker.internal:11434</span> (Ollama on host machine)</span>
                            </div>
                        )}
                    </div>

                    {/* Prompt Input */}
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">What do you want to build?</label>
                        <div className="relative">
                            <textarea 
                                value={prompt} 
                                onChange={(e) => setPrompt(e.target.value)} 
                                placeholder="E.g. Create a Laravel Task API, or build an Angular CRM..." 
                                className="w-full h-40 bg-black/30 border border-white/10 rounded-lg p-4 text-sm text-white focus:border-purple-500/50 outline-none resize-none placeholder:text-slate-600 leading-relaxed" 
                            />
                        </div>
                    </div>

                    {/* Status Message */}
                    {status && (
                        <div className={`text-xs text-center font-medium ${status.includes('Error') ? 'text-red-400' : 'text-purple-300 animate-pulse'}`}>
                            {status}
                        </div>
                    )}

                    {/* Raw model output — shown only when parsing fails, so user knows what the model said */}
                    {!loading && status.includes('Error') && rawModelOutput && (
                        <div className="mt-2 rounded-lg border border-red-500/20 bg-black/40 overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                                <span className="text-[10px] uppercase font-bold text-red-400 tracking-wider">Model Raw Output</span>
                                <button
                                    onClick={() => navigator.clipboard.writeText(rawModelOutput)}
                                    className="text-[10px] text-slate-500 hover:text-white transition-colors"
                                >Copy</button>
                            </div>
                            <pre className="text-[10px] text-slate-400 p-3 max-h-36 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed custom-scrollbar">
                                {rawModelOutput.length > 800
                                    ? rawModelOutput.substring(0, 800) + '\n… (truncated)'
                                    : rawModelOutput}
                            </pre>
                        </div>
                    )}

                    {/* Action Button */}
                    <button 
                        onClick={handleGenerate} 
                        disabled={loading || !prompt} 
                        className="w-full py-3.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-purple-900/20 active:scale-[0.98]"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
                        {loading ? "Architecting..." : "Generate Project"}
                    </button>
                </div>
            </div>
        </div>
    );
}