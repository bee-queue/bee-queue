--[[
key 1 -> bq:test:jobs
key 2 -> bq:test:waiting
key 3 -> bq:test:active
key 4 -> bq:test:succeeded
key 5 -> bq:test:failed
key 6 -> bq:test:delayed
key 7 -> bq:test:stalling

arg 1 -> jobId
]]

local rcall = redis.call
local jobId = ARGV[1]

rcall("hdel", KEYS[1], jobId)

-- if neither succeeded nor failed, must be either waiting or active
if (rcall("sismember", KEYS[4], jobId) + rcall("sismember", KEYS[5], jobId)) == 0 then
  rcall("lrem", KEYS[2], 0, jobId)
  rcall("lrem", KEYS[3], 0, jobId)
end

rcall("srem", KEYS[4], jobId)
rcall("srem", KEYS[5], jobId)
rcall("zrem", KEYS[6], jobId) -- zrem for delayed set
rcall("srem", KEYS[7], jobId)
