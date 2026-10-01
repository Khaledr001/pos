import { expandSynonyms, trigramSimilarity } from '../search/search.service.js';
import { pickupSlots } from './shipping.service.js';

const cfg = { leadHours: 2, slotMinutes: 120, daysAhead: 2, openHour: 8, closeHour: 20 };

describe('pickupSlots', () => {
  it('starts at least lead time from now, in Dubai time', () => {
    // 09:30 in Dubai = 05:30 UTC
    const slots = pickupSlots(new Date('2026-10-01T05:30:00Z'), cfg);
    expect(slots[0].label).toContain('12:00–14:00');
    expect(slots[0].start).toBe('2026-10-01T08:00:00.000Z');
  });

  it('rolls to tomorrow in the evening and covers `daysAhead` days', () => {
    const slots = pickupSlots(new Date('2026-10-01T16:00:00Z'), cfg); // 20:00 Dubai
    const days = new Set(slots.map((s) => s.label.split(',')[0]));
    expect(days.size).toBe(2);
    expect(slots[0].label).toContain('08:00–10:00');
  });
});

describe('search synonyms', () => {
  const groups = [['tap', 'faucet', 'mixer'], ['cable', 'wire']];

  it('expands a known term', () => {
    expect(expandSynonyms('basin tap', groups)).toEqual(
      expect.arrayContaining(['basin tap', 'basin faucet', 'basin mixer']),
    );
  });

  it('corrects a misspelt synonym before expanding', () => {
    const out = expandSynonyms('fawcet', groups);
    expect(out).toContain('faucet');
    expect(out).toContain('mixer');
  });

  it('computes trigram similarity like pg_trgm', () => {
    expect(trigramSimilarity('faucet', 'faucet')).toBe(1);
    expect(trigramSimilarity('fawcet', 'faucet')).toBeCloseTo(0.4, 1);
  });
});
