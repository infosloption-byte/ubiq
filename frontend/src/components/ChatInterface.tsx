import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { chatAPI, generateTitle } from '../services/api';
import { aiService } from '../services/aiService';
import ModelSelector from './ModelSelector';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { 
  PaperAirplaneIcon, StopIcon, SparklesIcon, UserIcon, 
  ClipboardIcon, CheckIcon, ArrowPathIcon, PhotoIcon, 
  DocumentTextIcon, ArrowDownOnSquareIcon, XMarkIcon,
  CommandLineIcon, WrenchScrewdriverIcon, AcademicCapIcon, RocketLaunchIcon,
  Cog6ToothIcon // [Modified] Added Icon
} from '@heroicons/react/24/outline';

interface Message {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

interface Attachment {
    url: string;
    name: string;
    type: string;
}

interface ChatInterfaceProps {
  sessionId: number;
  onSessionUpdate?: () => void;
  activeContext?: {
      projectStructure: string;
      currentFile?: { name: string; content: string };
  };
  onApplyCode?: (code: string) => void;
  autoPrompt?: string | null;
  onAutoPromptClear?: () => void;
  aiMode?: string; // Cloud vs Local Mode
}

export default function ChatInterface({ 
  sessionId, 
  onSessionUpdate, 
  activeContext,
  onApplyCode,
  autoPrompt,
  onAutoPromptClear,
  aiMode = 'cloud' 
}: ChatInterfaceProps) {
  
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  
  const [selectedModel, setSelectedModel] = useState<string>('');

  // [Modified] Settings State for Remote Ollama
  const [showSettings, setShowSettings] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState(localStorage.getItem('ubiq_ollama_url') || 'http://localhost:11434');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadMessages(); }, [sessionId]);

  useEffect(() => {
    if (autoPrompt) {
        processMessage(autoPrompt, true);
        if (onAutoPromptClear) onAutoPromptClear();
    }
  }, [autoPrompt]);

  useEffect(() => { scrollToBottom(); }, [messages, isLoading, pendingAttachments]);

  const loadMessages = async () => {
    try {
      setMessages([]);
      setPendingAttachments([]); 
      const response = await chatAPI.getMessages(sessionId);
      setMessages(response.data.messages || []);
    } catch (error) { console.error('Failed to load messages:', error); }
  };

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); };

  const handleStop = () => {
    if (abortController) { abortController.abort(); setAbortController(null); setIsLoading(false); }
  };

  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
        if (messages[messages.length - 1].role === 'assistant') { 
            setMessages(prev => prev.slice(0, -1)); 
        }
        processMessage(lastUserMsg.content, false);
    }
  };

  // [Modified] Save the custom URL
  const handleSaveSettings = () => {
      localStorage.setItem('ubiq_ollama_url', ollamaUrl);
      setShowSettings(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      try {
          const res = await chatAPI.uploadAttachment(sessionId, formData);
          const { url, name, type } = res.data;
          setPendingAttachments(prev => [...prev, { url, name, type }]);
          setTimeout(() => textareaRef.current?.focus(), 100);
      } catch (error) {
          console.error("Upload failed", error);
          alert("Failed to upload image. Please try again.");
      } finally {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  const removeAttachment = (index: number) => {
      setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    
    let finalContent = input.trim();
    
    if (pendingAttachments.length > 0) {
        const attachmentMarkdown = pendingAttachments.map(att => 
            att.type.startsWith('image/') 
                ? `![${att.name}](${att.url})` 
                : `[📎 ${att.name}](${att.url})`
        ).join('\n\n');
        
        if (finalContent) {
            finalContent += `\n\n${attachmentMarkdown}`;
        } else {
            finalContent = attachmentMarkdown;
        }
    }

    if (!finalContent) return;

    setInput('');
    setPendingAttachments([]); 
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    
    processMessage(finalContent, true);
  };

  const processMessage = async (content: string, isNewUserMessage: boolean = true) => {
    if (isLoading) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsLoading(true);

    try {
      if (isNewUserMessage) {
        const tempUserMsg: Message = { role: 'user', content, created_at: new Date().toISOString() };
        setMessages(prev => [...prev, tempUserMsg]);
        if (aiMode === 'cloud') {
            await chatAPI.sendMessage(sessionId, { content }); 
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: '', created_at: new Date().toISOString() }]);

      const contextMessages = messages
        .filter(m => m.content && m.content.trim() !== '') 
        .map(m => ({ role: m.role, content: m.content }));
      
      if (isNewUserMessage) contextMessages.push({ role: 'user', content });

      if (activeContext) {
          let systemPrompt = "You are an expert AI coding assistant. \n";
          if (activeContext.projectStructure) {
              systemPrompt += `\n[PROJECT CONTEXT & FILE STRUCTURE]:\n${activeContext.projectStructure}\n`;
          }
          if (activeContext.currentFile) {
              systemPrompt += `\n[CURRENTLY OPEN FILE]: ${activeContext.currentFile.name}\n\`\`\`\n${activeContext.currentFile.content}\n\`\`\`\n`;
          }
          contextMessages.unshift({ role: 'system', content: systemPrompt });
      }

      // [Modified] Prepare Config for Remote Ollama
      const apiConfig: any = {};
      if (aiMode === 'local') {
          // Retrieve latest URL from storage
          const currentUrl = localStorage.getItem('ubiq_ollama_url') || 'http://localhost:11434';
          apiConfig.api_keys = { ollama_url: currentUrl };
      }

      const response = await aiService.chat(
          content, 
          contextMessages, 
          aiMode, 
          selectedModel,
          apiConfig // [Modified] Pass config as 5th argument
      );

      setMessages(prev => {
          const newMsgs = [...prev];
          const lastIndex = newMsgs.length - 1;
          if (newMsgs[lastIndex]) newMsgs[lastIndex].content = response.content;
          return newMsgs;
      });

      if (aiMode === 'cloud' && response.content) {
           await chatAPI.sendMessage(sessionId, { content: response.content, role: 'assistant' });
           if (messages.length <= 1) { 
              await generateTitle(sessionId, content); 
              if (onSessionUpdate) onSessionUpdate(); 
           }
      }

    } catch (error: any) {
      console.error('Chat processing failed:', error);
      setMessages(prev => {
         const newMsgs = [...prev];
         const lastIndex = newMsgs.length - 1;
         if (newMsgs[lastIndex]) {
             newMsgs[lastIndex].content = `**Error:** ${error.message || "Failed to connect to AI."}`;
         }
         return newMsgs;
      });
    } finally {
        setIsLoading(false);
        setAbortController(null);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const getGreeting = () => {
      const hour = new Date().getHours();
      if (hour < 12) return "Good morning";
      if (hour < 18) return "Good afternoon";
      return "Good evening";
  };

  const getUsername = () => {
      return user?.username ? user.username.split(' ')[0] : 'Developer';
  };

  const suggestions = [
      { icon: RocketLaunchIcon, label: "Explain Code", prompt: "Explain the code in the current file step-by-step." },
      { icon: WrenchScrewdriverIcon, label: "Refactor / Optimize", prompt: "Review my code for performance improvements and refactoring opportunities." },
      { icon: CommandLineIcon, label: "Find Bugs", prompt: "Analyze the code for potential bugs, edge cases, or security issues." },
      { icon: AcademicCapIcon, label: "Generate Docs", prompt: "Generate comprehensive documentation comments for this file." },
  ];

  const handleSuggestion = (prompt: string) => {
      setInput(prompt);
      setTimeout(() => {
          if (textareaRef.current) {
              textareaRef.current.focus();
              textareaRef.current.style.height = 'auto';
              textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
          }
      }, 100);
  };

  const CodeBlockHeader = ({ language, code }: { language: string, code: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };

    return (
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1e1e1e] border-b border-white/5 font-sans">
         <span className="text-[10px] text-slate-500 uppercase font-medium">{language || 'text'}</span>
         <div className="flex items-center gap-2">
            {onApplyCode && (
                <button onClick={() => onApplyCode(code)} className="flex items-center gap-1 text-[10px] text-ubiq-accent hover:text-white transition-colors" title="Insert code into editor">
                    <ArrowDownOnSquareIcon className="w-3.5 h-3.5" /> Apply
                </button>
            )}
            <div className="w-px h-3 bg-white/10" />
            <button onClick={handleCopy} className="text-[10px] text-slate-400 hover:text-white transition-colors flex items-center gap-1">
                {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-400" /> : <ClipboardIcon className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
            </button>
         </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full relative bg-ubiq-950">
      <div className="flex-1 overflow-y-auto px-4 md:px-4 py-6 scroll-smooth custom-scrollbar">
        <div className="max-w-3xl mx-auto space-y-6 pb-32">
          
          {messages.length === 0 && !isLoading ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 animate-fade-in">
                  <div className="space-y-2">
                      <div className="inline-block p-3 rounded-2xl bg-gradient-to-tr from-ubiq-900 to-ubiq-800 border border-white/5 shadow-xl mb-4">
                          <SparklesIcon className="w-8 h-8 text-ubiq-accent" />
                      </div>
                      <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400">
                          {getGreeting()}, {getUsername()}
                      </h1>
                      <p className="text-slate-500 text-sm md:text-base">
                          How can I help you build today?
                          {aiMode === 'local' && <span className="block text-green-400 text-xs mt-2 font-mono">Running on Local/Remote Intelligence</span>}
                      </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-lg">
                      {suggestions.map((item, idx) => (
                          <button 
                              key={idx}
                              onClick={() => handleSuggestion(item.prompt)}
                              className="flex items-center gap-3 p-3 text-left rounded-xl bg-ubiq-900/50 border border-white/5 hover:bg-ubiq-900 hover:border-ubiq-accent/30 transition-all group"
                          >
                              <div className="p-2 rounded-lg bg-ubiq-950 text-slate-400 group-hover:text-ubiq-accent transition-colors">
                                  <item.icon className="w-5 h-5" />
                              </div>
                              <span className="text-sm text-slate-300 font-medium group-hover:text-white">{item.label}</span>
                          </button>
                      ))}
                  </div>
              </div>
          ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] ring-1 ring-white/10 shadow-lg mt-1 ${msg.role === 'user' ? 'bg-ubiq-800 text-slate-300' : 'bg-gradient-to-tr from-indigo-600 to-purple-600 text-white'}`}>
                    {msg.role === 'user' ? <UserIcon className="w-3.5 h-3.5" /> : <SparklesIcon className="w-3.5 h-3.5" />}
                  </div>
                  <div className={`flex flex-col max-w-[90%] min-w-0`}>
                      <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed shadow-sm overflow-hidden ${msg.role === 'user' ? 'bg-ubiq-800 text-slate-200 border border-white/5 rounded-tr-none' : 'bg-transparent text-slate-300 px-0 py-0 shadow-none'}`}>
                        <ReactMarkdown components={{
                            code({node, className, children, ...props}) {
                              const match = /language-(\w+)/.exec(className || '');
                              const codeString = String(children).replace(/\n$/, '');
                              return !props.inline && match ? (
                                <div className="my-3 rounded-lg overflow-hidden border border-white/10 bg-[#0d0d0d] shadow-lg w-full">
                                   <CodeBlockHeader language={match[1]} code={codeString} />
                                   <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div" customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '12px' }} {...props}>{codeString}</SyntaxHighlighter>
                                </div>
                              ) : (
                                <code className="bg-white/10 border border-white/5 rounded px-1.5 py-0.5 text-slate-200 font-mono text-xs break-all" {...props}>{children}</code>
                              );
                            },
                            a: ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ubiq-accent hover:underline">{children}</a>,
                            p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                            ul: ({children}) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                            ol: ({children}) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                            img: ({src, alt}) => <img src={src} alt={alt} className="max-w-[300px] h-auto rounded-lg border border-white/10 my-2 object-cover" />
                        }}>{msg.content}</ReactMarkdown>
                      </div>
                      <div className={`flex gap-2 mt-1 px-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} opacity-50 hover:opacity-100 transition-opacity`}>
                          {msg.role === 'assistant' && idx === messages.length - 1 && !isLoading && (
                              <button onClick={handleRetry} className="p-1 rounded text-slate-500 hover:text-ubiq-accent transition-colors" title="Regenerate"><ArrowPathIcon className="w-3 h-3" /></button>
                          )}
                      </div>
                  </div>
                </div>
              ))
          )}

          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
             <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white ring-1 ring-white/10"><SparklesIcon className="w-3.5 h-3.5 animate-pulse" /></div>
                <div className="flex items-center gap-1.5 h-7 px-2"><div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-75" /><div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-150" /><div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-300" /></div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-3 md:px-4 pb-4 pt-2 bg-gradient-to-t from-ubiq-950 via-ubiq-950 to-transparent z-20">
        <div className="max-w-3xl mx-auto relative">
          
          {activeContext && (
             <div className="absolute -top-8 left-2 flex items-center gap-1.5 px-3 py-1 bg-ubiq-900/90 border border-ubiq-accent/30 rounded-t-lg text-[10px] text-ubiq-accent font-medium backdrop-blur-sm shadow-sm animate-fade-in">
                <DocumentTextIcon className="w-3 h-3" />
                Reading: {activeContext.currentFile ? activeContext.currentFile.name : 'Project Context'}
             </div>
          )}

          {/* [Modified] Settings Popover for Remote Ollama */}
          {showSettings && (
              <div className="absolute -top-16 left-0 right-0 bg-ubiq-900/95 backdrop-blur-md border border-white/10 p-3 rounded-lg z-30 shadow-xl animate-fade-in-up flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 whitespace-nowrap">Ollama URL:</span>
                  <input 
                      type="text" 
                      value={ollamaUrl} 
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="flex-1 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white focus:border-ubiq-accent outline-none"
                  />
                  <button onClick={handleSaveSettings} className="bg-ubiq-accent px-3 py-1 text-xs text-white rounded hover:bg-indigo-500 font-bold">Save</button>
              </div>
          )}

          <div className={`relative glass-panel rounded-2xl p-2 shadow-2xl ring-1 ring-white/10 focus-within:ring-ubiq-accent/50 transition-all flex flex-col gap-2 bg-ubiq-900/90 backdrop-blur-xl ${activeContext ? 'rounded-tl-none' : ''}`}>
            
            {pendingAttachments.length > 0 && (
                <div className="flex gap-2 p-2 overflow-x-auto custom-scrollbar border-b border-white/5 mb-1">
                    {pendingAttachments.map((att, idx) => (
                        <div key={idx} className="relative group shrink-0">
                            {att.type.startsWith('image/') ? (
                                <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-white/10 group-hover:border-ubiq-accent/50 transition-colors">
                                    <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                <div className="w-14 h-14 rounded-lg bg-ubiq-800 border border-white/10 flex flex-col items-center justify-center p-1 group-hover:border-ubiq-accent/50 transition-colors">
                                    <DocumentTextIcon className="w-6 h-6 text-slate-400" />
                                    <span className="text-[8px] text-slate-500 truncate w-full text-center">{att.name.split('.').pop()}</span>
                                </div>
                            )}
                            
                            <button 
                                onClick={() => removeAttachment(idx)}
                                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 shadow-md hover:bg-red-600 transition-colors transform scale-0 group-hover:scale-100"
                            >
                                <XMarkIcon className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <textarea ref={textareaRef} rows={1} value={input} onChange={handleInput} onKeyDown={handleKeyDown} placeholder={activeContext?.currentFile ? `Ask about ${activeContext.currentFile.name}...` : "Ask AI..."} className="w-full bg-transparent text-slate-200 text-sm px-3 py-2 focus:outline-none resize-none max-h-[150px] placeholder:text-slate-500 custom-scrollbar" />
            
            <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                onChange={handleFileUpload}
                accept="image/*,.pdf,.txt" 
            />

            <div className="flex items-center justify-between px-1 pb-0.5">
                <div className="flex items-center gap-1 md:gap-2">
                    {/* [Modified] Model Selector + Settings Icon */}
                    <div className="scale-90 origin-left flex items-center gap-1">
                        <ModelSelector 
                            aiMode={aiMode} 
                            selectedModel={selectedModel} 
                            onSelectModel={setSelectedModel} 
                        />
                        {/* Only show settings gear if in LOCAL mode */}
                        {aiMode === 'local' && (
                            <button 
                                onClick={() => setShowSettings(!showSettings)}
                                className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'text-white bg-white/10' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}
                                title="Configure Remote/Local Connection"
                            >
                                <Cog6ToothIcon className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    
                    <button 
                        onClick={() => fileInputRef.current?.click()} 
                        disabled={isUploading || isLoading}
                        className={`p-2 rounded-lg transition-colors hidden md:block ${
                            isUploading ? 'text-ubiq-accent animate-pulse cursor-wait' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                        }`}
                        title="Attach Image or File"
                    >
                        <PhotoIcon className="w-5 h-5" />
                    </button>
                </div>
                
                {isLoading ? (
                    <button onClick={handleStop} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all text-xs font-medium"><StopIcon className="w-4 h-4 animate-pulse" /> Stop</button>
                ) : (
                    <button onClick={() => handleSubmit()} disabled={!input.trim() && pendingAttachments.length === 0} className={`p-2 rounded-xl transition-all duration-200 ${input.trim() || pendingAttachments.length > 0 ? 'bg-ubiq-accent hover:bg-ubiq-accent-hover text-white shadow-lg shadow-ubiq-accent/20' : 'bg-ubiq-800 text-slate-500 cursor-not-allowed'}`}><PaperAirplaneIcon className="w-5 h-5" /></button>
                )}
            </div>
          </div>
          <div className="text-center mt-2 text-[10px] text-slate-600 font-medium hidden md:block">
            {aiMode === 'local' ? (
                <span className="flex items-center justify-center gap-1">
                    Running on <span className="text-emerald-400 font-mono">{ollamaUrl.includes('localhost') ? 'Localhost' : 'Remote EC2'}</span> (Ollama)
                </span>
            ) : 'AI can make mistakes. Check important info.'}
          </div>
        </div>
      </div>
    </div>
  );
}