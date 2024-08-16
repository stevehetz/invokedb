export const get_paging = `
// Note: This example uses the axios library for http

const table = 'contacts';
const limit = 10;
const headers = { Authorization: \`Bearer your_api_key\` };

let url = \`https://api.invokedb.com/v1/get?table=\${table}\`;

let skip = 0;
url += \`&skip=\${skip}&limit=\${limit}\`;
let res = await axios.get(url, { headers });
// { data: { count: 200, data: [...] } }

skip = skip + limit;
url += \`&skip=\${skip}&limit=\${limit}\`;
res = await axios.get(url, { headers });
// { data: { count: 200, data: [...] } }

`;

export const get_sorting = `
// Note: This example uses the axios library for http

let url = 'https://api.invokedb.com/v1/get';
url += '?table=contacts';
url += '&skip=0';
url += '&limit=10';
url += '&sort_by=first_name';
url += '&sort_dir=desc';

const headers = { Authorization: \`Bearer your_api_key\` };

let res = await axios.get(url, { headers });
// { data: { count: 200, data: [...] } }

`;

export const search_text_contains = `
// Note: This example uses the axios library for http

const table = 'contacts';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/search?table=\${table}&skip=0&limit=10\`;

const filter = {
    first_name: {
        value: 'guilbert',
        type: 'contains',
        case: 'insensitive'
    }
};

const res = await axios.post(url, filter, { headers });
// { data: { count: 1, data: [...] } }

`;

export const search_text_exact = `
// Note: This example uses the axios library for http

const table = 'contacts';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/search?table=\${table}&skip=0&limit=10\`;

const filter = {
    first_name: {
        value: 'Guilbert',
        type: 'equals',
        case: 'sensitive'
    }
};

const res = await axios.post(url, filter, { headers });
// { data: { count: 1, data: [...] } }

`;

export const search_number = `
// Note: This example uses the axios library for http

const table = 'winereview';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/search?table=\${table}&skip=0&limit=10\`;

const filter = {
    price: {
        value: 87,
        type: 'greaterThanOrEqual'
    }
};  

const res = await axios.post(url, filter, { headers });
// { data: { count: 10, data: [...] } }

`;
export const search_date = `
// Note: This example uses the axios library for http

const table = 'contacts';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/search?table=\${table}&skip=0&limit=10\`;

const filter = {
    dob: {
        value: "2014-01-01 12:00:00",
        type: "greaterThanOrEqual"
    }
};  

const res = await axios.post(url, filter, { headers });
// { data: { count: 10, data: [...] } }

`;

export const search_one_column_and = `
// Note: This example uses the axios library for http

const table = 'winereview';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/search?table=\${table}&skip=0&limit=10\`;

const filter = {
    price: [{
        value: 100,
        type: "greaterThanOrEqual"
    }, {
        value: 200,
        type: "lessThan"
    }]
};  

const res = await axios.post(url, filter, { headers });
// { data: { count: 10, data: [...] } }

`;
export const search_one_column_or = `
// Note: This example uses the axios library for http

const table = 'winereview';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/search?table=\${table}&skip=0&limit=10\`;

const filter = {
    $or: {
        first_name: [{
            value: 100,
            type: "greaterThanOrEqual"
        }, {
            value: 200,
            type: "lessThan"
        }]
    }
}; 

const res = await axios.post(url, filter, { headers });
// { data: { count: 10, data: [...] } }

`;

export const search_two_columns_and = `
// Note: This example uses the axios library for http

const table = 'winereview';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/search?table=\${table}&skip=0&limit=10\`;

const filter = {
    price: {
        value: 100,
        type: "greaterThan"
    },
    points: {
        value: 50,
        type: "lessThan"
    }
};

const res = await axios.post(url, filter, { headers });
// { data: { count: 10, data: [...] } }

`;

export const search_two_columns_or = `
// Note: This example uses the axios library for http

const table = 'contacts';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/search?table=\${table}&skip=0&limit=10\`;

const filter = {
    $or: {
        first_name: {
            value: 'guilbert',
            type: 'equals',
            case: 'insensitive'
        },
        last_name: {
            value: 'conrad',
            type: 'equals',
            case: 'insensitive'
        }
    }
};

const res = await axios.post(url, filter, { headers });
// { data: { count: 2, data: [...] } }

`;

export const search_group = `
// Note: This example uses the axios library for http

// Description: Removes all duplicates of provided column name.
//              Only returns the 1 column that is being 'grouped'.
//              Helpful for dropdowns.

const table = 'contacts';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/search?table=\${table}&skip=0&limit=10\`;

const filter = {
    $group: 'first_name'
};

const res = await axios.post(url, filter, { headers });
/*
res.data =
{
    count: 2,
    data:  [
        {
            first_name: 'Stacee',
        },
        {
            first_name: 'Milo'
        }
    ]
}
*/

`;

export const create = `
// Note: This example uses the axios library for http

const table = 'contacts';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/create?table=\${table}\`;

const data = [{
    first_name: 'Malcolm',
    last_name: 'Reynolds'
},
{
    first_name: 'Jayne',
    last_name: 'Cobb'
}];

const res = await axios.post(url, data, { headers });
// { status: 201, ... }

`;

export const update = `
// Note: This example uses the axios library for http

const table = 'contacts';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/update?table=\${table}\`;

const data = [{
    _id: '5f38f1a22a3a9d1db22bae3d',
    first_name: 'River',
    last_name: 'Tam'
}];

const res = await axios.put(url, data, { headers });
// { status: 200, ... }

`;

export const remove = `
// Note: This example uses the axios library for http

const table = 'contacts';
const headers = { Authorization: \`Bearer your_api_key\` };

const url = \`https://api.invokedb.com/v1/delete?table=\${table}\`;

const data = ['5f38f1a22a3a9d1db22bae3d'];

const res = await axios.post(url, data, { headers });
// { status: 201, data: 1 }

`;
