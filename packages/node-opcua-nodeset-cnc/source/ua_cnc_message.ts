// ----- this file has been automatically generated - do not edit
import { UABaseEvent, UABaseEvent_Base } from "node-opcua-nodeset-ua/dist/ua_base_event"
/**
 * Event transmitting simple information messages.
 *
 * |                |                                                            |
 * |----------------|------------------------------------------------------------|
 * |namespace       |http://opcfoundation.org/UA/CNC                             |
 * |nodeClass       |ObjectType                                                  |
 * |typedDefinition |CncMessageType i=1011                                       |
 * |isAbstract      |false                                                       |
 */
export type UACncMessage_Base = UABaseEvent_Base;
export interface UACncMessage extends UABaseEvent, UACncMessage_Base {
}