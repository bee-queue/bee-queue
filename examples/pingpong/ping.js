const Queue = require('../../');
const pingQueue = new Queue('ping');

const sendPing = async function () {
  const job = await pingQueue.createJob().save();
  console.log('created job, will remove after 1sec');
  let i = 0;

  setInterval(() => {
    job.reportProgress(i++);
  }, 1000);

  setTimeout(() => {
    console.log('removing job');
    job.remove();
  }, 5000);
};

sendPing();
