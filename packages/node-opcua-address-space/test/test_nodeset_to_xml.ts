import fs from "fs";
import should from "should";
import "should";

import { getTempFilename } from "node-opcua-debug/nodeJS";
import { DataType, VariantArrayType } from "node-opcua-variant";
import { Variant } from "node-opcua-variant";
import { nodesets } from "node-opcua-nodesets";
import { coerceLocalizedText, coerceQualifiedName, makeAccessLevelFlag } from "node-opcua-data-model";
import { checkDebugFlag } from "node-opcua-debug";
import { DataTypeIds } from "node-opcua-constants";
import { ThreeDCartesianCoordinates } from "node-opcua-types";
import { AddressSpace, Namespace, UAVariable, UARootFolder, BaseNode } from "..";
import { createBoilerType, getMiniAddressSpace } from "../testHelpers";

import { generateAddressSpace } from "../nodeJS";

const XMLWriter = require("xml-writer");
const { createTemperatureSensorType } = require("./fixture_temperature_sensor_type");
const { createCameraType } = require("./fixture_camera_type");

function dumpXml(node: BaseNode): string {
    const xw = new XMLWriter(true);
    xw.translationTable = new Map([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5]
    ]);
    xw.priorityTable = [0, 1, 2, 3, 4, 5, 6];
    xw.startDocument({ encoding: "utf-8" });
    (node as any).dumpXML(xw);
    xw.endDocument();
    return xw.toString();
}

const doDebug = checkDebugFlag("TEST");

// eslint-disable-next-line import/order
const describe = require("node-opcua-leak-detector").describeWithLeakDetector;
describe("testing nodeset to xml", () => {
    let addressSpace: AddressSpace;
    let namespace: Namespace;

    beforeEach(async () => {
        addressSpace = await getMiniAddressSpace();
        namespace = addressSpace.getOwnNamespace();
    });
    afterEach(async () => {
        if (addressSpace) {
            addressSpace.dispose();
        }
    });

    it("NS2XML-1 should output a standard extension object datatype to xml (Argument)", () => {
        const argumentDataType = addressSpace.findDataType("Argument")!;
        if (doDebug) {
            console.log(argumentDataType.toString());
        }
        const str = dumpXml(argumentDataType);
        if (doDebug) {
            console.log(str);
        }
        str.should.match(/Argument/);
    });

    it("NS2XML-2 should output a standard Enum node to xml (ServerState)", () => {
        // TemperatureSensorType
        const serverStateType = addressSpace.findDataType("ServerState")!;
        const str = dumpXml(serverStateType);
        if (doDebug) {
            console.log(str);
        }
        str.should.match(/CommunicationFault/);
    });

    it("NS2XML-3 should output a custom Enum node to xml (MyEnumType) - Form1( with EnumStrings )", () => {
        const myEnumType = namespace.addEnumerationType({
            browseName: "MyEnumTypeForm1",
            enumeration: ["RUNNING", "STOPPED"]
        });

        const enumStringNode = myEnumType.getChildByName("EnumStrings")! as UAVariable;
        const values = enumStringNode.readValue().value.value.map((x: any) => x.toString());
        // xx console.log(values.toString());
        values.join(",").should.eql("locale=null text=RUNNING,locale=null text=STOPPED");

        myEnumType.browseName.toString().should.eql("1:MyEnumTypeForm1");
        const str = dumpXml(myEnumType);
        if (doDebug) {
            console.log(str);
        }
        str.should.match(/RUNNING/);
        str.should.match(/<Field Name="RUNNING" Value="0">/);
        str.should.match(/<Field Name="STOPPED" Value="1">/);
    });

    it("NS2XML-4 should output a custom Enum node to xml (MyEnumType) - Form2 ( with EnumValues )", () => {
        const myEnumType = namespace.addEnumerationType({
            browseName: "MyEnumType",
            enumeration: [
                { displayName: "RUNNING", value: 10, description: "the device is running" },
                { displayName: "STOPPED", value: 20, description: "the device is stopped" }
            ]
        });

        myEnumType.browseName.toString().should.eql("1:MyEnumType");
        const str = dumpXml(myEnumType);
        if (doDebug) {
            console.log(str);
        }
        str.should.match(/RUNNING/);
        str.should.match(/<Field Name="RUNNING" Value="10">/);
        str.should.match(/<Field Name="STOPPED" Value="20">/);
    });

    it("NS2XML-5 should output a simple objectType node to xml", () => {
        // TemperatureSensorType
        const temperatureSensorType = createTemperatureSensorType(addressSpace);

        const str = dumpXml(temperatureSensorType);
        str.should.match(/UAObjectType/);
    });

    it("NS2XML-6 should output a instance of a new ObjectType  to xml", () => {
        const ownNamespace = addressSpace.getOwnNamespace();

        // TemperatureSensorType
        const temperatureSensorType = ownNamespace.addObjectType({ browseName: "TemperatureSensorType" });
        ownNamespace.addVariable({
            browseName: "Temperature",
            componentOf: temperatureSensorType,
            dataType: "Double",
            description: "the temperature value of the sensor in Celsius <�C>",
            modellingRule: "Mandatory",
            value: new Variant({ dataType: DataType.Double, value: 19.5 })
        });

        const parentFolder = addressSpace.findNode("RootFolder")! as UARootFolder;
        parentFolder.browseName.toString().should.eql("Root");

        // variation 1
        const temperatureSensor = temperatureSensorType.instantiate({
            browseName: "MyTemperatureSensor",
            organizedBy: parentFolder
        });

        // variation 2
        const temperatureSensor2 = temperatureSensorType.instantiate({
            browseName: "MyTemperatureSensor",
            organizedBy: "RootFolder"
        });

        const str = dumpXml(temperatureSensor);
        if (doDebug) {
            console.log(str);
        }
        str.should.match(/UAObjectType/g);
    });

    it("NS2XML-7 should output a instance of object with method  to xml", () => {
        const cameraType = createCameraType(addressSpace);

        const camera1 = cameraType.instantiate({
            browseName: "Camera1",
            organizedBy: "RootFolder"
        });
        const str = dumpXml(camera1);
        if (doDebug) {
            console.log(str);
        }
        str.should.match(/UAObjectType/g);
        str.should.match(/UAObjectType/g);
        str.should.match(/<\/UAMethod>/g, "must have a complex UAMethod element");
        str.should.match(/BrowseName="InputArguments"/);
        str.should.match(/BrowseName="OutputArguments"/);
        str.should.match(/<UAMethod NodeId="ns=1;i=1001" BrowseName="1:Trigger" ParentNodeId="ns=1;i=1000">/);
        str.should.match(
            /<UAMethod NodeId="ns=1;i=[0-9]+" BrowseName="1:Trigger" ParentNodeId="ns=1;i=[0-9]+" MethodDeclarationId="ns=1;i=1001"/
        );
    });

    it("NS2XML-8 should output an instance of variable type to xml", () => {
        const ownNamespace = addressSpace.getOwnNamespace();
        const variableType = ownNamespace.addVariableType({ browseName: "MyCustomVariableType" });

        const str = dumpXml(variableType);
        if (doDebug) {
            console.log(str);
        }
        str.should.match(/UAVariableType/g);
    });

    it("NS2XML-9 should output a ReferenceType to xml", () => {
        const ownNamespace = addressSpace.getOwnNamespace();
        const referenceType = ownNamespace.addReferenceType({
            browseName: "HasStuff",
            inverseName: "StuffOf"
        });

        const str = dumpXml(referenceType);
        if (doDebug) {
            console.log(str);
        }
        str.should.match(/UAReferenceType/g);
        str.should.match(/StuffOf/g);
        str.should.match(/HasStuff/g);
    });

    it("NS2XML-A should output a Method to xml", () => {
        const ownNamespace = addressSpace.getOwnNamespace();

        const rootFolder = addressSpace.findNode("RootFolder")! as UARootFolder;

        const obj1 = ownNamespace.addObject({
            browseName: "Object",
            organizedBy: rootFolder.objects
        });
        ownNamespace.addMethod(obj1, {
            browseName: "Trigger",
            inputArguments: [
                {
                    dataType: DataType.UInt32,
                    description: { text: "specifies the number of seconds to wait before the picture is taken " },
                    name: "ShutterLag"
                }
            ],
            modellingRule: "Mandatory",
            outputArguments: [
                {
                    dataType: "Image",
                    description: { text: "the generated image" },
                    name: "Image"
                }
            ]
        });
        let str = dumpXml(obj1);

        str.should.match(/<\/UAMethod>/g, "must have a complex UAMethod element");
        str.should.match(/BrowseName="InputArguments"/);
        str.should.match(/BrowseName="OutputArguments"/);

        str = str.replace(/LastModified=".*" /g, 'LastModified="DATE" ');
        if (doDebug) {
            console.log(str);
        }

        str.should.eql(`<?xml version="1.0"?>
<!--Object - 1:Object {{{{ -->
<UAObject NodeId="ns=1;i=1000" BrowseName="1:Object">
    <DisplayName>Object</DisplayName>
    <References>
        <Reference ReferenceType="HasTypeDefinition">i=58</Reference>
        <Reference ReferenceType="Organizes" IsForward="false">i=85</Reference>
        <Reference ReferenceType="HasComponent">ns=1;i=1001</Reference>
    </References>
</UAObject>
<UAMethod NodeId="ns=1;i=1001" BrowseName="1:Trigger" ParentNodeId="ns=1;i=1000">
    <DisplayName>Trigger</DisplayName>
    <References>
        <Reference ReferenceType="HasModellingRule">i=78</Reference>
        <Reference ReferenceType="HasProperty">ns=1;i=1002</Reference>
        <Reference ReferenceType="HasProperty">ns=1;i=1003</Reference>
    </References>
</UAMethod>
<UAVariable NodeId="ns=1;i=1002" BrowseName="InputArguments" ParentNodeId="ns=1;i=1001" ValueRank="1" ArrayDimensions="1" DataType="Argument">
    <DisplayName>InputArguments</DisplayName>
    <Description>the definition of the input argument of method 1:Object.1:Trigger</Description>
    <References>
        <Reference ReferenceType="HasTypeDefinition">i=68</Reference>
        <Reference ReferenceType="HasModellingRule">i=78</Reference>
    </References>
    <Value>
        <ListOfExtensionObject>
            <ExtensionObject>
                <TypeId>
                    <Identifier>i=297</Identifier>
                </TypeId>
                <Body>
                    <Argument>
                        <Name>ShutterLag</Name>
                        <DataType>
                            <Identifier>i=7</Identifier>
                        </DataType>
                        <ValueRank>-1</ValueRank>
                        <ArrayDimensions/>
                        <Description>
                            <Text>specifies the number of seconds to wait before the picture is taken </Text>
                        </Description>
                    </Argument>
                </Body>
            </ExtensionObject>
        </ListOfExtensionObject>
    </Value>
</UAVariable>
<UAVariable NodeId="ns=1;i=1003" BrowseName="OutputArguments" ParentNodeId="ns=1;i=1001" ValueRank="1" ArrayDimensions="1" DataType="Argument">
    <DisplayName>OutputArguments</DisplayName>
    <Description>the definition of the output arguments of method 1:Object.1:Trigger</Description>
    <References>
        <Reference ReferenceType="HasTypeDefinition">i=68</Reference>
        <Reference ReferenceType="HasModellingRule">i=78</Reference>
    </References>
    <Value>
        <ListOfExtensionObject>
            <ExtensionObject>
                <TypeId>
                    <Identifier>i=297</Identifier>
                </TypeId>
                <Body>
                    <Argument>
                        <Name>Image</Name>
                        <DataType>
                            <Identifier>i=30</Identifier>
                        </DataType>
                        <ValueRank>-1</ValueRank>
                        <ArrayDimensions/>
                        <Description>
                            <Text>the generated image</Text>
                        </Description>
                    </Argument>
                </Body>
            </ExtensionObject>
        </ListOfExtensionObject>
    </Value>
</UAVariable>
<!--Object - 1:Object }}}} -->`);
    });

    it("NS2XML-B should output a View to xml", () => {
        const ownNamespace = addressSpace.getOwnNamespace();

        const rootFolder = addressSpace.findNode("RootFolder")! as UARootFolder;

        const obj1 = ownNamespace.addObject({
            browseName: "Object",
            organizedBy: rootFolder.objects
        });

        const view = ownNamespace.addView({
            browseName: "View1",
            organizedBy: rootFolder.views
        });

        view.addReference({
            nodeId: obj1,
            referenceType: "Organizes",
            isForward: true
        });

        const str = dumpXml(view);

        str.should.match(/<\/UAView>/g, "must have a complex UAView element");

        console.log(str);

        str.should.eql(`<?xml version="1.0"?>
<UAView NodeId="ns=1;i=1001" BrowseName="1:View1">
    <DisplayName>View1</DisplayName>
    <References>
        <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        <Reference ReferenceType="Organizes" IsForward="false">i=87</Reference>
    </References>
</UAView>`);
    });
});

describe("Namespace to NodeSet2.xml", () => {
    let addressSpace: AddressSpace;
    let namespace: Namespace;
    beforeEach(async () => {
        addressSpace = await getMiniAddressSpace();
        namespace = addressSpace.getOwnNamespace();
    });
    afterEach(async () => {
        if (addressSpace) {
            addressSpace.dispose();
        }
    });

    it("should produce a XML file from a namespace - a new Reference", () => {
        namespace.addReferenceType({
            browseName: "HasCousin",
            inverseName: "IsCousinOf",
            subtypeOf: "HasChild"
        });

        const nodeIds = namespace.getStandardsNodeIds();

        should.exist(nodeIds.referenceTypeIds.HasCousin);

        let xml = namespace.toNodeset2XML();
        xml = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        xml.should.eql(
            `<?xml version="1.0"?>
<UANodeSet xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:uax="http://opcfoundation.org/UA/2008/02/Types.xsd" xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd" xmlns:ns1="http://MYNAMESPACE/Type.xsd">
    <NamespaceUris>
        <Uri>http://MYNAMESPACE</Uri>
    </NamespaceUris>
    <Models>
        <Model ModelUri="http://MYNAMESPACE" Version="0.0.0" PublicationDate="1900-01-01T00:00:00.000Z">
            <RequiredModel ModelUri="http://opcfoundation.org/UA/" Version="1.04" PublicationDate="2018-05-15T00:00:00.000Z"/>
        </Model>
    </Models>
    <Aliases>
        <Alias Alias="HasSubtype">i=45</Alias>
    </Aliases>
<!--ReferenceTypes-->
    <UAReferenceType NodeId="ns=1;i=1000" BrowseName="1:HasCousin">
        <DisplayName>HasCousin</DisplayName>
        <References>
            <Reference ReferenceType="HasSubtype" IsForward="false">i=34</Reference>
        </References>
        <InverseName>IsCousinOf</InverseName>
    </UAReferenceType>
<!--ObjectTypes-->
<!--VariableTypes-->
<!--Other Nodes-->
</UANodeSet>`
        );
    });

    it("should produce a XML file from a namespace - a new UAObjectType", () => {
        namespace.addObjectType({
            browseName: "MyObjectType",
            subtypeOf: "BaseObjectType"
        });

        const nodeIds = namespace.getStandardsNodeIds();

        should.exist(nodeIds.objectTypeIds.MyObjectType);

        let xml = namespace.toNodeset2XML();
        xml = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        xml.should.eql(
            `<?xml version="1.0"?>
<UANodeSet xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:uax="http://opcfoundation.org/UA/2008/02/Types.xsd" xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd" xmlns:ns1="http://MYNAMESPACE/Type.xsd">
    <NamespaceUris>
        <Uri>http://MYNAMESPACE</Uri>
    </NamespaceUris>
    <Models>
        <Model ModelUri="http://MYNAMESPACE" Version="0.0.0" PublicationDate="1900-01-01T00:00:00.000Z">
            <RequiredModel ModelUri="http://opcfoundation.org/UA/" Version="1.04" PublicationDate="2018-05-15T00:00:00.000Z"/>
        </Model>
    </Models>
    <Aliases>
        <Alias Alias="HasSubtype">i=45</Alias>
    </Aliases>
<!--ReferenceTypes-->
<!--ObjectTypes-->
<!--ObjectType - 1:MyObjectType {{{{ -->
    <UAObjectType NodeId="ns=1;i=1000" BrowseName="1:MyObjectType">
        <DisplayName>MyObjectType</DisplayName>
        <References>
            <Reference ReferenceType="HasSubtype" IsForward="false">i=58</Reference>
        </References>
    </UAObjectType>
<!--ObjectType - 1:MyObjectType }}}}-->
<!--VariableTypes-->
<!--Other Nodes-->
</UANodeSet>`
        );
    });

    it("should produce a XML file from a namespace - with 2 UAObjectType", () => {
        const myObjectBaseType = namespace.addObjectType({
            browseName: "MyObjectBaseType",
            isAbstract: true,
            subtypeOf: "BaseObjectType"
        });

        const myObjectType = namespace.addObjectType({
            browseName: "MyObjectType",
            isAbstract: false,
            subtypeOf: myObjectBaseType
        });

        const nodeIds = namespace.getStandardsNodeIds();

        should.exist(nodeIds.objectTypeIds.MyObjectType);

        let xml = namespace.toNodeset2XML();
        xml = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        xml.should.eql(
            `<?xml version="1.0"?>
<UANodeSet xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:uax="http://opcfoundation.org/UA/2008/02/Types.xsd" xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd" xmlns:ns1="http://MYNAMESPACE/Type.xsd">
    <NamespaceUris>
        <Uri>http://MYNAMESPACE</Uri>
    </NamespaceUris>
    <Models>
        <Model ModelUri="http://MYNAMESPACE" Version="0.0.0" PublicationDate="1900-01-01T00:00:00.000Z">
            <RequiredModel ModelUri="http://opcfoundation.org/UA/" Version="1.04" PublicationDate="2018-05-15T00:00:00.000Z"/>
        </Model>
    </Models>
    <Aliases>
        <Alias Alias="HasSubtype">i=45</Alias>
    </Aliases>
<!--ReferenceTypes-->
<!--ObjectTypes-->
<!--ObjectType - 1:MyObjectBaseType {{{{ -->
    <UAObjectType NodeId="ns=1;i=1000" BrowseName="1:MyObjectBaseType" IsAbstract="true">
        <DisplayName>MyObjectBaseType</DisplayName>
        <References>
            <Reference ReferenceType="HasSubtype" IsForward="false">i=58</Reference>
        </References>
    </UAObjectType>
<!--ObjectType - 1:MyObjectBaseType }}}}-->
<!--ObjectType - 1:MyObjectType {{{{ -->
    <UAObjectType NodeId="ns=1;i=1001" BrowseName="1:MyObjectType">
        <DisplayName>MyObjectType</DisplayName>
        <References>
            <Reference ReferenceType="HasSubtype" IsForward="false">ns=1;i=1000</Reference>
        </References>
    </UAObjectType>
<!--ObjectType - 1:MyObjectType }}}}-->
<!--VariableTypes-->
<!--Other Nodes-->
</UANodeSet>`
        );
    });

    it("should emit AccessLevel attribute when needed (UAVariable)", () => {
        const accessLevelFlag = makeAccessLevelFlag("CurrentRead | CurrentWrite | HistoryRead");

        const myVariable = namespace.addVariable({
            accessLevel: accessLevelFlag,
            browseName: "MyVariable",
            dataType: DataType.Double,
            typeDefinition: "BaseVariableType"
        });

        myVariable.accessLevel.should.eql(accessLevelFlag);

        let xml = namespace.toNodeset2XML();
        xml = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        xml.should.eql(
            `<?xml version="1.0"?>
<UANodeSet xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:uax="http://opcfoundation.org/UA/2008/02/Types.xsd" xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd" xmlns:ns1="http://MYNAMESPACE/Type.xsd">
    <NamespaceUris>
        <Uri>http://MYNAMESPACE</Uri>
    </NamespaceUris>
    <Models>
        <Model ModelUri="http://MYNAMESPACE" Version="0.0.0" PublicationDate="1900-01-01T00:00:00.000Z">
            <RequiredModel ModelUri="http://opcfoundation.org/UA/" Version="1.04" PublicationDate="2018-05-15T00:00:00.000Z"/>
        </Model>
    </Models>
    <Aliases>
        <Alias Alias="Double">i=11</Alias>
        <Alias Alias="HasTypeDefinition">i=40</Alias>
    </Aliases>
<!--ReferenceTypes-->
<!--ObjectTypes-->
<!--VariableTypes-->
<!--Other Nodes-->
    <UAVariable NodeId="ns=1;i=1000" BrowseName="1:MyVariable" AccessLevel="7" DataType="Double">
        <DisplayName>MyVariable</DisplayName>
        <References>
            <Reference ReferenceType="HasTypeDefinition">i=62</Reference>
        </References>
    </UAVariable>
</UANodeSet>`
        );
    });
});

describe("nodeset2.xml with more than one referenced namespace", function (this: any) {
    this.timeout(Math.max(40000, this.timeout()));

    let addressSpace: AddressSpace;
    let namespace: Namespace;

    beforeEach(async () => {
        addressSpace = AddressSpace.create();

        const xml_files = [nodesets.standard, nodesets.di];
        fs.existsSync(xml_files[0]).should.be.eql(true);
        fs.existsSync(xml_files[1]).should.be.eql(true);

        addressSpace.registerNamespace("ServerNamespaceURI");
        addressSpace.getNamespaceArray().length.should.eql(2);

        await generateAddressSpace(addressSpace, xml_files);
        addressSpace.getNamespaceArray().length.should.eql(3);
        addressSpace.getNamespaceArray()[2].namespaceUri.should.eql("http://opcfoundation.org/UA/DI/");

        addressSpace
            .getNamespaceArray()
            .map((x) => x.namespaceUri)
            .should.eql([
                "http://opcfoundation.org/UA/", // 0
                "ServerNamespaceURI", // 1
                "http://opcfoundation.org/UA/DI/" // 2
            ]);

        namespace = addressSpace.getOwnNamespace();
    });
    afterEach(async () => {
        if (addressSpace) {
            addressSpace.dispose();
        }
    });

    async function reloadedNodeSet(tmpFilename: string) {
        /// Xx console.log(xml);
        const theNodesets = [nodesets.standard, nodesets.di, tmpFilename];
        // now reload the file as part of a addressSpace;
        const reloadedAddressSpace = AddressSpace.create();
        await generateAddressSpace(reloadedAddressSpace, theNodesets);

        const r_namespace = reloadedAddressSpace.getNamespace(namespace.namespaceUri);
        r_namespace.constructor.name.should.eql("NamespaceImpl");

        const r_xml = r_namespace.toNodeset2XML();
        const r_xml2 = r_xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');

        const tmpFilename2 = getTempFilename("__generated_node_set_version2.xml");
        fs.writeFileSync(tmpFilename2, r_xml);
        reloadedAddressSpace.dispose();
        return r_xml2;
    }

    it("should produce a XML file - with DI included - 1 Rich ObjectType - and reload it", async () => {
        createBoilerType(namespace);
        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version1.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));
        // create a
    });

    it("NSXML1 should output an XML file - with Variant GUID", async () => {
        const v = namespace.addVariable({
            browseName: "Test",
            dataType: "Guid",
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.Guid,
                value: "AFCFB362-73BD-D408-20FA-94E9567BCC27" // randomGuid("000")
            }
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version1.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));
        // console.log(xml);
    });
    it("NSXML2 should output an XML file - with Variant LocalizedText", async () => {
        const v1 = namespace.addVariable({
            browseName: "TestLocalizedText",
            dataType: DataType.LocalizedText,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.LocalizedText,
                value: coerceLocalizedText("Hello")
            }
        });

        const v2 = namespace.addVariable({
            browseName: "TestLocalizedTextArray",
            dataType: DataType.LocalizedText,
            valueRank: 1,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.LocalizedText,
                arrayType: VariantArrayType.Array,
                value: [coerceLocalizedText("Hello"), coerceLocalizedText("World")]
            }
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version1.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));

        // console.log(xml);
        r_xml2.should.match(/<LocalizedText/);
        r_xml2.should.match(/<ListOfLocalizedText.*>/);
        r_xml2.should.match(/<\/LocalizedText>/);
        r_xml2.should.match(/<\/ListOfLocalizedText>/);
    });
    it("NSXML3 should output an XML file - with Variant XmlElement", async () => {
        const v1 = namespace.addVariable({
            browseName: "TestXmlElement",
            dataType: DataType.XmlElement,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.XmlElement,
                value: "<tag>value</tag>"
            }
        });

        const v2 = namespace.addVariable({
            browseName: "TestXmlElementArray",
            dataType: DataType.XmlElement,
            valueRank: 1,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.XmlElement,
                arrayType: VariantArrayType.Array,
                value: ["<tag>Hello</tag>", "<tag>World</tag>"]
            }
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version1.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));

        // console.log(xml);
        r_xml2.should.match(/<XmlElement/);
        r_xml2.should.match(/<ListOfXmlElement.*>/);
        r_xml2.should.match(/<\/XmlElement>/);
        r_xml2.should.match(/<\/ListOfXmlElement>/);
    });
    it("NSXML4 should output an XML file - with Variant QualifiedName", async () => {
        const v1 = namespace.addVariable({
            browseName: "TestQualifiedName",
            dataType: DataType.QualifiedName,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.QualifiedName,
                value: coerceQualifiedName("Hello")
            }
        });
        const v2 = namespace.addVariable({
            browseName: "TestQualifiedName2",
            dataType: DataType.QualifiedName,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.QualifiedName,
                value: coerceQualifiedName({ name: "Hello", namespaceIndex: 1 })
            }
        });

        const v3 = namespace.addVariable({
            browseName: "TestQualifiedNameArray",
            dataType: DataType.QualifiedName,
            arrayDimensions: [2],
            valueRank: 1,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                arrayType: VariantArrayType.Array,
                dataType: DataType.QualifiedName,
                value: [
                    coerceQualifiedName({ name: "Hello", namespaceIndex: 1 }),
                    coerceQualifiedName({ name: "World", namespaceIndex: 1 })
                ]
            }
        });

        const xml = namespace.toNodeset2XML();
        // console.log(xml);

        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_qn_version1.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));

        r_xml2.should.match(/<QualifiedName/);
        r_xml2.should.match(/<ListOfQualifiedName.*>/);
        r_xml2.should.match(/<\/QualifiedName>/);
        r_xml2.should.match(/<\/ListOfQualifiedName>/);
    });
    it("NSXML5 should output an XML file - with Variant Matrix UAVariable", async () => {
        const v = namespace.addVariable({
            browseName: "TestUInt32Matrix",
            dataType: "UInt32",

            arrayDimensions: [1, 4],
            valueRank: 2,

            organizedBy: addressSpace.rootFolder.objects,
            value: {
                arrayType: VariantArrayType.Matrix,
                dataType: DataType.UInt32,
                dimensions: [1, 4],
                value: [1, 2, 3, 4]
            }
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version_x.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));

        r_xml2.should.match(/ValueRank="2"/);
        r_xml2.should.match(/ArrayDimensions="1,4"/);

        // console.log(xml);
    });
    it("NSXML6 should output an XML file - with Variant Matrix UAVariableType", async () => {
        const v = namespace.addVariableType({
            browseName: "TestVariableType",
            dataType: "UInt32",

            arrayDimensions: [2, 3],
            valueRank: 2,

            organizedBy: addressSpace.rootFolder.objects,
            value: {
                arrayType: VariantArrayType.Matrix,
                dataType: DataType.UInt32,
                dimensions: [2, 3],
                value: [1, 2, 3, 4, 5, 6]
            }
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version_x.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));

        r_xml2.should.match(/ValueRank="2"/);
        r_xml2.should.match(/ArrayDimensions="2,3"/);

        // console.log(xml);
    });
    it("NSXML7 - empty buffer #861 ", async () => {
        const v = namespace.addVariable({
            browseName: "TestVariable",
            dataType: DataType.ByteString,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.ByteString,
                value: Buffer.alloc(0)
            }
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version_x.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));

        //  console.log(xml);
    });

    it("NSXML8 - matrix of standard type ", async () => {
        const v = namespace.addVariable({
            browseName: "TestVariable",
            dataType: DataType.Int32,
            organizedBy: addressSpace.rootFolder.objects,
            valueRank: 2,
            arrayDimensions: [3, 2]
        });

        v.setValueFromSource({
            dataType: DataType.Int32,
            arrayType: VariantArrayType.Matrix,
            dimensions: [3, 2],
            value: [10, 20, 30, 11, 21, 31]
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        xml2.should.match(/<ListOfInt32/gm);
        xml2.should.match(/<\/ListOfInt32>/gm);

        const tmpFilename = getTempFilename("__generated_node_set_version_x.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);

        r_xml2.split("\n").should.eql(xml2.split("\n"));
    });
    it("NSXML9 - matrix of extension objects", async () => {
        const v = namespace.addVariable({
            browseName: "TestVariable",
            dataType: DataTypeIds.ThreeDCartesianCoordinates,
            organizedBy: addressSpace.rootFolder.objects,
            valueRank: 2,
            arrayDimensions: [3, 2]
        });

        v.setValueFromSource({
            dataType: DataType.ExtensionObject,
            arrayType: VariantArrayType.Matrix,
            dimensions: [3, 2],
            value: [
                new ThreeDCartesianCoordinates({ x: 0, y: 0, z: 0 }),
                new ThreeDCartesianCoordinates({ x: 1, y: 0, z: 0 }),
                new ThreeDCartesianCoordinates({ x: 2, y: 0, z: 0 }),
                new ThreeDCartesianCoordinates({ x: 0, y: 1, z: 0 }),
                new ThreeDCartesianCoordinates({ x: 1, y: 1, z: 0 }),
                new ThreeDCartesianCoordinates({ x: 2, y: 1, z: 0 })
            ]
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version_x.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));
        xml2.should.match(/<ListOfExtensionObject/gm);
        xml2.should.match(/<\/ListOfExtensionObject/gm);
    });

    it("NSXML10 -Variable containing a LocalizedTest", async () => {
        const v = namespace.addVariable({
            browseName: "TestVariableLT",
            dataType: DataTypeIds.LocalizedText,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.LocalizedText,
                value: coerceLocalizedText("Hello")
            }
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version_x.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));
        doDebug && console.log(xml);
        xml2.should.match(/<uax:LocalizedText>/gm);
        xml2.should.match(/ <uax:Text>/gm);
    });
    it("NSXML11 -Variable containing a QualifiedName", async () => {
        const value = coerceQualifiedName({ name: "Hello", namespaceIndex: 1 });
        value.name!.should.eql("Hello");
        value.namespaceIndex.should.eql(1);

        const v = namespace.addVariable({
            browseName: "TestVariableQN",
            dataType: DataTypeIds.QualifiedName,
            organizedBy: addressSpace.rootFolder.objects,
            value: {
                dataType: DataType.QualifiedName,
                value
            }
        });

        v.readValue().value.value.name!.should.eql(value.name);
        v.readValue().value.value.namespaceIndex!.should.eql(value.namespaceIndex);

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version_x.xml");
        fs.writeFileSync(tmpFilename, xml);

        const r_xml2 = await reloadedNodeSet(tmpFilename);
        r_xml2.split("\n").should.eql(xml2.split("\n"));
        doDebug && console.log(xml);
        doDebug && console.log(r_xml2);
        xml2.should.match(/<uax:QualifiedName>/gm);
        xml2.should.match(/ <uax:Name>/gm);
        xml2.should.match(/ <uax:NamespaceIndex>/gm);
    });

    it("NSXML12 - instance of methods", async () => {
        var objectType = namespace.addObjectType({
            browseName: "MyObjectType"
        });
        var method = namespace.addMethod(objectType, {
            browseName: "MyMethod",
            componentOf: objectType,
            modellingRule: "Mandatory",
            inputArguments: [{ name: "ShutterLag", dataType: DataType.UInt32 }],
            outputArguments: [{ name: "Image", dataType: DataType.ExtensionObject }]
        });

        var instance = objectType.instantiate({
            browseName: "Instance",
            organizedBy: addressSpace.rootFolder.objects
        });

        const xml = namespace.toNodeset2XML();
        const xml2 = xml.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        const tmpFilename = getTempFilename("__generated_node_set_version_x.xml");
        fs.writeFileSync(tmpFilename, xml);
        doDebug && console.log(xml);
        const r_xml2 = await reloadedNodeSet(tmpFilename);

        const xml22 = r_xml2.replace(/LastModified="([^"]*)"/g, 'LastModified="YYYY-MM-DD"');
        doDebug && console.log(xml22);

        r_xml2.split("\n").should.eql(xml2.split("\n"));

        const match = r_xml2.match(/\<ArrayDimensions\/\>/gm);
        doDebug && console.log(match);
        should(match).not.eql(null);
        match?.length.should.eql(4); // 2 of input and output argument in Type and 2 for instance
    });
});
