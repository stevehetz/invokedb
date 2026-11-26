import { AI_COLUMN_LIMITS } from './ai-column';
import { claim_pipeline } from './ai-column.manager';

// A small evaluator for the aggregation operators claim_pipeline uses (there's no Mongo in
// unit tests), with Mongo's rules for missing fields
function evaluate(expr: any, doc: any): any {
    if (typeof expr === 'string' && expr.startsWith('$')) return doc[expr.slice(1)];
    if (Array.isArray(expr)) return expr.map(e => evaluate(e, doc));
    if (!expr || typeof expr !== 'object') return expr;
    const [op] = Object.keys(expr);
    const args = expr[op];
    const v = (i: number) => evaluate(args[i], doc);
    switch (op) {
        case '$eq':
            return v(0) === v(1);
        case '$gt':
            return v(0) > v(1);
        case '$cond':
            return v(0) ? v(1) : v(2);
        case '$ifNull':
            return v(0) ?? v(1);
        case '$or':
            return args.some((_a: any, i: number) => !!v(i));
        case '$size':
            return evaluate(args, doc).length;
        case '$setUnion':
            return [...new Set(args.flatMap((_a: any, i: number) => v(i) || []))];
        default:
            throw new Error(`no ${op}`);
    }
}

function apply(doc: any, pipeline: any[]) {
    let out = { ...doc };
    for (const stage of pipeline) {
        if (stage.$set) {
            const next = { ...out };
            for (const [k, e] of Object.entries(stage.$set)) next[k] = evaluate(e, out);
            out = next;
        } else if (stage.$unset) {
            for (const k of stage.$unset) delete out[k];
        }
    }
    return out;
}

describe('claim_pipeline', () => {
    const claim = (doc: any) => apply(doc, claim_pipeline(1000, 10));

    it('moves the waiting rows into the run and empties the queue', () => {
        const out = claim({ pending: true, full: false, dirty_ids: ['a', 'b'] });
        expect(out).toEqual({
            pending: false,
            full: false,
            dirty_ids: [],
            claimed: true,
            claimed_full: false,
            claimed_ids: ['a', 'b'],
            lease_until: 1000,
            turn_at: 10
        });
    });

    it('moves a full fill into the run', () => {
        const out = claim({ pending: true, full: true, dirty_ids: [] });
        expect(out.claimed_full).toBe(true);
        expect(out.claimed_ids).toEqual([]);
        expect(out.pending).toBe(false);
    });

    it('keeps the work of a run that never ended, with what came since', () => {
        const out = claim({
            pending: true,
            full: false,
            dirty_ids: ['b', 'c'],
            claimed: true,
            claimed_full: false,
            claimed_ids: ['a', 'b'],
            lease_until: 5
        });
        expect(out.claimed_full).toBe(false);
        expect(out.claimed_ids.sort()).toEqual(['a', 'b', 'c']);
        expect(out.lease_until).toBe(1000);
    });

    it('keeps a full fill of a run that never ended when nothing waits', () => {
        const out = claim({
            pending: false,
            full: false,
            dirty_ids: [],
            claimed: true,
            claimed_full: true,
            claimed_ids: [],
            lease_until: 5
        });
        expect(out.claimed_full).toBe(true);
        expect(out.claimed).toBe(true);
    });

    it('ignores leftover run fields once a run released them', () => {
        const out = claim({ pending: true, dirty_ids: ['x'], claimed_full: true });
        expect(out.claimed_full).toBe(false);
        expect(out.claimed_ids).toEqual(['x']);
    });

    it('looks at the whole table past max_dirty_ids', () => {
        const many = Array.from({ length: AI_COLUMN_LIMITS.max_dirty_ids + 1 }, (_x, i) => `r${i}`);
        const out = claim({
            pending: true,
            dirty_ids: many.slice(0, 5),
            claimed: true,
            claimed_ids: many.slice(5)
        });
        expect(out.claimed_full).toBe(true);
        expect(out.claimed_ids).toEqual([]);
    });
});
