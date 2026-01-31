import { useState } from 'react';
import { 
  FolderIcon, 
  DocumentIcon, 
  ChevronRightIcon, 
  ChevronDownIcon 
} from '@heroicons/react/24/outline';

interface FileNode {
  id: number;
  name: string;
  language: string;
  is_folder?: boolean; // API might not send this yet, but good for future
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  onSelectFile: (file: FileNode) => void;
  selectedFileId?: number | null;
}

export default function FileTree({ files, onSelectFile, selectedFileId }: FileTreeProps) {
  // Simple flat list renderer for now (can be upgraded to recursive tree later)
  return (
    <div className="space-y-0.5 select-none">
      {files.map((file) => (
        <div
          key={file.id}
          onClick={() => onSelectFile(file)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
            selectedFileId === file.id
              ? 'bg-ubiq-accent/20 text-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
        >
          {/* Icon based on extension/type */}
          {file.name.includes('.') ? (
            <DocumentIcon className="w-4 h-4 shrink-0 opacity-70" />
          ) : (
            <FolderIcon className="w-4 h-4 shrink-0 text-ubiq-accent opacity-80" />
          )}
          
          <span className="truncate">{file.name}</span>
        </div>
      ))}
      
      {files.length === 0 && (
        <div className="text-center py-4 text-xs text-slate-600 italic">
          No files found.
        </div>
      )}
    </div>
  );
}