import { useEffect, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

interface FilePreviewProps {
  file: any;
  content: string; 
  projectId: number;
  allFiles: any[];
}

export default function FilePreview({ file, projectId }: FilePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    // 1. Get the raw token string
    let token = localStorage.getItem('token');
    
    // Fallback: Try getting it from auth-storage if main key is empty
    if (!token) {
        const authStorage = JSON.parse(localStorage.getItem('auth-storage') || '{}');
        token = authStorage.state?.token;
    }

    if (!token) {
        console.error("No auth token found for preview");
        return;
    }

    // 2. Clean the token (Remove "Bearer " prefix if present)
    // Sanctum's findToken() expects the raw string, not the header format.
    token = token.replace('Bearer ', '');

    // 3. Construct Backend URL
    const baseUrl = `${import.meta.env.VITE_API_URL}/projects/${projectId}/preview`;
    
    // Remove leading slashes from file path to ensure clean URL
    const cleanPath = file.path.replace(/^\/+/, '');
    
    // --- CRITICAL FIX: Put token IN THE PATH, not as a query param ---
    const url = `${baseUrl}/${token}/${cleanPath}`;
    
    setPreviewUrl(url);
  }, [file, projectId]);

  if (!previewUrl) {
      return (
        <div className="flex h-full items-center justify-center text-slate-500 gap-2">
            <ArrowPathIcon className="w-5 h-5 animate-spin" /> Loading Preview...
        </div>
      );
  }

  const ext = file.name.split('.').pop()?.toLowerCase();
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext || '');

  return (
    <div className="w-full h-full bg-white flex flex-col">
      {!isImage ? (
          <iframe
            key={previewUrl} 
            src={previewUrl}
            title="Preview"
            className="w-full h-full border-none flex-1"
            // Allow scripts so your JS/Charts work inside the preview
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          />
      ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900/50 p-4 overflow-auto">
             <img src={previewUrl} alt={file.name} className="max-w-full max-h-full object-contain shadow-lg rounded-lg bg-[url('/grid.png')]" />
          </div>
      )}
    </div>
  );
}