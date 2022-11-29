/**
* @description APF/CIRA Client
* @author Joko Sastriawan 
* @copyright Intel Corporation 2019
* @license Apache-2.0
* @version v0.0.1
*/

module.exports.CreateCiraClient = function (parent, args) {
    var obj = {};
    obj.parent = parent;
    obj.args = args;
    obj.tls = require('tls');
    obj.common = require('./common.js');
    obj.constants = require('constants');
    obj.net = require('net');
    obj.forwardClient = null;
    obj.downlinks = {};
    obj.pfwd_idx = 0;
    obj.keepalive = obj.args.mpskeepalive
    // keep alive timer
    obj.timer = null;

    function Debug(str) {
        if (obj.parent.debug) {
            console.log(str);
        }
    }
    // CIRA state     
    var CIRASTATE = {
        INITIAL: 0,
        PROTOCOL_VERSION_SENT: 1,
        AUTH_SERVICE_REQUEST_SENT: 2,
        AUTH_REQUEST_SENT: 3,
        PFWD_SERVICE_REQUEST_SENT: 4,
        GLOBAL_REQUEST_SENT: 5,
        FAILED: -1
    }
    obj.cirastate = CIRASTATE.INITIAL;

    // REDIR state
    var REDIR_TYPE = {
        REDIR_UNKNOWN: 0,
        REDIR_SOL: 1,
        REDIR_KVM: 2,
        REDIR_IDER: 3
    }

    // redirection start command
    obj.RedirectStartSol = String.fromCharCode(0x10, 0x00, 0x00, 0x00, 0x53, 0x4F, 0x4C, 0x20);
    obj.RedirectStartKvm = String.fromCharCode(0x10, 0x01, 0x00, 0x00, 0x4b, 0x56, 0x4d, 0x52);
    obj.RedirectStartIder = String.fromCharCode(0x10, 0x00, 0x00, 0x00, 0x49, 0x44, 0x45, 0x52);


    // AMT forwarded port list for non-TLS mode
    var pfwd_ports = [16992, 16993, 623, 16994, 16995, 5900];
    // protocol definitions
    var APFProtocol = {
        UNKNOWN: 0,
        DISCONNECT: 1,
        SERVICE_REQUEST: 5,
        SERVICE_ACCEPT: 6,
        USERAUTH_REQUEST: 50,
        USERAUTH_FAILURE: 51,
        USERAUTH_SUCCESS: 52,
        GLOBAL_REQUEST: 80,
        REQUEST_SUCCESS: 81,
        REQUEST_FAILURE: 82,
        CHANNEL_OPEN: 90,
        CHANNEL_OPEN_CONFIRMATION: 91,
        CHANNEL_OPEN_FAILURE: 92,
        CHANNEL_WINDOW_ADJUST: 93,
        CHANNEL_DATA: 94,
        CHANNEL_CLOSE: 97,
        PROTOCOLVERSION: 192,
        KEEPALIVE_REQUEST: 208,
        KEEPALIVE_REPLY: 209,
        KEEPALIVE_OPTIONS_REQUEST: 210,
        KEEPALIVE_OPTIONS_REPLY: 211
    }

    var APFDisconnectCode = {
        HOST_NOT_ALLOWED_TO_CONNECT: 1,
        PROTOCOL_ERROR: 2,
        KEY_EXCHANGE_FAILED: 3,
        RESERVED: 4,
        MAC_ERROR: 5,
        COMPRESSION_ERROR: 6,
        SERVICE_NOT_AVAILABLE: 7,
        PROTOCOL_VERSION_NOT_SUPPORTED: 8,
        HOST_KEY_NOT_VERIFIABLE: 9,
        CONNECTION_LOST: 10,
        BY_APPLICATION: 11,
        TOO_MANY_CONNECTIONS: 12,
        AUTH_CANCELLED_BY_USER: 13,
        NO_MORE_AUTH_METHODS_AVAILABLE: 14,
        INVALID_CREDENTIALS: 15,
        CONNECTION_TIMED_OUT: 16,
        BY_POLICY: 17,
        TEMPORARILY_UNAVAILABLE: 18
    }

    var APFChannelOpenFailCodes = {
        ADMINISTRATIVELY_PROHIBITED: 1,
        CONNECT_FAILED: 2,
        UNKNOWN_CHANNEL_TYPE: 3,
        RESOURCE_SHORTAGE: 4,
    }

    var APFChannelOpenFailureReasonCode = {
        AdministrativelyProhibited: 1,
        ConnectFailed: 2,
        UnknownChannelType: 3,
        ResourceShortage: 4,
    }

    obj.onSecureConnect = function () {
        Debug("CIRA TLS socket connected.");
        obj.forwardClient.tag = { accumulator: '' };
        obj.forwardClient.setEncoding('binary');
        obj.forwardClient.on('data', function (data) {
            obj.forwardClient.tag.accumulator += data;
            try {
                var len = 0;
                do {
                    len = ProcessData(obj.forwardClient);
                    if (len > 0) {
                        obj.forwardClient.tag.accumulator = obj.forwardClient.tag.accumulator.substring(len);
                    }
                    if (obj.cirastate == CIRASTATE.FAILED) {
                        Debug("CIRA: in a failed state, destroying socket.")
                        obj.forwardClient.end();
                    }
                } while (len > 0);
            } catch (e) {
                Debug(e);
            }
        });
        obj.forwardClient.on('error', function (e) {
            Debug("CIRA: Connection error, ending connecting.");
            if (obj.timer != null) {
                clearInterval(obj.timer);
                obj.timer = null;
            }
        });

        obj.forwardClient.on('close', function (e) {
            Debug("CIRA: Connection is closing.");
            if (obj.timer != null) {
                clearInterval(obj.timer);
                obj.timer = null;
            }
        });

        obj.forwardClient.on('end', function (data) {
            Debug("CIRA: Connection end.");
            if (obj.timer != null) {
                clearInterval(obj.timer);
                obj.timer = null;
            }
        });

        obj.state = CIRASTATE.INITIAL;
        SendProtocolVersion(obj.forwardClient, obj.args.clientuuid);
        SendServiceRequest(obj.forwardClient, 'auth@amt.intel.com');
    }

    function guidToStr(g) { return g.substring(6, 8) + g.substring(4, 6) + g.substring(2, 4) + g.substring(0, 2) + "-" + g.substring(10, 12) + g.substring(8, 10) + "-" + g.substring(14, 16) + g.substring(12, 14) + "-" + g.substring(16, 20) + "-" + g.substring(20); }
    function strToGuid(s) {
        s = s.replace(/-/g, '');
        var ret = s.substring(6, 8) + s.substring(4, 6) + s.substring(2, 4) + s.substring(0, 2);
        ret += s.substring(10, 12) + s.substring(8, 10) + s.substring(14, 16) + s.substring(12, 14) + s.substring(16, 20) + s.substring(20);
        return ret;
    }

    function SendProtocolVersion(socket, uuid) {
        var buuid = strToGuid(uuid);
        var data = String.fromCharCode(APFProtocol.PROTOCOLVERSION) + '' + obj.common.IntToStr(1) + obj.common.IntToStr(0) + obj.common.IntToStr(0) + obj.common.hex2rstr(buuid) + Buffer.alloc(64);
        socket.write(Buffer.from(data, 'binary'));
        Debug("CIRA: Send protocol version 1 0 " + uuid);
        obj.cirastate = CIRASTATE.PROTOCOL_VERSION_SENT;
    }

    function SendServiceRequest(socket, service) {
        var data = String.fromCharCode(APFProtocol.SERVICE_REQUEST) + obj.common.IntToStr(service.length) + service;
        socket.write(Buffer.from(data, 'binary'));
        Debug("CIRA: Send service request " + service);
        if (service == 'auth@amt.intel.com') {
            obj.cirastate = CIRASTATE.AUTH_SERVICE_REQUEST_SENT;
        } else if (service == 'pfwd@amt.intel.com') {
            obj.cirastate = CIRASTATE.PFWD_SERVICE_REQUEST_SENT;
        }
    }

    function SendUserAuthRequest(socket, user, pass) {
        var service = "pfwd@amt.intel.com";
        var data = String.fromCharCode(APFProtocol.USERAUTH_REQUEST) + obj.common.IntToStr(user.length) + user + obj.common.IntToStr(service.length) + service;
        //password auth
        data += obj.common.IntToStr(8) + 'password';
        data += Buffer.alloc(1) + obj.common.IntToStr(pass.length) + pass;
        socket.write(Buffer.from(data, 'binary'));
        Debug("CIRA: Send username password authentication to MPS");
        obj.cirastate = CIRASTATE.AUTH_REQUEST_SENT;
    }

    function SendGlobalRequestPfwd(socket, amthostname, amtport) {
        var tcpipfwd = 'tcpip-forward';
        var data = String.fromCharCode(APFProtocol.GLOBAL_REQUEST) + obj.common.IntToStr(tcpipfwd.length) + tcpipfwd + Buffer.alloc(1, 1);
        data += obj.common.IntToStr(amthostname.length) + amthostname + obj.common.IntToStr(amtport);
        socket.write(Buffer.from(data, 'binary'));
        Debug("CIRA: Send tcpip-forward " + amthostname + ":" + amtport);
        obj.cirastate = CIRASTATE.GLOBAL_REQUEST_SENT;
    }

    function SendKeepAliveRequest(socket) {
        var data = String.fromCharCode(APFProtocol.KEEPALIVE_REQUEST) + obj.common.IntToStr(255);
        socket.write(Buffer.from(data, 'binary'));
        Debug("CIRA: Send keepalive request");
    }

    function SendKeepAliveReply(socket, cookie) {
        var data = String.fromCharCode(APFProtocol.KEEPALIVE_REPLY) + obj.common.IntToStr(cookie);
        socket.write(Buffer.from(data, 'binary'));
        Debug("CIRA: Send keepalive reply");
    }

    function SendKeepAliveOptionsReply(socket, interval, timeout) {
        var data = String.fromCharCode(APFProtocol.KEEPALIVE_OPTIONS_REPLY)+obj.common.IntToStr(interval)+obj.common.IntToStr(timeout);
        socket.write(Buffer.from(data,'binary'));
        Debug("CIRA: Send keepalive options reply");
    }

    function ProcessData(socket) {
        var cmd = socket.tag.accumulator.charCodeAt(0);
        var len = socket.tag.accumulator.length;
        var data = socket.tag.accumulator;
        if (len == 0) { return 0; }
        // respond to MPS according to obj.cirastate
        switch (cmd) {
            case APFProtocol.SERVICE_ACCEPT: {
                var slen = obj.common.ReadInt(data, 1);
                var service = data.substring(5, 6 + slen);
                Debug("CIRA: Service request to " + service + " accepted.");
                if (service == 'auth@amt.intel.com') {
                    if (obj.cirastate >= CIRASTATE.AUTH_SERVICE_REQUEST_SENT) {
                        SendUserAuthRequest(socket, obj.args.mpsuser, obj.args.mpspass);
                    }
                } else if (service == 'pfwd@amt.intel.com') {
                    if (obj.cirastate >= CIRASTATE.PFWD_SERVICE_REQUEST_SENT) {
                        SendGlobalRequestPfwd(socket, obj.args.clientname, pfwd_ports[obj.pfwd_idx++]);
                    }
                }
                return 5 + slen;
            }
            case APFProtocol.REQUEST_SUCCESS: {
                if (len >= 5) {
                    var port = obj.common.ReadInt(data, 1);
                    Debug("CIRA: Request to port forward " + port + " successful.");
                    // iterate to pending port forward request
                    if (obj.pfwd_idx < pfwd_ports.length) {
                        SendGlobalRequestPfwd(socket, obj.args.clientname, pfwd_ports[obj.pfwd_idx++]);
                    } else {
                        // no more port forward, now setup timer to send keep alive
                        Debug("CIRA: Start keep alive for every " + obj.keepalive + " ms.");
                        clearInterval(obj.timer)
                        obj.timer = setInterval(function () {
                            SendKeepAliveRequest(obj.forwardClient);
                        }, obj.keepalive);// 
                    }
                    return 5;
                }
                Debug("CIRA: Request successful.");
                return 1;
            }
            case APFProtocol.USERAUTH_SUCCESS: {
                Debug("CIRA: User Authentication successful");
                // Send Pfwd service request
                SendServiceRequest(socket, 'pfwd@amt.intel.com');
                return 1;
            }
            case APFProtocol.USERAUTH_FAILURE: {
                Debug("CIRA: User Authentication failed");
                obj.cirastate = CIRASTATE.FAILED;
                return 14;
            }
            case APFProtocol.KEEPALIVE_REQUEST: {
                Debug("CIRA: Keep Alive Request with cookie: " + obj.common.ReadInt(data, 1));
                SendKeepAliveReply(socket, obj.common.ReadInt(data, 1));
                return 5;
            }
            case APFProtocol.KEEPALIVE_REPLY: {
                Debug("CIRA: Keep Alive Reply with cookie: " + obj.common.ReadInt(data, 1));
                return 5;
            }
            case APFProtocol.KEEPALIVE_OPTIONS_REQUEST: {
                Debug("CIRA: Keep Alive Request with cookie: " + +obj.common.ReadInt(data,1)+", timeout:"+ obj.common.ReadInt(data,5));
                obj.keepalive = obj.common.ReadInt(data,5)*1000;
                Debug("CIRA: Update keep alive for every " + obj.keepalive + " ms.");
                clearInterval(obj.timer);
                obj.timer = setInterval(function () {
                    SendKeepAliveRequest(obj.forwardClient);
                }, obj.keepalive);
                SendKeepAliveOptionsReply(socket, obj.common.ReadInt(data, 1),obj.common.ReadInt(data,5));
                return 9;
            }
            // Channel management
            case APFProtocol.CHANNEL_OPEN: {
                //parse CHANNEL OPEN request
                var p_res = parseChannelOpen(data);
                Debug("CIRA: CHANNEL_OPEN request: " + JSON.stringify(p_res));
                // Check if target port is in pfwd_ports
                if (pfwd_ports.indexOf(p_res.target_port) >= 0) {
                    // connect socket to that port
                    if (obj.args.tlsupgrade && obj.args.tlsupgrade != 0) {
                        obj.downlinks[p_res.sender_chan] = obj.tls.connect({ host: obj.args.clientaddress, port: p_res.target_port + 1, rejectUnauthorized: false }, function () {
                            obj.downlinks[p_res.sender_chan].setEncoding('binary');//assume everything is binary, not interpreting
                            SendChannelOpenConfirm(socket, p_res);
                        });
                    } else {
                        obj.downlinks[p_res.sender_chan] = obj.net.createConnection({ host: obj.args.clientaddress, port: p_res.target_port }, function () {
                            obj.downlinks[p_res.sender_chan].setEncoding('binary');//assume everything is binary, not interpreting
                            SendChannelOpenConfirm(socket, p_res);
                        });
                    }

                    obj.downlinks[p_res.sender_chan].on('data', function (ddata) {
                        //Relay data to fordwardclient
                        SendChannelData(socket, p_res.sender_chan, ddata.length, ddata);
                    });

                    obj.downlinks[p_res.sender_chan].on('error', function (e) {
                        Debug("Downlink connection error: " + e);
                        if (obj.downlinks[p_res.sender_chan]) {
                            try {
                                SendChannelClose(socket, p_res.sender_chan);
                                delete obj.downlinks[p_res.sender_chan];
                            } catch (e) {
                                Debug("Downlink connection exception: " + e);
                            }
                        }
                    });

                    obj.downlinks[p_res.sender_chan].on('end', function () {
                        if (obj.downlinks[p_res.sender_chan]) {
                            try {
                                SendChannelClose(socket, p_res.sender_chan);
                                delete obj.downlinks[p_res.sender_chan];
                            } catch (e) {
                                Debug("Downlink connection exception: " + e);
                            }
                        }
                    });
                } else {
                    SendChannelOpenFailure(socket, p_res);
                }
                return p_res.len;
            }
            case APFProtocol.CHANNEL_OPEN_CONFIRMATION: {
                Debug("CIRA: CHANNEL_OPEN_CONFIRMATION");
                return 17;
            }
            case APFProtocol.CHANNEL_CLOSE: {
                var rcpt_chan = obj.common.ReadInt(data, 1);
                if (obj.downlinks[rcpt_chan]!=null) {
                    Debug("CIRA: CHANNEL_CLOSE: " + rcpt_chan);
                    SendChannelClose(socket, rcpt_chan);
                }
                try {
                    obj.downlinks[rcpt_chan].end();
                    delete obj.downlinks[rcpt_chan];
                } catch (e) { }
                return 5;
            }
            case APFProtocol.CHANNEL_DATA: {
                Debug("CIRA: CHANNEL_DATA: " + JSON.stringify(obj.common.rstr2hex(data)));
                var rcpt_chan = obj.common.ReadInt(data, 1);
                var chan_data_len = obj.common.ReadInt(data, 5);
                var chan_data = data.substring(9, 9 + chan_data_len);
                if (obj.downlinks[rcpt_chan]) {
                    try {
                        obj.downlinks[rcpt_chan].write(chan_data, 'binary', function () {
                            Debug("Write completed.");
                            SendChannelWindowAdjust(socket, rcpt_chan, chan_data_len);//I have full window capacity now
                        });
                    } catch (e) {
                        Debug("Cannot forward data to downlink socket.");
                    }
                }
                return 9 + chan_data_len;
            }
            case APFProtocol.CHANNEL_WINDOW_ADJUST: {
                Debug("CIRA: CHANNEL_WINDOW_ADJUST ");
                return 9;
            }
            default: {
                Debug("CMD: " + cmd + " is not implemented.");
                obj.cirastate = CIRASTATE.FAILED;
                return 0;
            }
        }
    }

    function parseChannelOpen(data) {
        var result = {
            len: 0, //to be filled later
            cmd: APFProtocol.CHANNEL_OPEN,
            chan_type: "", //to be filled later
            sender_chan: 0, //to be filled later
            window_size: 0, //to be filled later
            target_address: "", //to be filled later
            target_port: 0, //to be filled later
            origin_address: "", //to be filled later
            origin_port: 0, //to be filled later            
        };
        var chan_type_slen = obj.common.ReadInt(data, 1);
        result.chan_type = data.substring(5, 5 + chan_type_slen);
        result.sender_chan = obj.common.ReadInt(data, 5 + chan_type_slen);
        result.window_size = obj.common.ReadInt(data, 9 + chan_type_slen);
        var c_len = obj.common.ReadInt(data, 17 + chan_type_slen);
        result.target_address = data.substring(21 + chan_type_slen, 21 + chan_type_slen + c_len);
        result.target_port = obj.common.ReadInt(data, 21 + chan_type_slen + c_len);
        var o_len = obj.common.ReadInt(data, 25 + chan_type_slen + c_len);
        result.origin_address = data.substring(29 + chan_type_slen + c_len, 29 + chan_type_slen + c_len + o_len);
        result.origin_port = obj.common.ReadInt(data, 29 + chan_type_slen + c_len + o_len);
        result.len = 33 + chan_type_slen + c_len + o_len;
        return result;
    }
    function SendChannelOpenFailure(socket, chan_data) {
        var data = String.fromCharCode(APFProtocol.CHANNEL_OPEN_FAILURE) + obj.common.IntToStr(chan_data.sender_chan)
            + obj.common.IntToStr(2) + obj.common.IntToStr(0) + obj.common.IntToStr(0);
        socket.write(Buffer.from(data, 'binary'));
        Debug("CIRA: Send ChannelOpenFailure");
    }
    function SendChannelOpenConfirm(socket, chan_data) {
        var data = String.fromCharCode(APFProtocol.CHANNEL_OPEN_CONFIRMATION) + obj.common.IntToStr(chan_data.sender_chan)
            + obj.common.IntToStr(chan_data.sender_chan) + obj.common.IntToStr(chan_data.window_size) + obj.common.IntToStr(0xFFFFFFFF);
        socket.write(Buffer.from(data, 'binary'));
        Debug("CIRA: Send ChannelOpenConfirmation");
    }

    function SendChannelWindowAdjust(socket, chan, size) {
        var data = String.fromCharCode(APFProtocol.CHANNEL_WINDOW_ADJUST) + obj.common.IntToStr(chan) + obj.common.IntToStr(size);
        socket.write(Buffer.from(data, 'binary'));
        Debug("CIRA: Send ChannelWindowAdjust: " + obj.common.rstr2hex(data));
    }

    function SendChannelData(socket, chan, len, data) {
        var buf = String.fromCharCode(APFProtocol.CHANNEL_DATA) + obj.common.IntToStr(chan) + obj.common.IntToStr(len) + data;
        socket.write(Buffer.from(buf, 'binary'));
        Debug("CIRA: Send ChannelData: " + obj.common.rstr2hex(buf));
    }

    function SendChannelClose(socket, chan) {
        var buf = String.fromCharCode(APFProtocol.CHANNEL_CLOSE) + obj.common.IntToStr(chan);
        socket.write(Buffer.from(buf, 'binary'));
        Debug("CIRA: Send ChannelClose: " + obj.common.rstr2hex(buf));
    }

    obj.connect = function () {
        if (obj.forwardClient != null) {
            try {
                obj.forwardClient.end();
            } catch (e) {
                Debug(e);
            }
            //obj.forwardClient = null;
        }
        obj.cirastate = CIRASTATE.INITIAL;
        obj.pfwd_idx = 0;
        obj.tlsoptions = {
            secureProtocol: 'SSLv23_method',
            ciphers: 'RSA+AES:!aNULL:!MD5:!DSS',
            secureOptions: obj.constants.SSL_OP_NO_SSLv2 | obj.constants.SSL_OP_NO_SSLv3 | obj.constants.SSL_OP_NO_COMPRESSION | obj.constants.SSL_OP_CIPHER_SERVER_PREFERENCE,
            rejectUnauthorized: false, 
            enableTrace: false
        };
        if (args.proxytype != null) {
            var net = require("net");
            obj.proxysocket = new net.Socket();
            obj.proxysocket.proxy_established = false;
            obj.proxysocket.proto_state = 0;//0: not started, 1: auth received; 2: proxy tunnel established            
            obj.proxysocket.connect(obj.args.proxyport, obj.args.proxyhost, function () {
                if (obj.args.proxytype == "http") {
                    // handle http proxy
                    // send CONNECT proxy command
                    var connect_request = "CONNECT " + obj.args.mpshost + ":" + obj.args.mpsport + " HTTP/1.1\r\n";
                    connect_request += "Host: " + obj.args.mpshost + "\r\n";
                    connect_request += "Proxy-Connection: Keep-Alive\r\n";
                    connect_request += "\r\n";
                    obj.proxysocket.write(connect_request);
                    //Debug(connect_request);
                } else if (obj.args.proxytype == "socks") {
                    // send authentication query packet 
                    // 0x05: SOCKS v5
                    // 0x02: two mode of authentication supported
                    // 0x00: no auth
                    // 0x02: username/password
                    obj.proxysocket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));                    
                } else {
                    Debug("Unsupported proxy type: " + obj.args.proxytype);
                }
            });

            obj.proxysocket.on("data", function (chunk) {
                if (obj.args.proxytype == "http") {
                    if (obj.proxysocket.proxy_established == false) {
                        if (chunk.toString().startsWith("HTTP/1.1 200")) {
                            //Debug("HTTP Proxy request response:" + chunk);
                            obj.proxysocket.proxy_established = true;
                            Debug("HTTP Proxy Connection established");
                            obj.tlsoptions.socket = obj.proxysocket;
                            obj.forwardClient = obj.tls.connect(obj.tlsoptions,obj.onSecureConnect);
                            obj.forwardClient.on('error', function(e) {
                                Debug('TLS Error:'+e);
                            });                
                        }
                    } else {
                        //Debug("Socket data: " + chunk);
                    }
                } else if (obj.args.proxytype == "socks") {
                    if (obj.proxysocket.proto_state == 0) {
                        //Debug("Stage 1: check if Socks5 and no auth are supported");
                        // see if protocol is Socks v5 and support no auth
                        if (chunk.length >= 2 && chunk[0] == 0x05 && chunk[1] == 0x00) {                            
                            // send socks5 (0x05), connect (0x01), reserved (0x00), ip (0x1)/dns (0x03), len, fqdn, htons(port)
                            // total length = 7 + fqdn length
                            var fqdn = Buffer.from(obj.args.mpshost);
                            var pkt = Buffer.alloc(7 + fqdn.length);
                            pkt[0] = 0x05;
                            pkt[1] = 0x01;
                            pkt[2] = 0x00;
                            if (obj.net.isIPv4(fqdn)) {
                                pkt[3] = 0x01;
                                //parse IP
                                var octets = fqdn.toString().trim().split(".");
                                for (i=0;i<4;i++) {
                                    var parsed = parseInt(octets[i],10);                                    
                                    if (isNaN(parsed)) {
                                        pkt[4+i]=0;
                                    } else {
                                        pkt[4+i]= (0xff & parsed);
                                    }
                                }
                                pkt[8] = (0xff & (obj.args.mpsport >> 8));
                                pkt[9] = (0xff & (obj.args.mpsport));
                                pkt = pkt.slice(0,10);                             
                                //Debug(pkt.length);
                            } else {
                                pkt[3] = 0x03;
                                pkt[4] = (0xff & (fqdn.length));
                                for (var c = 0; c < fqdn.length; c++) {
                                    pkt[c + 5] = fqdn[c];
                                }
                                pkt[pkt.length - 2] = (0xff & (obj.args.mpsport >> 8));
                                pkt[pkt.length - 1] = (0xff & (obj.args.mpsport));
                            }
                            
                            obj.proxysocket.proto_state = 1;
                            try {
                                obj.proxysocket.write(pkt);
                            } catch (e) {
                                Debug("Error:" + e);
                            }
                        } else {
                            Debug("Authentication is not supported");
                            try {
                                obj.proxysocket.end();
                            } catch (e) { }
                        }
                    } else if (obj.proxysocket.proto_state == 1) {
                        // Stage 2: check if conect request is accepted, 0x05, 0x00, 0x00, bnd addr, bnd port
                        //Debug("Stage 2: check if conect request is accepted, 0x05, 0x00, 0x00, bnd addr, bnd port");
                        if (chunk[0] == 0x05 && chunk[1] == 0x00) {
                            // dont care about the rest :)
                            obj.proxysocket.proto_state = 0;
                            obj.proxysocket.proxy_established = true;
                            // Establish TLS 
                            Debug("SOCKS5 Proxy Connection established");
                            obj.tlsoptions.socket = obj.proxysocket;
                            obj.forwardClient = obj.tls.connect(obj.tlsoptions,obj.onSecureConnect);
                            obj.forwardClient.on('error', function(e) {
                                Debug('TLS Error:'+e);
                            });
                        } else {
                            Debug("SOCKS proxy tunnel cannot be established");
                            obj.proxysocket.proto_state = 0;
                            try {
                                obj.proxysocket.end();// end the socket
                            } catch (e) { }
                        }
                    }
                } else {
                    Debug("Unsupported proxy type: " + obj.args.proxytype);
                }
            });

            obj.proxysocket.on("error", function (e) {
                Debug("Error: " + e);
            });

            obj.proxysocket.on("close", function () {
                Debug("Close event.");
                try {
                    obj.forwardClient.end();
                } catch (e) {
                    Debug("Error: " + e);
                }
            });
        } else {
            obj.forwardClient = obj.tls.connect(obj.args.mpsport, obj.args.mpshost, obj.tlsoptions, obj.onSecureConnect);
        }
    }

    obj.disconnect = function () {
        try {
            obj.forwardClient.end();
        } catch (e) {
            Debug(e);
        }
    }

    return obj;
}
