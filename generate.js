const glob = require('glob');
const path = require('path');
const yargs = require('yargs');
const fs = require('fs');
const writeFileAsync = require('util').promisify(fs.writeFile);
const URL = require('url');

const { argv } = yargs
    .option('from', {
        type: 'string',
        demand: true,
    })
    .option('to', {
        type: 'string',
        demand: true,
    });

(async () => {
    const from = URL.parse(argv.from).host;
    const to = URL.parse(argv.to).host;
    const files = glob.sync(`${from}/*.png`, { root: from }).map(f => path.basename(f));
    console.log(`
        window.dirs = ${JSON.stringify([URL.parse(argv.from).host, URL.parse(argv.to).host])};
        window.images = ${JSON.stringify(files)};
    `);
})();


