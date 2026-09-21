export interface SectionItem {
  name: string;
  group: string;
  disabled: boolean;
}

export interface SectionMap {
  /** Top-level sidebar groups by lowercased name -> page id. */
  byName: Map<string, number>;
  bySid: Map<number, string>;
  /** Sub-pages listed in the group dropdowns; reached by clicking. */
  items: SectionItem[];
  discoveredAt: number;
}

export type SidMap = SectionMap;

export interface SectionDef {
  aliases: string[];
  fallbackSid?: number;
}

// Fallback page ids are the top-level sidebar groups seen on the live site.
export const SECTIONS: Record<string, SectionDef> = {
  taxpayer_info: {
    aliases: ['personal', 'personal info', 'personal information', 'taxpayer info', 'taxpayer information', 'basic info', 'basic information'],
    fallbackSid: 200,
  },
  filing_status: { aliases: ['filing status', 'status'] },
  income: { aliases: ['income'], fallbackSid: 301400 },
  w2: { aliases: ['w-2', 'w2', 'wages', 'w-2 income', 'wages and salaries'] },
  '1099_int': { aliases: ['1099-int', '1099 int', 'interest', 'interest income'] },
  '1099_div': { aliases: ['1099-div', '1099 div', 'dividends', 'dividend income'] },
  '1099_misc': { aliases: ['1099-misc', '1099 misc'] },
  '1099_nec': { aliases: ['1099-nec', '1099 nec'] },
  deductions: { aliases: ['deductions', 'deductions / credits', 'deductions & credits', 'deductions and credits', 'credits'], fallbackSid: 460 },
  misc: { aliases: ['misc', 'miscellaneous'], fallbackSid: 301300 },
  summary: { aliases: ['summary', 'review', 'tax summary'], fallbackSid: 900 },
  state: { aliases: ['state', 'state return', 'state taxes'], fallbackSid: 90080 },
  filing: { aliases: ['filing', 'file', 'e-file', 'efile', 'final steps'], fallbackSid: 905 },
};

export function normalizeSectionName(input: string): string | undefined {
  const lower = input.toLowerCase().trim();
  for (const [key, def] of Object.entries(SECTIONS)) {
    if (key === lower || def.aliases.includes(lower)) return key;
  }
  return undefined;
}

export type SidResolution = { sid: number } | { item: SectionItem } | { ambiguous: string[] } | null;

function findItem(map: SectionMap, lower: string): SectionItem | undefined {
  return map.items.find(i => i.name.toLowerCase() === lower);
}

export function resolveSidFromMap(map: SidMap, section: string): SidResolution {
  const lower = section.toLowerCase().trim();
  const exact = map.byName.get(lower);
  if (exact !== undefined) return { sid: exact };
  const exactItem = findItem(map, lower);
  if (exactItem) return { item: exactItem };

  const key = normalizeSectionName(section);
  if (key) {
    for (const alias of [key, ...SECTIONS[key].aliases]) {
      const bySidAlias = map.byName.get(alias);
      if (bySidAlias !== undefined) return { sid: bySidAlias };
      const byItem = findItem(map, alias);
      if (byItem) return { item: byItem };
    }
    const fallback = SECTIONS[key].fallbackSid;
    if (fallback !== undefined) return { sid: fallback };
  }

  const hits: string[] = [];
  for (const name of map.byName.keys()) {
    if (name.includes(lower) || lower.includes(name)) hits.push(name);
  }
  const itemHits = map.items.filter(i => i.name.toLowerCase().includes(lower));
  if (hits.length + itemHits.length === 1) {
    return hits.length === 1 ? { sid: map.byName.get(hits[0])! } : { item: itemHits[0] };
  }
  if (hits.length + itemHits.length > 1) return { ambiguous: [...hits, ...itemHits.map(i => i.name)] };
  return null;
}
