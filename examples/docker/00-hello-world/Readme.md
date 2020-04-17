# Hello World for Bee-Queue in Docker

This example is the "Hello World" for Bee-Queue running in Docker containers.

It is a minimalist example of running Bee-Queue a networked setting with client and worker running in different Node JS processes.
The main purpose of this example is to validate that your Docker framework is usable for the other examples.
As such the code for this example is about as terse as possible.
Once this example works, use the other Docker examples to learn about Bee-Queue.

For this example to work you need `bash` and you need an up-to-date Docker environment, including `docker` and `docker-compose`.
See:
* Getting started with [Docker](https://www.docker.com/get-started)
* Reference for [docker-compose](https://docs.docker.com/compose/compose-file/)
* Reference for [Dockerfile](https://docs.docker.com/engine/reference/builder/)

## Run it

Run `go.sh` and you should get more-or-less the output shown below:
* Version info for your `docker` and `docker-compose`
* Use of docker-compose to cleanup, build, and run the example
* Logs from docker-compose which include the greeting result line from the single job that gets run:
```
 client_1  | Hello World!
```

> Note: The first time you run `go.sh` it will take a while because Docker has to download resources into its local cache.

```
$ ./go.sh

Docker version 19.03.8, build afacb8b
docker-compose version 1.25.4, build 8d51620a

+ docker-compose down
+ docker-compose build --quiet
+ docker-compose up --abort-on-container-exit --timeout 3 --renew-anon-volumes
Creating network "00-hello-world_default" with the default driver
Creating 00-hello-world_worker_1 ... done
Creating 00-hello-world_client_1 ... done
Creating 00-hello-world_redis_1  ... done
Attaching to 00-hello-world_worker_1, 00-hello-world_client_1, 00-hello-world_redis_1
client_1  |
client_1  | Hello World!
client_1  |
00-hello-world_client_1 exited with code 0
Aborting on container exit...
Stopping 00-hello-world_redis_1  ... done
Stopping 00-hello-world_worker_1 ... done
+ set +x
```

If it doesn't work correctly you may need to install or upgrade your Docker environment and ensure that docker-compose is also installed.

## What's going on

Docker-compose builds a Node.js image which includes the Bee Queue package and our client and worker logic.
Then docker-compose is used to start three Docker containers (processes) on a virtual network.
* client -- a container (process) that submits one job to the queue, using `client.js` logic in the image we built
* worker -- a container that implements the logic to process the job, using `worker.js` logic in the image we built
* redis -- an ephemeral Redis server, using an image downloaded from Docker Hub

The client and worker containers use the Bee-Queue library.
The Bee-Queue library uses the Redis server to manage job persistence and lifecycle.

Docker-compose starts the containers, logs their output, and shuts them down when the client exits.

## Manifest
* Dockerfile -- Script used by Docker to build our image
* Readme.md -- Overview desciption
* client.js -- **Code for the client container,** copied into our image
* docker-compose.yml -- Declarations for naming and running the three containers
* go.sh -- Script that uses docker-compose to build image and then run the containers
* worker.js -- **Code for the worker container,** copied into our image
