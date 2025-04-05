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

    return new ort.Tensor('float32', chwData, [1, 3, finalHeight, finalWidth]);
}

/**
 * Processes the output tensor from the model and returns the number of chairs detected.
 * Assumes the output tensor is of shape [1, 84, 8400] and that each prediction is arranged as:
 * [box_x, box_y, box_w, box_h, objectness, classProb1, classProb2, ..., classProb79].
 * For each prediction, the confidence is computed as objectness * max(classProbability).
 * The chair class is assumed to have an index of 56 (i.e. if max class index === 56).
 *
 * @param outputTensor - The output tensor from the model.
 * @returns The number of chairs detected.
 */
export function processOutputTensorToCountChairs(outputTensor: ort.Tensor): number {
    const threshold = 0.4; // Adjust as needed
    const data = outputTensor.data as Float32Array;
    const numPredictions = 8400; // From shape [1, 84, 8400]
    const numFeatures = 84;
    let chairCount = 0;
    for (let i = 0; i < numPredictions; i++) {
        const offset = i * numFeatures;
        const objectness = data[offset + 4];
        let maxProb = -Infinity;
        let maxClass = -1;
        for (let j = 5; j < numFeatures; j++) {
            const prob = data[offset + j];
            if (prob > maxProb) {
                maxProb = prob;
                maxClass = j - 5; // Class indices 0 to 78
            }
        }
        const confidence = objectness * maxProb;
        if (confidence > threshold && maxClass === 56) {
            chairCount++;
        }
    }
    return chairCount;
}

/**
 * Runs local inference on the given image and returns the number of chairs detected.
 * Measures timing for each major step.
 *
 * @param session - The ONNX InferenceSession.
 * @param imageUri - The URI of the input image.
 * @returns A promise that resolves to the number of chairs detected.
 */
export async function runLocalInference(
    session: ort.InferenceSession,
    imageUri: string
): Promise<number> {
    const totalStart = Date.now();

    const preprocessStart = Date.now();
    const inputTensor = await imageToTensor(imageUri);
    const preprocessEnd = Date.now();
    console.log(`🖼️ Preprocessing (imageToTensor): ${preprocessEnd - preprocessStart} ms`);

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
    const chairCount = processOutputTensorToCountChairs(outputTensor);
    const postprocessEnd = Date.now();
    console.log(`📊 Postprocessing (count chairs): ${postprocessEnd - postprocessStart} ms`);

    const totalEnd = Date.now();
    console.log(`🕐 Total Inference Time: ${totalEnd - totalStart} ms`);

    // Optional debug info
    console.log("Output tensor shape:", outputTensor.dims);
    console.log("First 20 output values:", outputTensor.data.slice(0, 20));

    return chairCount;
}
