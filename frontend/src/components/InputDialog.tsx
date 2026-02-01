import { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface InputDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  message: string;
  placeholder?: string;
}

export default function InputDialog({ isOpen, onClose, onSubmit, title, message, placeholder }: InputDialogProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (isOpen) setValue(''); // Reset on open
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-ubiq-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden ring-1 ring-white/10">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-ubiq-800/50">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><XMarkIcon className="w-5 h-5" /></button>
        </div>
        <div className="p-6">
          <p className="text-slate-400 text-sm mb-4">{message}</p>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className="w-full bg-ubiq-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-ubiq-accent focus:ring-1 focus:ring-ubiq-accent"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) onSubmit(value);
              if (e.key === 'Escape') onClose();
            }}
          />
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-ubiq-950/50 border-t border-white/5">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white">Cancel</button>
          <button 
            onClick={() => value.trim() && onSubmit(value)}
            disabled={!value.trim()}
            className="px-4 py-2 text-sm font-bold text-white bg-ubiq-accent rounded-lg hover:bg-ubiq-accent-hover disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}