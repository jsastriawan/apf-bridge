/**
* @description APF/CIRA Example bridge
* @author Joko Sastriawan 
* @copyright Intel Corporation 2019
* @license Apache-2.0
* @version v0.0.1
*/

var obj = {
    debug: true,
    ciraclients: []
};

var args_template = {
    host: "meshcentral.com",//MPS host
    port: 4433,//MPS port
    clientName: 'std-mgblt', // host name, friendly name
    target_address: '192.168.0.155', //IP address or FQDN or relayed machine
    uuid: "12345678-9abc-def1-2345-123456789000",//GUID of relayed machine
    username: 'X0Jwl0BqqAAd0XJX', // mps username, device group id/meshid
    password: 'P@ssw0rd', // mps password
    keepalive: 60000 // interval for keepalive ping
};


obj.ciraclients[0] = require('./ciraclient.js').CreateCiraClient(obj, args_template);

obj.ciraclients[0].connect();

