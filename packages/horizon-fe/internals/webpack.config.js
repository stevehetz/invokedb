const webpack = require('webpack');
const GoogleFontsPlugin = require('@beyonk/google-fonts-webpack-plugin');

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
        }),
        new GoogleFontsPlugin({
            fonts: [
                { family: 'Open Sans', variants: ['300', '400', '500', '600'] }
            ]
        })
    ]
};
