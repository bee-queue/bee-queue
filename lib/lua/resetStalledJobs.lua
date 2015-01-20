-- keyprefix -> key prefix ("hlq:name:")
-- returns {jobId1, jobId2, ...}
local activeKey = ARGV[1] .. "active"
local actives = redis.call("lrange", activeKey, 0, -1)
local results = {}

for i, v in ipairs(actives) do
  -- if not locked (key "hlq:name:id:lock") then add to list
  if not redis.call("get", ARGV[1] .. v .. ":lock") then
    results[#results + 1] = v -- jobId
    -- can probably safely change this to -1 instead of 0
    -- theoretical speedup, probably insignificant
    -- maybe check that its not in completed to be safe from duplicates
    redis.call("lrem", activeKey, 0, v)
  end
end

redis.call("rpush", ARGV[1] .. "wait", unpack(results));

return results
