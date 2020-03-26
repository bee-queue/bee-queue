--[[
key 1 -> bq:name:id (most recently created job ID -- only purpose is for checkHealth() newestJob)
key 2 -> bq:name:jobs
key 3 -> bq:name:waiting
arg 1 -> job id
arg 2 -> job data
]]

local jobId = ARGV[1]
if redis.call("hexists", KEYS[2], jobId) == 1 then return end
redis.call("set", KEYS[1], jobId)
redis.call("hset", KEYS[2], jobId, ARGV[2])
redis.call("lpush", KEYS[3], jobId)
