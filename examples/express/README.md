# Express example

This app receives a request, enqueues a job, waits for its results, then returns the results in the response.

First run:

```
node worker.js
```

Then, with the worker running, run:

```
node web.js
```

Then visit [http://localhost:3000/run/2/3](http://localhost:3000/run/2/3)
