/**
 * @module node-opcua-client
 */
import { EventEmitter } from "events";
import chalk from "chalk";
import { assert } from "node-opcua-assert";
import { ServerState } from "node-opcua-common";
import { VariableIds } from "node-opcua-constants";
import { DataValue } from "node-opcua-data-value";
import { AttributeIds } from "node-opcua-basic-types";
import { checkDebugFlag, make_debugLog, make_warningLog } from "node-opcua-debug";
import { coerceNodeId } from "node-opcua-nodeid";
import { ClientSecureChannelLayer } from "node-opcua-secure-channel";
import { ClientSessionImpl } from "./private/client_session_impl";
import { IClientBase } from "./private/i_private_client";

const serverStatusStateNodeId = coerceNodeId(VariableIds.Server_ServerStatus_State);

const debugLog = make_debugLog(__filename);
const doDebug = checkDebugFlag(__filename);
const warningLog = make_warningLog(__filename);

export interface ClientSessionKeepAliveManagerEvents {
    on(event: "keepalive", eventHandler: (lastKnownServerState: ServerState, count: number) => void): this;
    on(event: "failure", eventHandler: () => void): this;
}

export class ClientSessionKeepAliveManager extends EventEmitter implements ClientSessionKeepAliveManagerEvents {
    private readonly session: ClientSessionImpl;
    private timerId?: NodeJS.Timeout;
    private pingTimeout: number;
    private lastKnownState?: ServerState;
    private transactionInProgress = false;
    public count = 0;
    public checkInterval: number;

    constructor(session: ClientSessionImpl) {
        super();
        this.session = session;
        this.timerId = undefined;
        this.pingTimeout = 0;
        this.checkInterval = 0;
        this.count = 0;
    }

    public start(keepAliveInterval?: number): void {
        assert(!this.timerId);
        /* istanbul ignore next*/
        if (this.session.timeout < 600) {
            warningLog(
                `[NODE-OPCUA-W13] ClientSessionKeepAliveManager detected that the session timeout (${this.session.timeout} ms) is really too small: please adjust it to a greater value ( at least 1000))`
            );
        }
        /* istanbul ignore next*/
        if (this.session.timeout < 100) {
            throw new Error(
                `ClientSessionKeepAliveManager detected that the session timeout (${this.session.timeout} ms) is really too small: please adjust it to a greater value ( at least 1000))`
            );
        }

        const selectedCheckInterval =
            keepAliveInterval ||
            Math.min(Math.floor(Math.min((this.session.timeout * 2) / 3, 20000)), ClientSecureChannelLayer.defaultTransportTimeout);

        this.checkInterval = selectedCheckInterval;
        this.pingTimeout = Math.floor(Math.min(Math.max(50, selectedCheckInterval / 2), 20000));

        // make sure first one is almost immediate
        this.timerId = setTimeout(() => this.ping_server(), this.pingTimeout);
    }

    public stop(): void {
        if (this.timerId) {
            debugLog("ClientSessionKeepAliveManager#stop");
            clearTimeout(this.timerId);
            this.timerId = undefined;
        } else {
            debugLog("warning ClientSessionKeepAliveManager#stop ignore (already stopped)");
        }
    }

    private ping_server() {
        this._ping_server().then((delta) => {
            if (!this.session || this.session.hasBeenClosed()) {
                return; // stop here
            }
            if (this.timerId) {
                const timeout = Math.max(1, this.checkInterval - delta);
                this.timerId = setTimeout(() => this.ping_server(), timeout);
            }
        });
    }
    /**
     * @private
     * when a session is opened on a server, the client shall send request on a regular basis otherwise the server
     * session object might time out.
     * start_ping make sure that ping_server is called on a regular basis to prevent session to timeout.
     *
     */
    private async _ping_server(): Promise<number> {
        const session = this.session;
        if (!session || session.isReconnecting) {
            debugLog("ClientSessionKeepAliveManager#ping_server => no session available");
            return 0;
        }

        if (!this.timerId) {
            return 0; // keep-alive has been canceled ....
        }
        const now = Date.now();

        const timeSinceLastServerContact = now - session.lastResponseReceivedTime.getTime();
        if (timeSinceLastServerContact < this.pingTimeout) {
            debugLog(
                "ClientSessionKeepAliveManager#ping_server skipped because last communication with server was not that long ago ping timeout=",
                Math.round(this.pingTimeout),
                "timeSinceLastServerContact  = ",
                timeSinceLastServerContact
            );
            // no need to send a ping yet
            return timeSinceLastServerContact - this.pingTimeout;
        }

        if (session.isReconnecting) {
            debugLog("ClientSessionKeepAliveManager#ping_server skipped because client is reconnecting");
            return 0;
        }
        if (session.hasBeenClosed()) {
            debugLog("ClientSessionKeepAliveManager#ping_server skipped because client is reconnecting");
            return 0;
        }
        debugLog(
            "ClientSessionKeepAliveManager#ping_server timeSinceLastServerContact=",
            timeSinceLastServerContact,
            "timeout",
            this.session.timeout
        );

        if (this.transactionInProgress) {
            // readVariable already taking place ! Ignore
            return 0;
        }
        this.transactionInProgress = true;
        // Server_ServerStatus_State

        return new Promise((resolve) => {
            session.read(
                {
                    nodeId: serverStatusStateNodeId,
                    attributeId: AttributeIds.Value
                },
                (err: Error | null, dataValue?: DataValue) => {
                    this.transactionInProgress = false;

                    if (err || !dataValue || !dataValue.value) {
                        if (err) {
                            warningLog(
                                chalk.cyan(" warning : ClientSessionKeepAliveManager#ping_server "),
                                chalk.yellow(err.message)
                            );
                        }
                        /**
                         * @event failure
                         * raised when the server is not responding or is responding with en error to
                         * the keep alive read Variable value transaction
                         */
                        this.emit("failure");

            
                        // also simulate a connection by closing the channel abruptly from our end ... 
                        warningLog("Keep alive has failed, considering a network outage is in place, forcing a reconnection");

                        terminateConnection(session._client);


                        resolve(0);
                        return;
                    }

                    if (dataValue.statusCode.isGood()) {
                        const newState = dataValue.value.value as ServerState;
                        // istanbul ignore next
                        if (newState !== this.lastKnownState && this.lastKnownState) {
                            warningLog(
                                "ClientSessionKeepAliveManager#Server state has changed = ",
                                ServerState[newState],
                                " was ",
                                ServerState[this.lastKnownState]
                            );
                        }
                        this.lastKnownState = newState;
                        this.count++; // increase successful counter
                    }
                    debugLog("emit keepalive");
                    this.emit("keepalive", this.lastKnownState, this.count);
                    resolve(0);
                }
            );
        });
    }
}


function terminateConnection(client: IClientBase | null) {
    if (!client) return;

    const channel: ClientSecureChannelLayer = (client as any)._secureChannel;
    if (!channel) {
        return;
    }
    channel.forceConnectionBreak();
   
}
