import { describe, it, expect } from 'vitest';
import { redactSSN, redactAccountNumber, redactEIN, redactPII, filterPII } from '../../src/security/pii-filter.js';

describe('PII Filter', () => {
  describe('redactSSN', () => {
    it('should redact SSN with dashes', () => {
      expect(redactSSN('SSN: 123-45-6789')).toBe('SSN: ***-**-6789');
    });

    it('should redact SSN with spaces', () => {
      expect(redactSSN('SSN: 123 45 6789')).toBe('SSN: ***-**-6789');
    });

    it('should redact SSN without separators', () => {
      expect(redactSSN('SSN: 123456789')).toBe('SSN: ***-**-6789');
    });

    it('should redact multiple SSNs', () => {
      expect(redactSSN('Primary: 111-22-3333, Spouse: 444-55-6666'))
        .toBe('Primary: ***-**-3333, Spouse: ***-**-6666');
    });

    it('should preserve last 4 digits', () => {
      expect(redactSSN('999-88-7654')).toBe('***-**-7654');
    });

    it('should not modify text without SSNs', () => {
      expect(redactSSN('No SSN here')).toBe('No SSN here');
    });

    it('should handle empty string', () => {
      expect(redactSSN('')).toBe('');
    });
  });

  describe('redactAccountNumber', () => {
    it('should redact 10-digit account numbers', () => {
      expect(redactAccountNumber('Account: 1234567890')).toBe('Account: ****7890');
    });

    it('should redact 12-digit account numbers', () => {
      expect(redactAccountNumber('Account: 123456789012')).toBe('Account: ****9012');
    });

    it('should not redact numbers shorter than 8 digits', () => {
      expect(redactAccountNumber('Code: 12345')).toBe('Code: 12345');
    });

    it('should handle 8-digit numbers (minimum)', () => {
      expect(redactAccountNumber('Num: 12345678')).toBe('Num: ****5678');
    });
  });

  describe('redactEIN', () => {
    it('should redact EIN with dash', () => {
      expect(redactEIN('EIN: 12-3456789')).toBe('EIN: **-***6789');
    });

    it('should redact EIN without dash', () => {
      expect(redactEIN('EIN: 123456789')).toBe('EIN: **-***6789');
    });
  });

  describe('redactPII (combined)', () => {
    it('should redact SSN and EIN in same text', () => {
      const input = 'SSN: 111-22-3333, EIN: 45-6789012';
      const result = redactPII(input);
      expect(result).toContain('***-**-3333');
      expect(result).toContain('**-***');
    });

    it('should handle text with no PII', () => {
      expect(redactPII('Hello world')).toBe('Hello world');
    });
  });

  describe('filterPII (deep object filter)', () => {
    it('should redact strings in nested objects', () => {
      const obj = {
        name: 'John Doe',
        ssn: '123-45-6789',
        nested: {
          ein: '12-3456789',
        },
      };
      const result = filterPII(obj);
      expect(result.ssn).toBe('***-**-6789');
      expect(result.nested.ein).toBe('**-***6789');
      expect(result.name).toBe('John Doe');
    });

    it('should redact strings in arrays', () => {
      const arr = ['SSN: 111-22-3333', 'No PII here'];
      const result = filterPII(arr);
      expect(result[0]).toBe('SSN: ***-**-3333');
      expect(result[1]).toBe('No PII here');
    });

    it('should handle null and undefined', () => {
      expect(filterPII(null)).toBeNull();
      expect(filterPII(undefined)).toBeUndefined();
    });

    it('should handle numbers and booleans', () => {
      expect(filterPII(42)).toBe(42);
      expect(filterPII(true)).toBe(true);
    });

    it('should handle deeply nested structures', () => {
      const obj = {
        level1: {
          level2: {
            ssn: '999-88-7777',
          },
        },
      };
      const result = filterPII(obj);
      expect(result.level1.level2.ssn).toBe('***-**-7777');
    });

    it('should handle mixed arrays and objects', () => {
      const obj = {
        items: [
          { ssn: '111-22-3333' },
          { ssn: '444-55-6666' },
        ],
      };
      const result = filterPII(obj);
      expect(result.items[0].ssn).toBe('***-**-3333');
      expect(result.items[1].ssn).toBe('***-**-6666');
    });
  });
});

describe('redactPII edge cases', () => {
  it('masks a 9-digit routing number as an SSN-shaped value', () => {
    expect(redactPII('Routing: 031000053')).toBe('Routing: ***-**-0053');
  });

  it('masks a 10-digit timestamp as an account number', () => {
    expect(redactPII('ts=1758480000')).toBe('ts=****0000');
  });

  it('masks ZIP+4 whether or not it has a hyphen', () => {
    expect(redactPII('19301-1234')).toBe('***-**-1234');
    expect(redactPII('193011234')).toBe('***-**-1234');
  });

  it('leaves an email untouched', () => {
    expect(redactPII('me@example.com')).toBe('me@example.com');
  });

  it('is idempotent', () => {
    const once = redactPII('SSN 123-45-6789, acct 1234567890, EIN 12-3456789');
    expect(redactPII(once)).toBe(once);
  });
});
