FROM node:10.16.0-alpine

WORKDIR /test

COPY package.json /test/

RUN apk add git python build-base

RUN npm install

COPY testEthereumSend.js /test/

ENTRYPOINT ["node", "testEthereumSend.js"]
