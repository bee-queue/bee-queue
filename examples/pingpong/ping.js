const Queue = require('../../');
const pingQueue = new Queue('ping');

const sendPing = async function () {
  const job = await pingQueue.createJob().save();
  console.log('created job, will remove after 1sec');

  setTimeout(() => {
    console.log('removing job');
    job.remove();
  }, 1000);
};

sendPing();
