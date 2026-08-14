export interface PlanFeature {
  feature_key: string;
  feature_value: string;
  value_type: 'int' | 'bool' | 'string';
}

export interface Plan {
  id: number;
  key: string;
  name: string;
  price_cents: number;
  currency: string;
  billing_interval: string;
  paypal_plan_id: string | null;
  sort_order: number;
  features: PlanFeature[];
}

/**
 * Extracted from PricingGrid.tsx (the Settings/Billing tab's plan
 * grid) rather than reimplemented for the new public /pricing page —
 * two copies of "which feature keys to show and how to phrase them"
 * is exactly the kind of thing that quietly drifts (one page gets a
 * copy update, the other doesn't) until the marketing page and the
 * actual billing page disagree about what a plan includes. Both now
 * import from here; PricingGrid.tsx re-exports its own local
 * castValue/planBullets for backward compat but delegates to this.
 */
export function castValue(f: PlanFeature): any {
  if (f.value_type === 'int') return parseInt(f.feature_value, 10);
  if (f.value_type === 'bool') return f.feature_value === 'true' || f.feature_value === '1';
  return f.feature_value;
}

export const FEATURE_LABEL: Record<string, (value: any) => string | null> = {
  'sandbox.max_concurrent': (v) => `${v} concurrent sandbox${v === 1 ? '' : 'es'}`,
  'ai.requests_per_hour':   (v) => v === -1 ? 'Unlimited AI requests' : `${v.toLocaleString()} AI requests / hour`,
  'storage.max_mb':         (v) => v === -1 ? 'Unlimited storage' : (v >= 1024 ? `${(v / 1024).toFixed(0)} GB storage` : `${v} MB storage`),
  'projects.max_count':     (v) => v === -1 ? 'Unlimited projects' : `${v} projects`,
  'sharing.enabled':        (v) => v ? 'Public project sharing' : null,
};
export const FEATURE_ORDER = ['sandbox.max_concurrent', 'ai.requests_per_hour', 'storage.max_mb', 'projects.max_count', 'sharing.enabled'];

export function planBullets(plan: Plan): string[] {
  const byKey = new Map(plan.features.map(f => [f.feature_key, castValue(f)]));
  return FEATURE_ORDER
    .map(key => {
      const value = byKey.get(key);
      if (value === undefined) return null;
      return FEATURE_LABEL[key](value);
    })
    .filter((s): s is string => s !== null);
}

export function formatPrice(cents: number): string {
  return cents === 0 ? 'Free' : `$${(cents / 100).toFixed(0)}`;
}
