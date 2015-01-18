var smpp = require('smpp');
var rufus = require('rufus');
var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');

var states = {};
var range = [2775, 2779];

//Configuration examples: https://github.com/andris9/nodemailer-smtp-transport#usage
var transporter = nodemailer.createTransport({ 
	service: '',
	auth: {
	    user: '',
	    pass: ''
	}
});


function checkPort(p) {
	var session = smpp.connect('127.0.0.1', p);

	session.bind_transceiver({
	    system_id: 'test',
	    password: 'test'
	}, function (pdu) {
	    if (pdu.command_status === 0) {

			var TO = setTimeout (function () {
				setState(p, 'TIMEOUT');
			}, 20000);
		// Successfully bound
		/*session.submit_sm({
		    destination_addr: '79233280780',
		    short_message: 'Test',
		    registered_delivery : 1
		}, function (pdu) {
		    console.log(pdu);
		    if (pdu.command_status === 0) {
			// Message successfully sent
			console.log(pdu.message_id);
		    }
		});*/
			session.on('deliver_sm', function (pdu) {
				if(pdu.service_type === 'SYS') {
					clearTimeout(TO);
				    rufus.info('port %d:', p, pdu.short_message.message);
					setState(p, pdu.short_message.message);
				}
			});


	    }
	});
	session.on('error', function (err) {
		rufus.error('%d error: %s', p, err.message);
		setState(p, err.message);
	});
}

function setState (port, state) {
	states[port] = state;
	for (var i = range[0]; i <= range[1]; ++i) {
		if (!states[i]) {
			return;
		}
	}
	sendStates();
}

function sendStates() {
	// create reusable transporter object using SMTP transport
	
	var text = '';
	for (var k in states) {
		text += k + ': ' + states[k] + "\r\n";
	}
	transporter.sendMail({
	    from: '',
	    to: '',
	    subject: 'SMPP states',
	    text: text
	}, function () {
		process.exit();
	});
	rufus.info('States: %s', JSON.stringify(states));
}

for (var i = range[0]; i <= range[1]; ++i) {
	checkPort(i);
}
