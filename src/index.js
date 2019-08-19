const async = require('async');
const devices = require('puppeteer/DeviceDescriptors');
const puppeteer = require('puppeteer');
const EventEmitter = require('events')

class NetworkIdle extends EventEmitter {

    construct(page, networkIdle0, networkTimeout) {
        this.seen = {};
        this.lastNetworkRequest = null;
    }
    promise() {
        const self = this;

        if (this.promise)
            return this.promise;

        return this.promise = new Promise((resolve, reject) => {
            page.on('request', request => this.registerView(request.url()));
            page.on('requestfinished', request => this.unregisterView(request.url()));
            page.on('requestfailed', request => this.unregisterView(request.url()));
            page.setRequestInterception(true).then(() => {
                let interval = setInterval(() => {
                    if (Date.now() - self.lastNetworkRequest >= networkIdle0) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 100);
                setTimeout(() => {
                    clearInterval(interval);
                    if (this.inflight()) {
                        reject();
                    } else {
                        resolve();
                    }
                }, networkTimeout);
            }, (err) => reject(err));
        });

    }
    url(url) {
        const parsed = new URL(url);
        return `${parsed.host}${parsed.pathname}`;
    }
    registerView(url) {
        // if (url.match(/\b(data:image\/(png|gif)|data:application\/x-font|newrelic\.com|google-analytics\.com|driftt\.com|drift\.com|optimizely\.com|engagio\.com|adroll\.com|bizographics\.com|googleadservices\.com|hotjar\.com|opmnstr\.com|ads\.linkedin\.com|dialogtech\.com)/gi)) {
        //     return request.abort();
        // }

        const key = this.url();
        if (!this.urlSeen(url)) {
            this.seen[key] = this.seen[key] ? this.seen[key] + 1 : 1;
            request.continue();
        } else {
            // aborting duplicate requests to the same url
            this.emit('duplicate.url.request', url);
            this.seen[key] = this.seen[key] ? this.seen[key] + 1 : 1;
            request.abort();
        }
        this.lastNetworkRequest = Date.now();
    }
    unregisterView(url) {
        const key = this.url();
        if (!urlSeen(url))
            return;

        seen[key] -= 1;
        this.lastNetworkRequest = Date.now();
    }
    urlSeen(url) {
        return seen[this.url(url)];
    }
    inflight() {
        return Object.keys(this.seen).filter((key) => seen[key]);
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
        'duplicate.url.request': {
            handler(...args) {
                console.log(args)
            }
        }
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
                device.viewport.deviceScaleFactor = parseInt(process.env.CHROME_FORCE_DEVICE_SCALE_FACTOR);
            }
            await page._client.send('Animation.setPlaybackRate', { playbackRate: 1000 })
            await page.setViewport({ ...device.viewport, ...{ height: 0 } });
            await page.evaluateOnNewDocument((oneVh) => {
                window.__xxscrollTo = window.scrollTo;
                window.__xxrequestAnimationFrame = window.requestAnimationFrame;
            }, device.viewport.height * 0.01);

            // try {
                await page.goto(url, { waitUntil: 'load' });
            // } catch (err) {
            //     this.logger.error(url, err);
            //     return [Buffer.from('')];
            // }

            const buffers = [];

            const allTransitionsEnded = page.evaluate((oneVh, transitionsIdle0, transitionsTimeout) => {
                return new Promise((resolve, reject) => {
                    const stack = Array.from(document.styleSheets);
                    while (stack.length) {
                        let rule = stack.pop();
                        try {
                            if (rule.cssRules) {
                                stack.push(...rule.cssRules);
                            } else if (rule instanceof CSSStyleRule && rule.style.cssText.match(/\b([\d\.]+)vh/i)) {
                                rule.style.cssText = rule.style.cssText.replace(/(?:\b)([\d\.]+)vh/gi, (match, vh) => (oneVh * vh) + 'px');
                            }
                        } catch (err) {
                            console.error(rule);
                        }
                    }

                    let idle = 0;

                    // Array.from(document.getElementsByTagName('*')).forEach((elem) => {
                    [document.body].forEach((elem) => {
                        elem.addEventListener("transitionstart", () => setTimeout(() => idle = 0, 100));
                        elem.addEventListener("transitionend", () => setTimeout(() => idle = 0, 100));
                        elem.addEventListener("animationstart", () => setTimeout(() => idle = 0, 100));
                        elem.addEventListener("animationend", () => setTimeout(() => idle = 0, 100));
                    });
                    // it is possible to detect repeatedly changed elements
                    let interval = setInterval(() => {
                        if (++idle === Math.round(transitionsIdle0 / 100)) {
                            clearInterval(interval);
                            resolve();
                        }
                    }, 100);
                    setTimeout(() => {
                        clearInterval(interval);
                        reject();
                    }, transitionsTimeout);
                });

            }, device.viewport.height * 0.01, 5000, 20000);
            // console.timeEnd("evaluate " + url);

            // setting up network tracking before resizing page,
            // because resize might trigger new network requests
            console.time("extra network " + url);
            const networkIdle = new NetworkIdle(page, 5000, 20000);
            networkIdle.on('duplicate.url.request', (e) => {
                console.log(e);
                this.broker.emit(e)
            });

            const initialClientHeight = await this.upsize(page);
            try {
                await networkIdle.promise();
            } catch (e) {
                console.log(`networkIdle ${url} timed out`);
            }
            console.timeEnd("extra network " + url);

            console.time("transitions " + url);
            try {
                const reason = await allTransitionsEnded;
                // console.log(`transitions ${url} done`);
            } catch (e) {
                console.log(`transitions ${url} timed out`);
            }
            console.timeEnd("transitions " + url);

            const clientHeight = await this.upsize(page, initialClientHeight);

            let captureHeight = Math.floor(Math.floor(16384 / device.viewport.deviceScaleFactor) / device.viewport.height) * device.viewport.height;

            if (captureHeight > clientHeight) {
                // this.logger.info("captureHeight calculated to be less than clientHeight");
                captureHeight = clientHeight;
            }

            let frameTop = 0;
            console.time("screenshot " + url);
            while (frameTop < clientHeight) {
                let frameHeight = captureHeight;
                if (frameTop + frameHeight > clientHeight) {
                    frameHeight = clientHeight - frameTop;
                }
                // console.log(url, "clientHeight", clientHeight, "captureHeight", captureHeight, "frameTop", frameTop, "frameHeight", frameHeight)
                const buffer = await page.screenshot({
                    format: 'png',
                    clip: {
                        x: 0,
                        y: frameTop,
                        width: device.viewport.width,
                        height: frameHeight,
                        scale: 1
                    }
                });
                buffers.push(buffer);
                frameTop += frameHeight;
            }
            console.timeEnd("screenshot " + url);

            // buffers.push(buffer);
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