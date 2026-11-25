// Prints the onboarding funnel (#169): how many accounts that signed up reach each step, and the
// median time from signup to the first API call. Read-only.
//   locally:     npm run onboarding:funnel -- [--days 30 | --since 2026-11-01 --until 2026-12-01] [--json]
//   production:  deploy/deploy.sh compose exec -T api node dist/cli/onboarding-funnel.js [...]
// It only uses relative imports, so it runs from the build without module-alias.
import { MongoClient } from 'mongodb';
import env from '../env';
import {
    build_funnel,
    format_funnel,
    parse_funnel_args
} from '../core/onboarding/onboarding-funnel';

// OnboardingManager's documents: one collection per account in the tracking database
const COLLECTION = /^tracking:onboarding:acct_\d+$/;

async function run() {
    const args = parse_funnel_args(process.argv.slice(2));
    const uri = env.HORIZON_MONGO_TRACKING_URI || env.HORIZON_MONGO_URI;
    if (!uri || !env.HORIZON_MONGO_TRACKING_DB) {
        throw new Error('HORIZON_MONGO_TRACKING_URI and HORIZON_MONGO_TRACKING_DB must be set');
    }

    const client = await MongoClient.connect(uri);
    try {
        const db = client.db(env.HORIZON_MONGO_TRACKING_DB);
        const names = (await db.listCollections({}, { nameOnly: true }).toArray())
            .map(c => c.name)
            .filter(name => COLLECTION.test(name));
        const states = [];
        for (const name of names) {
            states.push(await db.collection(name).findOne({ _id: 'state' as any }));
        }
        const funnel = build_funnel(states, args);
        console.log(args.json ? JSON.stringify(funnel, null, 4) : format_funnel(funnel));
    } finally {
        await client.close();
    }
}

run().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
