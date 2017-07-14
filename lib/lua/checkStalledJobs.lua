--[[
key 1 -> bq:name:stallBlock
key 2 -> bq:name:stalling
key 3 -> bq:name:waiting
key 4 -> bq:name:active
arg 1 -> ms stallInterval

returns {resetJobId1, resetJobId2, ...}

workers are responsible for removing their jobId from the stalling set every stallInterval ms
if a jobId is not removed from the stalling set within a stallInterval window,
we assume the job has stalled and should be reset (moved from active back to waiting)
--]]

-- try to update the stallBlock key
if not redis.call("set", KEYS[1], "1", "PX", tonumber(ARGV[1]), "NX") then
  -- hasn't been long enough (stallInterval) since last check
  return {}
end

-- reset any stalling jobs by moving from active to waiting
local stalling, stalled = redis.call("smembers", KEYS[2]), {}
if next(stalling) ~= nil then
  -- not worth optimizing - this should be a rare occurrence, better to keep it straightforward
  local nextIndex = 1
  for i, jobId in ipairs(stalling) do
    local removed = redis.call("lrem", KEYS[4], 0, jobId)
    -- we only restart stalled jobs if we can find them in the active list - otherwise, the stalled
    -- lrem may have been delayed, or may not have run after the last checkStalledJobs call despite
    -- having ended. this can cause problems with static ids, and cause jobs to run again
    if removed > 0 then
      stalled[nextIndex] = jobId
      nextIndex = nextIndex + 1
    end
  end
  -- don't lpush zero jobs (the redis command will fail)
  if nextIndex > 1 then
    redis.call("lpush", KEYS[3], unpack(stalled))
  end
  redis.call("del", KEYS[2])
end

-- copy currently active jobs into stalling set
local actives = redis.call("lrange", KEYS[4], 0, -1)
if next(actives) ~= nil then
  redis.call("sadd", KEYS[2], unpack(actives))
end

return stalled
