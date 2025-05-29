import { HttpRequest, InvocationContext } from '@azure/functions'; // HttpResponseInit removed as it's not directly used by tests
// Import the specific handler
import { analyzeCreativeHttpEventGridHandler } from '../analyzeCreative';
// performCreativeAnalysis will be mocked via jest.mock, no need to import its actual implementation here for the handler's test
import { Readable } from 'stream';
import * as AzureStorageBlob from '@azure/storage-blob'; // Import for jest.mocked

// Mock dependencies
jest.mock('@azure/storage-blob'); // Auto-mock the entire module

jest.mock('file-type', () => ({
    fileTypeFromBuffer: jest.fn().mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' }), 
}));

jest.mock('ansi-styles', () => ({
    // Mock properties/functions used by chalk or other dependencies if necessary
    // For now, a simple object mock might suffice to prevent parsing errors.
    modifier: {
        reset: [0, 0],
        bold: [1, 22],
        dim: [2, 22],
        italic: [3, 23],
        underline: [4, 24],
        overline: [53, 55],
        inverse: [7, 27],
        hidden: [8, 28],
        strikethrough: [9, 29],
      },
      color: {
        black: [30, 39],
        red: [31, 39],
        green: [32, 39],
        yellow: [33, 39],
        blue: [34, 39],
        magenta: [35, 39],
        cyan: [36, 39],
        white: [37, 39],
        gray: [90, 39],
        // Bright colors
        // ... (add if needed)
      },
      bgColor: {
        // ... (add if needed)
      }
}));

jest.mock('chalk', () => ({
    // Mock chalk to return a function that returns the input string,
    // or a more sophisticated mock if specific chalk features are tested.
    // This basic mock prevents errors when chalk is called.
    red: (str: string) => str,
    yellow: (str: string) => str,
    green: (str: string) => str,
    blue: (str: string) => str,
    bold: (str: string) => str,
    italic: (str: string) => str,
    // Add other chalk functions if they are used and cause issues
    default: (str: string) => str, // if chalk is used as chalk(str)
}));


// Mock the core analysis logic function (performCreativeAnalysis)
// This mock needs to correctly target the module where performCreativeAnalysis is defined and exported.
const mockPerformCreativeAnalysis = jest.fn();
jest.mock('../analyzeCreative', () => {
    const originalModule = jest.requireActual('../analyzeCreative');
    return {
        __esModule: true, // Needed for ES modules
        ...originalModule, // Spread original exports
        performCreativeAnalysis: mockPerformCreativeAnalysis, // Override with mock
        // analyzeCreativeHttpEventGridHandler will be the actual one from originalModule due to spread
    };
});


describe('analyzeCreativeHttpEventGridTrigger', () => {
    let context: InvocationContext;
    let request: HttpRequest;
    // The handler is now directly imported
    const handler = analyzeCreativeHttpEventGridHandler; 

    beforeEach(() => {
        jest.clearAllMocks(); 
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
        mockStream.push(null);

        jest.mocked(AzureStorageBlob.BlobServiceClient.fromConnectionString).mockReturnValue({
            getContainerClient: jest.fn().mockReturnValue({
                getBlobClient: jest.fn().mockReturnValue({
                    download: jest.fn().mockResolvedValue({
                        readableStreamBody: mockStream,
                        blobContentType: 'application/octet-stream',
                    }),
                }),
            }),
        } as unknown as AzureStorageBlob.BlobServiceClient); // Cast to BlobServiceClient
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

    it('should return 200 and process a valid BlobCreated event', async () => {
        const mockEvent = {
            eventType: 'Microsoft.Storage.BlobCreated',
            data: { url: 'https://testaccount.blob.core.windows.net/files-processing/test-file.jpg' },
            subject: '/blobServices/default/containers/files-processing/blobs/test-file.jpg',
        };
        request = createMockEventGridRequest([mockEvent]);

        const response = await handler(request, context);

        expect(response.status).toBe(200);
        expect(context.log).toHaveBeenCalledWith(expect.stringContaining('Processing BlobCreated event for URL: https://testaccount.blob.core.windows.net/files-processing/test-file.jpg'));
        expect(mockPerformCreativeAnalysis).toHaveBeenCalledTimes(1);
        expect(mockPerformCreativeAnalysis).toHaveBeenCalledWith(
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
        expect(mockPerformCreativeAnalysis).not.toHaveBeenCalled();
    });
    
    it('should handle empty event array gracefully', async () => {
        request = createMockEventGridRequest([]);
        const response = await handler(request, context);
        expect(response.status).toBe(200);
        expect(context.log).toHaveBeenCalledWith(expect.stringContaining("Received 0 Event Grid event(s)"));
        expect(mockPerformCreativeAnalysis).not.toHaveBeenCalled();
    });

    it('should log error and skip event if blob URL is malformed', async () => {
        const mockEvent = {
            eventType: 'Microsoft.Storage.BlobCreated',
            data: { url: 'this-is-not-a-valid-url' }, 
            subject: '/blobServices/default/containers/files-processing/blobs/test-file.jpg',
        };
        request = createMockEventGridRequest([mockEvent]);
        await handler(request, context); 
        expect(context.error).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'), expect.any(TypeError)); 
        expect(mockPerformCreativeAnalysis).not.toHaveBeenCalled();
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
        expect(context.error).toHaveBeenCalledWith("Azure Storage Connection String not found in environment variables. Cannot download blob.");
        expect(mockPerformCreativeAnalysis).not.toHaveBeenCalled();
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
        expect(context.error).toHaveBeenCalledWith('Failed to get readable stream for blob: download-fail.jpg');
        expect(mockPerformCreativeAnalysis).not.toHaveBeenCalled();
    });
});

// TODO: Add tests for performCreativeAnalysis itself, mocking its deeper dependencies.
