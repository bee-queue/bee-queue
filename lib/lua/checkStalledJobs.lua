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
  for i, jobId in ipairs(stalling) do
    local removed = redis.call("lrem", KEYS[4], 0, jobId)
    -- safety belts: we only restart stalled jobs if we can find them in the active list
    -- the only place we add jobs to the stalling set is in this script, and the two places we
    -- remove jobs from the active list are in this script, and in the MULTI after the job finishes
    if removed > 0 then
      stalled[#stalled + 1] = jobId
    end
  end
  -- don't lpush zero jobs (the redis command will fail)
  if #stalled > 0 then
    -- lpush instead of rpush so that jobs which cause uncaught exceptions don't
    -- hog the job consumers and starve the whole system. not a great situation
    -- to be in, but this is fairer.
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
