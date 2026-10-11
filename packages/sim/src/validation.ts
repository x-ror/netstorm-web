import { MAX_ID } from './state.js';

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

export function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`Unknown ${label} field: ${key}`);
    }
  }
}

export function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${label} must not contain sparse entries`);
    }
  }

  return value;
}

export function finite(value: unknown, label: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new TypeError(`${label} must be a finite number >= ${min}`);
  }

  return value;
}

export function integer(
  value: unknown,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const number = finite(value, label, min);

  if (!Number.isSafeInteger(number) || number > max) {
    throw new TypeError(`${label} must be an integer in ${min}..${max}`);
  }

  return number;
}

export function text(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`);
  }

  return value;
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label} must be a boolean`);
  }

  return value;
}

export function choice<const T extends readonly (string | number)[]>(
  value: unknown,
  options: T,
  label: string,
): T[number] {
  for (const option of options) {
    if (value === option) {
      return option;
    }
  }

  throw new TypeError(`Invalid ${label}`);
}

export function nullableId(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label, 1, MAX_ID);
}
