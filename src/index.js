/* eslint-disable no-underscore-dangle */
const async = require('async');
const puppeteer = require('puppeteer');
const NetworkIdle = require('./network-idle');

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
		 * @param {Object} device - image width
         */
        capture: {
            params: {
                url: { type: "url" },
                device: {
                    type: "object",
                    props: {
                        viewport: {
                            type: "object",
                            props: {
                                width: { type: "number", positive: true, integer: true },
                                height: { type: "number", positive: true, integer: true },
                                deviceScaleFactor: { type: "number", positive: true },
                                isMobile: { type: "boolean" },
                                hasTouch: { type: "boolean" },
                                isLandscape: { type: "boolean" },
                            },
                        },
                        userAgent: {
                            type: "string",
                        },
                    },
                },
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
        'screenshot-service.url.duplicate': {
            handler(...args) {
                this.logger.warn(args);
            },
        },
    },

	/**
	 * Methods
	 */
    methods: {
        timeEnd(t) {
            const tdiff = process.hrtime(t);
            return tdiff[0] * 1000 + tdiff[1] / 1000000;
        },
        async getClientHeight(page) {
            const metrics = await page._client.send('Page.getLayoutMetrics');
            return Math.ceil(metrics.contentSize.height);
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
            const { url, device } = params;
            const page = await this.browser.newPage();

            let t;

            if (process.env.CHROME_FORCE_DEVICE_SCALE_FACTOR) {
                device.viewport.deviceScaleFactor = parseInt(process.env.CHROME_FORCE_DEVICE_SCALE_FACTOR, 10);
            }

            await page._client.send('Animation.setPlaybackRate', { playbackRate: 1000 })
            await page.setViewport({ ...device.viewport, ...{ height: 0 } });
            await page.evaluateOnNewDocument((oneVh) => {
                window.__xxscrollTo = window.scrollTo;
                window.__xxrequestAnimationFrame = window.requestAnimationFrame;
            }, device.viewport.height * 0.01);

            t = process.hrtime();
            await page.goto(url, { waitUntil: 'load' });
            this.broker.emit(`metrics.${this.name}.goto`, this.timeEnd(t));

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
                            // console.error(rule);
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
                    // and report them for further exclusion from comparison
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

            // eslint-disable-next-line no-shadow
            networkIdle.on('url.duplicate', url => this.broker.emit(`${this.name}.url.duplicate`, url))

            const initialClientHeight = await this.upsize(page);

            t = process.hrtime();
            let networkTimedOut = false;
            try {
                await networkIdle.promise();
            } catch (err) {
                networkTimedOut = true;
                this.logger.warn(`networkIdle ${url} timed out:`, err);
                this.broker.emit(`metrics.${this.name}.extra-network-timed-out`, url);
            }
            this.broker.emit(`metrics.${this.name}.extra-network`, this.timeEnd(t));


            t = process.hrtime();
            let transitionsTimedOut = false;
            try {
                await allTransitionsEnded;
            } catch (err) {
                transitionsTimedOut = true;
                this.logger.warn(`transitions ${url} timed out:`, err);
                this.broker.emit(`metrics.${this.name}.transitions-timed-out`, url);
            }
            this.broker.emit(`metrics.${this.name}.transitions`, this.timeEnd(t));

            const clientHeight = await this.upsize(page, initialClientHeight);

            let captureHeight = Math.floor(Math.floor(16384 / device.viewport.deviceScaleFactor) / device.viewport.height) * device.viewport.height;

            if (captureHeight > clientHeight) {
                // this.logger.info("captureHeight calculated to be less than clientHeight");
                captureHeight = clientHeight;
            }

            let frameTop = 0;
            const screenshotPromises = [];
            while (frameTop < clientHeight) {
                let frameHeight = captureHeight;
                if (frameTop + frameHeight > clientHeight) {
                    frameHeight = clientHeight - frameTop;
                }
                const screenshotPromise = page.screenshot({
                    format: 'png',
                    clip: {
                        x: 0,
                        y: frameTop,
                        width: device.viewport.width,
                        height: frameHeight,
                        scale: 1,
                    },
                });
                screenshotPromises.push(screenshotPromise);
                frameTop += frameHeight;
            }

            const links = await page.evaluate(() => {
                // eslint-disable-next-line no-shadow
                const links = new Set();
                const { hostname } = window.location;
                Array.from(document.links).forEach((l) => {
                    // eslint-disable-next-line no-shadow
                    const url = new URL(l.href);
                    if (url.hostname.indexOf(hostname) !== -1) {
                        links.add(l.href);
                    }
                });
                return Array.from(links);
            });


            t = process.hrtime();
            const screenshots = await Promise.all(screenshotPromises);
            this.broker.emit(`metrics.${this.name}.screenshot`, this.timeEnd(t));

            await page.close();

            return {
                screenshots,
                links,
                networkTimedOut,
                transitionsTimedOut,
            };
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