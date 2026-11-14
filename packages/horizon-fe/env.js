/* Vue app running in browser will access the generated file located at
   http://url/env.txt. */

const jsonfile = require('jsonfile');
const args = process.argv.slice(2);

process.env.NODE_ENV = process.env.ENV;

const env = {
    ENV: process.env.ENV,
    LOG_LEVEL: 'DEBUG',
    HORIZON_FS_PUB_HTTP_URL: process.env.HORIZON_FS_PUB_HTTP_URL,
    HORIZON_SB_PUB_WS_URL: process.env.HORIZON_SB_PUB_WS_URL,
    HORIZON_FE_PUB_HTTP_PORT: process.env.HORIZON_FE_PUB_HTTP_PORT,
    HORIZON_BE_PUB_HTTP_URL: process.env.HORIZON_BE_PUB_HTTP_URL,
    HORIZON_PRC_PUB_HTTP_URL: process.env.HORIZON_PRC_PUB_HTTP_URL,
    HORIZON_AUTH_FE_PUB_HTTP_URL: process.env.HORIZON_AUTH_FE_PUB_HTTP_URL,
    HORIZON_API_PUB_HTTP_URL: process.env.HORIZON_API_PUB_HTTP_URL
};

if (args[0]) {
    if (args[0] == 'dist')
        jsonfile.writeFile('dist/env.txt', env, function(err) {
            if (err) console.log(err);
        });
    else if (args[0] == 'public')
        jsonfile.writeFile('public/env.txt', env, function(err) {
            if (err) console.log(err);
        });
}

module.exports = env;
