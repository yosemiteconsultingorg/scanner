import { HttpRequest, InvocationContext } from '@azure/functions'; // HttpResponseInit removed as it's not directly used by tests
// Import the specific handler
import { analyzeCreativeHttpEventGridHandler } from '../analyzeCreative';
// performCreativeAnalysis will be mocked via jest.mock, no need to import its actual implementation here for the handler's test
import { Readable } from 'stream';
import * as AzureStorageBlob from '@azure/storage-blob'; // Import for jest.mocked

// Mock dependencies
jest.mock('@azure/storage-blob'); // Auto-mock the entire module

// file-type, ansi-styles, and chalk are now mocked globally via jest.config.js moduleNameMapper

// Mock the core analysis logic function (performCreativeAnalysis)
// This mock needs to correctly target the module where performCreativeAnalysis is defined and exported.
// We will mock performCreativeAnalysis directly.
jest.mock('../analyzeCreative', () => {
    const originalModule = jest.requireActual('../analyzeCreative');
    return {
        __esModule: true, // Needed for ES modules
        ...originalModule, // Spread original exports
        // analyzeCreativeHttpEventGridHandler is the actual function we are testing
        // performCreativeAnalysis is the function we want to mock from this module
        performCreativeAnalysis: jest.fn(), // This is the mock function
    };
});

// After jest.mock, when we import performCreativeAnalysis, it will be the mocked version.
// We need to cast it to JestMockExtended to satisfy TypeScript for toHaveBeenCalledWith etc.
// However, direct import and casting can be tricky with how Jest handles mocks.
// A common pattern is to import the module and then access the mocked function.
// For simplicity, we'll rely on the mock being in place and use a variable to reference it
// if needed, or directly assert on the imported (mocked) function.
// Import the module again to get the (potentially mocked) exports.
import { performCreativeAnalysis as importedMockedPerformCreativeAnalysis } from '../analyzeCreative';
// We will use importedMockedPerformCreativeAnalysis in tests, which Jest should have replaced with the mock.


describe('analyzeCreativeHttpEventGridTrigger', () => {
    let context: InvocationContext;
    let request: HttpRequest;
    // The handler is now directly imported
    const handler = analyzeCreativeHttpEventGridHandler; 

    beforeEach(() => {
        jest.clearAllMocks(); 
        // It's important to also reset the mock's state if it's defined outside beforeEach
        (importedMockedPerformCreativeAnalysis as jest.Mock).mockClear(); 

        context = { 
            log: jest.fn(), 
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            verbose: jest.fn(),
            debug: jest.fn(),
            trace: jest.fn(),
            invocationId: 'test-invocation-id',
            functionName: 'analyzeCreativeHttpEventGridTrigger-test',
            traceContext: { traceParent: undefined, traceState: undefined },
            options: { trigger: {}, extraInputs: {}, extraOutputs: {}, return: {} }, // Removed 'as any' for sub-properties
            retryContext: undefined,
            bindings: {}, 
            bindingData: {}, 
            df: undefined, 
        } as unknown as InvocationContext;

        process.env.AzureWebJobsStorage_ConnectionString = 'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net';
        
        // Reset specific mock implementations for @azure/storage-blob if needed per test
        // For default behavior in most tests:
        const mockBlobData = Buffer.from('mock blob content');
        const mockStream = new Readable();
        mockStream._read = () => {}; 
        mockStream.push(mockBlobData);
        mockStream.push(null); // This stream is prepared once

        jest.mocked(AzureStorageBlob.BlobServiceClient.fromConnectionString).mockImplementation(() => ({
            getContainerClient: jest.fn().mockReturnValue({
                getBlobClient: jest.fn().mockReturnValue({
                    download: jest.fn().mockImplementation(() => {
                        // Create a fresh stream for each download call
                        const freshMockStream = new Readable();
                        freshMockStream._read = () => {};
                        freshMockStream.push(Buffer.from('mock blob content')); // Ensure content
                        freshMockStream.push(null);
                        return Promise.resolve({
                            readableStreamBody: freshMockStream,
                            blobContentType: 'application/octet-stream',
                        });
                    }),
                }),
            }),
    } as unknown as AzureStorageBlob.BlobServiceClient));
    });

    const createMockEventGridRequest = (events: Record<string, any>[]): HttpRequest => ({
        method: 'POST',
        url: 'http://localhost/api/analyzeCreativeHttpEventGridTrigger',
        headers: { 'content-type': 'application/json' },
        query: {},
        params: {},
        user: null,
        get: jest.fn(),
        parseFormBody: jest.fn(),
        json: jest.fn().mockResolvedValue(events),
    } as unknown as HttpRequest);

    it('should return 200 and process a valid BlobCreated event', async () => { // Removed .only
        // Ensure a very clean mock for this specific test's download
        const freshMockStreamForValidEvent = new Readable();
        freshMockStreamForValidEvent._read = () => {};
        freshMockStreamForValidEvent.push(Buffer.from('valid event mock content'));
        freshMockStreamForValidEvent.push(null);

        const downloadMockForValidEvent = jest.fn().mockImplementation(() => {
            console.log('[TEST_DEBUG] downloadMockForValidEvent CALLED'); // Use console.log for direct visibility
            const stream = new Readable();
            stream._read = () => {};
            stream.push(Buffer.from('specific mock content for valid event test'));
            stream.push(null);
            const mockResolvedValue = {
                readableStreamBody: stream,
                blobContentType: 'application/octet-stream',
            };
            console.log('[TEST_DEBUG] downloadMockForValidEvent RETURNING:', !!mockResolvedValue.readableStreamBody);
            return Promise.resolve(mockResolvedValue);
        });

        jest.mocked(AzureStorageBlob.BlobServiceClient.fromConnectionString).mockImplementation(() => ({
            getContainerClient: jest.fn().mockReturnValue({
                getBlobClient: jest.fn().mockReturnValue({
                    download: downloadMockForValidEvent, // Use the specific, logging mock
                }),
            }),
        } as unknown as AzureStorageBlob.BlobServiceClient));


        const mockEvent = {
            eventType: 'Microsoft.Storage.BlobCreated',
            data: { url: 'https://testaccount.blob.core.windows.net/files-processing/test-file.jpg' },
            subject: '/blobServices/default/containers/files-processing/blobs/test-file.jpg',
        };
        request = createMockEventGridRequest([mockEvent]);

        const response = await handler(request, context);

        // --- DEBUGGING: Inspect all calls to context.log ---
        // console.log('DEBUG: context.log calls:', (context.log as jest.Mock).mock.calls);
        // --- END DEBUGGING ---

        expect(response.status).toBe(200);
        expect(context.log).toHaveBeenCalledWith(expect.stringContaining('Processing BlobCreated event for URL: https://testaccount.blob.core.windows.net/files-processing/test-file.jpg'));
        expect(importedMockedPerformCreativeAnalysis).toHaveBeenCalledTimes(1);
        expect(importedMockedPerformCreativeAnalysis).toHaveBeenCalledWith(
            expect.any(Buffer), 
            context,
            'test-file.jpg' 
        );
    });

    it('should return 200 and skip non-BlobCreated events', async () => {
        const mockEvent = { 
            eventType: 'Microsoft.Storage.BlobDeleted', 
            data: { url: 'https://testaccount.blob.core.windows.net/files-processing/test-file.jpg' },
            subject: '/blobServices/default/containers/files-processing/blobs/test-file.jpg',
        };
        request = createMockEventGridRequest([mockEvent]);

        const response = await handler(request, context);

        expect(response.status).toBe(200);
        expect(context.log).toHaveBeenCalledWith(expect.stringContaining("Received event of type Microsoft.Storage.BlobDeleted, not 'Microsoft.Storage.BlobCreated'. Skipping."));
        expect(importedMockedPerformCreativeAnalysis).not.toHaveBeenCalled();
    });
    
    it('should handle empty event array gracefully', async () => {
        request = createMockEventGridRequest([]);
        const response = await handler(request, context);
        expect(response.status).toBe(200);
        expect(context.log).toHaveBeenCalledWith(expect.stringContaining("Received 0 Event Grid event(s)"));
        expect(importedMockedPerformCreativeAnalysis).not.toHaveBeenCalled();
    });

    it('should log error and skip event if blob URL is malformed', async () => {
        const mockEvent = {
            eventType: 'Microsoft.Storage.BlobCreated',
            data: { url: 'this-is-not-a-valid-url' }, 
            subject: '/blobServices/default/containers/files-processing/blobs/test-file.jpg',
        };
        request = createMockEventGridRequest([mockEvent]);
        await handler(request, context); 
        expect(context.error).toHaveBeenCalledWith(
            expect.stringContaining("Error processing event for blob this-is-not-a-valid-url: TypeError: Invalid URL"), // Reverted
            expect.any(TypeError)
        ); 
        expect(importedMockedPerformCreativeAnalysis).not.toHaveBeenCalled();
    });
    
    it('should log error and skip if connection string is missing', async () => {
        delete process.env.AzureWebJobsStorage_ConnectionString;
        const mockEvent = {
            eventType: 'Microsoft.Storage.BlobCreated',
            data: { url: 'https://testaccount.blob.core.windows.net/files-processing/test-file.jpg' },
            subject: '/blobServices/default/containers/files-processing/blobs/test-file.jpg',
        };
        request = createMockEventGridRequest([mockEvent]);
        await handler(request, context);
        expect(context.error).toHaveBeenCalledWith("Azure Storage Connection String not found."); // Reverted
        expect(importedMockedPerformCreativeAnalysis).not.toHaveBeenCalled();
    });

    it('should log error if blob download fails (readableStreamBody is null)', async () => {
        // Specific mock for this test case
         const mockDownloadErrorStream = new Readable();
         mockDownloadErrorStream._read = () => {};
         mockDownloadErrorStream.push(null); // empty stream

        jest.mocked(AzureStorageBlob.BlobServiceClient.fromConnectionString)
            .mockImplementationOnce((): any => ({ // Use 'any' for less verbose deep mock
                getContainerClient: jest.fn().mockReturnValue({
                    getBlobClient: jest.fn().mockReturnValue({
                        download: jest.fn().mockResolvedValue({
                            readableStreamBody: null, // Simulate download failure
                            blobContentType: 'application/octet-stream',
                        }),
                    }),
                }),
            }));

        const mockEvent = {
            eventType: 'Microsoft.Storage.BlobCreated',
            data: { url: 'https://testaccount.blob.core.windows.net/files-processing/download-fail.jpg' },
            subject: '/blobServices/default/containers/files-processing/blobs/download-fail.jpg',
        };
        request = createMockEventGridRequest([mockEvent]);
        await handler(request, context);
        expect(context.error).toHaveBeenCalledWith('Failed to get readable stream for blob: download-fail.jpg'); // Reverted
        expect(importedMockedPerformCreativeAnalysis).not.toHaveBeenCalled();
    });
});

// TODO: Add tests for performCreativeAnalysis itself, mocking its deeper dependencies.
