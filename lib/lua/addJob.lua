--[[
key 1 -> bq:name:jobs
key 2 -> bq:name:waiting
arg 1 -> job id
arg 2 -> job data
]]

local jobId = ARGV[1]
if redis.call("hexists", KEYS[1], jobId) == 1 then return end
redis.call("hset", KEYS[1], jobId, ARGV[2])
redis.call("lpush", KEYS[2], jobId)
