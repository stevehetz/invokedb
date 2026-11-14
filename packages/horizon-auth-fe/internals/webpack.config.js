const webpack = require('webpack');
const GoogleFontsPlugin = require('@beyonk/google-fonts-webpack-plugin');

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
        new GoogleFontsPlugin({
            fonts: [
                { family: 'Open Sans', variants: ['300', '400', '500', '600'] },
                { family: 'Source Code Pro', variants: ['500'] }
            ]
        })
    ]
};
