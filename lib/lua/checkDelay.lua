--[[
key 1 -> bq:name:schedulelock
key 2 -> bq:name:schedule
key 3 -> bq:name:waiting
arg 1 -> process id (e.g: ip+pid+random number)
arg 2 -> maxscore (current time, e.g: 1453195007000)
]]
local count = 0 
redis.call("set", KEYS[1], ARGV[1], "EX", 2, "NX") 
if redis.call("get", KEYS[1]) == ARGV[1] then 
	local delays = redis.call("zrangebyscore", KEYS[2], 0, ARGV[2], "limit", 0, 1000) 
	for i= 1, #delays do 
		redis.call("rpush", KEYS[3], delays[i]) 
		redis.call("zrem", KEYS[2], delays[i]) 
	end 
	count = #delays
end 
return count