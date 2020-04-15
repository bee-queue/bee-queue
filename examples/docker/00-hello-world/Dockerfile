FROM node:lts-alpine

# Minimalist image with bee-queue package and local JS files

WORKDIR /bee-queue-hello-world

RUN npm init --name=bee-queue-hello-world --yes
RUN npm install bee-queue --no-package-lock --only prod

COPY *.js ./
