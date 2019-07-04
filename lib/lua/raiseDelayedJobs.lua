--[[
key 1 -> bq:name:delayed
key 2 -> bq:name:waiting
arg 1 -> ms timestamp ("now")
arg 2 -> debounce window (in milliseconds)

returns number of jobs raised and the timestamp of the next job (within the near-term window)
--]]

local now = tonumber(ARGV[1])

-- raise any delayed jobs that are now valid by moving from delayed to waiting
local raising = redis.call("zrangebyscore", KEYS[1], 0, ARGV[1])
local numRaising = #raising

if numRaising > 0 then
  -- re-add recurring jobs for next cycle
  for _, raise in ipairs(raising) do
    if string.sub(raise, 1, 2) == "r:" then
      local interval = string.gmatch(raise, ":([0-9]+):")()
      local nextTime = interval + tonumber(redis.call("zscore", KEYS[1], raise))
      while nextTime < now do
        nextTime = nextTime + interval
      end

      redis.call("zadd", KEYS[1], nextTime, raise)

      local head = redis.call("zrange", KEYS[1], 0, 0)
      if head[1] == raise then
        redis.call("publish", string.sub(KEYS[1], 1, -8).."earlierDelayed", nextTime)
      end
    end
  end
  redis.call("lpush", KEYS[2], unpack(raising))
  redis.call("zremrangebyscore", KEYS[1], 0, ARGV[1])
end

local head = redis.call("zrange", KEYS[1], 0, 0, "WITHSCORES")
local nearTerm = -1
if next(head) ~= nil then
  local proximal = redis.call("zrevrangebyscore", KEYS[1], head[2] + tonumber(ARGV[2]), 0, "WITHSCORES", "LIMIT", 0, 1)
  nearTerm = proximal[2]
end

return {numRaising, nearTerm}
