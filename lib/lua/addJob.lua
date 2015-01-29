-- key 1 -> job ID ("bq:name:id")
-- key 1 -> jobs ("bq:name:jobs")
-- key 2 -> wait ("bq:name:wait")
-- arg 1 -> job data

local jobId = redis.call("incr", KEYS[1])
redis.call("hset", KEYS[2], jobId, ARGV[1])
redis.call("lpush", KEYS[3], jobId)

return jobId
