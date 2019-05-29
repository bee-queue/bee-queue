'use strict'

const Queue = require('../../')

const pingQueue = new Queue('ping')
const pongQueue = new Queue('pong')

pongQueue.process(async function (job) {
  console.log(`Pong job received (ID: ${job.id})`)
})

const sendPing = async function () {
  await pingQueue.createJob().save()
  console.log('Created ping job')
}

setInterval(sendPing, 1000)
