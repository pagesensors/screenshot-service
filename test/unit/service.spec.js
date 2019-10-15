const { ServiceBroker } = require("moleculer");
const fs = require('fs');
const writeFileAsync = require('util').promisify(fs.writeFile);

const TestService = require("../../src");

jest.setTimeout(120000);

describe("Test 'screenshot-generator' service", () => {
    const broker = new ServiceBroker();
    broker.createService(TestService);

    beforeAll(() => broker.start());
    afterAll(() => broker.stop());

    describe("Test screenshot-generator.capture", () => {

/*
        it("invalid url", async () => {
            const promises = [];
            [
                'https://www,meltwater.com/',
            ].forEach((url) => {
                const p = broker.call("screenshot-generator.capture", {
                    url,
                    width: 800,
                });
                promises.push(p);
            })
            const result = await Promise.all(promises);
            result.forEach((r) => expect(r).toBeUndefined());
        });
*/

        it("should take a screenshot", async () => {
            const promises = [];
            [
                'https://www.meltwater.com/?ucs',
                'https://www.meltwater.com/uk/?ucs',
                'https://www.meltwater.com/fr/?ucs',
                'https://www.meltwater.com/sg/?ucs',
                'https://kibocommerce.com/',
                'https://www.namely.com/',
                'https://www.vts.com/',
                'https://bettsrecruiting.com/',
                'https://www.numo.global/',
                // 'https://jetasg.com/', 
                'https://initiative20x20.org/',
            ].forEach((url) => {
                const p = broker.call("screenshot-generator.capture", {
                    url,
                    width: 800,
                });
                promises.push(p);
            })
            const result = await Promise.all(promises);
            result.forEach(r => expect(r).toBeInstanceOf(Object));
            result.forEach(async (r, i) => {
                expect(r.screenshots).toBeInstanceOf(Array);
                expect(r.links).toBeInstanceOf(Array);
                expect(typeof r.networkTimedOut).toBe('boolean');
                expect(typeof r.transitionsTimedOut).toBe('boolean');

                r.screenshots.forEach(async (buffer, j) => {
                    expect(buffer).toBeInstanceOf(Buffer);
                    await writeFileAsync(`${i}-${j}.png`, buffer);
                });
            });
        });
    });
});
