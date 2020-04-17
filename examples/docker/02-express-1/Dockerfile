FROM node:lts-alpine

# Minimalist image with bee-queue package and local JS files

WORKDIR /bee-queue-express-1

RUN npm init --name=bee-queue-express-1 --yes
RUN npm install bee-queue morgan express --no-package-lock --only prod

COPY *.js ./
