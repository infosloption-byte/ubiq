import { Link } from 'react-router-dom';
import { Shield, Lock } from 'lucide-react';

/**
 * Shared footer across the marketing site's real pages. Product column
 * now links to real routes (/features, /use-cases, /pricing) instead of
 * the old same-page `#anchor` links, which only ever worked from inside
 * the single mega-page this replaced.
 */
export default function MarketingFooter() {
  return (
    <footer className="py-16 border-t border-white/5 bg-[#050509]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-12">

          {/* Brand Column */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-xs">
                U
              </div>
              <span className="font-bold text-white tracking-tight">Ubiq Editor</span>
            </div>
            <p className="text-slate-500 text-sm leading-relaxed mb-4">
              The AI code editor that runs your code live, imports straight from GitHub, and blends local privacy with cloud intelligence.
            </p>
          </div>

          {/* Product Column */}
          <div>
            <h4 className="text-white font-bold mb-4 text-sm uppercase tracking-wider">Product</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><Link to="/features" className="hover:text-indigo-400 transition-colors">Features</Link></li>
              <li><Link to="/use-cases" className="hover:text-indigo-400 transition-colors">Use Cases</Link></li>
              <li><Link to="/pricing" className="hover:text-indigo-400 transition-colors">Pricing</Link></li>
              <li><Link to="/guide" className="hover:text-indigo-400 transition-colors">Guide</Link></li>
            </ul>
          </div>

          {/* Legal Column - REQUIRED BY COMPLIANCE */}
          <div>
            <h4 className="text-white font-bold mb-4 text-sm uppercase tracking-wider">Legal</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><Link to="/terms" className="hover:text-indigo-400 transition-colors">Terms of Service</Link></li>
              <li><Link to="/privacy" className="hover:text-indigo-400 transition-colors">Privacy Policy</Link></li>
              <li><Link to="/refund" className="hover:text-indigo-400 transition-colors">Refund Policy</Link></li>
            </ul>
          </div>

          {/* Contact Column */}
          <div>
            <h4 className="text-white font-bold mb-4 text-sm uppercase tracking-wider">Support</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="mailto:support@ubiq-editor.space" className="hover:text-indigo-400 transition-colors">Contact Support</a></li>
              <li className="text-xs italic mt-4 text-slate-600">Built for developers, by developers.</li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-slate-600 text-xs">
          <p>&copy; {new Date().getFullYear()} Ubiq Editor. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5"><Shield className="w-3 h-3" /> PCI Compliant</span>
            <span className="flex items-center gap-1.5"><Lock className="w-3 h-3" /> Secure Checkout</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
