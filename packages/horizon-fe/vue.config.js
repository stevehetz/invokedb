const env = require('./env.js');
const webpackConfig = require('./internals/webpack.config.js');

module.exports = {
    filenameHashing: true,
    css: {
        extract: {
            filename: 'app.[hash].css',
            chunkFilename: '[id].[hash].css'
        }
    },
    configureWebpack: webpackConfig,
    devServer: {
        host: '0.0.0.0',
        port: env.HORIZON_FE_PUB_HTTP_PORT,
        watchOptions: {
            aggregateTimeout: 300,
            poll: true
        }
    }
};
