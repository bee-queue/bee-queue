-- jobId -> key prefix ("hlq:name:")
local jobId = KEYS[1]
local prefix = ARGV[1]
local succeededKey = prefix .. 'succeeded'
local failedKey = prefix .. 'failed'

if (redis.call("sismember", succeededKey, jobId) + redis.call("sismember", failedKey, jobId)) == 0 then
  redis.call("lrem", prefix .. 'wait', 0, jobId)
  redis.call("lrem", prefix .. 'active', 0, jobId)
end

redis.call("srem", succeededKey, jobId)
redis.call("srem", failedKey, jobId)
redis.call("hdel", prefix .. "jobs", jobId)
