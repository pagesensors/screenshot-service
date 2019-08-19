/* eslint-disable no-underscore-dangle */
const async = require('async');
const devices = require('puppeteer/DeviceDescriptors');
const puppeteer = require('puppeteer');
const EventEmitter = require('events')

class NetworkIdle extends EventEmitter {

    constructor(page, networkIdle0, networkTimeout) {
        super();
        this.page = page;
        this.networkIdle0 = networkIdle0;
        this.networkTimeout = networkTimeout;
        this.lastNetworkRequest = null;
        this.seen = {};
    }

    async promise() {
        const self = this;
        await Promise.all([
            this.page.on('request', request => this.registerView(request)),
            this.page.on('requestfinished', request => this.unregisterView(request)),
            this.page.on('requestfailed', request => this.unregisterView(request)),
            this.page.setRequestInterception(true),
        ]);
        return new Promise((resolve, reject) => {
            let timeout;
            const interval = setInterval(() => {
                // console.log('Date.now() - self.lastNetworkRequest >= self.networkIdle0', Date.now() - self.lastNetworkRequest, self.networkIdle0);
                if (Date.now() - self.lastNetworkRequest >= self.networkIdle0) {
                    clearInterval(interval);
                    clearTimeout(timeout);
                    resolve();
                    // console.log('---------------------- resolved');
                }
            }, 100);
            timeout = setTimeout(() => {
                // console.log('---------------------- timed out');
                if (self.inflight()) {
                    reject(self.inflight());
                } else {
                    resolve();
                }
                clearInterval(interval);
                clearTimeout(timeout);
            }, self.networkTimeout);
        });
    }

    // eslint-disable-next-line class-methods-use-this
    url(url) {
        const parsed = new URL(url);
        return `${parsed.host}${parsed.pathname}`;
    }

    registerView(request) {
        if (request.url().match(/\b(newrelic\.com|google-analytics\.com|driftt\.com|drift\.com|optimizely\.com|engagio\.com|adroll\.com|bizographics\.com|googleadservices\.com|hotjar\.com|opmnstr\.com|ads\.linkedin\.com|dialogtech\.com|salesloft\.com)/gi)) {
            return request.abort();
        }

        const key = this.url(request.url());
        if (!this.seen[key]) {
            this.seen[key] = 1;
        } else {
            this.seen[key] += 1;
            // this.emit('duplicate.url.request', key);
        }
        request.continue();
        this.lastNetworkRequest = Date.now();
        return this.seen[key];
    }

    unregisterView(request) {
        const key = this.url(request.url());
        if (!this.seen[key])
            return;

        this.seen[key] -= 1;
        this.lastNetworkRequest = Date.now();
    }

    inflight() {
        return Object.keys(this.seen).filter((key) => this.seen[key]);
    }
};

module.exports = {
    name: "screenshot-generator",

	/**
	 * Service settings
	 */
    settings: {
        chrome_args: [
            '--no-first-run',
            '--no-default-browser-check',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--shm-size=128M',
            '--disable-web-security',
            '--enable-logging',
            '--use-gl=egl',
        ],
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
                return this.queue.push(ctx.params);
            },
        },

    },

	/**
	 * Events
	 */
    events: {
        'duplicate.url.request': {
            handler(...args) {
                console.log(args)
            },
        },
    },

	/**
	 * Methods
	 */
    methods: {
        async getClientHeight(page) {
            // const metrics = await page._client.send('Page.getLayoutMetrics');
            // clientHeight = Math.ceil(metrics.contentSize.height);
            const { clientHeight } = await page.evaluate(() => {
                return { clientHeight: document.body.clientHeight };
            })
            return clientHeight;
        },
        async upsize(page, prevClientHeight) {
            const clientHeight = await this.getClientHeight(page);
            if (prevClientHeight !== clientHeight) {
                // console.log(`setting client height from ${prevClientHeight} to ${clientHeight}`);
                await page.setViewport({ ...page.viewport(), ... { height: clientHeight } });
            }
            return clientHeight;
        },
        async capture(params) {
            const { url } = params;
            const page = await this.browser.newPage();
            const device = devices['Pixel 2'];
            if (process.env.CHROME_FORCE_DEVICE_SCALE_FACTOR) {
                device.viewport.deviceScaleFactor = parseInt(process.env.CHROME_FORCE_DEVICE_SCALE_FACTOR, 10);
            }
            await page._client.send('Animation.setPlaybackRate', { playbackRate: 1000 })
            await page.setViewport({ ...device.viewport, ...{ height: 0 } });
            await page.evaluateOnNewDocument((oneVh) => {
                window.__xxscrollTo = window.scrollTo;
                window.__xxrequestAnimationFrame = window.requestAnimationFrame;
            }, device.viewport.height * 0.01);

            await page.goto(url, { waitUntil: 'load' });

            const allTransitionsEnded = page.evaluate((oneVh, transitionsIdle0, transitionsTimeout) => {
                return new Promise((resolve, reject) => {
                    const stack = Array.from(document.styleSheets);
                    while (stack.length) {
                        const rule = stack.pop();
                        try {
                            if (rule.cssRules) {
                                stack.push(...rule.cssRules);
                            } else if (rule instanceof CSSStyleRule && rule.style.cssText.match(/\b([\d.]+)vh/i)) {
                                rule.style.cssText = rule.style.cssText.replace(/(?:\b)([\d.]+)vh/gi, (match, vh) => `${(oneVh * vh)}px`);
                            }
                        } catch (err) {
                            console.error(rule);
                        }
                    }

                    let idle = 0;

                    // Array.from(document.getElementsByTagName('*')).forEach((elem) => {
                    [document.body].forEach((elem) => {
                        elem.addEventListener("transitionstart", () => setTimeout(() => { idle = 0 }, 100));
                        elem.addEventListener("transitionend", () => setTimeout(() => { idle = 0 }, 100));
                        elem.addEventListener("animationstart", () => setTimeout(() => { idle = 0 }, 100));
                        elem.addEventListener("animationend", () => setTimeout(() => { idle = 0 }, 100));
                    });
                    // it is possible to detect repeatedly changed elements
                    let timeout;
                    const interval = setInterval(() => {
                        // eslint-disable-next-line no-plusplus
                        if (++idle === Math.round(transitionsIdle0 / 100)) {
                            clearInterval(interval);
                            clearTimeout(timeout);
                            resolve();
                        }
                    }, 100);
                    timeout = setTimeout(() => {
                        clearInterval(interval);
                        clearTimeout(timeout);

                        reject();
                    }, transitionsTimeout);
                });

            }, device.viewport.height * 0.01, 5000, 20000);

            // setting up network tracking before resizing page,
            // because resize might trigger new network requests
            const networkIdle = new NetworkIdle(page, 5000, 20000);
            // networkIdle.on('duplicate.url.request', (e) => this.broker.emit(e));

            const initialClientHeight = await this.upsize(page);

            console.time(`extra network ${url}`);
            try {
                await networkIdle.promise();
            } catch (err) {
                console.log(`networkIdle ${url} timed out:`, err);
            }
            console.timeEnd(`extra network ${url}`);

            console.time(`transitions ${url}`);
            try {
                const reason = await allTransitionsEnded;
                // console.log(`transitions ${url} done`);
            } catch (err) {
                console.log(`transitions ${url} timed out:`, err);
            }
            console.timeEnd(`transitions ${url}`);

            const clientHeight = await this.upsize(page, initialClientHeight);

            let captureHeight = Math.floor(Math.floor(16384 / device.viewport.deviceScaleFactor) / device.viewport.height) * device.viewport.height;

            if (captureHeight > clientHeight) {
                // this.logger.info("captureHeight calculated to be less than clientHeight");
                captureHeight = clientHeight;
            }

            let frameTop = 0;
            const screenshots = [];
            while (frameTop < clientHeight) {
                let frameHeight = captureHeight;
                if (frameTop + frameHeight > clientHeight) {
                    frameHeight = clientHeight - frameTop;
                }
                // console.log(url, "clientHeight", clientHeight, "captureHeight", captureHeight, "frameTop", frameTop, "frameHeight", frameHeight)
                const screenshot = page.screenshot({
                    format: 'png',
                    clip: {
                        x: 0,
                        y: frameTop,
                        width: device.viewport.width,
                        height: frameHeight,
                        scale: 1,
                    },
                });
                screenshots.push(screenshot);
                frameTop += frameHeight;
            }

            console.time(`screenshot ${url}`);
            const buffers = await Promise.all(screenshots);
            console.timeEnd(`screenshot ${url}`);

            await page.close();

            return buffers;
        },
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
                browserWSEndpoint: process.env.CHROME_WS_ENDPOINT,
            });
            this.logger.info("Connected to ", process.env.CHROME_WS_ENDPOINT);
        } else {
            this.browser = await puppeteer.launch({ args });
            this.logger.info("Chrome launched");
        }
        this.queue = async.queue(async (task) => this.capture(task), process.env.CHROME_TAB_LIMIT);
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