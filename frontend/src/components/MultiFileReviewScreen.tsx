import { useState, useMemo } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  XMarkIcon,
  CheckIcon,
  NoSymbolIcon,
  LockClosedIcon,
  DocumentPlusIcon,
  DocumentMinusIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { diffLineStats } from '../utils/multiFileProposals';

export type FileChangeStatus = 'new' | 'modified' | 'deleted';

export interface ReviewFile {
  path: string;
  language: string;
  oldContent: string;
  newContent: string;
  status: FileChangeStatus;
  isProtected: boolean;
}

interface MultiFileReviewScreenProps {
  files: ReviewFile[];
  /** True while a specific file's accept/reject is in flight (disables that row + Accept All/Reject All so a second click can't race the first). */
  processingPath: string | null;
  onAcceptFile: (path: string) => void;
  onRejectFile: (path: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
}

const STATUS_META: Record<FileChangeStatus, { label: string; color: string; icon: typeof DocumentPlusIcon }> = {
  new:      { label: 'New',      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: DocumentPlusIcon },
  modified: { label: 'Modified', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',       icon: PencilSquareIcon },
  deleted:  { label: 'Deleted',  color: 'text-red-400 bg-red-500/10 border-red-500/20',             icon: DocumentMinusIcon },
};

/**
 * G2a — batch multi-file diff review (PLAN_SYSTEM_TASKS.md Phase G).
 *
 * Same underlying idea as ProjectEditorPage's existing single-file
 * `proposedContent` + Monaco `DiffEditor` flow — nothing writes to disk
 * until a file is explicitly accepted — just generalized to N files at
 * once with a file list instead of one implicit "the currently open
 * file". Deliberately a separate component rather than folded into
 * ProjectEditorPage directly: this same shape is what G2b will need
 * once `generate()`'s AI-scaffold-merge path routes through here too,
 * not just the chat path this is first proven on.
 */
export default function MultiFileReviewScreen({
  files,
  processingPath,
  onAcceptFile,
  onRejectFile,
  onAcceptAll,
  onRejectAll,
  onClose,
}: MultiFileReviewScreenProps) {
  const [selectedPath, setSelectedPath] = useState<string>(files[0]?.path ?? '');
  const selected = files.find(f => f.path === selectedPath) ?? files[0] ?? null;

  const statsByPath = useMemo(() => {
    const map = new Map<string, { added: number; removed: number }>();
    for (const f of files) {
      map.set(f.path, diffLineStats(f.oldContent, f.newContent));
    }
    return map;
  }, [files]);

  const acceptableCount = files.filter(f => !f.isProtected).length;

  if (files.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 md:p-8 animate-fade-in">
      <div className="w-full h-full max-w-6xl bg-[#1e1e1e] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">Review {files.length} proposed file {files.length === 1 ? 'change' : 'changes'}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Nothing is written until you accept — reject any file to discard it instead.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRejectAll}
              disabled={processingPath !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
            >
              <NoSymbolIcon className="w-3.5 h-3.5" /> Reject All
            </button>
            <button
              onClick={onAcceptAll}
              disabled={processingPath !== null || acceptableCount === 0}
              title={acceptableCount === 0 ? 'Every remaining file is protected' : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
            >
              <CheckIcon className="w-3.5 h-3.5" /> Accept All ({acceptableCount})
            </button>
            <div className="w-px h-5 bg-white/10 mx-1" />
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-colors">
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* File list */}
          <div className="w-72 border-r border-white/5 overflow-y-auto shrink-0">
            {files.map((f) => {
              const meta = STATUS_META[f.status];
              const Icon = meta.icon;
              const stats = statsByPath.get(f.path) ?? { added: 0, removed: 0 };
              const isSelected = f.path === selectedPath;
              const isProcessing = processingPath === f.path;

              return (
                <div
                  key={f.path}
                  onClick={() => setSelectedPath(f.path)}
                  className={`px-3.5 py-3 border-b border-white/5 cursor-pointer transition-colors ${isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${meta.color.split(' ')[0]}`} />
                      <span className="text-xs font-mono text-slate-300 truncate" title={f.path}>{f.path}</span>
                    </div>
                    {f.isProtected && (
                      <LockClosedIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" title="Protected scaffold file — can't be overwritten" />
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${meta.color}`}>{meta.label}</span>
                      <span className="text-[10px] font-mono">
                        {stats.added > 0 && <span className="text-emerald-400">+{stats.added}</span>}
                        {stats.added > 0 && stats.removed > 0 && ' '}
                        {stats.removed > 0 && <span className="text-red-400">−{stats.removed}</span>}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onRejectFile(f.path); }}
                        disabled={processingPath !== null}
                        title="Reject this file"
                        className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                      >
                        <NoSymbolIcon className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onAcceptFile(f.path); }}
                        disabled={processingPath !== null || f.isProtected}
                        title={f.isProtected ? "Protected scaffold file — can't be overwritten" : 'Accept this file'}
                        className="p-1 rounded text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                      >
                        {isProcessing ? (
                          <div className="w-3 h-3 border-[1.5px] border-slate-600 border-t-emerald-400 rounded-full animate-spin" />
                        ) : (
                          <CheckIcon className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Diff view */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selected ? (
              <>
                {selected.isProtected && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-300">
                    <LockClosedIcon className="w-3.5 h-3.5 shrink-0" />
                    This is a protected scaffold file. It's shown for reference, but can't be accepted — reject it to discard the proposal instead.
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  <DiffEditor
                    key={selected.path}
                    height="100%"
                    theme="vs-dark"
                    original={selected.oldContent}
                    modified={selected.newContent}
                    language={selected.language}
                    options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true, readOnly: true }}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">All files reviewed.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
