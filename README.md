# page-storage

## Build Setup

``` bash
# Install dependencies
npm install
```

## Run in Docker

```
docker run -it --rm -w /service -v "$PWD:/service:delegated" -e CHROME_TAB_LIMIT=10 -e CHROME_FORCE_DEVICE_SCALE_FACTOR=1 buildkite/puppeteer npm test
```


## Compare two sites (eg prod vs staging)

```
docker run -it --rm -w /service -v "$PWD:/service:delegated" -e CHROME_TAB_LIMIT=10 -e CHROME_FORCE_DEVICE_SCALE_FACTOR=1 buildkite/puppeteer nodejs compare.js --exclude "^http://" --exclude "gnk=job" --exclude "blog\/p\d+$" --exclude "blog\/topic" --device "Pixel 2" --rewrite "s#^http://#https://#" --from https://staging.example.com/ --to https://example.com --limit 1
```