/* Vue app running in browser will access the generated file located at
   http://url/env.txt. */

const fs = require('fs');
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
    HORIZON_API_PUB_HTTP_URL: process.env.HORIZON_API_PUB_HTTP_URL
};

if (args[0]) {
    if (args[0] == 'dist')
        fs.writeFile(
            'dist/env.txt',
            JSON.stringify(env) + '\n',
            function (err) {
                if (err) console.log(err);
            }
        );
    else if (args[0] == 'public')
        fs.writeFile(
            'public/env.txt',
            JSON.stringify(env) + '\n',
            function (err) {
                if (err) console.log(err);
            }
        );
}

module.exports = env;
