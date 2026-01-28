import { Editor } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { aiAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { SparklesIcon, XMarkIcon, CheckIcon } from '@heroicons/react/24/solid';

interface CodeEditorProps {
  initialCode?: string;
  language?: string;
  onCodeChange?: (code: string) => void;
}

export default function CodeEditor({ 
  initialCode = '', 
  language = 'javascript',
  onCodeChange 
}: CodeEditorProps) {
  const [code, setCode] = useState(initialCode);
  const [suggestion, setSuggestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const editorRef = useRef<any>(null);
  const timeoutRef = useRef<any>(null);
  const { user } = useAuthStore();

  useEffect(() => {
    setCode(initialCode);
  }, [initialCode]);

  // Debounced Auto-Completion
  const fetchCompletion = async (currentCode: string) => {
    if (currentCode.length < 10 || !user?.preferences?.code_suggestions) return;
    
    setIsLoading(true);
    try {
      const response = await aiAPI.completion({
        code: currentCode,
        language: language,
        max_tokens: 50,
      });

      if (response.data.completion) {
        setSuggestion(response.data.completion.trim());
      }
    } catch (err) {
      // Silent fail for completions to avoid annoying the user
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    const newCode = value || '';
    setCode(newCode);
    onCodeChange?.(newCode);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => fetchCompletion(newCode), 2000);
  };

  const insertSuggestion = () => {
    if (editorRef.current && suggestion) {
      const currentCode = editorRef.current.getValue();
      const newCode = currentCode + '\n' + suggestion;
      editorRef.current.setValue(newCode);
      setSuggestion('');
      onCodeChange?.(newCode);
    }
  };

  return (
    <div className="h-full relative group">
      <Editor
        height="100%"
        language={language}
        value={code}
        onChange={handleEditorChange}
        onMount={(editor) => { editorRef.current = editor; }}
        theme="vs-dark"
        options={{
          minimap: { enabled: user?.preferences?.editor_settings?.minimap?.enabled ?? false },
          fontSize: user?.preferences?.editor_settings?.fontSize ?? 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          lineNumbers: 'on',
          roundedSelection: false,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 20, bottom: 20 },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on"
        }}
      />
      
      {/* AI Loading State (Subtle Pulse) */}
      {isLoading && (
        <div className="absolute top-4 right-4 flex items-center gap-2 bg-ubiq-900/80 backdrop-blur border border-ubiq-accent/30 text-ubiq-accent px-3 py-1.5 rounded-full text-xs font-medium shadow-lg z-10">
          <SparklesIcon className="w-3.5 h-3.5 animate-pulse" />
          <span>AI Thinking...</span>
        </div>
      )}
      
      {/* AI Suggestion HUD */}
      {suggestion && !isLoading && (
        <div className="absolute bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-[500px] glass-panel rounded-xl shadow-2xl overflow-hidden border-l-4 border-l-ubiq-accent z-20">
          <div className="bg-ubiq-900/90 px-4 py-2 flex items-center justify-between border-b border-white/5">
            <div className="flex items-center gap-2 text-ubiq-accent">
              <SparklesIcon className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wide">AI Suggestion</span>
            </div>
            <div className="flex gap-2">
               <button onClick={() => setSuggestion('')} className="p-1 hover:bg-white/10 rounded transition-colors text-slate-400 hover:text-white">
                  <XMarkIcon className="w-4 h-4" />
               </button>
            </div>
          </div>
          
          <div className="p-4 bg-black/40 max-h-40 overflow-y-auto custom-scrollbar">
            <pre className="text-xs md:text-sm text-slate-300 font-mono whitespace-pre-wrap">{suggestion}</pre>
          </div>
          
          <div className="px-4 py-2 bg-ubiq-900/90 border-t border-white/5 flex justify-between items-center">
             <span className="text-[10px] text-slate-500">Review code before accepting</span>
             <button 
               onClick={insertSuggestion}
               className="flex items-center gap-1.5 bg-ubiq-accent hover:bg-ubiq-accent-hover text-white px-3 py-1 rounded text-xs font-medium transition-colors"
             >
               <CheckIcon className="w-3 h-3" /> Accept
             </button>
          </div>
        </div>
      )}
    </div>
  );
}