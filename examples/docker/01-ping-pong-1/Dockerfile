FROM node:lts-alpine

# Minimalist image with bee-queue package and local JS files

WORKDIR /bee-queue-ping-pong-1

RUN npm init --name=bee-queue-ping-pong-1 --yes
RUN npm install bee-queue --no-package-lock --only prod

COPY *.js ./
