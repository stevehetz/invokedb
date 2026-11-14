export const search = `
import { InvokeDBClient } from 'invokedb';

const invokedbClient = new InvokeDBClient({ apiKey: 'your_api_key' });
const contactsTbl = invokedbClient.table('contacts');

const filter = {};
filter.first_name = { $eq: 'River' };

const res = await contactsTbl.find(filter).skip(0).limit(10).exec();

`;

export const create = `
import { InvokeDBClient } from 'invokedb';

const invokedbClient = new InvokeDBClient({ apiKey: 'your_api_key' });
const contactsTbl = invokedbClient.table('contacts');

await contactsTbl.insert({
    first_name: 'Malcolm',
    last_name: 'Reynolds'
});
`;

export const update = `
import { InvokeDBClient } from 'invokedb';

const invokedbClient = new InvokeDBClient({ apiKey: 'your_api_key' });
const contactsTbl = invokedbClient.table('contacts');

await contactsTbl.update({
    _id: '5eb95a3ec49a22205bc36273',
    first_name: 'River',
    last_name: 'Tam'
});

`;

export const remove = `
import { InvokeDBClient } from 'invokedb';

const invokedbClient = new InvokeDBClient({ apiKey: 'your_api_key' });
const contactsTbl = invokedbClient.table('contacts');

const _id = '5eb95a3ec49a22205bc36273';

await contactsTbl.delete(_id);

`;
