import { Asset, } from 'expo-asset';
import { Image } from 'react-native';
import * as ort from 'onnxruntime-react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { decode as atob } from 'base-64';
import jpeg from 'jpeg-js';

/**
 * Loads the YOLOv8 ONNX model from the bundled asset.
 * @returns A promise that resolves to an InferenceSession or null if loading fails.
 */
export async function loadYoloModel(): Promise<ort.InferenceSession | null> {
    try {
        const modelAsset = Asset.fromModule(require('./assets/models/yolov8n.onnx'));
        // Ensure the asset is downloaded locally.
        await modelAsset.downloadAsync();
        const localUri = modelAsset.localUri || modelAsset.uri;
        const session = await ort.InferenceSession.create(localUri, {
            executionProviders: ['xnnpack'], // XNNPACK first, then NNAPI
            graphOptimizationLevel: 'all'
        });

        console.log('YOLOv8 model loaded successfully');
        return session;
    } catch (error) {
        console.error('Failed to load the YOLOv8 model:', error);
        return null;
    }
}

/**
 * Helper function to get image dimensions using React Native's Image.getSize.
 */
function getImageDimensions(imageUri: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        Image.getSize(
            imageUri,
            (width, height) => resolve({ width, height }),
            (error) => reject(error)
        );
    });
}

/**
 * Converts an image (given by its URI) into an ONNX Tensor with shape [1, 3, 640, 640]
 * using a letterbox approach to preserve the aspect ratio.
 *
 * Steps:
 * 1. Get the original dimensions with Image.getSize.
 * 2. Compute a scale factor so that the image fits inside a 640x640 box.
 * 3. Resize the image to the new dimensions using a single call to ImageManipulator.
 * 4. Create a blank 640x640 canvas and copy the resized image into the center.
 * 5. Convert the final image (in HWC format) to CHW format and normalize pixel values.
 *
 * @param imageUri - The local URI of the image.
 * @returns A promise that resolves to an ONNX Tensor.
 */
export async function imageToTensor(imageUri: string): Promise<ort.Tensor> {
    const targetSize = 640;

    // Step 1: Get the original image dimensions without heavy decoding.
    const { width: origWidth, height: origHeight } = await getImageDimensions(imageUri);

    // Step 2: Compute scale factor and new dimensions (preserving aspect ratio).
    const scale = Math.min(targetSize / origWidth, targetSize / origHeight);
    const newWidth = Math.round(origWidth * scale);
    const newHeight = Math.round(origHeight * scale);

    // Step 3: Resize the image to new dimensions using ImageManipulator.
    const manipulated = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: newWidth, height: newHeight } }],
        { base64: true, compress: 1 }
    );
    if (!manipulated.base64) {
        throw new Error("Failed to retrieve base64 data from resized image.");
    }
    const binaryStr = atob(manipulated.base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    const decoded = jpeg.decode(bytes, { useTArray: true });
    const resizedData = decoded.data; // RGBA data

    // Step 4: Create a blank canvas of targetSize x targetSize (RGB only)
    const finalWidth = targetSize;
    const finalHeight = targetSize;
    const finalData = new Float32Array(finalWidth * finalHeight * 3);
    // Compute offsets to center the resized image.
    const xOffset = Math.floor((finalWidth - newWidth) / 2);
    const yOffset = Math.floor((finalHeight - newHeight) / 2);

    // Copy the resized image's RGB data into finalData (skipping the alpha channel).
    for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
            const resizedIndex = (y * newWidth + x) * 4;
            const r = resizedData[resizedIndex];
            const g = resizedData[resizedIndex + 1];
            const b = resizedData[resizedIndex + 2];
            const finalX = x + xOffset;
            const finalY = y + yOffset;
            const finalIndex = (finalY * finalWidth + finalX) * 3;
            finalData[finalIndex] = r / 255.0;
            finalData[finalIndex + 1] = g / 255.0;
            finalData[finalIndex + 2] = b / 255.0;
        }
    }

    // Step 5: Convert from HWC (finalHeight, finalWidth, 3) to CHW (3, finalHeight, finalWidth).
    const chwData = new Float32Array(3 * finalWidth * finalHeight);
    for (let h = 0; h < finalHeight; h++) {
        for (let w = 0; w < finalWidth; w++) {
            for (let c = 0; c < 3; c++) {
                const idxHWC = h * finalWidth * 3 + w * 3 + c;
                const idxCHW = c * finalWidth * finalHeight + h * finalWidth + w;
                chwData[idxCHW] = finalData[idxHWC];
            }
        }
    }

    const tensor = new ort.Tensor('float32', chwData, [1, 3, finalHeight, finalWidth]);
    
    // Optional: Quick validation (uncomment for debugging)
    // console.log(`✅ Created tensor from ${imageUri}`);
    // console.log(`   Shape: [${tensor.dims.join(', ')}]`);
    // console.log(`   Value range: [${Math.min(...chwData).toFixed(4)}, ${Math.max(...chwData).toFixed(4)}]`);
    
    return tensor;
}

/**
 * Calculate Intersection over Union (IoU) for two bounding boxes
 */
function calculateIoU(box1: any, box2: any): number {
    const x1 = Math.max(box1.x1, box2.x1);
    const y1 = Math.max(box1.y1, box2.y1);
    const x2 = Math.min(box1.x2, box2.x2);
    const y2 = Math.min(box1.y2, box2.y2);
    
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
    const area2 = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);
    const union = area1 + area2 - intersection;
    
    return intersection / union;
}

/**
 * Apply Non-Maximum Suppression to remove overlapping detections
 */
function applyNMS(detections: any[], iouThreshold: number = 0.5): any[] {
    if (detections.length === 0) return [];
    
    // Sort by confidence (highest first)
    detections.sort((a, b) => b.confidence - a.confidence);
    
    const selectedDetections = [];
    const suppressed = new Set();
    
    for (let i = 0; i < detections.length; i++) {
        if (suppressed.has(i)) continue;
        
        selectedDetections.push(detections[i]);
        
        // Suppress overlapping boxes
        for (let j = i + 1; j < detections.length; j++) {
            if (suppressed.has(j)) continue;
            
            const iou = calculateIoU(detections[i], detections[j]);
            if (iou > iouThreshold) {
                suppressed.add(j);
            }
        }
    }
    
    return selectedDetections;
}

/**
 * Detection result containing person count and bounding box information
 */
export interface DetectionResult {
    personCount: number;
    detections: Array<{
        confidence: number;
        bbox: {
            x_center: number;
            y_center: number;
            width: number;
            height: number;
        };
    }>;
}

/**
 * Extended detection result containing both persons and chairs
 */
export interface PersonChairDetectionResult {
    personCount: number;
    chairCount: number;
    persons: Array<{
        confidence: number;
        bbox: {
            x_center: number;
            y_center: number;
            width: number;
            height: number;
        };
    }>;
    chairs: Array<{
        confidence: number;
        bbox: {
            x_center: number;
            y_center: number;
            width: number;
            height: number;
        };
    }>;
}

/**
 * Result of winner detection analysis
 */
export interface WinnerDetectionResult {
    success: boolean;
    winnerImage?: string; // URI of cropped winner image
    fullImage: string; // URI of full captured image
    confidence?: number;
    attempts: number;
}

/**
 * Processes the output tensor from the YOLOv8 model and returns detection results.
 * 
 * CRITICAL: YOLOv8 ONNX outputs [1, 84, 8400] format where:
 * - 84 features = 4 (bbox: x_center, y_center, width, height) + 80 (class scores)
 * - 8400 detections = Grid cells from different scales
 * - Person class = 0 (not 56!)
 * 
 * @param outputTensor - The output tensor from the model with shape [1, 84, 8400].
 * @returns Detection results with person count and bounding boxes.
 */
export function processOutputTensorToCountPersons(outputTensor: ort.Tensor): DetectionResult {
    const threshold = 0.7; // Increased threshold for fewer false positives
    const data = outputTensor.data as Float32Array;
    const [batch, features, numDetections] = outputTensor.dims; // [1, 84, 8400]
    
    console.log(`🔍 Processing output tensor: [${outputTensor.dims.join(', ')}]`);
    
    if (features !== 84 || numDetections !== 8400) {
        console.error(`❌ Unexpected output format: expected [1, 84, 8400], got [${outputTensor.dims.join(', ')}]`);
        return { personCount: 0, detections: [] };
    }
    
    let personCount = 0;
    let totalDetections = 0;
    const rawDetections: any[] = [];
    
    // First pass: collect all potential person detections
    for (let i = 0; i < numDetections; i++) {
        // Get bounding box coordinates (first 4 features) - normalized 0-1
        const x_center = data[0 * numDetections + i]; // Feature 0
        const y_center = data[1 * numDetections + i]; // Feature 1
        const width = data[2 * numDetections + i];    // Feature 2
        const height = data[3 * numDetections + i];   // Feature 3
        
        // Get class scores (features 4-83 = 80 classes)
        let maxClassScore = -Infinity;
        let bestClassId = -1;
        
        for (let classIdx = 0; classIdx < 80; classIdx++) {
            const featureIdx = 4 + classIdx; // Features 4-83
            const classScore = data[featureIdx * numDetections + i];
            
            if (classScore > maxClassScore) {
                maxClassScore = classScore;
                bestClassId = classIdx;
            }
        }
        
        // Count all detections above threshold for debugging
        if (maxClassScore >= 0.1) { // Lower threshold for debugging
            totalDetections++;
        }
        
        // Check if this is a person (class 0) with sufficient confidence
        if (bestClassId === 0 && maxClassScore >= threshold) {
            // Convert to pixel coordinates for NMS
            const x1 = x_center - width / 2;
            const y1 = y_center - height / 2;
            const x2 = x_center + width / 2;
            const y2 = y_center + height / 2;
            
            // Only add detections with reasonable size (filter out tiny detections)
            if (width > 0.02 && height > 0.02) { // At least 2% of image size
                rawDetections.push({
                    confidence: maxClassScore,
                    bbox: { x_center, y_center, width, height },
                    x1, y1, x2, y2
                });
            }
        }
    }
    
    // Apply Non-Maximum Suppression to remove overlapping detections
    const nmsFilteredDetections = applyNMS(rawDetections, 0.5);
    
    // Convert back to the expected format
    const detections: DetectionResult['detections'] = nmsFilteredDetections.map(det => ({
        confidence: det.confidence,
        bbox: det.bbox
    }));
    
    personCount = detections.length;
    
    // Log detection details
    console.log(`🔍 Raw detections: ${rawDetections.length}, After NMS: ${personCount}`);
    detections.forEach((det, idx) => {
        console.log(`✅ Person ${idx + 1}: confidence=${det.confidence.toFixed(3)}, ` +
                   `bbox=[${det.bbox.x_center.toFixed(3)}, ${det.bbox.y_center.toFixed(3)}, ${det.bbox.width.toFixed(3)}, ${det.bbox.height.toFixed(3)}]`);
    });
    
    console.log(`📊 Detection Summary:`);
    console.log(`   • Total detections (>0.1 conf): ${totalDetections}`);
    console.log(`   • Person detections (>${threshold} conf): ${rawDetections.length}`);
    console.log(`   • After NMS filtering: ${personCount}`);
    console.log(`🎯 Final result: ${personCount} person${personCount !== 1 ? 's' : ''} detected`);
    
    return {
        personCount,
        detections
    };
}

/**
 * Processes the output tensor from the YOLOv8 model to detect both persons and chairs.
 * 
 * @param outputTensor - The output tensor from the model with shape [1, 84, 8400].
 * @returns Detection results with person and chair counts and bounding boxes.
 */
export function processOutputTensorToCountPersonsAndChairs(outputTensor: ort.Tensor): PersonChairDetectionResult {
    const threshold = 0.7; // Increased threshold for fewer false positives
    const data = outputTensor.data as Float32Array;
    const [batch, features, numDetections] = outputTensor.dims; // [1, 84, 8400]
    
    console.log(`🔍 Processing output tensor for persons and chairs: [${outputTensor.dims.join(', ')}]`);
    
    if (features !== 84 || numDetections !== 8400) {
        console.error(`❌ Unexpected output format: expected [1, 84, 8400], got [${outputTensor.dims.join(', ')}]`);
        return { personCount: 0, chairCount: 0, persons: [], chairs: [] };
    }
    
    const rawPersons: any[] = [];
    const rawChairs: any[] = [];
    
    // First pass: collect all potential person and chair detections
    for (let i = 0; i < numDetections; i++) {
        // Get bounding box coordinates (first 4 features) - normalized 0-1
        const x_center = data[0 * numDetections + i]; // Feature 0
        const y_center = data[1 * numDetections + i]; // Feature 1
        const width = data[2 * numDetections + i];    // Feature 2
        const height = data[3 * numDetections + i];   // Feature 3
        
        // Get class scores (features 4-83 = 80 classes)
        let maxClassScore = -Infinity;
        let bestClassId = -1;
        
        for (let classIdx = 0; classIdx < 80; classIdx++) {
            const featureIdx = 4 + classIdx; // Features 4-83
            const classScore = data[featureIdx * numDetections + i];
            
            if (classScore > maxClassScore) {
                maxClassScore = classScore;
                bestClassId = classIdx;
            }
        }
        
        // Check if this is a person (class 0) or chair (class 56) with sufficient confidence
        // NOTE: COCO class indices: person=0, chair=56 (verified from official Ultralytics COCO YAML)
        if (maxClassScore >= threshold && (bestClassId === 0 || bestClassId === 56)) {
            // Only add detections with reasonable size (filter out tiny detections)
            if (width > 0.02 && height > 0.02) { // At least 2% of image size
                const detection = {
                    confidence: maxClassScore,
                    bbox: { x_center, y_center, width, height },
                    x1: x_center - width / 2,
                    y1: y_center - height / 2,
                    x2: x_center + width / 2,
                    y2: y_center + height / 2
                };
                
                if (bestClassId === 0) {
                    rawPersons.push(detection);
                } else if (bestClassId === 56) {
                    rawChairs.push(detection);
                }
            }
        }
    }
    
    // Apply Non-Maximum Suppression to remove overlapping detections
    const nmsPersons = applyNMS(rawPersons, 0.5);
    const nmsChairs = applyNMS(rawChairs, 0.5);
    
    // Convert back to the expected format
    const persons: PersonChairDetectionResult['persons'] = nmsPersons.map(det => ({
        confidence: det.confidence,
        bbox: det.bbox
    }));
    
    const chairs: PersonChairDetectionResult['chairs'] = nmsChairs.map(det => ({
        confidence: det.confidence,
        bbox: det.bbox
    }));
    
    console.log(`🔍 Detection Summary:`);
    console.log(`   • Persons detected: ${persons.length}`);
    console.log(`   • Chairs detected: ${chairs.length}`);
    
    return {
        personCount: persons.length,
        chairCount: chairs.length,
        persons,
        chairs
    };
}

/**
 * Runs local inference on the given image and returns detection results.
 * Measures timing for each major step.
 *
 * @param session - The ONNX InferenceSession.
 * @param imageUri - The URI of the input image.
 * @returns A promise that resolves to detection results.
 */
export async function runLocalInference(
    session: ort.InferenceSession,
    imageUri: string
): Promise<DetectionResult> {
    const totalStart = Date.now();

    const preprocessStart = Date.now();
    const inputTensor = await imageToTensor(imageUri);
    const preprocessEnd = Date.now();
    console.log(`🖼️ Preprocessing (imageToTensor): ${preprocessEnd - preprocessStart} ms`);

    // ✅ BASIC TENSOR VALIDATION
    console.log(`🎯 Input tensor: [${inputTensor.dims.join(', ')}], length: ${inputTensor.data.length}`);
    const data = inputTensor.data as Float32Array;
    console.log(`   Value range: [${data[0].toFixed(4)}, ${data[data.length-1].toFixed(4)}]`);
    console.log(`   Sample: [${data[0].toFixed(4)}, ${data[1].toFixed(4)}, ${data[2].toFixed(4)}]`);
    
    // Skip full validation to avoid stack overflow

    const inferenceStart = Date.now();
    const feeds = { images: inputTensor };
    const results = await session.run(feeds);
    const inferenceEnd = Date.now();
    console.log(`🧠 ONNX Inference: ${inferenceEnd - inferenceStart} ms`);

    const postprocessStart = Date.now();
    const outputTensor = results["output0"];
    if (!outputTensor) {
        throw new Error("No output tensor found in inference results.");
    }
    const detectionResults = processOutputTensorToCountPersons(outputTensor);
    const postprocessEnd = Date.now();
    console.log(`📊 Postprocessing (count persons): ${postprocessEnd - postprocessStart} ms`);

    const totalEnd = Date.now();
    console.log(`🕐 Total Inference Time: ${totalEnd - totalStart} ms`);

    // Optional debug info
    console.log("Output tensor shape:", outputTensor.dims);
    console.log("First 20 output values:", outputTensor.data.slice(0, 20));

    return detectionResults;
}

/**
 * Advanced validation to check if the tensor content makes sense for an image
 */
export async function validateImageTensorContent(tensor: ort.Tensor, originalImageUri: string): Promise<void> {
    console.log("\n🔍 Advanced Image Tensor Content Validation");
    
    const data = tensor.data as Float32Array;
    const [batch, channels, height, width] = tensor.dims;
    
    console.log(`Original image URI: ${originalImageUri}`);
    console.log(`Tensor dimensions: ${batch}x${channels}x${height}x${width}`);
    
    // Check if dimensions are reasonable for YOLOv8
    const expectedShape = [1, 3, 640, 640];
    const shapeCorrect = tensor.dims.every((dim, i) => dim === expectedShape[i]);
    console.log(`Expected shape [1,3,640,640]: ${shapeCorrect ? '✅' : '❌'}`);
    
    // Analyze each color channel separately
    const pixelsPerChannel = height * width;
    
    for (let c = 0; c < channels; c++) {
        const channelStart = c * pixelsPerChannel;
        const channelEnd = channelStart + pixelsPerChannel;
        
        // Optimized statistics calculation for large arrays
        let min = data[channelStart];
        let max = data[channelStart];
        let sum = 0;
        let sumSquares = 0;
        
        for (let i = channelStart; i < channelEnd; i++) {
            const val = data[i];
            if (val < min) min = val;
            if (val > max) max = val;
            sum += val;
            sumSquares += val * val;
        }
        
        const mean = sum / pixelsPerChannel;
        const variance = (sumSquares / pixelsPerChannel) - (mean * mean);
        const std = Math.sqrt(variance);
        
        const channelName = ['Red', 'Green', 'Blue'][c];
        console.log(`${channelName} channel - Min: ${min.toFixed(4)}, Max: ${max.toFixed(4)}, Mean: ${mean.toFixed(4)}, Std: ${std.toFixed(4)}`);
        
        // Check for reasonable image statistics
        const hasVariation = std > 0.01; // Images should have some variation
        const inValidRange = min >= 0 && max <= 1.0;
        console.log(`${channelName} validation - Has variation: ${hasVariation ? '✅' : '❌'}, In range [0,1]: ${inValidRange ? '✅' : '❌'}`);
    }
    
    // Sample pixel values from different locations
    console.log("\n📍 Sample pixel values (RGB at different locations):");
    const locations = [
        { name: "Top-left", x: 0, y: 0 },
        { name: "Top-right", x: width-1, y: 0 },
        { name: "Center", x: Math.floor(width/2), y: Math.floor(height/2) },
        { name: "Bottom-left", x: 0, y: height-1 },
        { name: "Bottom-right", x: width-1, y: height-1 }
    ];
    
    locations.forEach(loc => {
        const pixelIndex = loc.y * width + loc.x;
        const r = data[pixelIndex].toFixed(4);
        const g = data[pixelsPerChannel + pixelIndex].toFixed(4);
        const b = data[2 * pixelsPerChannel + pixelIndex].toFixed(4);
        console.log(`${loc.name} (${loc.x},${loc.y}): R=${r}, G=${g}, B=${b}`);
    });
    
    // Check for common tensor creation errors - optimized
    let allZeros = true;
    let allOnes = true;
    let allSame = true;
    const firstValue = data[0];
    
    // Sample check instead of checking all values to avoid stack overflow
    const sampleSize = Math.min(10000, data.length);
    const step = Math.floor(data.length / sampleSize);
    
    for (let i = 0; i < data.length; i += step) {
        const val = data[i];
        if (val !== 0) allZeros = false;
        if (val !== 1) allOnes = false;
        if (val !== firstValue) allSame = false;
        if (!allZeros && !allOnes && !allSame) break; // Early exit
    }
    
    console.log("\n⚠️ Error Checks:");
    console.log(`All zeros: ${allZeros ? '❌ ERROR' : '✅'}`);
    console.log(`All ones: ${allOnes ? '❌ ERROR' : '✅'}`);
    console.log(`All same value: ${allSame ? '❌ ERROR' : '✅'}`);
    
    // Check if RGB channels are properly separated (CHW format) - optimized
    let firstChannelSum = 0;
    let secondChannelSum = 0;
    let thirdChannelSum = 0;
    
    for (let i = 0; i < pixelsPerChannel; i++) {
        firstChannelSum += data[i];
        secondChannelSum += data[pixelsPerChannel + i];
        thirdChannelSum += data[2 * pixelsPerChannel + i];
    }
    
    const firstChannelMean = firstChannelSum / pixelsPerChannel;
    const secondChannelMean = secondChannelSum / pixelsPerChannel;
    const thirdChannelMean = thirdChannelSum / pixelsPerChannel;
    
    console.log(`\n📊 Channel means - R: ${firstChannelMean.toFixed(4)}, G: ${secondChannelMean.toFixed(4)}, B: ${thirdChannelMean.toFixed(4)}`);
    const channelsSeparated = Math.abs(firstChannelMean - secondChannelMean) > 0.001 || 
                             Math.abs(secondChannelMean - thirdChannelMean) > 0.001;
    console.log(`Channels properly separated: ${channelsSeparated ? '✅' : '⚠️ May be grayscale or error'}`);
    
    console.log("🔍 Content validation complete\n");
}

/**
 * Validates and logs tensor properties for debugging
 */
export function validateTensor(tensor: ort.Tensor, description: string = "Tensor"): void {
    console.log(`\n=== ${description} Validation ===`);
    console.log(`Shape: [${tensor.dims.join(', ')}]`);
    console.log(`Type: ${tensor.type}`);
    console.log(`Data length: ${tensor.data.length}`);
    
    const data = tensor.data as Float32Array;
    
    // Check if data length matches expected from shape
    const expectedLength = tensor.dims.reduce((a, b) => a * b, 1);
    console.log(`Expected length from shape: ${expectedLength}`);
    console.log(`Actual length: ${data.length}`);
    console.log(`Length match: ${expectedLength === data.length ? '✅' : '❌'}`);
    
    // Check data range (should be 0-1 for normalized images) - optimized for large arrays
    let min = data[0];
    let max = data[0];
    let sum = 0;
    
    for (let i = 0; i < data.length; i++) {
        const val = data[i];
        if (val < min) min = val;
        if (val > max) max = val;
        sum += val;
    }
    const mean = sum / data.length;
    
    console.log(`Value range: ${min.toFixed(4)} to ${max.toFixed(4)}`);
    console.log(`Mean value: ${mean.toFixed(4)}`);
    console.log(`Range check (0-1): ${min >= 0 && max <= 1 ? '✅' : '❌'}`);
    
    // Sample some values from different channels
    console.log("Sample values:");
    console.log(`R channel [0,0]: ${data[0].toFixed(4)}`);
    console.log(`G channel [0,0]: ${data[640*640].toFixed(4)}`);
    console.log(`B channel [0,0]: ${data[640*640*2].toFixed(4)}`);
    console.log(`Center pixel R: ${data[640*320 + 320].toFixed(4)}`);
    
    // Check for all zeros (common error) - optimized count
    let nonZeroCount = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) nonZeroCount++;
    }
    console.log(`Non-zero values: ${nonZeroCount}/${data.length} (${(nonZeroCount/data.length*100).toFixed(1)}%)`);
    console.log(`Has content: ${nonZeroCount > data.length * 0.1 ? '✅' : '❌'}`);
    console.log("=====================================\n");
}

/**
 * Creates a canvas image with bounding boxes drawn around detected persons
 * @param imageUri - Original image URI
 * @param detections - Detection results with bounding boxes
 * @param imageWidth - Original image width
 * @param imageHeight - Original image height
 * @returns Promise<string> - Data URI of the image with bounding boxes
 */
export async function drawBoundingBoxes(
    imageUri: string,
    detections: DetectionResult['detections'],
    imageWidth: number,
    imageHeight: number
): Promise<string> {
    try {
        // For React Native, we'll create a simple overlay approach
        // Since Canvas API is limited, we'll use ImageManipulator to create a visualization
        
        console.log(`🎨 Drawing ${detections.length} bounding boxes on ${imageWidth}x${imageHeight} image`);
        
        // For now, return the original image URI
        // In a future enhancement, you could use react-native-canvas or similar
        // to actually draw bounding boxes
        
        return imageUri;
        
    } catch (error) {
        console.error('Error drawing bounding boxes:', error);
        return imageUri;
    }
}

/**
 * Converts normalized coordinates to pixel coordinates
 */
export function convertToPixelCoords(
    bbox: { x_center: number; y_center: number; width: number; height: number },
    imageWidth: number,
    imageHeight: number
) {
    const pixelX = Math.round(bbox.x_center * imageWidth);
    const pixelY = Math.round(bbox.y_center * imageHeight);
    const pixelWidth = Math.round(bbox.width * imageWidth);
    const pixelHeight = Math.round(bbox.height * imageHeight);
    
    const x1 = Math.round(pixelX - pixelWidth / 2);
    const y1 = Math.round(pixelY - pixelHeight / 2);
    const x2 = Math.round(pixelX + pixelWidth / 2);
    const y2 = Math.round(pixelY + pixelHeight / 2);
    
    return { x1, y1, x2, y2, pixelX, pixelY, pixelWidth, pixelHeight };
}

/**
 * Saves tensor data as a readable format for manual inspection
 */
export function saveTensorSample(tensor: ort.Tensor, sampleSize: number = 100): void {
    const data = tensor.data as Float32Array;
    const sample = Array.from(data.slice(0, sampleSize));
    console.log("Tensor sample (first 100 values):");
    console.log(sample.map(v => v.toFixed(4)).join(', '));
}

/**
 * Creates a simple tensor visualization by logging ASCII representation
 * Useful for quickly checking if the image data looks reasonable
 */
export function visualizeTensorAsASCII(tensor: ort.Tensor, sampleSize: number = 20): void {
    console.log("\n🎨 ASCII Tensor Visualization (20x20 sample from center):");
    
    const data = tensor.data as Float32Array;
    const [batch, channels, height, width] = tensor.dims;
    
    // Take a small sample from the center of the image (red channel only)
    const centerY = Math.floor(height / 2);
    const centerX = Math.floor(width / 2);
    const startY = centerY - Math.floor(sampleSize / 2);
    const startX = centerX - Math.floor(sampleSize / 2);
    
    console.log(`Sampling ${sampleSize}x${sampleSize} from center region starting at (${startX}, ${startY})`);
    
    let ascii = "";
    for (let y = 0; y < sampleSize; y++) {
        let row = "";
        for (let x = 0; x < sampleSize; x++) {
            const actualY = startY + y;
            const actualX = startX + x;
            
            if (actualY >= 0 && actualY < height && actualX >= 0 && actualX < width) {
                // Get red channel value (first channel)
                const pixelIndex = actualY * width + actualX;
                const value = data[pixelIndex]; // Red channel
                
                // Convert to ASCII brightness (darker = lower values, brighter = higher values)
                const chars = " .:-=+*#%@";
                const charIndex = Math.min(Math.floor(value * chars.length), chars.length - 1);
                row += chars[charIndex];
            } else {
                row += " ";
            }
        }
        ascii += row + "\n";
    }
    
    console.log(ascii);
    console.log("Legend: ' '=black → '@'=white\n");
}

/**
 * Compares tensor statistics before and after processing
 */
export function compareTensorStats(original: ort.Tensor, processed: ort.Tensor): void {
    console.log("\n📊 Tensor Comparison:");
    
    const origData = original.data as Float32Array;
    const procData = processed.data as Float32Array;
    
    const origMean = origData.reduce((sum, val) => sum + val, 0) / origData.length;
    const procMean = procData.reduce((sum, val) => sum + val, 0) / procData.length;
    
    const origMin = Math.min(...origData);
    const origMax = Math.max(...origData);
    const procMin = Math.min(...procData);
    const procMax = Math.max(...procData);
    
    console.log(`Original - Shape: [${original.dims.join(',')}], Range: [${origMin.toFixed(4)}, ${origMax.toFixed(4)}], Mean: ${origMean.toFixed(4)}`);
    console.log(`Processed - Shape: [${processed.dims.join(',')}], Range: [${procMin.toFixed(4)}, ${procMax.toFixed(4)}], Mean: ${procMean.toFixed(4)}`);
    
    const meanDiff = Math.abs(origMean - procMean);
    console.log(`Mean difference: ${meanDiff.toFixed(4)} ${meanDiff < 0.1 ? '✅' : '⚠️'}`);
}

/**
 * Calculate overlap between two bounding boxes
 * Returns the intersection area divided by the area of the first box
 */
function calculateOverlap(box1: any, box2: any): number {
    const x1 = Math.max(box1.x1, box2.x1);
    const y1 = Math.max(box1.y1, box2.y1);
    const x2 = Math.min(box1.x2, box2.x2);
    const y2 = Math.min(box1.y2, box2.y2);
    
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
    
    return intersection / area1;
}

/**
 * Calculate distance between centers of two bounding boxes
 */
function calculateCenterDistance(box1: any, box2: any): number {
    const dx = box1.bbox.x_center - box2.bbox.x_center;
    const dy = box1.bbox.y_center - box2.bbox.y_center;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Crop an image to a specific bounding box with padding
 */
export async function cropImageToBoundingBox(
    imageUri: string,
    bbox: { x_center: number; y_center: number; width: number; height: number },
    imageWidth: number,
    imageHeight: number,
    padding: number = 0.1 // 10% padding around the bounding box
): Promise<string> {
    try {
        // Convert normalized coordinates to pixel coordinates
        const pixelCoords = convertToPixelCoords(bbox, imageWidth, imageHeight);
        
        // Add padding
        const paddingX = Math.round(pixelCoords.pixelWidth * padding);
        const paddingY = Math.round(pixelCoords.pixelHeight * padding);
        
        const cropX = Math.max(0, pixelCoords.x1 - paddingX);
        const cropY = Math.max(0, pixelCoords.y1 - paddingY);
        const cropWidth = Math.min(imageWidth - cropX, pixelCoords.x2 - pixelCoords.x1 + 2 * paddingX);
        const cropHeight = Math.min(imageHeight - cropY, pixelCoords.y2 - pixelCoords.y1 + 2 * paddingY);
        
        console.log(`🖼️ Cropping image: original=${imageWidth}x${imageHeight}, crop=${cropX},${cropY},${cropWidth}x${cropHeight}`);
        
        const croppedImage = await ImageManipulator.manipulateAsync(
            imageUri,
            [
                {
                    crop: {
                        originX: cropX,
                        originY: cropY,
                        width: cropWidth,
                        height: cropHeight
                    }
                }
            ],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        
        return croppedImage.uri;
    } catch (error) {
        console.error('Error cropping image:', error);
        return imageUri; // Return original image if cropping fails
    }
}

/**
 * Detect the winner by finding which person is sitting on the chair
 * This function takes a camera reference and captures a new image for each attempt
 */
export async function detectWinner(
    session: ort.InferenceSession,
    cameraRef: any,
    maxRetries: number = 3
): Promise<WinnerDetectionResult> {
    console.log(`🏆 Starting winner detection with ${maxRetries} max retries`);
    
    let firstCapturedImage: string | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`🎯 Winner detection attempt ${attempt}/${maxRetries}`);
        
        try {
            // Capture a new image for each attempt
            const picture = await cameraRef.current?.takePictureAsync({
                quality: 0.8,
                base64: false,
            });

            if (!picture) {
                console.log(`⚠️ Attempt ${attempt}: Failed to capture picture`);
                continue;
            }

            // Store the first captured image for fallback
            if (attempt === 1) {
                firstCapturedImage = picture.uri;
            }

            // Get image dimensions
            const { width: imageWidth, height: imageHeight } = await new Promise<{width: number, height: number}>((resolve, reject) => {
                Image.getSize(
                    picture.uri,
                    (width, height) => resolve({ width, height }),
                    (error) => reject(error)
                );
            });

            console.log(`📸 Captured image ${attempt}: ${imageWidth}x${imageHeight}`);
            
            // Run detection to find persons and chairs
            const inputTensor = await imageToTensor(picture.uri);
            const feeds = { images: inputTensor };
            const results = await session.run(feeds);
            const outputTensor = results["output0"];
            
            if (!outputTensor) {
                throw new Error("No output tensor found in inference results.");
            }
            
            const detectionResults = processOutputTensorToCountPersonsAndChairs(outputTensor);
            
            // Check if we have both persons and chairs
            if (detectionResults.personCount === 0) {
                console.log(`⚠️ Attempt ${attempt}: No persons detected`);
                if (attempt === maxRetries) {
                    return {
                        success: false,
                        fullImage: firstCapturedImage || picture.uri,
                        attempts: attempt
                    };
                }
                continue;
            }
            
            if (detectionResults.chairCount === 0) {
                console.log(`⚠️ Attempt ${attempt}: No chairs detected`);
                if (attempt === maxRetries) {
                    return {
                        success: false,
                        fullImage: firstCapturedImage || picture.uri,
                        attempts: attempt
                    };
                }
                continue;
            }
            
            // Find the person with the highest overlap with any chair
            let bestPerson = null;
            let bestOverlap = 0;
            let bestDistance = Infinity;
            let bestConfidence = 0;
            
            for (const person of detectionResults.persons) {
                for (const chair of detectionResults.chairs) {
                    // Convert to pixel coordinates for overlap calculation
                    const personPixel = convertToPixelCoords(person.bbox, imageWidth, imageHeight);
                    const chairPixel = convertToPixelCoords(chair.bbox, imageWidth, imageHeight);
                    
                    const overlap = calculateOverlap(personPixel, chairPixel);
                    const distance = calculateCenterDistance(person, chair);
                    
                    console.log(`👤 Person (conf: ${person.confidence.toFixed(3)}) overlap with chair: ${overlap.toFixed(3)}, distance: ${distance.toFixed(3)}`);
                    
                    // Prefer higher overlap, then shorter distance, then higher confidence
                    if (overlap > bestOverlap || 
                        (overlap === bestOverlap && distance < bestDistance) ||
                        (overlap === bestOverlap && distance === bestDistance && person.confidence > bestConfidence)) {
                        bestPerson = person;
                        bestOverlap = overlap;
                        bestDistance = distance;
                        bestConfidence = person.confidence;
                    }
                }
            }
            
            if (bestPerson && bestOverlap > 0.1) { // At least 10% overlap required
                console.log(`🏆 Winner found! Overlap: ${bestOverlap.toFixed(3)}, Confidence: ${bestConfidence.toFixed(3)}`);
                
                // Crop the winner's image from the current successful capture
                const winnerImage = await cropImageToBoundingBox(
                    picture.uri,
                    bestPerson.bbox,
                    imageWidth,
                    imageHeight,
                    0.2 // 20% padding
                );
                
                return {
                    success: true,
                    winnerImage,
                    fullImage: picture.uri,
                    confidence: bestConfidence,
                    attempts: attempt
                };
            } else {
                console.log(`⚠️ Attempt ${attempt}: No clear winner found (best overlap: ${bestOverlap.toFixed(3)})`);
            }
            
        } catch (error) {
            console.error(`❌ Error in winner detection attempt ${attempt}:`, error);
        }
        
        // Wait a bit before retrying (except on last attempt)
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    // All attempts failed, return the first captured image
    console.log(`❌ Winner detection failed after ${maxRetries} attempts, returning first captured image`);
    return {
        success: false,
        fullImage: firstCapturedImage || '',
        attempts: maxRetries
    };
}
