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
