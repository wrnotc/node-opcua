/**
 * @module node-opcua-file-transfer
 */

import { promisify, types } from "util";
import fsOrig from "fs";

import { assert } from "node-opcua-assert";
import { getContextMaxMessageSize } from "node-opcua-address-space-base";
import {
    IAddressSpace,
    ISessionContext,
    UAFile,
    UAFile_Base,
    UAMethod,
    UAObjectType
} from "node-opcua-address-space";
import { Byte, Int32, UInt32, UInt64 } from "node-opcua-basic-types";
import { BinaryStream } from "node-opcua-binary-stream";
import { checkDebugFlag, make_debugLog, make_errorLog, make_warningLog } from "node-opcua-debug";
import { NodeId, NodeIdLike, sameNodeId } from "node-opcua-nodeid";
import { CallMethodResultOptions } from "node-opcua-service-call";
import { StatusCodes } from "node-opcua-status-code";
import { DataType, Variant, VariantArrayType } from "node-opcua-variant";

import { OpenFileMode, OpenFileModeMask } from "../open_mode";
import { AbstractFs } from "../common/abstract_fs";

const debugLog = make_debugLog("FileType");
const errorLog = make_errorLog("FileType");
const warningLog = make_warningLog("FileType");
const doDebug = checkDebugFlag("FileType");
doDebug;
/**
 *
 */
export interface FileOptions {
    /**
     * the filaname of the physical file which is managed by the OPCUA filetpye
     */
    filename: string;
    /**
     * the maximum allowed size of the  phisical file.
     */
    maxSize?: number;
    /**
     * an optional mimeType
     */
    mimeType?: string;

    fileSystem?: AbstractFs;

    nodeId?: NodeIdLike;

    /**
     * the maximum number of bytes that can be read from the file
     * in a single read call
     * - if not specified or 0, we assume Int32 limit
     */
    maxChunkSize?: number;

    refreshFileContentFunc?: () => Promise<void>;
}

export interface UAFileType extends UAObjectType, UAFile_Base {}
/**
 *
 */
export class FileTypeData {
    public _fs: AbstractFs;
    public filename = "";
    public maxSize = 0;
    public mimeType = "";
    public maxChunkSizeBytes = 0;

    private file: UAFile;
    private _openCount = 0;
    private _fileSize = 0;

    public static maxChunkSize = 16 * 1024 * 1024; // 16 MB

    public refreshFileContentFunc?: () => Promise<void>;

    constructor(options: FileOptions, file: UAFile) {
        this.file = file;
        this._fs = options.fileSystem || fsOrig;
        this.refreshFileContentFunc = options.refreshFileContentFunc;

        this.filename = options.filename;
        this.maxSize = options.maxSize!;
        this.mimeType = options.mimeType || "";
        this.maxChunkSizeBytes = options.maxChunkSize || FileTypeData.maxChunkSize;

        // openCount indicates the number of currently valid file handles on the file.
        this._openCount = 0;
        file.openCount.bindVariable(
            {
                get: () => new Variant({ dataType: DataType.UInt16, value: this._openCount })
            },
            true
        );
        file.openCount.minimumSamplingInterval = 0; // changes immediately

        file.size.bindVariable(
            {
                get: () => new Variant({ dataType: DataType.UInt64, value: this._fileSize })
            },
            true
        );

        file.size.minimumSamplingInterval = 0; // changes immediately

        this.refresh();
    }

    public set openCount(value: number) {
        this._openCount = value;
        this.file.openCount.touchValue();
    }

    public get openCount(): number {
        return this._openCount;
    }

    public set fileSize(value: number) {
        this._fileSize = value;
        this.file.size.touchValue();
    }

    public get fileSize(): number {
        return this._fileSize;
    }

    /**
     * refresh position and size
     * this method should be call by the server if the file
     * is modified externally
     *
     */
    public async refresh(): Promise<void> {
        const abstractFs = this._fs;

        // lauch an async request to update filesize
        await (async function extractFileSize(self: FileTypeData) {
            try {
                if (!abstractFs.existsSync(self.filename)) {
                    self._fileSize = 0;
                    return;
                }
                const stat = await promisify(abstractFs.stat)(self.filename);
                self._fileSize = stat.size;
                debugLog("original file size ", self.filename, " size = ", self._fileSize);
            } catch (err) {
                self._fileSize = 0;
                if (types.isNativeError(err)) {
                    warningLog("Cannot access file ", self.filename, err.message);
                }
            }
        })(this);
    }

    public async refreshFileContent() {
        if (this.refreshFileContentFunc) {
            await this.refreshFileContentFunc();
            await this.refresh();
        }
    }
}

export async function writeFile(fileSystem: AbstractFs, filename: string, content: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        fileSystem.open(filename, "w", (err, fd) => {
            // istanbul ignore next
            if (err) {
                return reject(err);
            }
            fileSystem.write(fd, content, 0, content.length, 0, (err) => {
                // istanbul ignore next
                if (err) {
                    return reject(err);
                }
                fileSystem.close(fd, (err) => {
                    // istanbul ignore next
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
            });
        });
    });
}

/**
 * @private
 */
export interface UAFileEx extends UAFile {
    $fileData: FileTypeData;
}

/**
 * @orivate
 */
export function getFileData(opcuaFile2: UAFile): FileTypeData {
    return (opcuaFile2 as UAFileEx).$fileData;
}

function getFileDataFromContext(context: ISessionContext): FileTypeData {
    return getFileData(context.object as UAFile);
}

interface FileAccessData {
    handle: number;
    fd: number; // nodejs handler
    position: UInt64; // position in file
    size: number; // size
    openMode: OpenFileMode;
    sessionId: NodeId;
}

interface FileTypeM {
    $$currentFileHandle: number;
    $$files: { [key: number]: FileAccessData };
}

interface AddressSpacePriv extends IAddressSpace, FileTypeM {}
function _prepare(addressSpace: IAddressSpace, context: ISessionContext): FileTypeM {
    const _context = addressSpace as AddressSpacePriv;
    _context.$$currentFileHandle = _context.$$currentFileHandle ? _context.$$currentFileHandle : 41;
    _context.$$files = _context.$$files || {};
    return _context as FileTypeM;
}
function _getSessionId(context: ISessionContext) {
    if (!context.session) {
        return new NodeId();
    }
    assert(context.session && context.session.getSessionId);
    return context.session?.getSessionId() || new NodeId();
}
function _addFile(addressSpace: IAddressSpace, context: ISessionContext, openMode: OpenFileMode): UInt32 {
    const _context = _prepare(addressSpace, context);
    _context.$$currentFileHandle++;
    const fileHandle: number = _context.$$currentFileHandle;
    const sessionId = _getSessionId(context);
    const _fileData: FileAccessData = {
        fd: -1,
        handle: fileHandle,
        openMode,
        position: [0, 0],
        size: 0,
        sessionId
    };
    _context.$$files[fileHandle] = _fileData;

    return fileHandle;
}

function _getFileInfo(addressSpace: IAddressSpace, context: ISessionContext, fileHandle: UInt32): FileAccessData | null {
    const _context = _prepare(addressSpace, context);
    const _fileInfo = _context.$$files[fileHandle];
    const sessionId = _getSessionId(context);

    if (!_fileInfo || !sameNodeId(_fileInfo.sessionId, sessionId)) {
        errorLog("Invalid session ID this file descriptor doesn't belong to this session");
        return null;
    }
    return _fileInfo;
}

function _close(addressSpace: IAddressSpace, context: ISessionContext, fileData: FileAccessData) {
    const _context = _prepare(addressSpace, context);
    delete _context.$$files[fileData.fd];
}

function toNodeJSMode(opcuaMode: OpenFileMode): string {
    let flags: string;
    switch (opcuaMode) {
        case OpenFileMode.Read:
            flags = "r";
            break;
        case OpenFileMode.ReadWrite:
        case OpenFileMode.Write:
            flags = "w+";
            break;
        case OpenFileMode.ReadWriteAppend:
        case OpenFileMode.WriteAppend:
            flags = "a+";
            break;
        case OpenFileMode.WriteEraseExisting:
        case OpenFileMode.ReadWriteEraseExisting:
            flags = "w+";
            break;
        default:
            flags = "?";
            break;
    }
    return flags;
}

/**
 * Open is used to open a file represented by an Object of FileType.
 * When a client opens a file it gets a file handle that is valid while the
 * session is open. Clients shall use the Close Method to release the handle
 * when they do not need access to the file anymore. Clients can open the
 * same file several times for read.
 * A request to open for writing shall return Bad_NotWritable when the file is
 * already opened.
 * A request to open for reading shall return Bad_NotReadable
 * when the file is already opened for writing.
 *
 * Method Result Codes (defined in Call Service)
 *  Result Code         Description
 *  BadNotReadable      File might be locked and thus not readable.
 *  BadNotWritable      The file is locked and thus not writable.
 *  BadInvalidState
 *  BadInvalidArgument  Mode setting is invalid.
 *  BadNotFound .
 *  BadUnexpectedError
 *
 * @private
 */

async function _openFile(this: UAMethod, inputArguments: Variant[], context: ISessionContext): Promise<CallMethodResultOptions> {
    const addressSpace = this.addressSpace;
    const mode = inputArguments[0].value as Byte;

    /**
     * mode (Byte) Indicates whether the file should be opened only for read operations
     *      or for read and write operations and where the initial position is set.
     *      The mode is an 8-bit unsigned integer used as bit mask with the structure
     *      defined in the following table:
     *      Field        Bit  Description
     *      Read          0   The file is opened for reading. If this bit is not
     *                        set the Read Method cannot be executed.
     *      Write         1   The file is opened for writing. If this bit is not
     *                        set the Write Method cannot be executed.
     *      EraseExisting 2   This bit can only be set if the file is opened for writing
     *                        (Write bit is set). The existing content of the file is
     *                        erased and an empty file is provided.
     *      Append        3   When the Append bit is set the file is opened at end
     *                        of the file, otherwise at begin of the file.
     *                        The SetPosition Method can be used to change the position.
     *      Reserved     4:7  Reserved for future use. Shall always be zero.
     */

    // see https://nodejs.org/api/fs.html#fs_file_system_flags

    const flags = toNodeJSMode(mode);
    if (flags === "?") {
        errorLog("Invalid mode " + OpenFileMode[mode] + " (" + mode + ")");
        return { statusCode: StatusCodes.BadInvalidArgument };
    }

    /**
     *  fileHandle (UInt32) A handle for the file used in other method calls indicating not the
     *            file (this is done by the Object of the Method call) but the access
     *            request and thus the position in the file. The fileHandle is generated
     *            by the server and is unique for the Session. Clients cannot transfer the
     *            fileHandle to another Session but need to get a new fileHandle by calling
     *            the Open Method.
     */
    const fileHandle = _addFile(addressSpace, context, mode as OpenFileMode);

    const _fileInfo = _getFileInfo(addressSpace, context, fileHandle);
    if (!_fileInfo) {
        return { statusCode: StatusCodes.BadInvalidArgument };
    }

    const fileData = getFileDataFromContext(context);

    const filename = fileData.filename;

    // make sure file is up to date ... by delegating
    if (mode === OpenFileMode.Read) {
        await fileData.refreshFileContent();
    }

    const abstractFs = _getFileSystem(context);

    try {
        _fileInfo.fd = await promisify(abstractFs.open)(filename, flags);

        // update position
        _fileInfo.position = [0, 0];

        const fileLength = (await promisify(abstractFs.stat)(filename)).size;
        _fileInfo.size = fileLength;

        // tslint:disable-next-line:no-bitwise
        if ((mode & OpenFileModeMask.AppendBit) === OpenFileModeMask.AppendBit) {
            _fileInfo.position[1] = fileLength;
        }
        if ((mode & OpenFileModeMask.EraseExistingBit) === OpenFileModeMask.EraseExistingBit) {
            _fileInfo.size = 0;
        }

        fileData.openCount += 1;
    } catch (err) {
        if (types.isNativeError(err)) {
            errorLog(err.message);
            errorLog(err.stack);
        }
        return { statusCode: StatusCodes.BadUnexpectedError };
    }

    debugLog("Opening file handle ", fileHandle, "filename: ", fileData.filename, "openCount: ", fileData.openCount);

    const callMethodResult = {
        outputArguments: [
            {
                dataType: DataType.UInt32,
                value: fileHandle
            }
        ],
        statusCode: StatusCodes.Good
    };
    return callMethodResult;
}

function _getFileSystem(context: ISessionContext): AbstractFs {
    const fs: AbstractFs = getFileDataFromContext(context)._fs;
    return fs;
}

/**
 * Close is used to close a file represented by a FileType.
 * When a client closes a file the handle becomes invalid.
 *
 * @param inputArguments
 * @param context
 * @private
 */
async function _closeFile(this: UAMethod, inputArguments: Variant[], context: ISessionContext): Promise<CallMethodResultOptions> {
    const abstractFs = _getFileSystem(context);

    const addressSpace = this.addressSpace;

    const fileHandle: UInt32 = inputArguments[0].value as UInt32;

    const _fileInfo = _getFileInfo(addressSpace, context, fileHandle);
    if (!_fileInfo) {
        return { statusCode: StatusCodes.BadInvalidArgument };
    }

    const fileData = getFileDataFromContext(context);

    debugLog("Closing file handle ", fileHandle, "filename: ", fileData.filename, "openCount: ", fileData.openCount);

    await promisify(abstractFs.close)(_fileInfo.fd);
    _close(addressSpace, context, _fileInfo);
    fileData.openCount -= 1;

    return {
        statusCode: StatusCodes.Good
    };
}

/**
 * Read is used to read a part of the file starting from the current file position.
 * The file position is advanced by the number of bytes read.
 *
 * @param inputArguments
 * @param context
 * @private
 */
async function _readFile(this: UAMethod, inputArguments: Variant[], context: ISessionContext): Promise<CallMethodResultOptions> {
    const addressSpace = this.addressSpace;

    const abstractFs = _getFileSystem(context);

    //  fileHandle A handle indicating the access request and thus indirectly the
    //  position inside the file.
    const fileHandle: UInt32 = inputArguments[0].value as UInt32;

    // Length Defines the length in bytes that should be returned in data, starting from the current
    // position of the file handle. If the end of file is reached all data until the end of the file is
    // returned.

    let length: Int32 = inputArguments[1].value as Int32;

    // Only positive values are allowed.
    if (length < 0) {
        return { statusCode: StatusCodes.BadInvalidArgument };
    }

    const _fileInfo = _getFileInfo(addressSpace, context, fileHandle);
    if (!_fileInfo) {
        return { statusCode: StatusCodes.BadInvalidState };
    }
    // tslint:disable-next-line:no-bitwise
    if ((_fileInfo.openMode & OpenFileModeMask.ReadBit) === 0x0) {
        // open mode did not specify Read Flag
        return { statusCode: StatusCodes.BadInvalidState };
    }

    // Spec says that the the Server is allowed to return less data than specified length.
    //
    // In particular, we have to make sure that the number og bytes returned is not greater than
    // the maxChunkSizeBytes specified in the server configuration.
    // length cannot exceed maxChunkSizeBytes
    const fileData = getFileDataFromContext(context);

    const maxChunkSizeBytes = fileData.maxChunkSizeBytes;
    if (length > maxChunkSizeBytes) {
        length = maxChunkSizeBytes;
    }
    // length cannot either exceed ByteStream.maxChunkSizeBytes
    if (length > BinaryStream.maxByteStringLength) {
        length = BinaryStream.maxByteStringLength;
    }

    // length cannot either exceed transport OPCUA maxMessageLength - some margin.
    const maxMessageSize = getContextMaxMessageSize(context) - 1024;
    if (maxMessageSize > 0 && length > maxMessageSize) {
        length = maxMessageSize;
    }

    // length cannot either exceed remaining buffer size from current position
    length = Math.min(_fileInfo.size - _fileInfo.position[1], length);

    const data = Buffer.alloc(length);

    let ret = { bytesRead: 0 };
    try {
        // note: we do not util.promise here as it has a wierd behavior...
        ret = await new Promise((resolve, reject) =>
            abstractFs.read(_fileInfo.fd, data, 0, length, _fileInfo.position[1], (err, bytesRead, buff) => {
                if (err) {
                    return reject(err);
                }
                return resolve({ bytesRead });
            })
        );
        _fileInfo.position[1] += ret.bytesRead;
    } catch (err) {
        if (types.isNativeError(err)) {
            errorLog("Read error : ", err.message);
        }
        return { statusCode: StatusCodes.BadUnexpectedError };
    }

    //   Data Contains the returned data of the file. If the ByteString is empty it indicates that the end
    //     of the file is reached.
    return {
        outputArguments: [{ dataType: DataType.ByteString, value: data.subarray(0, ret.bytesRead) }],
        statusCode: StatusCodes.Good
    };
}

async function _writeFile(this: UAMethod, inputArguments: Variant[], context: ISessionContext): Promise<CallMethodResultOptions> {
    const addressSpace = this.addressSpace;

    const abstractFs = _getFileSystem(context);

    const fileHandle: UInt32 = inputArguments[0].value as UInt32;

    const _fileInfo = _getFileInfo(addressSpace, context, fileHandle);
    if (!_fileInfo) {
        return { statusCode: StatusCodes.BadInvalidArgument };
    }

    // tslint:disable-next-line:no-bitwise
    if ((_fileInfo.openMode & OpenFileModeMask.WriteBit) === 0x00) {
        // File has not been open with write mode
        return { statusCode: StatusCodes.BadInvalidState };
    }

    const data: Buffer = inputArguments[1].value as Buffer;

    let ret = { bytesWritten: 0 };
    try {
        // note: we do not util.promise here as it has a wierd behavior...
        ret = await new Promise((resolve, reject) => {
            abstractFs.write(_fileInfo.fd, data, 0, data.length, _fileInfo.position[1], (err, bytesWritten) => {
                if (err) {
                    errorLog("Err", err);
                    return reject(err);
                }
                return resolve({ bytesWritten });
            });
        });
        assert(typeof ret.bytesWritten === "number");
        _fileInfo.position[1] += ret.bytesWritten;
        _fileInfo.size = Math.max(_fileInfo.size, _fileInfo.position[1]);

        const fileData = getFileDataFromContext(context);
        debugLog(fileData.fileSize);
        fileData.fileSize = Math.max(fileData.fileSize, _fileInfo.position[1]);
        debugLog(fileData.fileSize);
    } catch (err) {
        if (types.isNativeError(err)) {
            errorLog("Write error : ", err.message);
        }
        return { statusCode: StatusCodes.BadUnexpectedError };
    }

    return {
        outputArguments: [],
        statusCode: StatusCodes.Good
    };
}

async function _setPositionFile(
    this: UAMethod,
    inputArguments: Variant[],
    context: ISessionContext
): Promise<CallMethodResultOptions> {
    const addressSpace = this.addressSpace;

    const fileHandle: UInt32 = inputArguments[0].value as UInt32;
    const position: UInt64 = inputArguments[1].value as UInt64;

    const _fileInfo = _getFileInfo(addressSpace, context, fileHandle);
    if (!_fileInfo) {
        return { statusCode: StatusCodes.BadInvalidArgument };
    }
    _fileInfo.position = position;
    return { statusCode: StatusCodes.Good };
}

async function _getPositionFile(
    this: UAMethod,
    inputArguments: Variant[],
    context: ISessionContext
): Promise<CallMethodResultOptions> {
    const addressSpace = this.addressSpace;

    const fileHandle: UInt32 = inputArguments[0].value as UInt32;

    const _fileInfo = _getFileInfo(addressSpace, context, fileHandle);
    if (!_fileInfo) {
        return { statusCode: StatusCodes.BadInvalidArgument };
    }

    return {
        outputArguments: [
            {
                arrayType: VariantArrayType.Scalar,
                dataType: DataType.UInt64,
                value: _fileInfo.position
            }
        ],
        statusCode: StatusCodes.Good
    };
}

export const defaultMaxSize = 100000000;

function install_method_handle_on_type(addressSpace: IAddressSpace): void {
    const fileType = addressSpace.findObjectType("FileType") as unknown as UAFile;
    if (fileType.open.isBound()) {
        return;
    }
    fileType.open.bindMethod(_openFile);
    fileType.close.bindMethod(_closeFile);
    fileType.read.bindMethod(_readFile);
    fileType.write.bindMethod(_writeFile);
    fileType.setPosition.bindMethod(_setPositionFile);
    fileType.getPosition.bindMethod(_getPositionFile);
}

/**
 * bind all methods of a UAFile OPCUA node
 * @param file the OPCUA Node that has a typeDefinition of FileType
 * @param options the options
 */
export function installFileType(_file: UAFile, options: FileOptions): void {
    const file = _file as UAFileEx;
    if (file.$fileData) {
        errorLog("File already installed ", file.nodeId.toString(), file.browseName.toString());
        return;
    }

    // make sure that FileType methods are also bound.
    install_method_handle_on_type(file.addressSpace);

    // to protect the server we setup a maximum limit in bytes on the file
    // if the client try to access or set the position above this limit
    // the server will return an error
    options.maxSize = options.maxSize === undefined ? defaultMaxSize : options.maxSize;

    const $fileData = new FileTypeData(options, file);
    file.$fileData = $fileData;

    // ----- install mime type
    if (options.mimeType) {
        if (file.mimeType) {
            file.mimeType.bindVariable({
                get: () => new Variant({ dataType: DataType.String, value: file.$fileData.mimeType })
            });
        }
    }

    file.open.bindMethod(_openFile);
    file.close.bindMethod(_closeFile);
    file.read.bindMethod(_readFile);
    file.write.bindMethod(_writeFile);
    file.setPosition.bindMethod(_setPositionFile);
    file.getPosition.bindMethod(_getPositionFile);
}
