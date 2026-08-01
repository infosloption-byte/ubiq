import { useNavigate } from 'react-router-dom';
import { ExclamationTriangleIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { usePlanLimitStore } from '../stores/planLimitStore';

/**
 * C2 — Mounted once at the app root (App.tsx), driven entirely by
 * planLimitStore. Never instantiated per-component — this is what lets
 * the axios interceptor in api.ts trigger it from anywhere, including
 * code paths that have no direct access to component state.
 */
export default function PlanLimitModal() {
    const { isOpen, info, close } = usePlanLimitStore();
    const navigate = useNavigate();

    if (!isOpen || !info) return null;

    const handleUpgrade = () => {
        close();
        navigate('/settings');
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-ubiq-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden ring-1 ring-white/10">
                <div className="p-6 text-center">
                    <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
                        info.showUpgrade ? 'bg-ubiq-accent/10 text-ubiq-accent' : 'bg-orange-500/10 text-orange-400'
                    }`}>
                        <ExclamationTriangleIcon className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">{info.title}</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">{info.message}</p>
                    {(info.limit !== undefined && info.limit !== null) && (
                        <p className="text-[11px] text-slate-500 font-mono mt-3">
                            Limit: {info.limit}{info.usage !== undefined && info.usage !== null ? ` · Current: ${info.usage}` : ''}
                        </p>
                    )}
                </div>
                <div className={`grid ${info.showUpgrade ? 'grid-cols-2' : 'grid-cols-1'} gap-px bg-white/5 border-t border-white/5`}>
                    <button onClick={close} className="p-4 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5">
                        {info.showUpgrade ? 'Maybe later' : 'OK'}
                    </button>
                    {info.showUpgrade && (
                        <button onClick={handleUpgrade} className="p-4 text-sm font-bold text-ubiq-accent hover:bg-white/5 flex items-center justify-center gap-1.5">
                            <SparklesIcon className="w-4 h-4" />
                            Upgrade Plan
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
