#!/bin/bash

prettier --write 'src/**/*.{js,vue}'
prettier --write 'internals/**/*.js'
prettier --write 'vue.config.js'
prettier --write 'babel.config.js'
prettier --write 'env.js'