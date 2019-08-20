const { EventEmitter } = require('events');

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
                if (Date.now() - self.lastNetworkRequest >= self.networkIdle0) {
                    clearInterval(interval);
                    clearTimeout(timeout);
                    resolve();
                }
            }, 100);
            timeout = setTimeout(() => {
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
            this.emit('url.duplicate', key);
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

module.exports = NetworkIdle;