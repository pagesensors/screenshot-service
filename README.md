# page-storage

## Build Setup

``` bash
# Install dependencies
yarn install

# Start developing with REPL
yarn dev

# Start production
yarn start

# Run unit tests
yarn test

# Run continuous test mode
yarn ci
```

## Run in Docker

```
docker run -it --rm -w /service -v "$PWD:/service:delegated" -e CHROME_TAB_LIMIT=10 -e CHROME_FORCE_SCALE_FACTOR=1 buildkite/puppeteer yarn test
```