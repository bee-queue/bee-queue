--[[
key 1 -> bq:name:jobs
key 2 -> bq:name:delayed
key 3 -> bq:name:earlierDelayed
arg 1 -> job id
arg 2 -> job data
arg 3 -> job delay timestamp
]]

local jobId = ARGV[1]
if redis.call("hexists", KEYS[1], jobId) == 1 then return nil end
redis.call("hset", KEYS[1], jobId, ARGV[2])
redis.call("zadd", KEYS[2], tonumber(ARGV[3]), jobId)

-- if this job is the new head, alert the workers that they need to update their timers
-- if we try to do something tricky like checking the delta between this job and the next job, we
-- can enter a pathological case where jobs incrementally creep sooner, and each one never updates
-- the timers
local head = redis.call("zrange", KEYS[2], 0, 0)
if head[1] == jobId then
  redis.call("publish", KEYS[3], ARGV[3])
end

return jobId
