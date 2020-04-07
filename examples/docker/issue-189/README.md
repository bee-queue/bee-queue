# Reproducible Issue 189

Minimalist project that demonstrates a bee-queue Queue losing track of jobs. See https://github.com/bee-queue/bee-queue/issues/189

The demo uses docker-compose to run a Redis server (holds state of all jobs), a bee-queue client (creates jobs), and several bee-queue workers (processes jobs).
Every 3 seconds it logs statistics about the number of jobs that have run.
The counts for two callbacks that should be the same will diverge, and the loss percentage is calculated.

## Run

You need Docker and docker-compose installed.

The following docker-compose command builds a simple Docker image and then runs the container configuration in docker-compose.yml.
It runs one Redis server and onc client process (Node JS).
It scales to run 6 worker processes (Node JS).

```bash
$ docker-compose up --build --scale worker=6

 ... a bunch of Docker build and docker-compose startup...
 ... (be patient the first time as Docker populates its caches)
 ... then the periodic logs

client_1  | {"numJobSaveSuccess":3588,"numJobSaveError":0,"numQueueSucceeded":3586,"numQueueFailed":0,"numJobSucceeded":3461,"throughput":"1195","numSucceededLost":125,"succededLossPercent":"3.5"}
client_1  | {"numJobSaveSuccess":9154,"numJobSaveError":0,"numQueueSucceeded":9155,"numQueueFailed":0,"numJobSucceeded":8901,"throughput":"1526","numSucceededLost":254,"succededLossPercent":"2.8"}
client_1  | {"numJobSaveSuccess":16538,"numJobSaveError":0,"numQueueSucceeded":16544,"numQueueFailed":0,"numJobSucceeded":16180,"throughput":"1838","numSucceededLost":364,"succededLossPercent":"2.2"}
client_1  | {"numJobSaveSuccess":24535,"numJobSaveError":0,"numQueueSucceeded":24532,"numQueueFailed":0,"numJobSucceeded":24017,"throughput":"2044","numSucceededLost":515,"succededLossPercent":"2.1"}
client_1  | {"numJobSaveSuccess":32370,"numJobSaveError":0,"numQueueSucceeded":32368,"numQueueFailed":0,"numJobSucceeded":31636,"throughput":"2158","numSucceededLost":732,"succededLossPercent":"2.3"}
```

## The stats

* numJobSaveSuccess -- number of jobs successfully saved by the client Queue
* numJobSaveError -- number of jobs with errors while trying to save, should be zero
* numQueueSucceeded -- reliable number of jobs successfully run
* numQueueFailed -- reliable number of jobs that threw an error while running, should be zero
* numJobSucceeded -- unreliable number of jobs successfully run, undercounts due to a race condition
* throughput -- average of (numQueueSucceeded + numQueueFailed) per second, since start
* numSucceededLost -- number of lost jobs, (numQueueSucceeded - numJobSucceeded)
* succededLossPercent -- percentage jobs that have been lost, since start

## The leak

If you run the following in another shell, you will see the slow growth of memory (VSZ) used by the client:
```bash
$ docker exec -it issue-189_client_1 top
```

## Tinker

The race condition involves a job getting run immediately after it has been entered into Redis, before the Queue that submitted it has registered it.
The queue thus fails to pass on the succeeded event callback.

You need several workers so that there is often one ready to run the job immediately after it gets into Redis (scale worker).
Workers need to be able to keep busy while asynchronous stuff is happening (concurrency).
You need enough recurring jobs that you get decent statistics (numChains).

You can change the worker scaling in the docker-compose command.
More workers means more likelihood of jobs being lost due to the race, but throughput eventually suffers.
In `config.js`:
* concurrency -- number of "simultaneous" jobs a worker process will run
* numChains -- number of separate, recurrent job chains to start

## Code

* Dockerfile -- builds a Docker image with bee-queue library and the *.js files
* client.js -- code for the client, the interesting stuff
* config.js -- some parameters
* docker-compose.yml -- declarative specification for the Docker containers
* worker.js -- code for the workers
