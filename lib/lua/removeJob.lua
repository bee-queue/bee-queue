--[[
key 1 -> bq:test:succeeded
key 2 -> bq:test:failed
key 3 -> bq:test:waiting
key 4 -> bq:test:active
key 5 -> bq:test:stalling
key 6 -> bq:test:jobs
key 7 -> bq:test:delayed
arg 1 -> jobId
]]

local jobId = ARGV[1]

if (redis.call("sismember", KEYS[1], jobId) + redis.call("sismember", KEYS[2], jobId)) == 0 then
  redis.call("lrem", KEYS[3], 0, jobId)
  redis.call("lrem", KEYS[4], 0, jobId)
end

redis.call("srem", KEYS[1], jobId)
redis.call("srem", KEYS[2], jobId)
redis.call("srem", KEYS[5], jobId)
redis.call("hdel", KEYS[6], jobId)
redis.call("zrem", KEYS[7], jobId)
