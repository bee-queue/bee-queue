FROM node:lts-alpine

# Minimalist image with bee-queue library and local JS files

WORKDIR /issue-189

RUN npm init --yes
COPY bee-queue /issue-189/bee-queue
RUN npm install ./bee-queue --no-package-lock --only prod

COPY *.js /issue-189/
