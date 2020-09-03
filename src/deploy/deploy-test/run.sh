#!/bin/bash

set -e

cd $(dirname "$0")

docker build -t deploy-hmy . > /dev/null

docker run --rm deploy-hmy $@
