import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiService } from '../services/aiService';
import { projectAPI } from '../services/api';
import { Sparkles, X, Loader2, Cloud, Cpu } from 'lucide-react';
import ModelSelector from './ModelSelector'; 

interface AiGeneratorModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function AiGeneratorModal({ isOpen, onClose }: AiGeneratorModalProps) {
    const navigate = useNavigate();
    
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    
    // Model Selection State
    const [aiMode, setAiMode] = useState<'cloud' | 'local'>('cloud');
    const [selectedModel, setSelectedModel] = useState('gpt-4o'); // Default

    const parseResponse = (rawOutput: string) => {
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

        let jsonStr = rawOutput;
        const start = rawOutput.indexOf('[');
        const end = rawOutput.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
            jsonStr = rawOutput.substring(start, end + 1);
        }
        
        jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '');
        
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            try {
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
            const projectRes = await projectAPI.create({
                name: "AI App " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                description: prompt.substring(0, 50) + "...",
                visibility: 'private',
                source: 'manual'
            });
            const projectId = projectRes.data.project.id;

            setStatus(`Architecting with ${selectedModel}...`);
            
            // --- EXPANDED POLYGLOT SYSTEM PROMPT ---
            const systemPrompt = `You are an Expert Full Stack Architect.
            TASK: Generate a complete, production-ready web application workspace.
            
            TECHNOLOGY STACK SELECTION:
            - If the user specifies a framework (React, Angular, Laravel, Django, Next.js, etc.), you MUST strictly use that technology stack.
            - If the user does not specify a stack, you MUST analyze their requirements and independently choose the OPTIMUM modern stack for their specific use case.
            
            STRICT OUTPUT FORMAT (NO JSON):
            You must output files using exactly this block format. Do NOT use markdown blocks outside of this format:

            ---START_FILE: filename.ext---
            // content here
            ---END_FILE---

            CRITICAL RULES:
            1. You MUST include a 'ubiq.json' file to configure the server.
            2. 'ubiq.json' MUST contain:
               - "title": A short, catchy name for this project based on the prompt.
               - "runtime": Map to EXACTLY ONE of these: "static", "node", "php", "python".
               - "entry": The primary file to execute/serve (e.g., package.json, composer.json, index.html).
            
            DECISION TREE FOR RUNTIME:
            - Vanilla HTML/JS -> "runtime": "static"
            - React/Vue/Node/Next/Angular -> "runtime": "node" 
            - PHP/Laravel/Symfony -> "runtime": "php" 
            - Python/Django/Flask -> "runtime": "python" 

            3. DEPENDENCY ENFORCEMENT & PORT STANDARDIZATION:
               - If runtime is "node", generate 'package.json'. CRITICAL: Configure the "dev" script to run on port 5173 and bind to 0.0.0.0 (e.g., "vite --port 5173 --host 0.0.0.0", "next dev -p 5173 -H 0.0.0.0", "ng serve --port 5173 --host 0.0.0.0").
               - If runtime is "php", generate 'composer.json' (if applicable) and standard PHP directory structure.
               - If runtime is "python", generate 'requirements.txt'.
              
            4. Provide ALL necessary code. Do not leave placeholders.`;

            // --- DYNAMIC PROMPT REINFORCEMENT ---
            let enhancedPrompt = prompt;
            const promptLower = prompt.toLowerCase();
            
            if (/(react|vue|angular|svelte|next|nuxt|node|express)/.test(promptLower)) {
                enhancedPrompt += "\n\nCRITICAL ENFORCEMENT: You MUST use '\"runtime\": \"node\"' and generate a 'package.json'. Configure the dev server to run on port 5173. Do NOT output a static HTML fallback.";
            } else if (/(php|laravel|symfony|codeigniter)/.test(promptLower)) {
                enhancedPrompt += "\n\nCRITICAL ENFORCEMENT: You MUST use '\"runtime\": \"php\"' and generate a 'composer.json' if applicable. Do NOT output a static HTML fallback.";
            } else if (/(python|django|flask|fastapi)/.test(promptLower)) {
                enhancedPrompt += "\n\nCRITICAL ENFORCEMENT: You MUST use '\"runtime\": \"python\"' and generate a 'requirements.txt'. Do NOT output a static HTML fallback.";
            } else {
                enhancedPrompt += "\n\nCRITICAL ENFORCEMENT: Choose the best tech stack. If it requires a build step or server (Node/PHP/Python), you MUST set the correct 'runtime' in ubiq.json and generate the dependency files.";
            }

            const fullMessage = `${systemPrompt}\n\nUser Request: ${enhancedPrompt}`;

            const response = await aiService.chat(fullMessage, [], aiMode, selectedModel, projectId);

            setStatus('Extracting Files...');
            let files = [];
            
            try {
                files = parseResponse(response.content);
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

            // --- NEW: DYNAMIC TITLE EXTRACTION ---
            try {
                const ubiqFile = files.find((f: any) => f.path === 'ubiq.json');
                if (ubiqFile) {
                    const parsedUbiq = JSON.parse(ubiqFile.content);
                    if (parsedUbiq.title) {
                        setStatus(`Renaming to "${parsedUbiq.title}"...`);
                        await projectAPI.update(projectId, { name: parsedUbiq.title });
                    }
                }
            } catch (titleError) {
                console.warn("Failed to extract dynamic title from ubiq.json");
            }

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
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">AI Architect Model</label>
                            
                            {/* Toggle Cloud / Local */}
                            <div className="flex bg-black/30 rounded-lg p-0.5 border border-white/5">
                                <button onClick={() => setAiMode('cloud')} className={`px-3 py-1 rounded-md text-[10px] font-medium flex items-center gap-1.5 transition-all ${aiMode === 'cloud' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                                    <Cloud className="w-3 h-3" /> Cloud
                                </button>
                                <button onClick={() => setAiMode('local')} className={`px-3 py-1 rounded-md text-[10px] font-medium flex items-center gap-1.5 transition-all ${aiMode === 'local' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                                    <Cpu className="w-3 h-3" /> Local
                                </button>
                            </div>
                        </div>

                        {/* USE YOUR EXISTING CUSTOM COMPONENT HERE */}
                        <ModelSelector 
                            aiMode={aiMode}
                            selectedModel={selectedModel}
                            onSelectModel={setSelectedModel}
                            menuPosition="bottom"
                        />
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