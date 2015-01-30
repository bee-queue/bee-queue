--[[
key 1 -> bq:name:active
key 2 -> bq:name:jobs

unclear whether this script needs to keep existing
]]

local actives = redis.call("lrange", KEYS[1], 0, -1)

if #actives > 0 then
  redis.call("hdel", KEYS[2], unpack(actives))
end

redis.call("del", KEYS[1])
