export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  fileId?: number;
  language?: string;
}

export const buildFileTree = (files: any[]): FileNode[] => {
  const root: FileNode[] = [];
  const map: { [key: string]: FileNode } = {};

  // Safety: Ensure input is an array
  if (!Array.isArray(files)) {
    console.warn("buildFileTree received non-array:", files);
    return [];
  }

  // Safety: Filter out files with missing paths/names to prevent 'localeCompare' crash
  // Also filter .gitkeep — these are folder placeholder files, not real user content
  const validFiles = files.filter(f => f && f.path && typeof f.path === 'string' && !f.path.endsWith('.gitkeep'));

  // Sort: Alphabetical
  const sortedFiles = [...validFiles].sort((a, b) => a.path.localeCompare(b.path));

  sortedFiles.forEach((file) => {
    // Normalize Windows paths
    const normalizedPath = file.path.replace(/\\/g, '/');
    const parts = normalizedPath.split('/'); 
    
    let currentPath = '';

    parts.forEach((part: string, index: number) => {
      const isFile = index === parts.length - 1;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!map[currentPath]) {
        const node: FileNode = {
          id: isFile ? String(file.id) : currentPath,
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'folder',
          children: isFile ? undefined : [],
          fileId: isFile ? file.id : undefined,
          language: isFile ? file.language : undefined
        };

        map[currentPath] = node;

        if (parentPath && map[parentPath]) {
          map[parentPath].children?.push(node);
        } else if (!parentPath) {
          root.push(node);
        }
      }
    });
  });

  return root;
};