import { useState, useEffect } from 'react';
import { adminAPI } from '../services/api';
import { Save, Plus, Trash2, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';

interface PlanFeature {
    id?: number;
    feature_key: string;
    feature_value: string;
    value_type: 'int' | 'bool' | 'string';
}

interface Plan {
    id: number;
    key: string;
    name: string;
    price_cents: number;
    currency: string;
    billing_interval: string;
    paypal_plan_id: string | null;
    is_active: boolean;
    sort_order: number;
    features: PlanFeature[];
}

/**
 * C5 — Admin UI for plans/plan_features (B5's endpoints). The whole point
 * of this session's work was "manage it over the database" — this is what
 * makes that literally true without SSH+tinker or hand-rolled curl.
 */
export default function AdminPlansPanel() {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<number | null>(null);
    const [saving, setSaving] = useState<number | null>(null);
    const [warnings, setWarnings] = useState<Record<number, string[]>>({});
    const [showReport, setShowReport] = useState(false);
    const [report, setReport] = useState<any>(null);
    const [reportLoading, setReportLoading] = useState(false);

    useEffect(() => { loadPlans(); }, []);

    const loadPlans = async () => {
        setLoading(true);
        try {
            const res = await adminAPI.getPlans();
            setPlans(res.data.plans);
        } catch (e) {
            console.error('Failed to load plans', e);
        } finally {
            setLoading(false);
        }
    };

    const updateLocalPlan = (planId: number, patch: Partial<Plan>) => {
        setPlans(prev => prev.map(p => (p.id === planId ? { ...p, ...patch } : p)));
    };

    const updateLocalFeature = (planId: number, index: number, patch: Partial<PlanFeature>) => {
        setPlans(prev => prev.map(p => {
            if (p.id !== planId) return p;
            const features = [...p.features];
            features[index] = { ...features[index], ...patch };
            return { ...p, features };
        }));
    };

    const addFeatureRow = (planId: number) => {
        setPlans(prev => prev.map(p => (p.id === planId
            ? { ...p, features: [...p.features, { feature_key: '', feature_value: '', value_type: 'int' }] }
            : p)));
    };

    const removeFeatureRow = async (plan: Plan, index: number) => {
        const feature = plan.features[index];
        // Only hit the API if this feature actually exists server-side —
        // a freshly-added blank row has no id and is purely local state.
        if (feature.id) {
            try {
                await adminAPI.deletePlanFeature(plan.id, feature.feature_key);
            } catch (e) {
                alert('Failed to delete feature on the server.');
                return;
            }
        }
        setPlans(prev => prev.map(p => (p.id === plan.id
            ? { ...p, features: p.features.filter((_, i) => i !== index) }
            : p)));
    };

    const savePlan = async (plan: Plan) => {
        setSaving(plan.id);
        setWarnings(prev => ({ ...prev, [plan.id]: [] }));
        try {
            // Core fields — key intentionally excluded, matches the backend
            // (AdminPlanController::update deliberately doesn't accept it).
            await adminAPI.updatePlan(plan.id, {
                name: plan.name,
                price_cents: plan.price_cents,
                is_active: plan.is_active,
                sort_order: plan.sort_order,
                paypal_plan_id: plan.paypal_plan_id,
            });

            // Features — only rows with a non-empty key, so an unfinished
            // "Add feature" row doesn't get saved half-filled.
            const validFeatures = plan.features
                .filter(f => f.feature_key.trim() !== '')
                .map(({ feature_key, feature_value, value_type }) => ({ feature_key, feature_value, value_type }));

            if (validFeatures.length > 0) {
                const res = await adminAPI.updatePlanFeatures(plan.id, validFeatures);
                if (res.data?.warnings?.length) {
                    setWarnings(prev => ({ ...prev, [plan.id]: res.data.warnings }));
                }
            }

            await loadPlans();
        } catch (e: any) {
            alert(e?.response?.data?.message || 'Failed to save plan.');
        } finally {
            setSaving(null);
        }
    };

    const loadReport = async () => {
        setReportLoading(true);
        try {
            const res = await adminAPI.getPlanReport(30);
            setReport(res.data);
        } catch (e) {
            console.error('Failed to load report', e);
        } finally {
            setReportLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-40 text-slate-500">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading plans...
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white uppercase tracking-tight">Plans &amp; Limits</h3>
                <button
                    onClick={() => { setShowReport(v => !v); if (!report) loadReport(); }}
                    className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"
                >
                    <BarChart3 className="w-3.5 h-3.5" /> {showReport ? 'Hide' : 'View'} 30-day report
                </button>
            </div>

            {showReport && (
                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-4">
                    {reportLoading ? (
                        <div className="text-xs text-slate-500 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading report...</div>
                    ) : report ? (
                        <>
                            <ReportTable title="Denial rates" rows={report.denial_rates} columns={['plan', 'action_key', 'total', 'allowed_count', 'denied_count', 'denial_rate_pct']} />
                            <ReportTable title="Top denial reasons" rows={report.top_denial_reasons} columns={['plan', 'action_key', 'reason', 'denial_count']} />
                            <ReportTable title="Usage vs. limit" rows={report.usage_vs_limit} columns={['plan', 'action_key', 'sample_size', 'avg_pct_of_limit', 'max_pct_of_limit']} />
                        </>
                    ) : (
                        <div className="text-xs text-slate-500">No report data.</div>
                    )}
                </div>
            )}

            {plans.map(plan => {
                const isOpen = expanded === plan.id;
                return (
                    <div key={plan.id} className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden">
                        <button
                            onClick={() => setExpanded(isOpen ? null : plan.id)}
                            className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02]"
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-bold text-white">{plan.name}</span>
                                <span className="text-[10px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded">{plan.key}</span>
                                {!plan.is_active && <span className="text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded">Inactive</span>}
                            </div>
                            {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                        </button>

                        {isOpen && (
                            <div className="p-4 border-t border-white/5 space-y-4">
                                {/* Core fields */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <Field label="Name">
                                        <input
                                            value={plan.name}
                                            onChange={e => updateLocalPlan(plan.id, { name: e.target.value })}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                                        />
                                    </Field>
                                    <Field label="Price (cents)">
                                        <input
                                            type="number"
                                            value={plan.price_cents}
                                            onChange={e => updateLocalPlan(plan.id, { price_cents: parseInt(e.target.value, 10) || 0 })}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white font-mono"
                                        />
                                    </Field>
                                    <Field label="PayPal Plan ID">
                                        <input
                                            value={plan.paypal_plan_id ?? ''}
                                            onChange={e => updateLocalPlan(plan.id, { paypal_plan_id: e.target.value || null })}
                                            placeholder="P-XXXXXXXXXX"
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white font-mono"
                                        />
                                    </Field>
                                    <Field label="Active">
                                        <label className="flex items-center gap-2 h-full pt-1.5">
                                            <input
                                                type="checkbox"
                                                checked={plan.is_active}
                                                onChange={e => updateLocalPlan(plan.id, { is_active: e.target.checked })}
                                                className="accent-indigo-500"
                                            />
                                            <span className="text-xs text-slate-400">{plan.is_active ? 'Shown publicly' : 'Hidden'}</span>
                                        </label>
                                    </Field>
                                </div>

                                {/* Features table */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Features / limits</span>
                                        <button onClick={() => addFeatureRow(plan.id)} className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300">
                                            <Plus className="w-3 h-3" /> Add
                                        </button>
                                    </div>
                                    <div className="space-y-1.5">
                                        {plan.features.map((f, i) => (
                                            <div key={f.id ?? `new-${i}`} className="grid grid-cols-[1fr_1fr_80px_28px] gap-2 items-center">
                                                <input
                                                    value={f.feature_key}
                                                    onChange={e => updateLocalFeature(plan.id, i, { feature_key: e.target.value })}
                                                    placeholder="feature.key"
                                                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-mono text-white"
                                                />
                                                <input
                                                    value={f.feature_value}
                                                    onChange={e => updateLocalFeature(plan.id, i, { feature_value: e.target.value })}
                                                    placeholder="value"
                                                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-mono text-white"
                                                />
                                                <select
                                                    value={f.value_type}
                                                    onChange={e => updateLocalFeature(plan.id, i, { value_type: e.target.value as PlanFeature['value_type'] })}
                                                    className="bg-white/5 border border-white/10 rounded-lg px-1.5 py-1.5 text-[11px] text-white"
                                                >
                                                    <option value="int">int</option>
                                                    <option value="bool">bool</option>
                                                    <option value="string">string</option>
                                                </select>
                                                <button onClick={() => removeFeatureRow(plan, i)} className="text-slate-500 hover:text-red-400 flex items-center justify-center">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {warnings[plan.id]?.length > 0 && (
                                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-300 text-[11px]">
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                        <div>{warnings[plan.id].map((w, i) => <p key={i}>{w}</p>)}</div>
                                    </div>
                                )}

                                <button
                                    onClick={() => savePlan(plan)}
                                    disabled={saving === plan.id}
                                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg"
                                >
                                    {saving === plan.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                    Save changes
                                </button>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</label>
            {children}
        </div>
    );
}

function ReportTable({ title, rows, columns }: { title: string; rows: any[]; columns: string[] }) {
    if (!rows || rows.length === 0) {
        return (
            <div>
                <p className="text-[11px] font-medium text-slate-400 mb-1">{title}</p>
                <p className="text-[11px] text-slate-600">No data in this window.</p>
            </div>
        );
    }
    return (
        <div>
            <p className="text-[11px] font-medium text-slate-400 mb-1.5">{title}</p>
            <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                    <thead>
                        <tr className="text-slate-500">
                            {columns.map(c => <th key={c} className="text-left font-medium px-2 py-1">{c.replace(/_/g, ' ')}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i} className="border-t border-white/5 text-slate-300">
                                {columns.map(c => <td key={c} className="px-2 py-1 font-mono">{String(row[c])}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
