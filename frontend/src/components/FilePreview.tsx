import { useEffect, useState } from 'react';
import { ArrowPathIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import api from '../services/api';

interface FilePreviewProps {
  file: any;
  content: string; 
  projectId: number;
  allFiles: any[];
}

export default function FilePreview({ file, projectId }: FilePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file?.path) return;

    setPreviewUrl(null);
    setError(null);

    const cleanPath = file.path.replace(/^\/+/, '');

    // Request a short-lived signed URL from the backend.
    // The Bearer token travels in the Authorization header (via api interceptor),
    // never in the URL — so it never appears in server logs, browser history,
    // referrer headers, or proxy logs.
    api.get(`/projects/${projectId}/preview-url/${cleanPath}`)
      .then(res => setPreviewUrl(res.data.url))
      .catch(err => {
        console.error('Failed to get preview URL', err);
        setError('Could not load preview. You may not have access to this file.');
      });

  }, [file, projectId]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400 gap-2 flex-col">
        <ExclamationCircleIcon className="w-8 h-8 opacity-50" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

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
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-900/50 p-4 overflow-auto">
          <img
            src={previewUrl}
            alt={file.name}
            className="max-w-full max-h-full object-contain shadow-lg rounded-lg bg-[url('/grid.png')]"
          />
        </div>
      )}
    </div>
  );
}