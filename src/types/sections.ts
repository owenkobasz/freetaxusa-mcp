export interface SidMap {
  byName: Map<string, number>;
  bySid: Map<number, string>;
  discoveredAt: number;
}

export interface SectionDef {
  aliases: string[];
  fallbackSid?: number;
}

export const SECTIONS: Record<string, SectionDef> = {
  taxpayer_info: {
    aliases: ['personal', 'personal info', 'personal information', 'taxpayer info', 'taxpayer information', 'basic info', 'basic information'],
    fallbackSid: 11,
  },
  filing_status: { aliases: ['filing status', 'status'], fallbackSid: 12 },
  income: { aliases: ['income'], fallbackSid: 20 },
  w2: { aliases: ['w-2', 'w2', 'wages', 'w-2 income', 'wages and salaries'] },
  '1099_int': { aliases: ['1099-int', '1099 int', 'interest', 'interest income'] },
  '1099_div': { aliases: ['1099-div', '1099 div', 'dividends', 'dividend income'] },
  '1099_misc': { aliases: ['1099-misc', '1099 misc'] },
  '1099_nec': { aliases: ['1099-nec', '1099 nec'] },
  deductions: { aliases: ['deductions', 'deductions & credits', 'deductions and credits', 'credits'], fallbackSid: 50 },
  summary: { aliases: ['summary', 'review', 'tax summary'], fallbackSid: 90 },
  state: { aliases: ['state', 'state return', 'state taxes'], fallbackSid: 95 },
  filing: { aliases: ['filing', 'file', 'e-file', 'efile'], fallbackSid: 99 },
};

export function normalizeSectionName(input: string): string | undefined {
  const lower = input.toLowerCase().trim();
  for (const [key, def] of Object.entries(SECTIONS)) {
    if (key === lower || def.aliases.includes(lower)) return key;
  }
  return undefined;
}

export type SidResolution = { sid: number } | { ambiguous: string[] } | null;

export function resolveSidFromMap(map: SidMap, section: string): SidResolution {
  const lower = section.toLowerCase().trim();
  const exact = map.byName.get(lower);
  if (exact !== undefined) return { sid: exact };

  const key = normalizeSectionName(section);
  if (key) {
    for (const alias of [key, ...SECTIONS[key].aliases]) {
      const bySidAlias = map.byName.get(alias);
      if (bySidAlias !== undefined) return { sid: bySidAlias };
    }
    const fallback = SECTIONS[key].fallbackSid;
    if (fallback !== undefined) return { sid: fallback };
  }

  const hits: string[] = [];
  for (const name of map.byName.keys()) {
    if (name.includes(lower) || lower.includes(name)) hits.push(name);
  }
  if (hits.length === 1) return { sid: map.byName.get(hits[0])! };
  if (hits.length > 1) return { ambiguous: hits };
  return null;
}
