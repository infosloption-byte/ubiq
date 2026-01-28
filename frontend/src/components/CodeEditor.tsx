import { Editor } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { aiAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';

interface CodeEditorProps {
  initialCode?: string;
  language?: string;
  onCodeChange?: (code: string) => void;
}

export default function CodeEditor({ 
  initialCode = '// Start coding with AI assistance...\n\n', 
  language = 'javascript',
  onCodeChange 
}: CodeEditorProps) {
  const [code, setCode] = useState(initialCode);
  const [suggestion, setSuggestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const editorRef = useRef<any>(null);
  const timeoutRef = useRef<any>(null);
  const { user } = useAuthStore();

  useEffect(() => {
    setCode(initialCode);
  }, [initialCode]);

  const fetchCompletion = async (currentCode: string) => {
    // Don't fetch if code is too short
    if (currentCode.length < 15) {
      setSuggestion('');
      return;
    }
    
    // Don't fetch if user hasn't enabled suggestions
    if (user?.preferences && !user.preferences.code_suggestions) {
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      const response = await aiAPI.completion({
        code: currentCode,
        language: language,
        max_tokens: 100,
        temperature: 0.2,
      });

      if (response.data.completion) {
        setSuggestion(response.data.completion.trim());
        
        // Auto-hide suggestion after 10 seconds
        setTimeout(() => {
          setSuggestion('');
        }, 10000);
      }
    } catch (err: any) {
      console.error('Completion failed:', err);
      
      if (err.response?.status === 429) {
        setError('Rate limit exceeded. Please wait before requesting more completions.');
      } else {
        setError('Failed to get AI suggestion');
      }
      
      // Clear error after 3 seconds
      setTimeout(() => setError(''), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    const newCode = value || '';
    setCode(newCode);
    onCodeChange?.(newCode);

    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Debounce completion requests (wait 2 seconds after user stops typing)
    timeoutRef.current = setTimeout(() => {
      fetchCompletion(newCode);
    }, 2000);
  };

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    // Add keyboard shortcut for accepting suggestion
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => {
      if (suggestion) {
        const currentCode = editor.getValue();
        const newCode = currentCode + '\n' + suggestion;
        editor.setValue(newCode);
        setSuggestion('');
      }
    });

    // Add save shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // Trigger save event if needed
      const event = new CustomEvent('editor-save', { detail: { code: editor.getValue() } });
      window.dispatchEvent(event);
    });
  };

  const insertSuggestion = () => {
    if (editorRef.current && suggestion) {
      const currentCode = editorRef.current.getValue();
      const newCode = currentCode + '\n' + suggestion;
      editorRef.current.setValue(newCode);
      setSuggestion('');
    }
  };

  const dismissSuggestion = () => {
    setSuggestion('');
  };

  return (
    <div className="h-full relative">
      <Editor
        height="100%"
        language={language}
        value={code}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        theme="vs-dark"
        options={{
          minimap: { 
            enabled: user?.preferences?.editor_settings?.minimap?.enabled ?? false 
          },
          fontSize: user?.preferences?.editor_settings?.fontSize ?? 14,
          lineNumbers: 'on',
          roundedSelection: false,
          scrollBeyondLastLine: false,
          readOnly: false,
          automaticLayout: true,
          tabSize: user?.preferences?.editor_settings?.tabSize ?? 4,
          wordWrap: user?.preferences?.editor_settings?.wordWrap ?? 'on',
          formatOnSave: user?.preferences?.editor_settings?.formatOnSave ?? false,
          suggestOnTriggerCharacters: true,
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
          acceptSuggestionOnCommitCharacter: true,
          acceptSuggestionOnEnter: 'on',
          snippetSuggestions: 'top',
        }}
      />
      
      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm flex items-center shadow-lg">
          <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          AI is thinking...
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="absolute top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg text-sm shadow-lg">
          {error}
        </div>
      )}
      
      {/* AI Suggestion Panel */}
      {suggestion && !isLoading && (
        <div className="absolute bottom-4 left-4 right-4 bg-slate-800 border-2 border-blue-500 rounded-lg shadow-2xl overflow-hidden animate-fade-in">
          <div className="bg-blue-600 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-white font-semibold text-sm">AI Suggestion</span>
            </div>
            <button
              onClick={dismissSuggestion}
              className="text-white hover:text-blue-200 transition-colors"
              title="Dismiss (Esc)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="p-4 max-h-48 overflow-y-auto">
            <pre className="text-sm text-gray-200 whitespace-pre-wrap font-mono bg-slate-900 p-3 rounded">
              {suggestion}
            </pre>
          </div>
          
          <div className="bg-slate-700 px-4 py-3 flex items-center justify-between border-t border-slate-600">
            <div className="text-xs text-slate-400">
              Press <kbd className="px-2 py-1 bg-slate-600 rounded text-white">Alt+Enter</kbd> to insert
            </div>
            <button
              onClick={insertSuggestion}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors"
            >
              Insert Code
            </button>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help */}
      <div className="absolute bottom-2 right-2 text-xs text-slate-500">
        <div className="flex items-center space-x-4 bg-slate-800/90 px-3 py-1 rounded">
          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">Ctrl+S</kbd> Save
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">Alt+Enter</kbd> Accept AI
          </span>
        </div>
      </div>
    </div>
  );
}