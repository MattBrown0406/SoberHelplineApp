export const COST_CATEGORY_IDS = ['living', 'rescues', 'consequences'] as const;
export type CostCategoryId = (typeof COST_CATEGORY_IDS)[number];

export const COST_ITEM_IDS = [
  'housing',
  'recurringBills',
  'dailySpending',
  'transportation',
  'cash',
  'personalDebts',
  'finesAndRelease',
  'legalCosts',
  'propertyLoss',
  'unrecoveredMoney',
] as const;
export type CostItemId = (typeof COST_ITEM_IDS)[number];

export type CostValues = Partial<Record<CostItemId, string | number>>;

export const COST_ITEMS_BY_CATEGORY: Record<CostCategoryId, readonly CostItemId[]> = {
  living: ['housing', 'recurringBills', 'dailySpending', 'transportation'],
  rescues: ['cash', 'personalDebts', 'finesAndRelease'],
  consequences: ['legalCosts', 'propertyLoss', 'unrecoveredMoney'],
};

export interface EnablingCostCalculation {
  total: number;
  monthlyAverage: number;
  fiveYearProjection: number;
  categoryTotals: Record<CostCategoryId, number>;
  largestCategory: CostCategoryId | null;
}

/**
 * Convert a display-friendly currency entry into a safe non-negative amount.
 * The worksheet intentionally keeps values in memory only; this helper does
 * not read from or write to storage.
 */
export function parseCostValue(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (!value) return 0;

  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function calculateEnablingCosts(values: CostValues): EnablingCostCalculation {
  const categoryTotals = COST_CATEGORY_IDS.reduce<Record<CostCategoryId, number>>(
    (totals, categoryId) => {
      totals[categoryId] = COST_ITEMS_BY_CATEGORY[categoryId].reduce(
        (sum, itemId) => sum + parseCostValue(values[itemId]),
        0,
      );
      return totals;
    },
    { living: 0, rescues: 0, consequences: 0 },
  );

  const total = COST_CATEGORY_IDS.reduce(
    (sum, categoryId) => sum + categoryTotals[categoryId],
    0,
  );
  const largestCategory = total === 0
    ? null
    : COST_CATEGORY_IDS.reduce((largest, categoryId) =>
        categoryTotals[categoryId] > categoryTotals[largest] ? categoryId : largest,
      );

  return {
    total,
    monthlyAverage: total / 12,
    fiveYearProjection: total * 5,
    categoryTotals,
    largestCategory,
  };
}

