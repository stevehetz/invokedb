import { ai_cell_update } from './ai-cell-guard';

describe('ai_cell_update', () => {
    const stored = { _id: 1, a: 'feedback', b: 'positive', _ai: { b: { h: 'x' } } };

    it("drops an AI cell's state when the update changes its value", () => {
        expect(ai_cell_update(stored, { a: 'feedback', b: null }, '_ai')).toEqual({
            unset: ['_ai.b'],
            guard: { b: 'positive' }
        });
    });

    it("keeps it when the update writes the value that's there, or leaves the cell out", () => {
        expect(ai_cell_update(stored, { a: 'new', b: 'positive' }, '_ai')).toEqual({
            unset: [],
            guard: { b: 'positive' }
        });
        expect(ai_cell_update(stored, { a: 'new' }, '_ai')).toEqual({ unset: [], guard: {} });
    });

    it('compares dates by time and treats a missing value as null', () => {
        const d = {
            d: new Date('2026-01-01T00:00:00Z'),
            _ai: { d: { h: 'x' }, e: { s: 'limit' } }
        };
        expect(ai_cell_update(d, { d: new Date('2026-01-01T00:00:00Z'), e: null }, '_ai')).toEqual({
            unset: [],
            guard: { d: d.d, e: null }
        });
    });

    it('does nothing for a row without AI cells, or no row', () => {
        expect(ai_cell_update({ a: 1 }, { a: 2 }, '_ai')).toEqual({ unset: [], guard: {} });
        expect(ai_cell_update(null, { a: 2 }, '_ai')).toEqual({ unset: [], guard: {} });
    });
});
