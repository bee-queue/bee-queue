-- keyprefix -> key prefix ("bq:name:")
-- returns {resetJobId1, resetJobId2, ...}
-- uses :stalling, :active, :wait

-- todo figure out a way to ensure this is time-interval-idempotent

local activeKey = ARGV[1] .. "active"
local stallingKey = ARGV[1] .. "stalling"
local stalling = redis.call("smembers", stallingKey)

if #stalling > 0 then
  redis.call("rpush", ARGV[1] .. "wait", unpack(stalling))
  for i = 1, #stalling do
    redis.call("lrem", activeKey, 0, stalling[i])
  end
end

redis.call("del", stallingKey)

local actives = redis.call("lrange", activeKey, 0, -1)
if #actives > 0 then
  redis.call("sadd", stallingKey, unpack(actives))
end

return stalling

--[[
if < stallTimeout milliseconds since last check, return

take everything in stalling
  add to wait
  remove from active

set stalling = active

renewLock procedure: remove id from stalling
]]
