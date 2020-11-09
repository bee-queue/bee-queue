
--[[
key 1 -> bq:name:active
key 2 -> bq:name:waiting
key 3 -> bq:name:stalling
key 4 -> bq:name:failed
key 5 -> bq:name:delayed
key 6 -> bq:name:earlierDelayed
key 7 -> bq:name:succeeded
key 8 -> bq:name:events
key 9 -> bq:name:jobs

arg 1 -> job id
arg 2 -> remove job?
arg 3 -> job data
arg 4 -> new job status
arg 5 -> delayed time
arg 6 -> job event data
--]]

-- If we don't find the job in the active list, ensure it hasn't been recently stalled
if not redis.call("lrem", KEYS[1], 0, ARGV[1]) then
  redis.call("lrem", KEYS[2], ARGV[1])
end

redis.call("srem", KEYS[3], ARGV[1])

if ARGV[2] ~= "" then -- remove?
  redis.call("hdel", KEYS[9], ARGV[1])
else
  redis.call("hset", KEYS[9], ARGV[1], ARGV[3])

  if ARGV[4] == "failed" then
    redis.call("sadd", KEYS[4], ARGV[1])
  elseif ARGV[4] == "succeeded" then
    redis.call("sadd", KEYS[7], ARGV[1])
  elseif ARGV[5] ~= "" then
    redis.call("zadd", KEYS[5], tonumber(ARGV[5]), ARGV[1])
    redis.call("publish", KEYS[6], tonumber(ARGV[5]))
  else
    redis.call("lpush", KEYS[2], ARGV[1])
  end
end

if ARGV[6] ~= "" then
  redis.call("publish", KEYS[8], ARGV[6]);
end
