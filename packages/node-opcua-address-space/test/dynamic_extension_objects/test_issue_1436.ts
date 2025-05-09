<<<<<<< HEAD:packages/node-opcua-client-dynamic-extension-object/test/test_issue_1436.ts

import { OpaqueStructure } from "node-opcua-extension-object";
import {
    OPCUAServer,
    OPCUAServerOptions,
    nodesets,
    OPCUAClient,
    MessageSecurityMode,
    SecurityPolicy,
    OPCUAClientOptions,
    EndpointWithUserIdentity,
    UserTokenType,
    AttributeIds
} from "../../node-opcua"

const serverOptions: OPCUAServerOptions = {
    port: 4840,
    nodeset_filename: [
        nodesets.standard,
        "./test/test_issue_1436_base.xml",
        "./test/test_issue_1436_dependent.xml",
        "./test/test_issue_1436_server.xml"
    ],
    securityPolicies: [SecurityPolicy.None],
    securityModes: [MessageSecurityMode.None]
};

const clientOptions: OPCUAClientOptions = {
    endpointMustExist: false,
    connectionStrategy: {
        maxRetry: 2,
        initialDelay: 250,
        maxDelay: 500,
    }
};

const endpoint: EndpointWithUserIdentity = {
    endpointUrl: "opc.tcp://localhost:4840",
    userIdentity: {
        type: UserTokenType.Anonymous
    }
}

const describe = require("node-opcua-leak-detector").describeWithLeakDetector;
describe("issue_1436", function (this: any) {
    this.timeout(10 * 1000);
    it("should correctly handle 1.04 servers when handling structs which depend on multiple namespaces", async () => {
        const server = new OPCUAServer(serverOptions);
        try {
            // start server
            await server.initialize();
            await server.start();

            // read struct with client
            const client = OPCUAClient.create(clientOptions);
            await client.withSessionAsync(endpoint, async (session) => {
                const result = await session.read({
                    nodeId: "ns=4;i=6001", // Read variable of data type structure which contains a structure from a dependent namespace.
                    attributeId: AttributeIds.Value,
                })

                if (result.statusCode.isBad() || !result.value.value) {
                    throw new Error("Error while reading node.")
                }

                if (result.value.value instanceof OpaqueStructure) {
                    throw new Error("Structure with substructure from dependent namespace could not be decoded right.")
                }
            });

        } finally {
            // shutdown server
            await server.shutdown();
        }
    })
=======
import should from  "should";
import path from "path";
import { AttributeIds, StatusCodes } from "node-opcua-basic-types";
import { OpaqueStructure } from "node-opcua-extension-object";
import { nodesets } from "node-opcua-nodesets";
import { AddressSpace, Namespace, PseudoSession } from "../..";
import { generateAddressSpace } from "../../distNodeJS";
import { BinaryStream, BinaryStreamSizeCalculator } from "node-opcua-binary-stream";
import { DataValue, decodeDataValue, encodeDataValue } from "node-opcua-data-value";
import { promoteOpaqueStructure } from "node-opcua-client-dynamic-extension-object";


const describe = require("node-opcua-leak-detector").describeWithLeakDetector;

describe("issue_1436", function (this: any) {

    const fixtureFolder = path.join(__dirname,"../../test_helpers/test_fixtures/fixtures-for-1436");
    const nodesetFilename = [
        nodesets.standard,
        path.join(fixtureFolder, "test_issue_1436_base.xml"),
        path.join(fixtureFolder, "test_issue_1436_dependent.xml"),
        path.join(fixtureFolder, "test_issue_1436_server.xml")
    ];

    let addressSpace: AddressSpace;
    let namespace: Namespace;
    before(async () => {
        addressSpace = AddressSpace.create();
        await generateAddressSpace(addressSpace, nodesetFilename);
        namespace = addressSpace.registerNamespace("Private");
        namespace.index.should.eql(4);
    });
    after(async () => {
        addressSpace.dispose();
    });


    it("should correctly handle 1.04 namespaces when handling structs which depend on multiple namespaces - PseudoSession", async () => {

        const session = new PseudoSession(addressSpace);

        const nsServer = addressSpace.getNamespaceIndex("http://baseDataTypeFactoryBugExample.org/server/");

        const result = await session.read({
            nodeId: `ns=${nsServer};i=6001`, // Read variable of data type structure which contains a structure from a dependent namespace.
            attributeId: AttributeIds.Value,
        });

        result.statusCode.should.eql(StatusCodes.Good);
        should.exist(result.value.value);
        result.value.value.should.not.be.instanceOf(OpaqueStructure);
        console.log(result.value.value.toString());
    });

    it("should correctly handle 1.04 servers when handling structs which depend on multiple namespaces - with Encoding/Decoding", async () => {

       const session = new PseudoSession(addressSpace);
       const nsServer = addressSpace.getNamespaceIndex("http://baseDataTypeFactoryBugExample.org/server/");
       const result = await session.read({
            nodeId: `ns=${nsServer};i=6001`, // Read variable of data type structure which contains a structure from a dependent namespace.
            attributeId: AttributeIds.Value,
        });

        var bl = new BinaryStreamSizeCalculator();
        encodeDataValue(result, bl);

        var stream = new BinaryStream(bl.length);
        encodeDataValue(result, stream);

        stream.rewind();
        var decoded = decodeDataValue(stream);
        decoded.should.be.instanceOf(DataValue);
        //
        decoded.value.value.should.be.instanceOf(OpaqueStructure);

        await promoteOpaqueStructure(session, [decoded]);

        decoded.should.be.instanceOf(DataValue);
        decoded.value.value.should.not.be.instanceOf(OpaqueStructure);

        should.exist(decoded.value.value.exampleNumber);
        should(decoded.value.value.exampleNumber).eql(123);
        should.exist(decoded.value.value.dependentStruct);
        should.exist(decoded.value.value.dependentStruct.exampleBoolean);
        should(decoded.value.value.dependentStruct.exampleBoolean).eql(true);


    }); 
>>>>>>> upstream/master:packages/node-opcua-address-space/test/dynamic_extension_objects/test_issue_1436.ts
});
