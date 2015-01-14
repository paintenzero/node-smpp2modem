#!/bin/bash
sudo forever start -o modem1.log -e modem1-err.log --minUptime 15000 --spinSleepTime 5000 server.js --config modem1.ini
