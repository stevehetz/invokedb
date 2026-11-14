var rimraf = require('rimraf');
var exec = require('child_process').exec;

rimraf('public/env.txt', () => {
    exec('vue-cli-service build');
});
