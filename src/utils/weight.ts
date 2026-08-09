import { config } from '../config';

type WeightUnit = 'KG' | 'LBS';

const { KG_TO_LBS } = config.weight;

/**
 * Convert a weight value from KG to the target unit.
 * All data is stored in KG — conversion happens only at the API boundary.
 */
export const convertWeight = (valueKg: number | null, unit: WeightUnit): number | null => {
  if (valueKg === null || valueKg === undefined) return null;
  if (unit === 'LBS') return round(valueKg * KG_TO_LBS, 1);
  return valueKg;
};

/**
 * Round a number to a specified number of decimal places.
 */
export const round = (value: number, decimals: number = 1): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

/**
 * Get the lowercase unit label for response fields.
 */
export const getUnitLabel = (unit: WeightUnit): string => {
  return unit === 'LBS' ? 'lbs' : 'kg';
};
