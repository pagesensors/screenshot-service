const fs = require('fs');
const writeFileAsync = require('util').promisify(fs.writeFile);
const URL = require('url');
const yargs = require('yargs');
const devices = require('puppeteer/DeviceDescriptors');
const { PNG } = require('pngjs');
const { ServiceBroker } = require("moleculer");
const Service = require("./src");

const emulatedDevices = {
    'Desktop 1920x1080': {
        name: 'Desktop 1920x1080',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.75 Safari/537.36',
        viewport: {
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: false,
        },
    },
    'Desktop 1440x960': {
        name: 'Desktop 1440x960',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.75 Safari/537.36',
        viewport: {
            width: 1440,
            height: 960,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: false,
        },
    },
    'Desktop 1280x800': {
        name: 'Desktop 1280x800',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.75 Safari/537.36',
        viewport: {
            width: 1280,
            height: 800,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: false,
        },
    },
    'Desktop 1024x768': {
        name: 'Desktop 1024x768',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.75 Safari/537.36',
        viewport: {
            width: 1024,
            height: 768,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: false,
        },
    },
    'Pixel 2' : devices['Pixel 2'],
    'iPhone 8': devices['iPhone 8'],
    // eslint-disable-next-line dot-notation
    'iPad': devices['iPad'],
};

const { argv } = yargs
    .option('from', {
        type: 'string',
        demand: true,
    })
    .option('to', {
        type: 'string',
        demand: true,
    })
    .option('device', {
        choices: Object.keys(emulatedDevices),
        demand: true,
    })
    .option('limit', {
        type: 'number',
        default: 100,        
    })
    .option('exclude', {
        type: 'array',
    })
    .option('rewrite', {
        type: 'array',
    });

const device = emulatedDevices[argv.device];

const rewrites = [];
argv.rewrite.forEach(s => {
    const rewrite = s.match(/s(.)(.*?)\1(.*?)\1([gmis]?)/).slice(2);
    rewrite[0] = new RegExp(rewrite[0], rewrite[2]);
    rewrites.push(rewrite.slice(0, 2));
});

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

    const filenames = [];
    const seen = {};
    let urls = [ argv.from ];
    let i = 0;
    while (urls.length && i < argv.limit) {
        const url = urls.shift().replace(/#.*/, '');
        if (!seen[url]) {
            const orig = URL.parse(url);

            try {
                const alt = URL.parse(argv.to);
                alt.pathname = orig.pathname;

                const stack = [orig, alt];
                const histograms = [];
                for (let k = 0; k < stack.length; k += 1) {
                    console.log(`fetching ${i}: ${stack[k].format()}`);
                    // eslint-disable-next-line no-await-in-loop
                    const result = await broker.call("screenshot-generator.capture", {
                        url: stack[k].format(),
                        device,
                    });

                    if (result) {
                        // console.log(result);
                        if (k === 0) {
                            const filtered = [];
                            result.links.forEach(link => {
                                let exclude = false;
                                rewrites.forEach(rewrite => {
                                    // eslint-disable-next-line no-param-reassign
                                    link = link.replace(...rewrite);
                                })
                                argv.exclude.forEach(pattern => {
                                    if ((new RegExp(pattern)).test(link)) {
                                        exclude = true;
                                    }
                                });
                                if (!exclude) 
                                    filtered.push(link);
                            })
                            urls = [...urls, ...filtered];
                        }

                        const dir = stack[k].host;
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir);
                        }
                        const safe = stack[k].pathname.replace(/\W+/g, '-');
                        for(let j = 0; j < result.screenshots.length; j +=1) {
                            const buffer = result.screenshots[j];
                            const filename = `${safe}-${j}.png`;
                            // eslint-disable-next-line no-await-in-loop
                            await writeFileAsync(`${dir}/${filename}`, buffer);
                            if (k === 0) {
                                filenames.push(filename);
                            }
                            // eslint-disable-next-line no-await-in-loop
                            // const histogram = await Histogram(buffer);
                            // histograms.push(histogram);

                        }
                    }
                }
                // console.log("qdiff: ", QDiff(histograms[0], histograms[1]));

            } catch (e) {
                // doing nothing
                console.error(e);
            }
            seen[orig.format()] = true;
            i += 1;
        }
    }

    await writeFileAsync('results.js', `
        window.dirs = ${JSON.stringify([URL.parse(argv.from).host, URL.parse(argv.to).host])};
        window.images = ${JSON.stringify(filenames)};
    `);

    await broker.stop();

})();
