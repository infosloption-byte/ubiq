import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { Check, RefreshCw, ArrowRight, Sparkles } from 'lucide-react';
import MarketingNavbar from '../components/marketing/MarketingNavbar';
import MarketingFooter from '../components/marketing/MarketingFooter';
import { useAuthStore } from '../stores/authStore';
import type { Plan } from '../lib/planDisplay';
import { planBullets, formatPrice } from '../lib/planDisplay';

/**
 * New standalone /pricing page — previously there was no dedicated
 * pricing route at all, despite `/plans` being explicitly built and
 * commented "C3 — public pricing page data" back when the plan system
 * shipped. The only place plans were ever rendered was PricingGrid.tsx,
 * buried inside the logged-in Settings > Billing tab.
 *
 * Deliberately does NOT reuse PricingGrid.tsx directly here, even
 * though the data and bullets are shared (see lib/planDisplay.ts):
 * PricingGrid renders a live PayPal checkout button and assumes an
 * authenticated user (`useAuthStore()`, `subscriptionApi.confirmSubscription`
 * on approval). Embedding that as-is on a PUBLIC page would let an
 * anonymous visitor start a real PayPal checkout, approve payment, and
 * then hit an auth error on confirmation -- a broken pay-then-fail flow.
 * This page instead shows the same plan data with a "Get Started" CTA
 * to /register for logged-out visitors; real checkout still only
 * happens inside Settings > Billing (PricingGrid, unchanged) once
 * they're authenticated. An already-logged-in visitor who lands here
 * gets routed to Settings > Billing instead of a duplicate checkout UI.
 */
export default function PricingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const { token } = useAuthStore();

  useEffect(() => {
    axios.get(`${import.meta.env.VITE_API_URL}/plans`)
      .then(res => setPlans(res.data?.plans || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#050509] text-slate-300 font-sans selection:bg-ubiq-accent/30 selection:text-ubiq-accent">
      <MarketingNavbar />

      <section className="relative pt-40 pb-20 px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight mb-6">
              Simple, wholesale pricing.
            </h1>
            <p className="text-lg text-slate-400 max-w-xl mx-auto">
              Bring your own AI keys — you pay providers directly, no markup from us. Every tier includes a live sandbox to run and preview your code.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-slate-500 text-xs font-mono">LOADING PLANS...</p>
            </div>
          ) : plans.length === 0 ? (
            <p className="text-center text-slate-500 py-24">Couldn't load pricing right now — please refresh, or check back shortly.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {plans.map((plan, i) => {
                const bullets = planBullets(plan);
                const isPopular = plan.key === 'creator'; // middle-ish tier, matches Settings/Billing convention of no explicit "popular" flag in the data itself — purely a display choice, safe to change here without touching plan data
                return (
                  <motion.div
                    key={plan.key}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.05 }}
                    className={`p-6 bg-[#0F111A] border rounded-3xl flex flex-col relative ${
                      isPopular ? 'border-indigo-500/50 shadow-[0_0_40px_rgba(99,102,241,0.15)]' : 'border-white/10'
                    }`}
                  >
                    {isPopular && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-indigo-500 text-white px-3 py-1 rounded-full">
                        <Sparkles className="w-3 h-3" /> Most Popular
                      </span>
                    )}
                    <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3">{plan.name}</span>
                    <div className="flex items-baseline gap-1 mb-6">
                      <span className="text-4xl font-bold text-white">{formatPrice(plan.price_cents)}</span>
                      {plan.price_cents > 0 && <span className="text-slate-400 text-sm">/ {plan.billing_interval}</span>}
                    </div>
                    <div className="space-y-3 mb-8 flex-1">
                      {bullets.map((b, j) => (
                        <div key={j} className="flex items-start gap-2.5 text-sm text-slate-300">
                          <Check className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" /> {b}
                        </div>
                      ))}
                    </div>
                    {token ? (
                      <Link
                        to="/settings?tab=billing"
                        className="w-full py-2.5 text-center bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-semibold text-sm transition-colors"
                      >
                        Manage in Settings
                      </Link>
                    ) : (
                      <Link
                        to="/register"
                        className={`w-full py-2.5 text-center rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
                          isPopular ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white'
                        }`}
                      >
                        {plan.price_cents === 0 ? 'Start Free' : 'Get Started'} <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
          <p className="text-center text-slate-600 text-xs mt-10">
            All plans are billed monthly via PayPal, cancel anytime. Prices exclude your own AI provider costs (OpenAI, Google, Mistral, or OpenRouter) — see our <Link to="/refund" className="underline hover:text-slate-400">Refund Policy</Link>.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 bg-[#0B0B10] border-t border-white/5">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-white mb-12 text-center">Pricing Questions</h2>
          <div className="space-y-6">
            <FaqItem
              question="What am I actually paying for, if I still pay OpenAI/Google directly?"
              answer="Your Ubiq subscription covers the sandbox infrastructure (running and previewing your code live), storage, project limits, and AI request throughput — not the AI itself. You bring your own API key (BYOK) and pay your provider's own rates directly, with zero markup from us."
            />
            <FaqItem
              question="Can I use this for free, without any paid plan?"
              answer="Yes. The Free tier includes a live sandbox, a limited set of AI requests per hour, and works fully offline with local models via Ollama at no cost at all — no card required."
            />
            <FaqItem
              question="Is my API key safe?"
              answer="Yes. Keys are encrypted at rest on our servers and are never sent back to your browser after you save them — they're only decrypted server-side, in memory, to proxy your requests to the provider you chose."
            />
            <FaqItem
              question="What happens if I hit my plan's limits?"
              answer="You'll see it coming — Ubiq shows your live usage against your plan's limits before you actually hit them. If you do hit a limit, you can upgrade instantly, or just wait for it to reset (hourly/daily depending on the limit)."
            />
            <FaqItem
              question="Can I cancel anytime?"
              answer="Yes, anytime from Settings > Billing. Your plan stays active through the end of the period you already paid for, then reverts to Free rather than cutting off access mid-period."
            />
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="border border-white/10 rounded-xl p-6 bg-[#0B0B10]">
      <h3 className="text-lg font-semibold text-white mb-2">{question}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">{answer}</p>
    </div>
  );
}
