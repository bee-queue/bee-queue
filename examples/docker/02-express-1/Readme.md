# Simple Express example using Bee-Queue in Docker

This example uses a Bee-Queue worker to catenate two strings provided via a web-service API.

The code is taken directly from the [terminal-based Express example](file:../../express/README.md).

## Run it

The `./go.sh` script starts the example web server and bee-queue worker.

Once it's running, browse here:

- http://localhost:3000/run/2/3
- http://localhost:3000/run/Hello%20/World

Logged output shows the processing steps, with latency measures that include the Bee-Queue round trip.
Ctrl-C shuts it all down.

## Manifest

- web.js -- **Express server that gets an API request, submits a job, and returns job result**
- worker.js -- **Worker process that catenates the two strings in the job**

- Dockerfile -- Script used by Docker to build our image
- Readme.md -- Overview desciption
- docker-compose.yml -- Declarations for naming and running the three containers
- go.sh -- Script that uses docker-compose to build image and then run the containers
