import { describe, it, expect } from 'vitest';
import { SECTIONS, normalizeSectionName, resolveSidFromMap, type SidMap } from '../../src/types/sections.js';

function mapOf(entries: Array<[string, number]>): SidMap {
  return {
    byName: new Map(entries.map(([n, s]) => [n.toLowerCase(), s])),
    bySid: new Map(entries.map(([n, s]) => [s, n])),
    discoveredAt: Date.now(),
  };
}

describe('normalizeSectionName', () => {
  it('maps every alias to its key', () => {
    for (const [key, def] of Object.entries(SECTIONS)) {
      expect(normalizeSectionName(key)).toBe(key);
      for (const alias of def.aliases) expect(normalizeSectionName(alias)).toBe(key);
    }
  });

  it('is case and whitespace insensitive', () => {
    expect(normalizeSectionName('  Personal Info ')).toBe('taxpayer_info');
    expect(normalizeSectionName('W-2')).toBe('w2');
  });

  it('returns undefined for unknown names', () => {
    expect(normalizeSectionName('crypto')).toBeUndefined();
  });
});

describe('resolveSidFromMap', () => {
  const map = mapOf([
    ['Personal Info', 14],
    ['Wages (W-2)', 22],
    ['Interest Income (1099-INT)', 23],
    ['Dividend Income (1099-DIV)', 24],
    ['Summary', 91],
  ]);

  it('returns an exact sidebar match', () => {
    expect(resolveSidFromMap(map, 'summary')).toEqual({ sid: 91 });
  });

  it('resolves an alias through the sidebar before the fallback', () => {
    expect(resolveSidFromMap(map, 'taxpayer info')).toEqual({ sid: 14 });
  });

  it('uses the fallback SID when the sidebar has no match', () => {
    expect(resolveSidFromMap(map, 'filing status')).toEqual({ sid: 12 });
  });

  it('returns a unique partial match', () => {
    expect(resolveSidFromMap(map, 'dividend')).toEqual({ sid: 24 });
  });

  it('reports an ambiguous partial match', () => {
    const result = resolveSidFromMap(map, '1099');
    expect(result).not.toBeNull();
    expect(result && 'ambiguous' in result ? result.ambiguous.length : 0).toBe(2);
  });

  it('returns null for a miss with no fallback', () => {
    expect(resolveSidFromMap(map, 'crypto')).toBeNull();
  });
});
