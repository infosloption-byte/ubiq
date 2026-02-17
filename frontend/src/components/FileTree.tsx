import { useState, useMemo } from 'react';
import { 
  FolderIcon, 
  DocumentIcon, 
  ChevronRightIcon, 
  ChevronDownIcon, 
  PlusIcon, 
  TrashIcon, 
  FolderPlusIcon 
} from '@heroicons/react/24/outline';

import type { FileNode } from '../utils/fileUtils';

interface FileTreeProps {
  nodes: FileNode[];
  onSelectFile: (file: FileNode) => void;
  onDeleteNode: (node: FileNode) => void;
  onCreateNode: (type: 'file' | 'folder', parentPath: string) => void;
  selectedFileId?: number | null;
  level?: number;
}

export default function FileTree({ nodes, onSelectFile, onDeleteNode, onCreateNode, selectedFileId, level = 0 }: FileTreeProps) {
  const [expanded, setExpanded] = useState<{ [key: string]: boolean }>({});

  const toggleFolder = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  };

  // --- NEW: Sort Nodes (Folders Top, then Files, both Alphabetical) ---
  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => {
        // 1. Primary Sort: Folders before Files
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        
        // 2. Secondary Sort: Alphabetical by Name
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [nodes]);

  return (
    <div className="select-none text-sm font-medium">
      {sortedNodes.map((node) => {
        const isExpanded = expanded[node.path];
        
        // FIX: Ensure only valid fileIds are marked selected. Folders (undefined id) are ignored.
        const isSelected = !!node.fileId && node.fileId === selectedFileId;
        
        const paddingLeft = level * 12 + 12;

        return (
          <div key={node.path}>
            <div
              className={`group flex items-center justify-between py-1.5 pr-2 cursor-pointer transition-colors ${
                isSelected 
                  ? 'bg-ubiq-accent/20 text-white border-l-2 border-ubiq-accent' // Highlight Only Active File
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border-l-2 border-transparent' // Default Hover
              }`}
              style={{ paddingLeft: `${paddingLeft}px` }}
              onClick={(e) => {
                e.stopPropagation(); 
                node.type === 'folder' ? toggleFolder(node.path, e) : onSelectFile(node); 
              }}
            >
              <div className="flex items-center gap-1.5 truncate min-w-0">
                {node.type === 'folder' && (
                  <span className="shrink-0 text-slate-500 hover:text-white transition-colors">
                    {isExpanded ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
                  </span>
                )}
                
                {/* Spacer for files so they align with folders */}
                {node.type !== 'folder' && <div className="w-3 h-3 shrink-0" />}

                {node.type === 'folder' ? (
                  <FolderIcon className={`w-4 h-4 shrink-0 ${isExpanded ? 'text-ubiq-accent' : 'text-slate-500 group-hover:text-slate-300'}`} />
                ) : (
                  <DocumentIcon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-ubiq-accent' : 'opacity-70'}`} />
                )}
                
                <span className={`truncate ${node.type === 'folder' ? 'font-semibold' : ''}`}>{node.name}</span>
              </div>

              {/* Actions Area - Only visible on hover */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {node.type === 'folder' && (
                  <>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onCreateNode('file', node.path); setExpanded(p => ({...p, [node.path]: true})); }}
                      className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded" 
                      title="New File"
                    >
                      <PlusIcon className="w-3 h-3" />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onCreateNode('folder', node.path); setExpanded(p => ({...p, [node.path]: true})); }}
                      className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded" 
                      title="New Folder"
                    >
                      <FolderPlusIcon className="w-3 h-3" />
                    </button>
                  </>
                )}
                
                <button 
                  onClick={(e) => { e.stopPropagation(); onDeleteNode(node); }}
                  className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors" 
                  title="Delete"
                >
                  <TrashIcon className="w-3 h-3" />
                </button>
              </div>
            </div>

            {node.type === 'folder' && isExpanded && node.children && (
              <FileTree 
                nodes={node.children} 
                onSelectFile={onSelectFile} 
                onDeleteNode={onDeleteNode}
                onCreateNode={onCreateNode}
                selectedFileId={selectedFileId}
                level={level + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}