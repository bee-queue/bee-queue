-- keyprefix -> key prefix ("hlq:name:")
-- returns {jobId1, jobId2, ..., jobData1, jobData2, ...}
local actives = redis.call("lrange", ARGV[1] .. 'active', 0, -1)
local dataKeys = {}
local results = {}

for i, v in ipairs(actives) do
  -- if not locked (key "hlq:name:id:lock") then add to list
  if not redis.call('get', ARGV[1] .. v .. ":lock") then
    results[#results + 1] = v -- jobId
    dataKeys[#dataKeys + 1] = ARGV[1] .. v
  end
end

-- then get all jobDatas and combine with jobIds
local dataVals = redis.call('mget', unpack(dataKeys))
for i = 1, #dataVals do
  results[#results + 1] = dataVals[i]
end

return results
