import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, BookOpenIcon, Menu, X } from 'lucide-react';
import { useState } from 'react';

/**
 * Shared navbar across the marketing site's real pages (Home, Features,
 * Use Cases, Pricing). Previously each of these lived as `#anchor`
 * sections inside one giant LandingPage.tsx, so the nav only ever needed
 * `<a href="#features">` scroll-links. Splitting into real routes means
 * those anchors would silently 404-scroll (or just not exist) from any
 * page other than Home — this is a real `<Link>` nav instead, with the
 * current page highlighted via `useLocation()`.
 *
 * Deliberately NOT used on GuidePage (has its own docs-style sidebar
 * nav, a different page shape entirely) or the legal pages
 * (Terms/Privacy/Refund — minimal single-purpose pages, adding the full
 * marketing nav there wasn't asked for and isn't obviously right either).
 */
const NAV_LINKS = [
  { to: '/features', label: 'Features' },
  { to: '/use-cases', label: 'Use Cases' },
  { to: '/pricing', label: 'Pricing' },
];

export default function MarketingNavbar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#050509]/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-500/20">
            U
          </div>
          <span className="font-semibold text-white tracking-tight text-lg">Ubiq Editor</span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium">
          {NAV_LINKS.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={`transition-colors ${location.pathname === link.to ? 'text-white' : 'hover:text-white'}`}
            >
              {link.label}
            </Link>
          ))}
          <Link to="/guide" className="hover:text-white transition-colors flex items-center gap-1.5">
            <BookOpenIcon className="w-4 h-4" /> Guide
          </Link>
        </div>

        <div className="hidden md:flex items-center gap-4">
          <Link to="/login" className="text-sm font-medium hover:text-white transition-colors">Sign In</Link>
          <Link to="/register" className="text-sm font-semibold bg-white text-black px-4 py-2 rounded-full hover:bg-slate-200 transition-colors flex items-center gap-2">
            Get Started <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <button onClick={() => setMobileOpen(v => !v)} className="md:hidden text-white">
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-white/5 bg-[#050509] px-6 py-4 space-y-4">
          {NAV_LINKS.map(link => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className={`block text-sm font-medium ${location.pathname === link.to ? 'text-white' : 'text-slate-400'}`}
            >
              {link.label}
            </Link>
          ))}
          <Link to="/guide" onClick={() => setMobileOpen(false)} className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <BookOpenIcon className="w-4 h-4" /> Guide
          </Link>
          <div className="pt-4 border-t border-white/5 flex flex-col gap-3">
            <Link to="/login" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-slate-300">Sign In</Link>
            <Link to="/register" onClick={() => setMobileOpen(false)} className="text-sm font-semibold bg-white text-black px-4 py-2 rounded-full text-center">
              Get Started
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
