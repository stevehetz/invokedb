const webpack = require('webpack');

module.exports = {
    devtool: process.env.NODE_ENV === 'production' ? false : 'eval-source-map',
    optimization: {
        splitChunks: {
            minSize: 10000,
            maxSize: 250000
        }
    },
    output: {
        filename: 'app.[hash].js',
        chunkFilename: '[id].[hash].js'
    },
    resolve: {
        alias: {
            '@': require('path').resolve(__dirname, '../src')
        }
    },
    plugins: [
    ]
};
