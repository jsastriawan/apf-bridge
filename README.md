# apf-bridge
APF/CIRA-based AMT/Standard Manageability network bridge service helps to emulate CIRA connection to an MPS for each local AMT machine. Each local AMT or Standard Manageability PC can have one CIRA client. This effectively enables AMT or Standard Manageability PCs to be manageable via cloud without setting up CIRA.

```
> node mainbridge.js someconfig.json
```
The JSON configuration file is expected to have the following keys:
* mps (mandatory)
* proxy (optional)
* clients (mandatory)

See config.json as an example.

Specific to each client entry, it must have at least the following keys:
- clientname: Hostname to identify the machine
- clientaddress: IP address of the machine in the local network
- clientuuid: AMT GUID of the target machine
- tlsupgrade: Optional, automatically upgrade local connection to use TLS (without verification, i.e. rejectUnauthorized: false)

Note:
- To turn off debugging, please edit mainbridge.js and change obj.debug to false like the following snippet:

```javascript
var obj = {
    debug: false,
    ciraclients: []
};
```

# TODO
* ~~Proxy support~~
* ~~TLS upgrade for local connection~~

