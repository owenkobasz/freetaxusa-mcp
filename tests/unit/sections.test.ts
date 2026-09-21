import { describe, it, expect } from 'vitest';
import { SECTIONS, normalizeSectionName, resolveSidFromMap, type SidMap, type SectionItem } from '../../src/types/sections.js';

function mapOf(entries: Array<[string, number]>, items: SectionItem[] = []): SidMap {
  return {
    byName: new Map(entries.map(([n, s]) => [n.toLowerCase(), s])),
    bySid: new Map(entries.map(([n, s]) => [s, n])),
    items,
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
  const map = mapOf(
    [
      ['Personal Info', 14],
      ['Wages (W-2)', 22],
      ['Interest Income (1099-INT)', 23],
      ['Dividend Income (1099-DIV)', 24],
      ['Summary', 91],
    ],
    [
      { name: 'Taxpayer Information', group: 'Personal Info', disabled: false },
      { name: 'Filing Status', group: 'Personal Info', disabled: true },
    ],
  );

  it('returns an exact sidebar match', () => {
    expect(resolveSidFromMap(map, 'summary')).toEqual({ sid: 91 });
  });

  it('resolves an alias through the sidebar before the fallback', () => {
    expect(resolveSidFromMap(map, 'personal')).toEqual({ sid: 14 });
  });

  it('resolves a dropdown sub-page by name or alias', () => {
    expect(resolveSidFromMap(map, 'Taxpayer Information')).toEqual({ item: { name: 'Taxpayer Information', group: 'Personal Info', disabled: false } });
    expect(resolveSidFromMap(map, 'filing status')).toEqual({ item: { name: 'Filing Status', group: 'Personal Info', disabled: true } });
  });

  it('uses the fallback page id when the sidebar has no match', () => {
    expect(resolveSidFromMap(map, 'income')).toEqual({ sid: 301400 });
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
