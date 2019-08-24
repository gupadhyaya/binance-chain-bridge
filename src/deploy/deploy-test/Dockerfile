FROM node:10.16.0-alpine

WORKDIR /build

RUN apk add git python build-base

RUN npm install -g truffle
RUN npm install truffle-hdwallet-provider

RUN truffle obtain --solc 0.5.9

COPY truffle-config-build.js /build/truffle-config.js
COPY contracts/openzeppelin-solidity /build/contracts/openzeppelin-solidity

RUN truffle compile

COPY contracts /build/contracts

RUN truffle compile

COPY truffle-config.js /build/truffle-config.js
COPY migrations /build/migrations

ENTRYPOINT truffle deploy