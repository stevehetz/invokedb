const webpack = require('webpack');

module.exports = {
    devtool: process.env.NODE_ENV === 'production' ? false : 'eval-source-map',
    output: {
        filename: 'app.[hash].js',
        chunkFilename: '[id].[hash].js'
    },
    optimization: {
        splitChunks: {
            minSize: 10000,
            maxSize: 250000
        }
    },
    resolve: {
        alias: {
            '@': require('path').resolve(__dirname, '../src')
        }
    },
    plugins: [
        new webpack.ProvidePlugin({
            $: 'jquery',
            jQuery: 'jquery',
            _: 'lodash'
        })
    ]
};
