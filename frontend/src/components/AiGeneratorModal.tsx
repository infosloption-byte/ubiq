import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiService } from '../services/aiService';
import { projectAPI } from '../services/api';
import { Sparkles, X, Loader2, Cloud, Cpu, Globe, Settings, Save } from 'lucide-react';
import ModelSelector from './ModelSelector'; 

interface AiGeneratorModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function AiGeneratorModal({ isOpen, onClose }: AiGeneratorModalProps) {
    const navigate = useNavigate();
    
    // --- STATE ---
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    
    // AI Configuration
    const [aiMode, setAiMode] = useState<'cloud' | 'local' | 'remote'>('cloud');
    const [selectedModel, setSelectedModel] = useState('gpt-4o'); 
    
    // Remote Connection Settings
    const [showSettings, setShowSettings] = useState(false);
    const [remoteUrl, setRemoteUrl] = useState(localStorage.getItem('ubiq_remote_url') || 'http://localhost:11434');

    // Save remote URL to local storage
    const handleSaveSettings = () => {
        localStorage.setItem('ubiq_remote_url', remoteUrl);
        setShowSettings(false);
    };

    // Auto-select defaults when switching modes
    useEffect(() => {
        if (aiMode === 'cloud') setSelectedModel('gpt-4o');
        // For local/remote, ModelSelector usually handles default selection or we let user pick
    }, [aiMode]);

    // Robust Response Parser
    const parseResponse = (rawOutput: string) => {
        // 1. Try parsing "---START_FILE---" block format (Preferred for Local Models)
        if (rawOutput.includes('---START_FILE:')) {
            const files = [];
            const parts = rawOutput.split('---START_FILE:');
            
            for (const part of parts) {
                if (!part.trim()) continue; 
                
                const endNameIndex = part.indexOf('---');
                if (endNameIndex === -1) continue;
                const fileName = part.substring(0, endNameIndex).trim();
                
                const contentEndIndex = part.lastIndexOf('---END_FILE---');
                if (contentEndIndex === -1) continue;
                
                let content = part.substring(endNameIndex + 3, contentEndIndex).trim();
                
                if (fileName && content) {
                    files.push({ path: fileName, content: content });
                }
            }
            if (files.length > 0) return files;
        }

        // 2. Fallback: Try parsing pure JSON or Markdown-wrapped JSON
        let jsonStr = rawOutput;
        const start = rawOutput.indexOf('['); // Look for array start
        const end = rawOutput.lastIndexOf(']');
        
        if (start !== -1 && end !== -1) {
            jsonStr = rawOutput.substring(start, end + 1);
        }
        
        // Clean markdown code blocks
        jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '');
        
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            try {
                // Last resort: unsafe eval if JSON is slightly malformed (keys without quotes etc)
                // eslint-disable-next-line no-new-func
                return new Function('return ' + jsonStr)(); 
            } catch (e2) {
                throw new Error("Could not parse AI response. The model output was invalid.");
            }
        }
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setLoading(true);
        setStatus('Initializing Workspace...');

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
            
            // 2. Construct System Prompt
            const systemPrompt = `You are an Expert Full Stack Architect.
            TASK: Generate a complete, production-ready web application workspace.
            
            OUTPUT FORMAT (STRICT):
            ---START_FILE: filename.ext---
            // content
            ---END_FILE---

            CRITICAL RULES:
            1. Include 'ubiq.json' (runtime: static/node/php/python).
            2. If 'node', include 'package.json' with "dev": "vite --port 5173 --host 0.0.0.0".
            3. React/Vue 'index.html' must be in ROOT.
            4. If 'php', standard structure + 'composer.json'.
            5. Provide FULL code. No placeholders.`;

            const fullMessage = `${systemPrompt}\n\nUser Request: ${prompt}`;

            // 3. Prepare Config based on Mode
            const apiConfig: any = {
                project_id: projectId
            };
            
            if (aiMode === 'remote') {
                const currentRemoteUrl = localStorage.getItem('ubiq_remote_url');
                if (!currentRemoteUrl) throw new Error("Please configure your Remote URL in settings.");
                apiConfig.api_keys = { ollama_url: currentRemoteUrl };
            }
            // Note: If 'local', we send no api_keys. Backend defaults to host.docker.internal.

            // 4. Call AI Service
            const response = await aiService.chat(
                fullMessage, 
                [], 
                aiMode === 'cloud' ? 'cloud' : 'local', // Service layer treats Remote as 'local' (Ollama provider)
                selectedModel, 
                apiConfig
            );

            setStatus('Extracting Files...');
            let files = [];
            
            try {
                files = parseResponse(response.content);
                // Ensure content is stringified if it came back as JSON object/array
                files = files.map((f: any) => {
                    let content = f.content;
                    if (Array.isArray(content)) content = content.join('\n');
                    else if (typeof content === 'object') content = JSON.stringify(content, null, 2);
                    return { path: f.path, content: String(content) };
                });
            } catch (e: any) {
                console.error("Parsing Error:", e);
                throw new Error("Failed to parse AI output. Try a simpler prompt or a smarter model.");
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
                                    // Pass 'local' to filter for Ollama models if in Local OR Remote mode
                                    aiMode={aiMode === 'cloud' ? 'cloud' : 'local'} 
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
                                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase">Remote Server URL (EC2)</label>
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
                                    Connects your backend to an external Ollama instance.
                                </p>
                            </div>
                        )}
                        
                        {/* Info Banner for Local Mode */}
                        {aiMode === 'local' && (
                            <div className="text-[10px] text-emerald-400 bg-emerald-900/20 border border-emerald-900/50 p-2 rounded flex items-center gap-2">
                                <Cpu className="w-3 h-3" />
                                <span>Using Docker Host (host.docker.internal:11434)</span>
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