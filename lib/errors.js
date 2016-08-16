'use strict';

class BeeQueueError extends Error {}
class JobNotFoundBeeQueueError extends BeeQueueError {}

module.exports  = {
	BeeQueueError: BeeQueueError,
	JobNotFoundBeeQueueError: JobNotFoundBeeQueueError
};
