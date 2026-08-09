import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateEnablingCosts,
  parseCostValue,
} from '../src/lib/enablingCostWorksheet';

describe('enabling cost worksheet', () => {
  it('parses common currency entries without allowing negative values', () => {
    assert.equal(parseCostValue('$1,250.50'), 1250.5);
    assert.equal(parseCostValue(' 75 '), 75);
    assert.equal(parseCostValue(-40), 0);
    assert.equal(parseCostValue('not sure'), 0);
  });

  it('adds category totals and projections', () => {
    const result = calculateEnablingCosts({
      housing: '1,200',
      recurringBills: '300',
      cash: 500,
      legalCosts: '$1,000',
    });

    assert.deepEqual(result.categoryTotals, {
      living: 1500,
      rescues: 500,
      consequences: 1000,
    });
    assert.equal(result.total, 3000);
    assert.equal(result.monthlyAverage, 250);
    assert.equal(result.fiveYearProjection, 15000);
    assert.equal(result.largestCategory, 'living');
  });

  it('returns no largest category for an empty worksheet', () => {
    const result = calculateEnablingCosts({});

    assert.equal(result.total, 0);
    assert.equal(result.largestCategory, null);
  });
});
