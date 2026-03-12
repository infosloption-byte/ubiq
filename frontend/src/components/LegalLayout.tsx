import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export const LegalLayout: React.FC<LegalLayoutProps> = ({ title, lastUpdated, children }) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full bg-[#0B0F1A] text-slate-300 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto pb-20"> {/* Added padding-bottom for better mobile scrolling */}
        <button 
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 transition mb-8 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back
        </button>

        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="w-8 h-8 text-indigo-500" />
          <h1 className="text-4xl font-black text-white tracking-tight">{title}</h1>
        </div>
        <p className="text-sm text-slate-500 mb-12">Last Updated: {lastUpdated}</p>

        <div className="prose prose-invert prose-indigo max-w-none 
          prose-headings:text-white prose-headings:font-bold prose-p:leading-relaxed prose-li:my-2">
          {children}
        </div>

        <div className="mt-16 pt-8 border-t border-white/10 text-center">
          <p className="text-xs text-slate-600">
            © 2026 Ubiq-Editor. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};