--[[
key 1 -> bq:name:stallTime
key 2 -> bq:name:stalling
key 3 -> bq:name:waiting
key 4 -> bq:name:active
arg 1 -> ms timestamp ("now")
arg 2 -> ms stallInterval

returns {resetJobId1, resetJobId2, ...}

workers are responsible for removing their jobId from the stalling set every stallInterval ms
if a jobId is not removed from the stalling set within a stallInterval window,
we assume the job has stalled and should be reset (moved from active back to waiting)
--]]

local now = tonumber(ARGV[1])
local stallTime = tonumber(redis.call("get", KEYS[1]) or 0)

if now < stallTime then
  -- hasn't been long enough (stallInterval) since last check
  return {}
end

-- reset any stalling jobs by moving from active to waiting
local stalling = redis.call("smembers", KEYS[2])
if next(stalling) ~= nil then
  redis.call("rpush", KEYS[3], unpack(stalling))
  -- not worth optimizing - this should be a rare occurrence, better to keep it straightforward
  for i, jobId in ipairs(stalling) do
    redis.call("lrem", KEYS[4], 0, jobId)
  end
  redis.call("del", KEYS[2])
end

-- copy currently active jobs into stalling set
local actives = redis.call("lrange", KEYS[4], 0, -1)
if next(actives) ~= nil then
  redis.call("sadd", KEYS[2], unpack(actives))
end

redis.call("set", KEYS[1], now + ARGV[2])

return stalling
