const Queue = require('../../');
const pingQueue = new Queue('ping');

const sendPing = async function () {
  const job = await pingQueue.createJob().save();
  console.log('created job, will remove after 1sec');
  let i = 0;

  const report = () => {
    if (i < 5) {
      console.log('report progress');
      job.reportProgress(i++);
      setTimeout(report, 1000);
    }
  };

  report();

  setTimeout(() => {
    console.log('removing job');
    job.remove();
  }, 5000);
};

sendPing();
