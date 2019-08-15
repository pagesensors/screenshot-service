const async = require('async');
const devices = require('puppeteer/DeviceDescriptors');
const puppeteer = require('puppeteer');
const fs = require('fs');

module.exports = {
    name: "screenshot-generator",

	/**
	 * Service settings
	 */
    settings: {
        chrome_args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--enable-logging',
            '--use-gl=egl'
        ]
    },

	/**
	 * Service dependencies
	 */
    // dependencies: [],	

	/**
	 * Actions
	 */
    actions: {

        /**
         * capture
		 * @param {String} url - page url
		 * @param {String} width - image width
         */
        capture: {
            params: {
                url: { type: "url" },
                width: { type: "number", positive: true, integer: true },
            },
            async handler(ctx) {
                return await this.queue.push(ctx.params);
            },
        },

    },

	/**
	 * Events
	 */
    events: {

    },

	/**
	 * Methods
	 */
    methods: {
        async screenshot(page, options) {
            const { data } = await page._client.send('Page.captureScreenshot', {
                ...options, fromSurface: true
            });
            return Buffer.from(data, 'base64');
        },
        async pscreenshot(page, options) {
            return await page.screenshot(options);
        },
        async capture(params) {
            const { url, width } = params;
            const page = await this.browser.newPage();
            const device = devices['Pixel 2'];
            if (process.env.CHROME_FORCE_SCALE_FACTOR) {
                device.viewport.deviceScaleFactor = parseInt(process.env.CHROME_FORCE_SCALE_FACTOR);
            }
            await page.emulate(device);
            await page.setRequestInterception(true);
            await page.evaluateOnNewDocument(() => {
                window.__xxscrollTo = window.scrollTo;
                window.__xxrequestAnimationFrame = window.requestAnimationFrame;
            })
            // await page._client.send('Animation.setPlaybackRate', { playbackRate: 12 }); 

            let inflight = 0;

            page.on('request', request => {
                inflight += 1;
                if (request.url().match(/\b(data:image\/(png|gif)|data:application\/x-font|newrelic\.com|google-analytics\.com|driftt\.com|drift\.com|optimizely\.com|engagio\.com|adroll\.com|bizographics\.com|googleadservices\.com|hotjar\.com|opmnstr\.com|ads\.linkedin\.com|dialogtech\.com)/)) {
                    // still triggers requestfailed
                    request.abort();
                } else {
                    if (!request.url().match(/(vts\.com|namely\.com|bettsrecruiting\.com|meltwater\.com|jetasg\.com|numo\.global|kibocommerce\.com|initiative20x20\.org)/)) {
                        // console.log(request.url());
                    }
                    request.continue();
                }
            })

            page.on('requestfinished', request => {
                inflight -= 1;
            })

            page.on('requestfailed', request => {
                const response = request.response();
                if (response){
                    // console.error(request.url(), response.status());
                }
                inflight -= 1;
            });

            try {
                await page.goto(url, { waitUntil: 'load' });
            } catch (err) {
                this.logger.error(url, err);
                return [ Buffer.from('') ];
            }

            const sleep = (timeout) => new Promise(resolve => setTimeout(resolve, timeout))
            const buffers = [];
            console.time("evaluate " + url);
            await page.evaluate(() => {
                const scrollHeight = 100;
                return new Promise((resolve) => {
                    let scrollTop = 0;
                    const f = () => {
                        window.__xxscrollTo(0, scrollTop);
                        if (scrollTop <= document.body.clientHeight) {
                            scrollTop += scrollHeight;
                            window.__xxrequestAnimationFrame(f, 0);
                        } else {
                            window.__xxrequestAnimationFrame(() => {
                                window.__xxscrollTo(0, 0);
                                window.__xxrequestAnimationFrame(resolve);
                            });
                        }
                    };
                    f();
                });
            });
            console.timeEnd("evaluate " + url);

            let j = 200; // 20 sec
            console.time("extra network " + url);
            while (inflight > 0 && j > 0) {
                await sleep(500);
                j -= 10;
                while (inflight > 0 && j > 0) {
                    await sleep(100);
                    j -= 1;
                }
            }
            console.timeEnd("extra network " + url);
            const { clientHeight } = await page.evaluate(() => {
                return new Promise(resolve => {
                    window.__xxrequestAnimationFrame(
                        resolve({
                            clientHeight: document.body.clientHeight
                        })
                    )
                });
            });
            await sleep(500);

            const realDeviceWidth = device.viewport.width * device.viewport.deviceScaleFactor;
            const maxTextureSize = 10 * 1024 * 1024;
            const maxHeight = (maxTextureSize / realDeviceWidth / device.viewport.deviceScaleFactor);
            let captureHeight = Math.floor(maxHeight / device.viewport.height) * device.viewport.height;

            if (captureHeight < device.viewport.height) {
                this.logger.info("captureHeight calculated to be less than device height");
                captureHeight = device.viewport.height;
            }

            console.time("screenshot " + url);
            let frameTop = 0;
            while (frameTop + captureHeight <= clientHeight) {
                const buffer = await this.screenshot(page, {
                    format: 'png',
                    clip: {
                        x: 0,
                        y: frameTop,
                        width: device.viewport.width,
                        height: captureHeight,
                        scale: 1
                    }
                });

                buffers.push(buffer);
                frameTop += captureHeight;
            }
            if (frameTop < clientHeight) {
                const buffer = await this.screenshot(page, {
                    format: 'png',
                    clip: {
                        x: 0,
                        y: frameTop,
                        width: device.viewport.width,
                        height: clientHeight - frameTop,
                        scale: 1
                    }
                });

                buffers.push(buffer);
            }
            console.timeEnd("screenshot " + url);
            await page.close();
            return buffers;
        }
    },

	/**
	 * Service created lifecycle event handler
	 */
    created() {
        if (!process.env.CHROME_TAB_LIMIT) {
            throw new Error("CHROME_TAB_LIMIT not set");
        }
        if (!process.env.CHROME_WS_ENDPOINT) {
            this.logger.warn("CHROME_WS_ENDPOINT not set, will launch local instance");
        }
        if (!process.env.CHROME_ARGS) {
            this.logger.warn("CHROME_ARGS not set, using insecure defaults:", this.settings.chrome_args)
        }
    },

	/**
	 * Service started lifecycle event handler
	 */
    async started() {
        const self = this;
        const args = process.env.CHROME_ARGS
            ? process.env.CHROME_ARGS.split(/\s+/)
            : this.settings.chrome_args;
        if (process.env.CHROME_WS_ENDPOINT) {
            this.browser = await puppeteer.connect({
                browserWSEndpoint: process.env.CHROME_WS_ENDPOINT
            });
            this.logger.info("Connected to ", process.env.CHROME_WS_ENDPOINT);
        } else {
            this.browser = await puppeteer.launch({ args: args });
            this.logger.info("Chrome launched");
        }
        this.queue = async.queue(async (task) => await this.capture(task), process.env.CHROME_TAB_LIMIT);
        this.queue.error(err => this.logger.error(err));
    },

	/**
	 * Service stopped lifecycle event handler
	 */
    async stopped() {
        if (this.queue && !this.queue.idle()) {
            await this.queue.drain();
        }
        if (this.browser) {
            if (process.env.CHROME_WS_ENDPOINT) {
                await this.browser.disconnect();
                this.logger.info("Disconnected from ", process.env.CHROME_WS_ENDPOINT);
            } else {
                await this.browser.close();
                this.logger.info("Chrome stopped ", process.env.CHROME_WS_ENDPOINT);
            }
        }
    },
};