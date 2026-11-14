/* Vue app running in browser will access the generated file located at
   http://url/env.txt. */

const jsonfile = require('jsonfile');
const args = process.argv.slice(2);

process.env.NODE_ENV = process.env.ENV;

const env = {
    ENV: process.env.ENV,
    HORIZON_FE_PUB_HTTP_URL: process.env.HORIZON_FE_PUB_HTTP_URL,
    HORIZON_BE_PUB_HTTP_URL: process.env.HORIZON_BE_PUB_HTTP_URL,
    HORIZON_AUTH_FE_PUB_HTTP_URL: process.env.HORIZON_AUTH_FE_PUB_HTTP_URL,
    HORIZON_AUTH_FE_PUB_HTTP_PORT: process.env.HORIZON_AUTH_FE_PUB_HTTP_PORT
};

if (args[0]) {
    if (args[0] == 'dist')
        jsonfile.writeFile('dist/env.txt', env, function (err) {
            if (err) console.log(err);
        });
    else if (args[0] == 'public')
        jsonfile.writeFile('public/env.txt', env, function (err) {
            if (err) console.log(err);
        });
}

module.exports = env;
