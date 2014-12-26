var smpp = require('smpp');
var session = smpp.connect('127.0.0.1', 2775);

session.bind_transceiver({
    system_id: 'test',
    password: 'test'
}, function (pdu) {
    if (pdu.command_status === 0) {
        

        // Successfully bound
        session.submit_sm({
            destination_addr: 'SOME_NUMBER_HERE',
            short_message: 'Test',
            registered_delivery : 1
        }, function (pdu) {
            console.log(pdu);
            if (pdu.command_status === 0) {
                // Message successfully sent
                console.log(pdu.message_id);
            }
        });
        session.on('deliver_sm', function (pdu) {
            console.log (pdu);
        });


    }
});