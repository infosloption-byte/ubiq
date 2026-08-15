import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { chatAPI, generateTitle } from '../services/api';
import { aiService, AiApiConfig } from '../services/aiService';
import { parseMultiFileProposals, extractSummaryText } from '../utils/multiFileProposals';
import ModelSelector from './ModelSelector';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  PaperAirplaneIcon, StopIcon, SparklesIcon, UserIcon,
  ClipboardIcon, CheckIcon, ArrowPathIcon, PhotoIcon,
  DocumentTextIcon, ArrowDownOnSquareIcon, XMarkIcon,
  CommandLineIcon, WrenchScrewdriverIcon, AcademicCapIcon, RocketLaunchIcon,
  Cog6ToothIcon, Square3Stack3DIcon
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
  /**
   * G2a — called with every path-tagged file proposal parsed out of an
   * assistant message (see utils/multiFileProposals.ts), when there are
   * 2+ of them in that message. A single path-tagged block is left to
   * the existing per-block "Apply" button instead — this is additive,
   * not a replacement for onApplyCode.
   */
  onReviewFiles?: (proposals: { path: string; language: string; newContent: string }[], summary: string) => void | Promise<void>;
  autoPrompt?: string | null;
  onAutoPromptClear?: () => void;
  aiMode?: string;
}

export default function ChatInterface({
  sessionId,
  onSessionUpdate,
  activeContext,
  onApplyCode,
  onReviewFiles,
  autoPrompt,
  onAutoPromptClear,
  aiMode = 'cloud'
}: ChatInterfaceProps) {

  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // G2d — activity indicator for the async gap between clicking "Review
  // N files" and the screen actually opening (fetching each file's
  // current content, resolving autonomy mode — see
  // ProjectEditorPage.tsx's handleReviewFiles). That gap was previously
  // a silent pause with zero feedback. A single component-wide boolean
  // rather than per-message: only one review can meaningfully be in
  // flight at a time, and disabling every "Review" button while one is
  // preparing is a reasonable, simple guard against double-firing.
  const [preparingReview, setPreparingReview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const [selectedModel, setSelectedModel] = useState<string>('');

  const [showSettings, setShowSettings] = useState(false);
  const [localUrl, setLocalUrl] = useState(localStorage.getItem('ubiq_local_url') || 'http://localhost:11434');
  const [remoteUrl, setRemoteUrl] = useState(localStorage.getItem('ubiq_ollama_url') || '');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * FIX #11: Stale closure in processMessage.
   *
   * The old code listed onApplyCode and onSessionUpdate in the useCallback
   * dependency array. When ProjectEditorPage passes these as inline arrow
   * functions (e.g. onApplyCode={(code) => setProposedContent(code)}), a new
   * function reference is created on every parent render, causing useCallback
   * to rebuild processMessage on every render — and in pathological cases,
   * causing it to capture a stale closure of the previous render's values.
   *
   * Fix: store the props in refs. The refs always hold the latest value without
   * being listed as dependencies, so processMessage is stable across renders
   * and never captures stale prop values.
   */
  const onApplyCodeRef = useRef(onApplyCode);
  const onReviewFilesRef = useRef(onReviewFiles);
  const onSessionUpdateRef = useRef(onSessionUpdate);
  const activeContextRef = useRef(activeContext);

  useEffect(() => { onApplyCodeRef.current = onApplyCode; }, [onApplyCode]);
  useEffect(() => { onReviewFilesRef.current = onReviewFiles; }, [onReviewFiles]);
  useEffect(() => { onSessionUpdateRef.current = onSessionUpdate; }, [onSessionUpdate]);
  useEffect(() => { activeContextRef.current = activeContext; }, [activeContext]);

  useEffect(() => { loadMessages(); }, [sessionId]);
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

  const handleSaveSettings = () => {
    if (aiMode === 'remote') localStorage.setItem('ubiq_ollama_url', remoteUrl);
    else localStorage.setItem('ubiq_local_url', localUrl);
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
      finalContent = finalContent ? `${finalContent}\n\n${attachmentMarkdown}` : attachmentMarkdown;
    }
    if (!finalContent) return;
    setInput('');
    setPendingAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    processMessage(finalContent, true);
  };

  /**
   * FIX #11 continued: processMessage now reads props from refs, not from the
   * dependency array. This means:
   *   - The function is only rebuilt when sessionId, aiMode, or selectedModel
   *     change — the things that actually affect how the API call is made.
   *   - onApplyCode and onSessionUpdate are read from refs at call time,
   *     so they are always current without being listed as deps.
   *   - activeContext is also read from a ref for the same reason.
   */
  const processMessage = useCallback(async (content: string, isNewUserMessage: boolean = true) => {
    if (isLoading) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsLoading(true);

    try {
      if (isNewUserMessage) {
        const tempUserMsg: Message = { role: 'user', content, created_at: new Date().toISOString() };
        setMessages(prev => [...prev, tempUserMsg]);

        try {
          await chatAPI.sendMessage(sessionId, { content });
        } catch (e) {
          console.warn('Failed to persist user message:', e);
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: '', created_at: new Date().toISOString() }]);

      // Read activeContext from ref — always current, no stale closure risk
      const ctx = activeContextRef.current;

      const contextMessages = messages
        .filter(m => m.content && m.content.trim() !== '')
        .map(m => ({ role: m.role, content: m.content }));

      if (isNewUserMessage) contextMessages.push({ role: 'user', content });

      if (ctx) {
        let systemPrompt = "You are an expert AI coding assistant. \n";
        if (ctx.projectStructure) {
          systemPrompt += `\n[PROJECT CONTEXT & FILE STRUCTURE]:\n${ctx.projectStructure}\n`;
          // G2a: only worth asking for when there's actual project
          // context to place files against — a context-free chat has
          // no file tree for "path=" to mean anything relative to.
          systemPrompt += "\nWhen you propose changes to one or more actual project files (not a standalone snippet), "
            + "tag each code block's fence with path=<relative/path/from/project/root> immediately after the "
            + "language name, for example a fence opened as: tsx path=src/components/Button.tsx "
            + "(then the code, then the closing fence as normal). Use one fenced block per file. Only use this "
            + "tag for real files in the project structure above — never for illustrative snippets, "
            + "partial examples, or terminal commands.\n";
        }
        if (ctx.currentFile) {
          systemPrompt += `\n[CURRENTLY OPEN FILE]: ${ctx.currentFile.name}\n\`\`\`\n${ctx.currentFile.content}\n\`\`\`\n`;
        }
        contextMessages.unshift({ role: 'system', content: systemPrompt });
      }

      const apiConfig: AiApiConfig = {};
      if (aiMode === 'local') {
        apiConfig.api_keys = { ollama_url: localStorage.getItem('ubiq_local_url') || 'http://localhost:11434' };
      } else if (aiMode === 'remote') {
        const savedRemoteUrl = localStorage.getItem('ubiq_ollama_url') || '';
        if (!savedRemoteUrl.trim()) {
          setMessages(prev => {
            const msgs = [...prev];
            const last = msgs[msgs.length - 1];
            if (last) last.content = "⚠️ Remote URL not configured. Open the settings panel (⚙) and enter your Ollama server URL.";
            return msgs;
          });
          setIsLoading(false);
          return;
        }
        apiConfig.api_keys = { ollama_url: savedRemoteUrl.trim() };
      }

      const response = await aiService.chat(content, contextMessages, aiMode, selectedModel, apiConfig);

      setMessages(prev => {
        const newMsgs = [...prev];
        const lastIndex = newMsgs.length - 1;
        if (newMsgs[lastIndex]) newMsgs[lastIndex].content = response.content;
        return newMsgs;
      });

      if (response.content) {
        try {
          await chatAPI.sendMessage(sessionId, { content: response.content, role: 'assistant' });
        } catch (e) {
          console.warn('Failed to persist assistant message:', e);
        }

        if (messages.length <= 1) {
          await generateTitle(sessionId, content);
          // Read onSessionUpdate from ref — always current
          onSessionUpdateRef.current?.();
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
    // FIX #11: onApplyCode and onSessionUpdate removed from deps — read from refs instead.
    // activeContext removed from deps — read from activeContextRef instead.
  }, [isLoading, messages, sessionId, aiMode, selectedModel]);

  useEffect(() => {
    if (autoPrompt) {
      processMessage(autoPrompt, true);
      onAutoPromptClear?.();
    }
  }, [autoPrompt]);

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

  const getUsername = () => user?.username ? user.username.split(' ')[0] : 'Developer';

  const suggestions = [
    { icon: RocketLaunchIcon, label: "Explain Code",        prompt: "Explain the code in the current file step-by-step." },
    { icon: WrenchScrewdriverIcon, label: "Refactor / Optimize", prompt: "Review my code for performance improvements and refactoring opportunities." },
    { icon: CommandLineIcon, label: "Find Bugs",            prompt: "Analyze the code for potential bugs, edge cases, or security issues." },
    { icon: AcademicCapIcon, label: "Generate Docs",        prompt: "Generate comprehensive documentation comments for this file." },
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

  const CodeBlockHeader = ({ language, code }: { language: string; code: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
    return (
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1e1e1e] border-b border-white/5 font-sans">
        <span className="text-[10px] text-slate-500 uppercase font-medium">{language || 'text'}</span>
        <div className="flex items-center gap-2">
          {/* Read onApplyCode from ref at render time — always current */}
          {onApplyCodeRef.current && (
            <button onClick={() => onApplyCodeRef.current!(code)} className="flex items-center gap-1 text-[10px] text-ubiq-accent hover:text-white transition-colors" title="Insert code into editor">
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
                  {(aiMode === 'local' || aiMode === 'remote') && <span className="block text-green-400 text-xs mt-2 font-mono">{aiMode === 'remote' ? 'Running on Remote Ollama' : 'Running on Local Ollama'}</span>}
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
                <div className="flex flex-col max-w-[90%] min-w-0">
                  <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed shadow-sm overflow-hidden ${msg.role === 'user' ? 'bg-ubiq-800 text-slate-200 border border-white/5 rounded-tr-none' : 'bg-transparent text-slate-300 px-0 py-0 shadow-none'}`}>
                    <ReactMarkdown components={{
                      code({ node, className, children, ...props }) {
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
                      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ubiq-accent hover:underline">{children}</a>,
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                      img: ({ src, alt }) => <img src={src} alt={alt} className="max-w-[300px] h-auto rounded-lg border border-white/10 my-2 object-cover" />
                    }}>{msg.content}</ReactMarkdown>
                  </div>

                  {/* G2a: only when 2+ path-tagged blocks are present —
                      a single one is left to that block's own existing
                      "Apply" button (CodeBlockHeader above) instead of
                      opening a whole review screen for one file. */}
                  {msg.role === 'assistant' && onReviewFilesRef.current && (() => {
                    const proposals = parseMultiFileProposals(msg.content);
                    if (proposals.length < 2) return null;
                    return (
                      <button
                        onClick={async () => {
                          if (!onReviewFilesRef.current || preparingReview) return;
                          setPreparingReview(true);
                          try {
                            await onReviewFilesRef.current(proposals, extractSummaryText(msg.content, proposals.length));
                          } finally {
                            setPreparingReview(false);
                          }
                        }}
                        disabled={preparingReview}
                        className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ubiq-accent hover:text-white bg-ubiq-accent/10 hover:bg-ubiq-accent/20 border border-ubiq-accent/20 rounded-lg px-3 py-1.5 transition-colors self-start disabled:opacity-60 disabled:cursor-wait"
                      >
                        {preparingReview ? (
                          <>
                            <div className="w-3.5 h-3.5 border-[1.5px] border-ubiq-accent/40 border-t-ubiq-accent rounded-full animate-spin" />
                            Preparing files for review…
                          </>
                        ) : (
                          <>
                            <Square3Stack3DIcon className="w-3.5 h-3.5" /> Review {proposals.length} files
                          </>
                        )}
                      </button>
                    );
                  })()}
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

          {showSettings && aiMode !== 'cloud' && (
            <div className="absolute -top-16 left-0 right-0 bg-ubiq-900/95 backdrop-blur-md border border-white/10 p-3 rounded-lg z-30 shadow-xl animate-fade-in-up flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 whitespace-nowrap">
                {aiMode === 'remote' ? 'Remote URL:' : 'Local URL:'}
              </span>
              <input
                type="text"
                value={aiMode === 'remote' ? remoteUrl : localUrl}
                onChange={(e) => aiMode === 'remote' ? setRemoteUrl(e.target.value) : setLocalUrl(e.target.value)}
                placeholder={aiMode === 'remote' ? 'http://54.123.x.x:11434' : 'http://localhost:11434'}
                className="flex-1 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white focus:border-ubiq-accent outline-none font-mono"
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

            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept="image/*,.pdf,.txt" />

            <div className="flex items-center justify-between px-1 pb-0.5">
              <div className="flex items-center gap-1 md:gap-2">
                <div className="scale-90 origin-left flex items-center gap-1">
                  <ModelSelector aiMode={aiMode} selectedModel={selectedModel} onSelectModel={setSelectedModel} />
                  {(aiMode === 'local' || aiMode === 'remote') && (
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
                  className={`p-2 rounded-lg transition-colors hidden md:block ${isUploading ? 'text-ubiq-accent animate-pulse cursor-wait' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
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
            {(aiMode === 'local' || aiMode === 'remote') ? (
              <span className="flex items-center justify-center gap-1">
                Running on <span className="text-emerald-400 font-mono">{aiMode === 'remote' ? 'Remote Ollama' : 'Localhost'}</span>
              </span>
            ) : 'AI can make mistakes. Check important info.'}
          </div>
        </div>
      </div>
    </div>
  );
}