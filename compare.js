const { ServiceBroker } = require("moleculer");
const fs = require('fs');
const writeFileAsync = require('util').promisify(fs.writeFile);
const URL = require('url');
const yargs = require('yargs');
const { PNG } = require('pngjs');

const { argv } = yargs
    .option('from', {
        type: 'string',
    })
    .option('to', {
        type: 'string',
    });

const Service = require("./src");

function Histogram(data) {
    // const png = PNG.parse(data);
    return new Promise((resolve, reject) => {
        new PNG({ filterType: 4 }).parse(data, (err, png) => {
            if (err) {
                reject(err);
            } else {
                const histogram = { width: png.width, height: png.height, data: [[], [], []] };
                for (let y = 0; y < png.height; y += 1) {
                    for (let x = 0; x < png.width; x += 1) {
                        // eslint-disable-next-line no-bitwise
                        const idx = (png.width * y + x) << 2;
                        const [r, g, b] = [png.data[idx + 0], png.data[idx + 1], png.data[idx + 2]];
                        histogram.data[0][r] = histogram.data[0][r] || 0;
                        histogram.data[0][r] += 1;
                        histogram.data[1][g] = histogram.data[1][g] || 0;
                        histogram.data[1][g] += 1;
                        histogram.data[2][b] = histogram.data[2][b] || 0;
                        histogram.data[2][b] += 1;
                    }
                }
                resolve(histogram);
            }
        });
    });
}

function QDiff(h1, h2) {
    const h1total = h1.width * h1.height;
    const h2total = h2.width * h2.height;
    let sum = 0;
    for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 256; j += 1) {
            const d = ((h1.data[i][j] || 0) * 100) / h1total - ((h2.data[i][j] || 0) * 100) / h2total;
            sum += d ** 2; // Math.pow(2, d);
        }
    }
    return Math.sqrt(sum / 768);
}
(async () => {

    const broker = new ServiceBroker();
    broker.createService(Service);
    await broker.start();

    const seen = {};
    let urls = [ argv.from ];
    let i = 0;
    while (urls.length && i < 100) {
        const url = urls.shift().replace(/#.*/, '');
        if (!seen[url]) {

            try {
                const orig = URL.parse(url);
                const alt = URL.parse(argv.to);
                alt.pathname = orig.pathname;

                const stack = [orig, alt];
                const histograms = [];
                for (let k = 0; k < stack.length; k += 1) {
                    console.log(`fetching ${i}: ${stack[k].format()}`);
                    // eslint-disable-next-line no-await-in-loop
                    const result = await broker.call("screenshot-generator.capture", {
                        url: stack[k].format(),
                        width: 1280,
                    });

                    if (result) {
                        // console.log(result);
                        urls = [...urls, ...(result.links.filter(l => l.match(/^https:\/\//) && !l.match(/gnk=job/) && !l.match(/blog\/topic/) && !l.match(/blog\/p\d+$/)))];

                        const dir = stack[k].host;
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir);
                        }
                        const safe = stack[k].pathname.replace(/\W+/g, '-');
                        for(let j = 0; j < result.screenshots.length; j +=1) {
                            const buffer = result.screenshots[j];
                            // eslint-disable-next-line no-await-in-loop
                            await writeFileAsync(`${dir}/${safe}-${j}.png`, buffer);
                            // eslint-disable-next-line no-await-in-loop
                            const histogram = await Histogram(buffer);
                            histograms.push(histogram);

                        }
                    }
                }
                console.log("qdiff: ", QDiff(histograms[0], histograms[1]));

            } catch (e) {
                // doing nothing
                console.error(e);
            }
            seen[url] = true;
            i += 1;
        }
    }

    await broker.stop();

})();
