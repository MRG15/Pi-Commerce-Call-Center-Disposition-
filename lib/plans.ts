// Subscription plans sold from 1 Oct 2026. Prices exclude GST; revenue is always ex-GST.
export const PLANS = {
  silver: { label: 'Silver', price: 1999 },
  gold: { label: 'Gold', price: 4999 },
  platinum: { label: 'Platinum', price: 9999 },
} as const;
export type PlanCode = keyof typeof PLANS;

export const PLAN_START_DATE = '2026-10-01';
// Every sale before plans were introduced was the ₹799 subscription.
export const LEGACY_SALE_PRICE = 799;

export function isPlanCode(v: unknown): v is PlanCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PLANS, v);
}

export function plansRequiredOn(date: string) {
  return date >= PLAN_START_DATE;
}

// Revenue of one sale dated `date`. Before 1 Oct every sale is ₹799; from 1 Oct it is the
// plan price stored on the sale (0 if none was recorded).
export function saleRevenue(date: string, planAmount: number | null | undefined) {
  if (!plansRequiredOn(date)) return LEGACY_SALE_PRICE;
  return Number(planAmount || 0);
}

export function todayIst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Last 10 digits of a phone number, or null when there are fewer than 10 digits.
export function phoneKey(v: unknown) {
  const digits = String(v ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

// Plan upgrades. A merchant's plan before plans existed is the legacy ₹799 subscription (₹499 is
// only its renewal price, so upgrades are always valued from ₹799).
export type CurrentPlan = 'legacy' | PlanCode;
export const PLAN_RANK: Record<CurrentPlan, number> = { legacy: 0, silver: 1, gold: 2, platinum: 3 };
// The ₹799 plan renews at ₹499 on day 30 of the subscription (the purchase day is day 1); Silver, Gold and Platinum renew at
// their own price.
export const LEGACY_RENEWAL_PRICE = 499;
export const RENEWAL_DAY = 30;
export function planPrice(p: CurrentPlan, renewed = false) {
  return p === 'legacy' ? (renewed ? LEGACY_RENEWAL_PRICE : LEGACY_SALE_PRICE) : PLANS[p].price;
}
export function planLabel(p: CurrentPlan) {
  return p === 'legacy' ? `₹${LEGACY_SALE_PRICE} plan` : PLANS[p].label;
}
// Plans a merchant on `from` can upgrade to (only higher plans).
export function upgradeTargets(from: CurrentPlan): PlanCode[] {
  return (Object.keys(PLANS) as PlanCode[]).filter(p => PLAN_RANK[p] > PLAN_RANK[from]);
}
// Upgrade value credited for incentives: new plan price minus what the merchant pays for the current
// plan that month (first 30 days: the purchase price; from day 30: the renewal price).
export function upgradeValue(from: CurrentPlan, to: PlanCode, renewed = false) {
  return Math.max(0, PLANS[to].price - planPrice(from, renewed));
}
// Whether `on` is on or after the first renewal of a subscription bought on `subscribed`. The
// purchase day is day 1 and the renewal is charged on day 30 (bought 1 Oct → renewed 30 Oct).
export function isRenewed(subscribed: string | null | undefined, on: string) {
  if (!subscribed) return false;
  const days = (new Date(on + 'T00:00:00Z').getTime() - new Date(String(subscribed).slice(0, 10) + 'T00:00:00Z').getTime()) / 86400000;
  return days + 1 >= RENEWAL_DAY;
}
// Sub Raw plan name → plan ("₹799 Plan" / "₹499 Plan" → legacy).
export function planFromName(name: unknown): CurrentPlan | null {
  const n = String(name ?? '').toLowerCase();
  if (!n) return null;
  for (const p of Object.keys(PLANS) as PlanCode[]) if (n.includes(PLANS[p].label.toLowerCase())) return p;
  if (/799|499/.test(n)) return 'legacy';
  return null;
}
export function isCurrentPlan(v: unknown): v is CurrentPlan {
  return v === 'legacy' || isPlanCode(v);
}
