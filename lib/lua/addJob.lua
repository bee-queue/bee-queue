--[[
key 1 -> bq:name:id (job counter)
key 2 -> bq:name:jobs
key 3 -> bq:name:waiting
arg 1 -> job id
arg 2 -> job data
]]

local jobId = ARGV[1]
if redis.call("hexists", KEYS[2], jobId) == 1 then return end
if KEYS[1] then redis.call("incr", KEYS[1]) end
redis.call("hset", KEYS[2], jobId, ARGV[2])
redis.call("lpush", KEYS[3], jobId)
