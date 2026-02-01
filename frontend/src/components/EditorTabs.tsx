import { XMarkIcon, DocumentIcon } from '@heroicons/react/24/outline';
import type { FileNode } from '../utils/fileUtils';

interface EditorTabsProps {
  files: FileNode[];
  activeFileId: number | null;
  onSelect: (file: FileNode) => void;
  onClose: (fileId: number) => void;
}

export default function EditorTabs({ files, activeFileId, onSelect, onClose }: EditorTabsProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex bg-ubiq-900 border-b border-white/5 overflow-x-auto custom-scrollbar no-scrollbar">
      {files.map((file) => (
        <div
          key={file.id}
          onClick={() => onSelect(file)}
          className={`
            group flex items-center gap-2 px-3 py-2.5 text-xs font-medium cursor-pointer border-r border-white/5 min-w-[120px] max-w-[200px]
            ${activeFileId === file.fileId 
              ? 'bg-[#1e1e1e] text-white border-t-2 border-t-ubiq-accent' 
              : 'text-slate-400 hover:bg-[#1e1e1e] hover:text-slate-200 border-t-2 border-t-transparent'}
          `}
        >
          <DocumentIcon className={`w-3.5 h-3.5 ${activeFileId === file.fileId ? 'text-ubiq-accent' : 'text-slate-500'}`} />
          <span className="truncate flex-1">{file.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); if (file.fileId) onClose(file.fileId); }}
            className={`p-0.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10 ${activeFileId === file.fileId ? 'opacity-100' : ''}`}
          >
            <XMarkIcon className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}