import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient, AzureNamedKeyCredential, RestError } from "@azure/data-tables";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
// Removed static import: import { fileTypeFromBuffer } from 'file-type';
import { imageSize } from 'image-size';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
// import { Readable } from 'stream'; // No longer directly used

// Helper function for retries
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Event Grid Event Interfaces ---
interface EventGridEvent<TData = Record<string, unknown>> { // Changed any to unknown
    id: string;
    subject: string;
    data: TData;
    eventType: string;
    eventTime: string;
    dataVersion: string;
    topic?: string;
    metadataVersion?: string;
}

interface StorageBlobCreatedEventData {
    api: string;
    clientRequestId: string;
    requestId: string;
    eTag: string;
    contentType: string;
    contentLength: number;
    blobType: string;
    url: string; // URL to the blob
    sequencer: string;
    storageDiagnostics: {
        batchId: string;
    };
}

// --- Interfaces (existing) ---
interface ValidationCheck {
    checkName: string;
    status: 'Pass' | 'Fail' | 'Warn' | 'NotApplicable';
    message: string;
    value?: string | number;
    limit?: string | number;
}

interface AnalysisData {
    blobName: string;
    originalFileName?: string;
    blobSize: number;
    isCtv: boolean;
    mimeType?: string;
    extension?: string;
    dimensions?: { width?: number; height?: number };
    validationChecks: ValidationCheck[];
    status: 'Processing' | 'Completed' | 'Error';
    duration?: number;
    bitrate?: number;
    frameRate?: number;
    html5Info?: {
        primaryHtmlFile?: string;
        adSizeMeta?: string;
        clickTagDetected?: boolean;
        fileCount?: number;
        totalUncompressedSize?: number;
        backupImageFile?: string;
        extractedBackupBlobName?: string;
    };
}

type CreativeCategory = 'display' | 'audio' | 'video_olv' | 'video_ctv' | 'html5' | 'unknown';

// --- Constants & Helpers (existing) ---
const metadataTableName = "CreativeMetadata";
const resultsTableName = "AnalysisResults";
const partitionKey = "Creative";
const blobContainerName = "files-processing"; // Used for HTML5 backup image upload

function getAccountInfo(connectionString: string): { accountName: string; accountKey: string } {
    const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
    const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);
    if (!accountNameMatch || !accountKeyMatch) {
        throw new Error("Could not parse AccountName or AccountKey from connection string");
    }
    return { accountName: accountNameMatch[1], accountKey: accountKeyMatch[1] };
}

const mimeTypes: { [key: string]: string } = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
};

const SPEC_LIMITS = {
    display: { maxSizeKB: 150, supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'], supportedDimensions: [ "160x600", "300x250", "728x90", "300x600", "1024x768", "768x1024", "336x280", "300x50", "320x50", "1000x90", "1020x250", "120x240", "120x60", "120x600", "120x90", "125x125", "125x83", "1280x100", "180x150", "180x500", "226x850", "230x230", "230x600", "234x60", "240x400", "250x250", "250x360", "300x100", "300x1050", "300x240", "300x60", "320x160", "320x240", "320x250", "320x320", "320x480", "320x80", "400x400", "440x220", "450x250", "468x400", "468x60", "480x250", "480x280", "480x320", "480x80", "519x225", "544x225", "550x340", "551x289", "555x111", "555x333", "600x75", "640x480", "720x300", "720x480", "750x200", "800x250", "88x31", "930x180", "960x325", "960x60", "970x250", "970x66", "970x90", "975x300", "980x120", "980x150", "980x240", "980x250", "980x400", "980x90", "994x250" ] },
    audio: { maxSizeMB: 10, supportedMimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'], minBitrateKbps: 128, maxBitrateKbps: 1000, allowedDurationsSec: [15, 30, 60] },
    video_olv: { maxSizeMB: 200, supportedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'], minBitrateKbps: 500, maxBitrateKbps: 3500, minDurationSec: 5, maxDurationSec: 300 },
    video_ctv: { maxSizeGB: 10, supportedMimeTypes: ['video/mp4'], minBitrateKbps: 1200, minDurationSec: 5, maxDurationSec: 300, requiredResolution: "1920x1080" },
    html5: { maxFileCount: 100, maxUncompressedMB: 12, allowedExtensions: ['.html', '.js', '.css', '.mp4', '.jpg', '.jpeg', '.gif', '.png', '.svg'] }
};

// --- FFprobe Helper (existing) ---
function getMediaMetadata(filePath: string, context: InvocationContext): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
        ffmpeg(filePath).ffprobe((err, metadata) => {
            if (err) {
                context.log(`ERROR running ffprobe on ${filePath}:`, err);
                reject(err);
            } else {
                resolve(metadata);
            }
        });
    });
}

// --- Validation Functions (existing, unchanged) ---
function validateDisplay(analysisData: AnalysisData, blob: Buffer, context: InvocationContext): void {
    context.log("--- EXECUTING validateDisplay ---");
    const mime = analysisData.mimeType;
    const blobSize = analysisData.blobSize;

    if (mime && SPEC_LIMITS.display.supportedMimeTypes.includes(mime)) { analysisData.validationChecks.push({ checkName: "File Type (Display)", status: "Pass", message: `Type ${mime} is supported.`, value: mime }); }
    else { analysisData.validationChecks.push({ checkName: "File Type (Display)", status: "Fail", message: `Type ${mime || 'unknown'} is not supported for Display.`, value: mime }); }

    try {
        const dimensions = imageSize(blob);
        analysisData.dimensions = { width: dimensions.width, height: dimensions.height };
        const dimString = `${dimensions.width}x${dimensions.height}`;
        context.log(`Image dimensions: ${dimString}`);
        if (SPEC_LIMITS.display.supportedDimensions.includes(dimString)) {
            analysisData.validationChecks.push({ checkName: "Dimensions (Display)", status: "Pass", message: `Dimensions ${dimString} are supported.`, value: dimString });
        } else {
            analysisData.validationChecks.push({ checkName: "Dimensions (Display)", status: "Fail", message: `Dimensions ${dimString} are NOT supported for Display.`, value: dimString, limit: "See supported list" });
        }
    } catch (error: unknown) {
        const msg = `Error getting image dimensions: ${error instanceof Error ? error.message : String(error)}`; context.log(`ERROR: ${msg}`);
        analysisData.validationChecks.push({ checkName: "Dimensions", status: "Fail", message: "Could not read image dimensions." });
    }

    const maxDisplayBytes = SPEC_LIMITS.display.maxSizeKB * 1024;
    const displaySizeKB = (blobSize / 1024).toFixed(1);
    const displayLimit = `${SPEC_LIMITS.display.maxSizeKB} KB`;
    if (blobSize > maxDisplayBytes) {
        const msg = `File size (${displaySizeKB} KB) exceeds limit (${displayLimit}).`; context.warn(msg);
        analysisData.validationChecks.push({ checkName: "File Size (Display)", status: "Fail", message: msg, value: `${displaySizeKB} KB`, limit: displayLimit });
    } else {
        const msg = `File size (${displaySizeKB} KB) is within limit (${displayLimit}).`; context.log(msg);
        analysisData.validationChecks.push({ checkName: "File Size (Display)", status: "Pass", message: msg, value: `${displaySizeKB} KB`, limit: displayLimit });
    }
}

function validateAudio(analysisData: AnalysisData, metadata: ffmpeg.FfprobeData | null, context: InvocationContext): void {
    context.log("--- EXECUTING validateAudio ---");
    const mime = analysisData.mimeType;
    const blobSize = analysisData.blobSize;

    if (mime && SPEC_LIMITS.audio.supportedMimeTypes.includes(mime)) { analysisData.validationChecks.push({ checkName: "File Type (Audio)", status: "Pass", message: `Type ${mime} is supported.`, value: mime }); }
    else { analysisData.validationChecks.push({ checkName: "File Type (Audio)", status: "Fail", message: `Type ${mime || 'unknown'} is not supported for Audio.`, value: mime }); }

    analysisData.validationChecks.push({ checkName: "Dimensions (Audio)", status: "NotApplicable", message: "Dimension check does not apply to audio." });

    const maxAudioBytes = SPEC_LIMITS.audio.maxSizeMB * 1024 * 1024;
    const audioSizeMB = (blobSize / 1024 / 1024).toFixed(1);
    const audioLimit = `${SPEC_LIMITS.audio.maxSizeMB} MB`;
    if (blobSize > maxAudioBytes) {
        const msg = `File size (${audioSizeMB} MB) exceeds limit (${audioLimit}).`; context.warn(msg);
        analysisData.validationChecks.push({ checkName: "File Size (Audio)", status: "Fail", message: msg, value: `${audioSizeMB} MB`, limit: audioLimit });
    } else {
        const msg = `File size (${audioSizeMB} MB) is within limit (${audioLimit}).`; context.log(msg);
        analysisData.validationChecks.push({ checkName: "File Size (Audio)", status: "Pass", message: msg, value: `${audioSizeMB} MB`, limit: audioLimit });
    }

    if (metadata?.format) {
        const duration = metadata.format.duration;
        const bitrate = metadata.format.bit_rate ? Math.round(metadata.format.bit_rate / 1000) : undefined;
        analysisData.duration = duration;
        analysisData.bitrate = bitrate;

        if (duration !== undefined) {
            const allowedDurations = SPEC_LIMITS.audio.allowedDurationsSec;
            const isDurationValid = allowedDurations.some(allowed => Math.abs(duration - allowed) < 0.5);
            const durLimit = `${allowedDurations.join(', ') } sec`;
            if (isDurationValid) { analysisData.validationChecks.push({ checkName: "Duration (Audio)", status: "Pass", message: `Duration ${duration.toFixed(1)}s is allowed.`, value: `${duration.toFixed(1)}s`, limit: durLimit }); }
            else { analysisData.validationChecks.push({ checkName: "Duration (Audio)", status: "Fail", message: `Duration ${duration.toFixed(1)}s is not one of the allowed durations.`, value: `${duration.toFixed(1)}s`, limit: durLimit }); }
        } else { analysisData.validationChecks.push({ checkName: "Duration (Audio)", status: "Warn", message: "Could not determine duration." }); }

        if (bitrate !== undefined) {
            const minBitrate = SPEC_LIMITS.audio.minBitrateKbps;
            const maxBitrate = SPEC_LIMITS.audio.maxBitrateKbps;
            const bitrateLimit = `${minBitrate}-${maxBitrate} kbps`;
            if (bitrate >= minBitrate && bitrate <= maxBitrate) { analysisData.validationChecks.push({ checkName: "Bitrate (Audio)", status: "Pass", message: `Bitrate ${bitrate} kbps is within range.`, value: `${bitrate} kbps`, limit: bitrateLimit }); }
            else { analysisData.validationChecks.push({ checkName: "Bitrate (Audio)", status: "Fail", message: `Bitrate ${bitrate} kbps is outside allowed range.`, value: `${bitrate} kbps`, limit: bitrateLimit }); }
        } else { analysisData.validationChecks.push({ checkName: "Bitrate (Audio)", status: "Warn", message: "Could not determine bitrate." }); }

    } else {
        analysisData.validationChecks.push({ checkName: "Duration (Audio)", status: "Fail", message: "Could not read audio metadata (duration/bitrate)." });
        analysisData.validationChecks.push({ checkName: "Bitrate (Audio)", status: "Fail", message: "Could not read audio metadata (duration/bitrate)." });
    }
}

function validateVideoOlv(analysisData: AnalysisData, metadata: ffmpeg.FfprobeData | null, context: InvocationContext): void {
    context.log("--- EXECUTING validateVideoOlv ---");
    const mime = analysisData.mimeType;
    const blobSize = analysisData.blobSize;

    if (mime && SPEC_LIMITS.video_olv.supportedMimeTypes.includes(mime)) { analysisData.validationChecks.push({ checkName: "File Type (Video OLV)", status: "Pass", message: `Type ${mime} is supported.`, value: mime }); }
    else { analysisData.validationChecks.push({ checkName: "File Type (Video OLV)", status: "Fail", message: `Type ${mime || 'unknown'} is not supported for Video OLV.`, value: mime }); }

    const maxOlvBytes = SPEC_LIMITS.video_olv.maxSizeMB * 1024 * 1024;
    const olvSizeMB = (blobSize / 1024 / 1024).toFixed(1);
    const olvLimit = `${SPEC_LIMITS.video_olv.maxSizeMB} MB`;
    if (blobSize > maxOlvBytes) {
        const msg = `File size (${olvSizeMB} MB) exceeds limit (${olvLimit}).`; context.warn(msg);
        analysisData.validationChecks.push({ checkName: "File Size (Video OLV)", status: "Fail", message: msg, value: `${olvSizeMB} MB`, limit: olvLimit });
    } else {
        const msg = `File size (${olvSizeMB} MB) is within limit (${olvLimit}).`; context.log(msg);
        analysisData.validationChecks.push({ checkName: "File Size (Video OLV)", status: "Pass", message: msg, value: `${olvSizeMB} MB`, limit: olvLimit });
    }

    if (metadata?.format && metadata?.streams) {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const duration = metadata.format.duration;
        const bitrate = metadata.format.bit_rate ? Math.round(metadata.format.bit_rate / 1000) : undefined;
        analysisData.duration = duration;
        analysisData.bitrate = bitrate;
        analysisData.dimensions = videoStream ? { width: videoStream.width, height: videoStream.height } : undefined;
        analysisData.frameRate = videoStream?.r_frame_rate ? eval(videoStream.r_frame_rate) : undefined;

        if (duration !== undefined) {
            const minDur = SPEC_LIMITS.video_olv.minDurationSec;
            const maxDur = SPEC_LIMITS.video_olv.maxDurationSec;
            const durLimit = `${minDur}-${maxDur} sec`;
            if (duration >= minDur && duration <= maxDur) { analysisData.validationChecks.push({ checkName: "Duration (Video OLV)", status: "Pass", message: `Duration ${duration.toFixed(1)}s is within range.`, value: `${duration.toFixed(1)}s`, limit: durLimit }); }
            else { analysisData.validationChecks.push({ checkName: "Duration (Video OLV)", status: "Fail", message: `Duration ${duration.toFixed(1)}s is outside allowed range.`, value: `${duration.toFixed(1)}s`, limit: durLimit }); }
        } else { analysisData.validationChecks.push({ checkName: "Duration (Video OLV)", status: "Warn", message: "Could not determine duration." }); }

        if (bitrate !== undefined) {
            const minBitrate = SPEC_LIMITS.video_olv.minBitrateKbps;
            const maxBitrate = SPEC_LIMITS.video_olv.maxBitrateKbps;
            const bitrateLimit = `${minBitrate}-${maxBitrate} kbps`;
            if (bitrate >= minBitrate && bitrate <= maxBitrate) { analysisData.validationChecks.push({ checkName: "Bitrate (Video OLV)", status: "Pass", message: `Bitrate ${bitrate} kbps is within range.`, value: `${bitrate} kbps`, limit: bitrateLimit }); }
            else { analysisData.validationChecks.push({ checkName: "Bitrate (Video OLV)", status: "Fail", message: `Bitrate ${bitrate} kbps is outside allowed range.`, value: `${bitrate} kbps`, limit: bitrateLimit }); }
        } else { analysisData.validationChecks.push({ checkName: "Bitrate (Video OLV)", status: "Warn", message: "Could not determine bitrate." }); }

        if (analysisData.dimensions?.width && analysisData.dimensions?.height) {
             const dimString = `${analysisData.dimensions.width}x${analysisData.dimensions.height}`;
             analysisData.validationChecks.push({ checkName: "Resolution (Video OLV)", status: "Pass", message: `Resolution is ${dimString}.`, value: dimString });
        } else { analysisData.validationChecks.push({ checkName: "Resolution (Video OLV)", status: "Warn", message: "Could not determine resolution." }); }

    } else {
        analysisData.validationChecks.push({ checkName: "Metadata (Video OLV)", status: "Fail", message: "Could not read video metadata (duration/bitrate/resolution)." });
    }
}

function validateVideoCtv(analysisData: AnalysisData, metadata: ffmpeg.FfprobeData | null, context: InvocationContext): void {
    context.log("--- EXECUTING validateVideoCtv ---");
    const mime = analysisData.mimeType;
    const blobSize = analysisData.blobSize;

     if (mime && SPEC_LIMITS.video_ctv.supportedMimeTypes.includes(mime)) { analysisData.validationChecks.push({ checkName: "File Type (Video CTV)", status: "Pass", message: `Type ${mime} is supported.`, value: mime }); }
    else { analysisData.validationChecks.push({ checkName: "File Type (Video CTV)", status: "Fail", message: `Type ${mime || 'unknown'} is not supported for Video CTV.`, value: mime }); }

    const maxCtvBytes = SPEC_LIMITS.video_ctv.maxSizeGB * 1024 * 1024 * 1024;
    const ctvSizeGB = (blobSize / 1024 / 1024 / 1024).toFixed(1);
    const ctvLimit = `${SPEC_LIMITS.video_ctv.maxSizeGB} GB`;
    if (blobSize > maxCtvBytes) {
        const msg = `File size (${ctvSizeGB} GB) exceeds limit (${ctvLimit}).`; context.warn(msg);
        analysisData.validationChecks.push({ checkName: "File Size (Video CTV)", status: "Fail", message: msg, value: `${ctvSizeGB} GB`, limit: ctvLimit });
    } else {
        const msg = `File size (${ctvSizeGB} GB) is within limit (${ctvLimit}).`; context.log(msg);
        analysisData.validationChecks.push({ checkName: "File Size (Video CTV)", status: "Pass", message: msg, value: `${ctvSizeGB} GB`, limit: ctvLimit });
    }

    if (metadata?.format && metadata?.streams) {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const duration = metadata.format.duration;
        const bitrate = metadata.format.bit_rate ? Math.round(metadata.format.bit_rate / 1000) : undefined;
        analysisData.duration = duration;
        analysisData.bitrate = bitrate;
        analysisData.dimensions = videoStream ? { width: videoStream.width, height: videoStream.height } : undefined;
        analysisData.frameRate = videoStream?.r_frame_rate ? eval(videoStream.r_frame_rate) : undefined;

        if (duration !== undefined) {
            const minDur = SPEC_LIMITS.video_ctv.minDurationSec;
            const maxDur = SPEC_LIMITS.video_ctv.maxDurationSec;
            const durLimit = `${minDur}-${maxDur} sec`;
            if (duration >= minDur && duration <= maxDur) { analysisData.validationChecks.push({ checkName: "Duration (Video CTV)", status: "Pass", message: `Duration ${duration.toFixed(1)}s is within range.`, value: `${duration.toFixed(1)}s`, limit: durLimit }); }
            else { analysisData.validationChecks.push({ checkName: "Duration (Video CTV)", status: "Fail", message: `Duration ${duration.toFixed(1)}s is outside allowed range.`, value: `${duration.toFixed(1)}s`, limit: durLimit }); }
        } else { analysisData.validationChecks.push({ checkName: "Duration (Video CTV)", status: "Warn", message: "Could not determine duration." }); }

        if (bitrate !== undefined) {
            const minBitrate = SPEC_LIMITS.video_ctv.minBitrateKbps;
            const bitrateLimit = `Min ${minBitrate} kbps`;
            if (bitrate >= minBitrate) { analysisData.validationChecks.push({ checkName: "Bitrate (Video CTV)", status: "Pass", message: `Bitrate ${bitrate} kbps meets minimum.`, value: `${bitrate} kbps`, limit: bitrateLimit }); }
            else { analysisData.validationChecks.push({ checkName: "Bitrate (Video CTV)", status: "Fail", message: `Bitrate ${bitrate} kbps is below minimum.`, value: `${bitrate} kbps`, limit: bitrateLimit }); }
        } else { analysisData.validationChecks.push({ checkName: "Bitrate (Video CTV)", status: "Warn", message: "Could not determine bitrate." }); }

        if (analysisData.dimensions?.width && analysisData.dimensions?.height) {
             const dimString = `${analysisData.dimensions.width}x${analysisData.dimensions.height}`;
             const requiredRes = SPEC_LIMITS.video_ctv.requiredResolution;
             if (dimString === requiredRes) { analysisData.validationChecks.push({ checkName: "Resolution (Video CTV)", status: "Pass", message: `Resolution ${dimString} matches required ${requiredRes}.`, value: dimString, limit: requiredRes }); }
             else { analysisData.validationChecks.push({ checkName: "Resolution (Video CTV)", status: "Fail", message: `Resolution ${dimString} does not match required ${requiredRes}.`, value: dimString, limit: requiredRes }); }
        } else { analysisData.validationChecks.push({ checkName: "Resolution (Video CTV)", status: "Warn", message: "Could not determine resolution." }); }

    } else {
        analysisData.validationChecks.push({ checkName: "Metadata (Video CTV)", status: "Fail", message: "Could not read video metadata (duration/bitrate/resolution)." });
    }
}

async function validateHtml5(analysisData: AnalysisData, blob: Buffer, context: InvocationContext): Promise<void> {
    context.log("--- EXECUTING validateHtml5 ---");
    analysisData.html5Info = {};
    context.log("validateHtml5: HTML5 Info initialized.");

    try {
        const zip = new AdmZip(blob);
        const zipEntries = zip.getEntries();
        analysisData.html5Info.fileCount = zipEntries.length;
        context.log(`validateHtml5: ZIP file count: ${zipEntries.length}`);

        const maxFiles = SPEC_LIMITS.html5.maxFileCount;
        if (analysisData.html5Info.fileCount > maxFiles) {
            analysisData.validationChecks.push({ checkName: "File Count (HTML5)", status: "Fail", message: `Exceeds limit of ${maxFiles} files.`, value: analysisData.html5Info.fileCount, limit: maxFiles });
        } else {
            analysisData.validationChecks.push({ checkName: "File Count (HTML5)", status: "Pass", message: `Contains ${analysisData.html5Info.fileCount} files.`, value: analysisData.html5Info.fileCount, limit: maxFiles });
        }

        const primaryHtml = zipEntries.find(entry => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.html') && !entry.entryName.includes('/'));
        if (primaryHtml) {
            analysisData.html5Info.primaryHtmlFile = primaryHtml.entryName;
            analysisData.validationChecks.push({ checkName: "Primary HTML (HTML5)", status: "Pass", message: `Found primary HTML: ${primaryHtml.entryName}`, value: primaryHtml.entryName });
            context.log(`validateHtml5: Primary HTML found: ${primaryHtml.entryName}`);

            const htmlContent = zip.readAsText(primaryHtml);
            const sizeMatch = htmlContent.match(/<meta\s+name=["']ad\.size["']\s+content=["']width=(\d+),height=(\d+)["']\s*\/?>/i);
            if (sizeMatch && sizeMatch[1] && sizeMatch[2]) {
                const adSize = `${sizeMatch[1]}x${sizeMatch[2]}`;
                analysisData.html5Info.adSizeMeta = adSize;
                analysisData.validationChecks.push({ checkName: "Ad Size Meta (HTML5)", status: "Pass", message: `Found ad.size meta tag: ${adSize}`, value: adSize });
            } else {
                analysisData.validationChecks.push({ checkName: "Ad Size Meta (HTML5)", status: "Fail", message: "Required ad.size meta tag not found or invalid." });
            }

            const clickTagFound = htmlContent.includes('clickTAG') || htmlContent.includes('clickTag');
            analysisData.html5Info.clickTagDetected = clickTagFound;
            if (clickTagFound) {
                analysisData.validationChecks.push({ checkName: "ClickTag (HTML5)", status: "Pass", message: `clickTAG/clickTag variable usage detected (basic check).`, value: "Detected" });
            } else {
                analysisData.validationChecks.push({ checkName: "ClickTag (HTML5)", status: "Warn", message: "clickTAG/clickTag variable usage not detected (basic check)." });
            }
        } else {
            analysisData.validationChecks.push({ checkName: "Primary HTML (HTML5)", status: "Fail", message: "No primary HTML file found in the root of the ZIP." });
            context.log("validateHtml5: No primary HTML file found.");
        }

        let totalUncompressedSize = 0;
        let backupImageFile: { name: string, size: number } | undefined;
        zipEntries.forEach(entry => {
            if (!entry.isDirectory) {
                totalUncompressedSize += entry.header.size;
                const entryExt = path.extname(entry.entryName).toLowerCase();
                if (!SPEC_LIMITS.html5.allowedExtensions.includes(entryExt)) {
                    analysisData.validationChecks.push({ checkName: "Allowed Files (HTML5)", status: "Fail", message: `Disallowed file type found: ${entry.entryName}`, value: entry.entryName });
                }
                if (['.jpg', '.jpeg', '.png', '.gif'].includes(entryExt)) {
                    if (!backupImageFile || entry.header.size > backupImageFile.size) {
                        backupImageFile = { name: entry.entryName, size: entry.header.size };
                    }
                }
            }
        });
        analysisData.html5Info.totalUncompressedSize = totalUncompressedSize;
        analysisData.html5Info.backupImageFile = backupImageFile?.name;
        context.log(`validateHtml5: Total uncompressed size: ${totalUncompressedSize}, Backup image: ${backupImageFile?.name}`);

        let extractedBackupBlobName: string | undefined;
        if (backupImageFile?.name) {
            context.log(`validateHtml5: Attempting to extract backup image: ${backupImageFile.name}`);
            try {
                const backupEntry = zip.getEntry(backupImageFile.name);
                if (backupEntry) {
                    const backupImageData = backupEntry.getData();
                    const ext = path.extname(backupImageFile.name).toLowerCase();
                    const contentType = mimeTypes[ext] || 'application/octet-stream';
                    extractedBackupBlobName = `${analysisData.blobName}-backup${ext}`;
                    const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
                    if (connectionString) {
                        const { accountName, accountKey } = getAccountInfo(connectionString);
                        const blobServiceClient = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, new StorageSharedKeyCredential(accountName, accountKey));
                        const containerClient = blobServiceClient.getContainerClient(blobContainerName);
                        const blockBlobClient = containerClient.getBlockBlobClient(extractedBackupBlobName);
                        context.log(`Uploading extracted backup image '${backupImageFile.name}' to blob '${extractedBackupBlobName}' with Content-Type ${contentType}`);
                        await blockBlobClient.uploadData(backupImageData, { blobHTTPHeaders: { blobContentType: contentType } });
                        analysisData.html5Info.extractedBackupBlobName = extractedBackupBlobName;
                        context.log(`Successfully uploaded extracted backup image.`);
                    } else {
                        context.log("WARN: Storage connection string not found, cannot upload extracted backup image.");
                    }
                } else {
                     context.log(`WARN: Backup image entry '${backupImageFile.name}' not found in zip during extraction attempt.`);
                }
            } catch (extractError) {
                 context.log(`ERROR extracting/uploading backup image: ${extractError instanceof Error ? extractError.message : String(extractError)}`);
            }
        }
        context.log(`validateHtml5: completed ZIP processing. Backup image file: ${backupImageFile?.name}, Extracted blob: ${extractedBackupBlobName}`);

        const maxSizeMB = SPEC_LIMITS.html5.maxUncompressedMB;
        const maxSize = maxSizeMB * 1024 * 1024;
        const currentSizeMB = (totalUncompressedSize / 1024 / 1024).toFixed(1);
        if (totalUncompressedSize > maxSize) {
            analysisData.validationChecks.push({ checkName: "Uncompressed Size (HTML5)", status: "Fail", message: `Total uncompressed size (${currentSizeMB} MB) exceeds limit.`, value: `${currentSizeMB} MB`, limit: `${maxSizeMB} MB` });
        } else {
            analysisData.validationChecks.push({ checkName: "Uncompressed Size (HTML5)", status: "Pass", message: `Total uncompressed size (${currentSizeMB} MB) is within limit.`, value: `${currentSizeMB} MB`, limit: `${maxSizeMB} MB` });
        }

        if (analysisData.html5Info.backupImageFile) {
             analysisData.validationChecks.push({ checkName: "Backup Image (HTML5)", status: "Pass", message: `Potential backup image identified: ${analysisData.html5Info.backupImageFile}`, value: analysisData.html5Info.backupImageFile });
        } else {
             analysisData.validationChecks.push({ checkName: "Backup Image (HTML5)", status: "Warn", message: "No image file found in ZIP to identify as backup." });
        }
    } catch (error: unknown) {
        const msg = `Error processing ZIP file: ${error instanceof Error ? error.message : String(error)}`; context.log(`ERROR: ${msg}`);
        analysisData.validationChecks.push({ checkName: "ZIP Processing", status: "Fail", message: "Could not process ZIP file." });
    }
    context.log("--- FINISHED validateHtml5 ---");
}

function validateUnknown(analysisData: AnalysisData, context: InvocationContext): void {
    context.log("--- EXECUTING validateUnknown ---");
    const mime = analysisData.mimeType;
    if (analysisData.validationChecks.every(c => c.checkName !== 'File Type')) {
        analysisData.validationChecks.push({ checkName: "File Type (Unknown)", status: "Warn", message: `No validation rules defined for type ${mime || 'unknown'}.` });
    }
    analysisData.validationChecks.push({ checkName: "Dimensions (Unknown)", status: "NotApplicable", message: "Checks not applicable." });
    analysisData.validationChecks.push({ checkName: "File Size (Unknown)", status: "NotApplicable", message: "Checks not applicable." });
}

// --- Main Azure Function (Refactored Core Logic) ---
// Renamed from analyzeCreative to performCreativeAnalysis
// Added blobNameFromEvent parameter
export async function performCreativeAnalysis(blobContent: Buffer, context: InvocationContext, blobNameFromEvent: string): Promise<void> { // Added export
    // Use blobNameFromEvent (e.g., UUID-OriginalFilename.ext)
    // Extract the UUID part for table storage RowKey consistency.
    // The full blobNameFromEvent is the actual name in blob storage.
    const uuidPart = blobNameFromEvent.split('-')[0];
    const originalFileName = blobNameFromEvent.includes('-') ? blobNameFromEvent.substring(blobNameFromEvent.indexOf('-') + 1) : blobNameFromEvent;

    if (!uuidPart || blobNameFromEvent === 'unknown-blob' || !blobNameFromEvent) { 
        context.log(`ERROR: Could not derive UUID or blob name invalid. UUID Part: '${uuidPart}', Full Name: '${blobNameFromEvent}'`);
        return;
    }
    context.log(`Derived UUID for Table Storage RowKey: ${uuidPart} (from full blob name: ${blobNameFromEvent})`);

    const blobSize = blobContent.length;
    context.log(`Processing blob "${blobNameFromEvent}" (parsed original: "${originalFileName}"), Size: ${blobSize} bytes`);

    const analysisData: AnalysisData = {
        blobName: blobNameFromEvent, // Store the full, actual blob name
        originalFileName: originalFileName, 
        blobSize: blobSize,
        isCtv: false, validationChecks: [], status: 'Processing',
    };
    let tableClient: TableClient | undefined;
    let tempFilePath: string | undefined;

    const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
    if (!connectionString) {
        context.log("ERROR: Azure Storage Connection String not found.");
        analysisData.status = 'Error';
        analysisData.validationChecks.push({ checkName: "Configuration", status: "Fail", message: "Server configuration error: Storage connection missing." });
    } else {
        try {
            const { accountName, accountKey } = getAccountInfo(connectionString);
            const credential = new AzureNamedKeyCredential(accountName, accountKey);
            const tableServiceUrl = `https://${accountName}.table.core.windows.net`;
            const metadataTableClient = new TableClient(tableServiceUrl, metadataTableName, credential);
            tableClient = new TableClient(tableServiceUrl, resultsTableName, credential);
            await tableClient.createTable(); // Ensure table exists

            context.log(`Attempting to retrieve metadata using RowKey (UUID): ${uuidPart}`);
            try {
                // Fetch metadata using the UUID part as RowKey
                const entity = await metadataTableClient.getEntity<{ isCtv: boolean, originalFullBlobName?: string }>(partitionKey, uuidPart);
                if (entity) {
                    if (typeof entity.isCtv === 'boolean') {
                        analysisData.isCtv = entity.isCtv;
                        context.log(`Retrieved metadata for UUID ${uuidPart}: isCtv = ${analysisData.isCtv}`);
                    } else {
                        context.warn(`Metadata 'isCtv' invalid for UUID ${uuidPart}. Assuming isCtv = false.`);
                    }
                    // If originalFullBlobName was stored by setCreativeMetadata, we could use it here,
                    // but originalFileName is already parsed from blobNameFromEvent.
                    // analysisData.originalFileName = entity.originalFullBlobName || originalFileName; 
                } else {
                    context.warn(`Metadata entity not found for RowKey (UUID) ${uuidPart}. Assuming isCtv = false.`);
                }
            } catch (error: unknown) {
                 if (error instanceof RestError && error.statusCode === 404) {
                    context.warn(`Metadata entity not found for RowKey (UUID) ${uuidPart}. Assuming isCtv = false.`);
                 } else {
                    const msg = `Error retrieving metadata for RowKey (UUID) ${uuidPart}: ${error instanceof Error ? error.message : String(error)}`;
                    context.log(`ERROR: ${msg}`);
                 }
            }
        } catch (error: unknown) {
            const msg = `Error initializing table clients: ${error instanceof Error ? error.message : String(error)}`;
            context.log(`ERROR: ${msg}`);
            analysisData.status = 'Error';
            analysisData.validationChecks.push({ checkName: "Configuration", status: "Fail", message: "Error initializing backend storage." });
        }
        context.log(`Metadata retrieval completed. Status: ${analysisData.status}`);
    }

    if (analysisData.status === 'Processing') {
        try {
            // Dynamically import file-type
            const { fileTypeFromBuffer } = await import('file-type');
            const fileTypeResult = await fileTypeFromBuffer(blobContent);
            if (fileTypeResult) {
                analysisData.mimeType = fileTypeResult.mime; analysisData.extension = fileTypeResult.ext;
                context.log(`Detected file type: ${analysisData.mimeType} (.${analysisData.extension})`);
            } else {
                context.warn(`Could not determine file type for blob: ${blobNameFromEvent}. Attempting fallback via extension.`);
                if (analysisData.originalFileName) {
                    const ext = analysisData.originalFileName.split('.').pop()?.toLowerCase();
                    if (ext === 'mp3') analysisData.mimeType = 'audio/mpeg';
                    else if (ext === 'ogg') analysisData.mimeType = 'audio/ogg';
                    else if (ext === 'wav') analysisData.mimeType = 'audio/wav';
                    else if (ext === 'mp4') analysisData.mimeType = 'video/mp4';
                    else if (ext === 'mov') analysisData.mimeType = 'video/quicktime';
                    else if (ext === 'webm') analysisData.mimeType = 'video/webm';
                    else if (ext === 'jpg' || ext === 'jpeg') analysisData.mimeType = 'image/jpeg';
                    else if (ext === 'png') analysisData.mimeType = 'image/png';
                    else if (ext === 'gif') analysisData.mimeType = 'image/gif';
                    else if (ext === 'zip') analysisData.mimeType = 'application/zip';

                    if (analysisData.mimeType) {
                        context.log(`Fallback determined type: ${analysisData.mimeType}`);
                        analysisData.validationChecks.push({ checkName: "File Type", status: "Warn", message: `Could not detect type reliably, inferred ${analysisData.mimeType} from extension.` });
                    } else {
                         analysisData.validationChecks.push({ checkName: "File Type", status: "Fail", message: "Could not determine file type from content or extension." });
                    }
                } else {
                     analysisData.validationChecks.push({ checkName: "File Type", status: "Fail", message: "Could not determine file type (missing filename for fallback)." });
                }
            }
        } catch (error: unknown) {
            const msg = `Error detecting file type: ${error instanceof Error ? error.message : String(error)}`; context.log(`ERROR: ${msg}`);
            analysisData.validationChecks.push({ checkName: "File Type", status: "Fail", message: "Error during detection." });
        }

        const mime = analysisData.mimeType;
        const isCtv = analysisData.isCtv;
        let category: CreativeCategory = 'unknown';

        if (!mime) {
             context.warn("MIME type is undefined after detection and fallback. Categorizing as unknown.");
             category = 'unknown';
        } else if (mime.startsWith('image/')) category = 'display';
        else if (mime.startsWith('audio/')) category = 'audio';
        else if (mime.startsWith('video/')) category = isCtv ? 'video_ctv' : 'video_olv';
        else if (mime === 'application/zip') category = 'html5';

        context.log(`Determined creative category: ${category} (MIME: ${mime || 'N/A'}, isCtv: ${isCtv})`);

        let mediaMetadata: ffmpeg.FfprobeData | null = null;
        if (category === 'audio' || category === 'video_olv' || category === 'video_ctv') {
            try {
                tempFilePath = path.join(os.tmpdir(), blobNameFromEvent); // Use blobNameFromEvent for temp file
                context.log(`Writing blob to temporary file: ${tempFilePath}`);
                await fs.writeFile(tempFilePath, blobContent);
                context.log(`Getting media metadata using ffprobe for: ${tempFilePath}`);
                mediaMetadata = await getMediaMetadata(tempFilePath, context);
                context.log("Successfully retrieved media metadata.");
            } catch (error: unknown) {
                const msg = `Error processing media file with ffprobe: ${error instanceof Error ? error.message : String(error)}`;
                context.log(`ERROR: ${msg}`);
                analysisData.validationChecks.push({ checkName: "Media Metadata", status: "Fail", message: "Could not read media properties (duration, bitrate, etc.)." });
                mediaMetadata = null;
            }
        }

        context.log(`Running validations for category: ${category}`);
        switch (category) {
            case 'display': validateDisplay(analysisData, blobContent, context); break;
            case 'audio': validateAudio(analysisData, mediaMetadata, context); break;
            case 'video_olv': validateVideoOlv(analysisData, mediaMetadata, context); break;
            case 'video_ctv': validateVideoCtv(analysisData, mediaMetadata, context); break;
            case 'html5': await validateHtml5(analysisData, blobContent, context); break;
            default: validateUnknown(analysisData, context); break;
        }

        const hasFailures = analysisData.validationChecks.some(c => c.status === 'Fail');
        analysisData.status = hasFailures ? 'Error' : 'Completed';
        context.log(`Overall analysis status determined: ${analysisData.status}`);
    }

    context.log(`Final analysis data for ${blobNameFromEvent}:`, analysisData);
    if (tableClient) {
        try {
            const resultEntity = {
                partitionKey: partitionKey, rowKey: uuidPart, // Use UUID part as RowKey for results
                fullBlobName: blobNameFromEvent, // Store the full blob name for reference
                status: analysisData.status,
                validationChecksData: JSON.stringify(analysisData.validationChecks),
                originalFileName: analysisData.originalFileName, blobSize: analysisData.blobSize,
                mimeType: analysisData.mimeType, extension: analysisData.extension,
                isCtv: analysisData.isCtv,
                dimensionsData: analysisData.dimensions ? JSON.stringify(analysisData.dimensions) : undefined,
                duration: analysisData.duration, bitrate: analysisData.bitrate, frameRate: analysisData.frameRate,
                html5InfoData: analysisData.html5Info ? JSON.stringify(analysisData.html5Info) : undefined,
            };
            await tableClient.upsertEntity(resultEntity, "Replace");
            context.log(`Successfully stored analysis result for RowKey (UUID): ${uuidPart} (full blob name: ${blobNameFromEvent})`);
        } catch (error: unknown) {
             const msg = `Error storing analysis result for RowKey (UUID) ${uuidPart}: ${error instanceof Error ? error.message : String(error)}`;
             context.log(`ERROR storing analysis result for ${uuidPart}: ${msg}`, error);
        }
    } else {
         context.log(`WARNING: Table client not initialized. Could not store analysis result for RowKey (UUID) ${uuidPart}.`);
    }

    if (tempFilePath) {
        try {
            context.log(`Deleting temporary file: ${tempFilePath}`);
            await fs.unlink(tempFilePath);
        } catch (error: unknown) {
             const msg = `Error deleting temporary file ${tempFilePath}: ${error instanceof Error ? error.message : String(error)}`; context.log(`WARN: ${msg}`);
        }
    }
}

// Helper to convert stream to buffer
async function streamToBuffer(readableStream: NodeJS.ReadableStream, context?: InvocationContext): Promise<Buffer> {
    // Correctly use context.log or console.log
    const log = (message: string, ...optionalParams: any[]) => {
        if (context && typeof context.log === 'function') {
            context.log(message, ...optionalParams);
        } else {
            console.log(message, ...optionalParams);
        }
    };

    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        log('[STREAM_DEBUG] streamToBuffer: Attaching listeners.'); 
        readableStream.on('data', (data: Buffer | string) => {
            log('[STREAM_DEBUG] streamToBuffer: data event received.'); 
            chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        });
        readableStream.on('end', () => {
            log('[STREAM_DEBUG] streamToBuffer: end event received.'); 
            resolve(Buffer.concat(chunks));
        });
        readableStream.on('error', (err) => {
            log(`[STREAM_DEBUG] streamToBuffer: error event received: ${err.message}`); 
            reject(err);
        });
    });
}

// New HTTP Trigger for Event Grid Events
export const analyzeCreativeHttpEventGridHandler = async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const requestData = await request.json(); 
    
    // Handle Event Grid Subscription Validation Handshake
    if (Array.isArray(requestData) && requestData.length > 0 && requestData[0].eventType === "Microsoft.EventGrid.SubscriptionValidationEvent") {
        const validationEvent = requestData[0];
        if (validationEvent.data && validationEvent.data.validationCode) {
            const validationCode = validationEvent.data.validationCode;
            context.log(`Responding to Event Grid validation handshake with code: ${validationCode}`);
            return {
                status: 200,
                jsonBody: {
                    validationResponse: validationCode
                }
            };
        } else {
            context.error("SubscriptionValidationEvent received, but validationCode is missing in data.");
            return { status: 400, body: "Validation event received, but validationCode missing." };
        }
    }

    const eventGridEvents = requestData as EventGridEvent<StorageBlobCreatedEventData>[];
    context.log(`Received ${eventGridEvents.length} Event Grid event(s) for processing.`);

        for (const event of eventGridEvents) {
            if (event.eventType === 'Microsoft.Storage.BlobCreated') {
                const blobUrl = event.data.url;
                context.log(`Processing BlobCreated event for URL: ${blobUrl}`); 

                try { 
                    context.log('[HANDLER_ENTRY_TRY_BLOCK] Entered try block for event processing.');
                    const url = new URL(blobUrl);
                    const pathSegments = url.pathname.split('/').filter(segment => segment.length > 0);
                    
                    if (pathSegments.length < 2) {
                        context.error(`Could not parse container and blob name from URL: ${blobUrl}`); 
                        continue;
                    }
                    const containerNameFromUrl = pathSegments[0];
                    // Reconstruct the blob name from path segments. url.pathname is already decoded.
                    const rawBlobNameFromPathSegments = pathSegments.slice(1).join('/');
                    // Explicitly decode this reconstructed path to ensure it's the semantic name (spaces are spaces).
                    const decodedBlobNameForSDK = decodeURIComponent(rawBlobNameFromPathSegments);

                    context.log(`[DEBUG] Original blobUrl from event: ${blobUrl}`);
                    context.log(`[DEBUG] Parsed container: ${containerNameFromUrl}`);
                    context.log(`[DEBUG] Raw blob name from path segments (after .pathname decode): ${rawBlobNameFromPathSegments}`);
                    context.log(`[DEBUG] Decoded blob name for SDK: ${decodedBlobNameForSDK}`);
                    
                    const connectionString = process.env.AzureWebJobsStorage_ConnectionString;
                    if (!connectionString) {
                        context.error("Azure Storage Connection String not found."); 
                        continue; 
                    }

                    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
                    const containerClient = blobServiceClient.getContainerClient(containerNameFromUrl);
                    // Pass the fully decoded blob name to the SDK client.
                    // The SDK will handle URI encoding this name when making the actual HTTP request.
                    const specificBlobClient = containerClient.getBlobClient(decodedBlobNameForSDK); 
                    context.log(`[HANDLER_TRACE] Before specificBlobClient.download() for (using decoded name): ${decodedBlobNameForSDK}`);

                    let downloadResponse;
                    const maxRetries = 5; 
                    const retryDelayMs = 6000; 
                    let attempt = 0;
                    let blobDownloaded = false;

                    while (attempt < maxRetries && !blobDownloaded) {
                        attempt++;
                        try {
                            context.log(`[HANDLER_TRACE] Attempt ${attempt} to download blob: ${decodedBlobNameForSDK}`);
                            downloadResponse = await specificBlobClient.download();
                            context.log(`[HANDLER_TRACE] downloadResponse object (Attempt ${attempt}):`, downloadResponse); 
                            context.log(`[HANDLER_TRACE] After specificBlobClient.download() (Attempt ${attempt}). Response has readableStreamBody: ${!!downloadResponse?.readableStreamBody}`);
                            if (downloadResponse?.readableStreamBody) {
                                blobDownloaded = true;
                            } else {
                                context.warn(`[HANDLER_TRACE] Download attempt ${attempt} for ${decodedBlobNameForSDK} resolved but no readableStreamBody.`);
                                if (attempt < maxRetries) await delay(retryDelayMs); else throw new Error("No readableStreamBody after max retries.");
                            }
                        } catch (downloadError) {
                            if (downloadError instanceof RestError && downloadError.statusCode === 404 && attempt < maxRetries) {
                                context.warn(`[HANDLER_TRACE] Blob ${decodedBlobNameForSDK} not found on attempt ${attempt}. Retrying in ${retryDelayMs}ms...`);
                                await delay(retryDelayMs);
                            } else {
                                throw downloadError; 
                            }
                        }
                    }

                    if (!blobDownloaded || !downloadResponse?.readableStreamBody) {
                        context.error(`Failed to get readable stream for blob: ${decodedBlobNameForSDK} after ${maxRetries} attempts.`);
                        continue; 
                    }
                    
                    const blobContent = await streamToBuffer(downloadResponse.readableStreamBody, context);
                    context.log(`Successfully downloaded blob: ${decodedBlobNameForSDK}, size: ${blobContent.length} bytes`);

                    // Pass the decoded blob name to performCreativeAnalysis
                    await performCreativeAnalysis(blobContent, context, decodedBlobNameForSDK);

                } catch (innerErr) { 
                    context.error(`Error processing event for blob URL ${blobUrl}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`, innerErr);
                }
            } else {
                context.log(`Received event of type ${event.eventType}, not 'Microsoft.Storage.BlobCreated'. Skipping.`);
            }
        }
        return { status: 200, body: "Events processed." };
    };


// Remove or comment out the old storageBlob trigger
// app.storageBlob('analyzeCreative', {
//     path: 'files-processing/{name}',
//     connection: 'AzureWebJobsStorage_ConnectionString',
//     handler: analyzeCreative // This would now point to the old signature
// });

app.http('analyzeCreativeHttpEventGridTrigger', {
    methods: ['POST'],
    authLevel: 'function', 
    handler: analyzeCreativeHttpEventGridHandler
});
