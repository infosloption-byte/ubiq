import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  isDestructive?: boolean;
}

export default function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", isDestructive = false }: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-ubiq-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden ring-1 ring-white/10">
        <div className="p-6 text-center">
          <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDestructive ? 'bg-red-500/10 text-red-500' : 'bg-ubiq-accent/10 text-ubiq-accent'}`}>
            <ExclamationTriangleIcon className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
          <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-white/5 border-t border-white/5">
          <button onClick={onClose} className="p-4 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5">Cancel</button>
          <button onClick={() => { onConfirm(); onClose(); }} className={`p-4 text-sm font-bold hover:bg-white/5 ${isDestructive ? 'text-red-400' : 'text-ubiq-accent'}`}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}