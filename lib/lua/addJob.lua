--[[
key 1 -> bq:name:id (job ID counter)
key 2 -> bq:name:jobs
key 3 -> bq:name:waiting
arg 1 -> job data
]]

local jobId = redis.call("incr", KEYS[1])
redis.call("hset", KEYS[2], jobId, ARGV[1])
redis.call("lpush", KEYS[3], jobId)

return jobId
