# Ping-Pong for Bee-Queue in Docker

This example uses two queues whereby a job on the ping queue submits a job to the pong queue.
The code is taken directly from the [terminal-based ping-pong example](file:../../pingpong/README.md).

## Run it

The `./go.sh` script runs the example.
The `ping.js` process submits a ping job twice.
The `pong.js` process responds to each ping job by submitting a pong job.

Logged output shows the processing steps.

## Manifest

- Dockerfile -- Script used by Docker to build our image
- Readme.md -- Overview desciption
- ping.js -- **Code for the client container that creates the ping job, and implements worker for pong-queue**
- docker-compose.yml -- Declarations for naming and running the three containers
- go.sh -- Script that uses docker-compose to build image and then run the containers
- pong.js -- **Code implements the ping-queue worker, submits job to pong-queue**
