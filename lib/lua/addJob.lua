-- prefix ("bq:name:") -> jobData (JSON string)
local prefix = KEYS[1]
local jobData = ARGV[1]

local jobId = redis.call("incr", prefix .. "id")
redis.call("set", prefix .. jobId, jobData)
redis.call("lpush", prefix .. "wait", jobId)

return jobId
