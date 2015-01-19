-- keyprefix -> key prefix ("hlq:name:")
local activeKey = ARGV[1] .. "active"
local actives = redis.call("lrange", activeKey, 0, -1)

for i = 1, #actives do
  actives[i] = prefix .. actives[i]
end
actives[#actives] = activeKey

redis.call("del", unpack(actives))
