FROM node:10.16.0-alpine

WORKDIR /watcher

RUN apk update && \
    apk add libssl1.1 libressl-dev curl

COPY ./hmyWatcher/package.json /watcher/

RUN apk add git python build-base

RUN npm install

COPY ./hmyWatcher/hmyWatcher.js ./shared/db.js ./shared/logger.js ./shared/amqp.js ./shared/crypto.js ./shared/wait.js /watcher/

ENTRYPOINT ["node", "hmyWatcher.js"]
