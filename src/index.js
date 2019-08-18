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
            '--no-first-run',
            '--no-default-browser-check',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
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

            let seen = {};
            let inflight = 0;

            page.on('request', request => {
                if (request.url().match(/\b(data:image\/(png|gif)|data:application\/x-font|newrelic\.com|google-analytics\.com|driftt\.com|drift\.com|optimizely\.com|engagio\.com|adroll\.com|bizographics\.com|googleadservices\.com|hotjar\.com|opmnstr\.com|ads\.linkedin\.com|dialogtech\.com)/)) {
                    // still triggers requestfailed
                    request.abort();
                } else {
                    if (!request.url().match(/(vts\.com|namely\.com|bettsrecruiting\.com|meltwater\.com|jetasg\.com|numo\.global|kibocommerce\.com|initiative20x20\.org)/)) {
                        // console.log(request.url());
                    }
                    seen[request.url()] = true;
                    inflight += 1;
                    request.continue();
                }
            })

            page.on('requestfinished', request => {
                if (!seen[request.url()])
                    return;

                inflight -= 1;
            })

            page.on('requestfailed', request => {
                if (!seen[request.url()])
                    return;

                const response = request.response();
                if (response) {
                    // console.error(request.url(), response.status());
                }
                inflight -= 1;
            });

            await page.setRequestInterception(true);
            try {
                await page.goto(url, { waitUntil: 'load' });
            } catch (err) {
                this.logger.error(url, err);
                return [Buffer.from('')];
            }

            const buffers = [];

            // page.on('console', (m) => console.log(m.text()));
            console.time("evaluate " + url);
            const allTransitionsEnded = page.evaluate((oneVh, transitionsTimeout) => {
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
                        elem.addEventListener("transitionstart", () => idle = 0);
                        elem.addEventListener("transitionend", () =>  idle = 0);
                        elem.addEventListener("animationstart", () => idle = 0);
                        elem.addEventListener("animationend", () =>  idle = 0);
                    });
                    let interval = setInterval(() => {
                        if (++idle === 5) {
                            clearInterval(interval);
                            resolve();
                        }
                        // console.log(`${location}: idle: ${idle}, transitions ${transitions}`);
                    }, 1000);
                    setTimeout(() => {
                        clearInterval(interval);
                        reject();
                    }, transitionsTimeout);
                });

            }, device.viewport.height * 0.01, 20000);
            // console.timeEnd("evaluate " + url);

            // console.time("upsize 1 " + url);
            let initialClientHeight = await this.upsize(page);
            // console.timeEnd("upsize 1 " + url);

            console.time("transitions " + url);
            try {
                const reason = await allTransitionsEnded;
                console.log(`transitions ${url}: ${reason}`);
            } catch (e) {
                console.log(`transitions ${url} timed out`);
            }
            console.timeEnd("transitions " + url);


            const sleep = (timeout) => new Promise(resolve => setTimeout(resolve, timeout))

            let j = 200; // 20 sec
            let idle = 0;
            console.time("extra network " + url);
            while (idle <= 5 && j > 0) {
                while (inflight > 0 && j-- > 0) {
                    idle = 0;
                    await sleep(100);
                }
                idle++;
            }
            // console.timeEnd("extra network " + url, idle);


            let clientHeight = await this.upsize(page, initialClientHeight);

            let captureHeight = Math.floor(Math.floor(16384 / device.viewport.deviceScaleFactor) / device.viewport.height) * device.viewport.height;
            // console.log(device.viewport.deviceScaleFactor, Math.floor(16384 / device.viewport.deviceScaleFactor), Math.floor(Math.floor(16384 / device.viewport.deviceScaleFactor) / device.viewport.height), captureHeight);

            if (captureHeight > clientHeight) {
                this.logger.info("captureHeight calculated to be less than clientHeight");
                captureHeight = clientHeight;
            }

            let frameTop = 0;
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
            /*
            const buffer = await this.pscreenshot(page, {
                format: 'png',
                fullPage: true
            });
            */
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