// Pure unit tests for the effectiveLeverage and isOpeningOrIncreasing helpers
// exported from server/exchange/executor.js.
import { describe, it, expect } from 'vitest';
const { effectiveLeverage, isOpeningOrIncreasing } = require('../server/exchange/executor');

describe('effectiveLeverage', () => {
  it('open from flat (0→10) takes the order leverage', () => {
    expect(effectiveLeverage(0, 1, 10, 5)).toBe(5);
  });

  it('add to existing long (10→20) takes the order leverage', () => {
    expect(effectiveLeverage(10, 5, 20, 3)).toBe(3);
  });

  it('reduce long (10→4) keeps prior leverage', () => {
    expect(effectiveLeverage(10, 5, 4, 2)).toBe(5);
  });

  it('flip long→short (10→-5) takes the order leverage', () => {
    expect(effectiveLeverage(10, 3, -5, 2)).toBe(2);
  });

  it('flat result (10→0) returns 1', () => {
    expect(effectiveLeverage(10, 5, 0, 7)).toBe(1);
  });
});

describe('isOpeningOrIncreasing', () => {
  it('flat → nonzero is true', () => {
    expect(isOpeningOrIncreasing(0, 10)).toBe(true);
  });

  it('adding to long is true', () => {
    expect(isOpeningOrIncreasing(10, 20)).toBe(true);
  });

  it('pure reduce is false', () => {
    expect(isOpeningOrIncreasing(10, 4)).toBe(false);
  });

  it('flip long→short is true', () => {
    expect(isOpeningOrIncreasing(10, -5)).toBe(true);
  });

  it('going flat is false', () => {
    expect(isOpeningOrIncreasing(10, 0)).toBe(false);
  });
});
