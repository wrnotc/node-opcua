// ----- this file has been automatically generated - do not edit
import { UAProperty } from "node-opcua-address-space-base"
import { DataType } from "node-opcua-variant"
import { DTOpticalVerifierScanResult } from "./dt_optical_verifier_scan_result"
import { UAOpticalScanEvent, UAOpticalScanEvent_Base } from "./ua_optical_scan_event"
/**
 * |                |                                                            |
 * |----------------|------------------------------------------------------------|
 * |namespace       |http://opcfoundation.org/UA/AutoID/                         |
 * |nodeClass       |ObjectType                                                  |
 * |typedDefinition |OpticalVerifierScanEventType i=1013                         |
 * |isAbstract      |true                                                        |
 */
export interface UAOpticalVerifierScanEvent_Base extends UAOpticalScanEvent_Base {
    scanResult: UAProperty<DTOpticalVerifierScanResult[], DataType.ExtensionObject>;
}
export interface UAOpticalVerifierScanEvent extends Omit<UAOpticalScanEvent, "scanResult">, UAOpticalVerifierScanEvent_Base {
}