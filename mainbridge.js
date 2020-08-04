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

if (process.argv.length <3) {
    console.log("Configuration file is not found.");
    console.log("e.g: node mainbridge.js config.json");
    process.exit();
}

var config = {};
try {
    config = JSON.parse(require("fs").readFileSync(process.argv[2]));
} catch (e) {
    console.log(e);
}
// correct config must have at least mps object defined
if (config.mps === undefined) {
    console.log("Invalid configuration file. Missing MPS settings.")
    process.exit();
}

if (config.clients === undefined || config.clients === {}) {
    console.log("No clients, exitting");
    process.exit();
}

// preparing args template
var args = {
    mpshost: config.mps.mpshost,
    mpsport: config.mps.mpsport,
    mpsuser: config.mps.mpsuser,
    mpspass: config.mps.mpspass,
    mpskeepalive: config.mps.mpskeepalive
};

if (config.proxy && config.proxy !=null) {
    if (config.proxy.proxytype) { args.proxytype = config.proxy.proxytype; }
    if (config.proxy.proxyhost) { args.proxyhost = config.proxy.proxyhost; }
    if (config.proxy.proxyport) { args.proxyport = config.proxy.proxyport; }
}

for (i=0; i<config.clients.length; i++) {
    args.clientname = config.clients[i].clientname;
    args.clientaddress = config.clients[i].clientaddress;
    args.clientuuid = config.clients[i].clientuuid;
    if (config.clients[i].tlsupgrade) {
        args.tlsupgrade = config.clients[i].tlsupgrade;
    } else {
        delete args.tlsupgrade;
    }
    obj.ciraclients[0] = require('./ciraclient.js').CreateCiraClient(obj, args);
    obj.ciraclients[0].connect();
}


