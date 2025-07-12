# Real-Time Inference Performance Analysis

## Current Implementation Analysis

### Performance Bottlenecks Identified

#### 1. **Image Preprocessing Pipeline (Major Bottleneck)**
**Current Process:**
- `Image.getSize()` - Network/file system call
- `ImageManipulator.manipulateAsync()` - Heavy image resize operation
- `base64` encoding/decoding - Memory intensive
- `jpeg.decode()` - CPU intensive JPEG decompression
- Nested loops for RGB extraction and HWC→CHW conversion

**Estimated Time: 150-300ms per frame**

#### 2. **ONNX Inference**
- YOLOv8n model: ~20-50ms on mobile GPU (XNNPACK)
- Model size: Small (YOLOv8n = 6MB)
- Input: 640x640x3 = 1.2M pixels

**Estimated Time: 20-80ms per frame**

#### 3. **Post-processing (Moderate Bottleneck)**
- Loop through 8,400 detections
- 80 class score comparisons per detection
- NMS algorithm with IoU calculations
- Multiple console.log statements

**Estimated Time: 10-30ms per frame**

### Total Current Pipeline Time
**Conservative Estimate: 180-410ms per frame**
**Current FPS: 2.4-5.5 FPS** ❌

### 25 FPS Target Analysis
**Required Frame Time: 40ms (1000ms / 25 fps)**
**Performance Gap: 4.5-10x too slow** ❌

## Optimization Strategies for 25 FPS

### Phase 1: Critical Optimizations (Target: 10-15 FPS)

#### 1. **Preprocessing Optimization**
```typescript
// Replace current imageToTensor with optimized version
export async function imageToTensorOptimized(imageUri: string): Promise<ort.Tensor> {
    // Use lower quality for speed
    const manipulated = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 640, height: 640 } }], // Direct resize, no letterboxing
        { 
            base64: false,  // Skip base64 encoding
            compress: 0.7,  // Reduce quality for speed
            format: ImageManipulator.SaveFormat.JPEG
        }
    );
    
    // Use native tensor creation if available
    // Or implement direct pixel buffer access
}
```

#### 2. **Remove Debugging Overhead**
```typescript
// Remove all console.log statements in production
// Use conditional logging only
const DEBUG = __DEV__;
if (DEBUG) console.log(...);
```

#### 3. **Optimize Post-processing**
```typescript
// Early exit optimizations
for (let i = 0; i < numDetections; i++) {
    // Skip low-confidence detections early
    const maxPossibleScore = Math.max(
        data[4 * numDetections + i], // First class score
        data[5 * numDetections + i]  // Second class score
    );
    if (maxPossibleScore < threshold) continue;
    
    // ... rest of processing
}
```

### Phase 2: Advanced Optimizations (Target: 20-25 FPS)

#### 1. **Camera Preview Stream Processing**
```typescript
// Process camera preview frames instead of taking pictures
const processPreviewFrame = (frameData: ImageData) => {
    // Direct access to camera buffer
    // Skip file I/O completely
};
```

#### 2. **Model Quantization**
```typescript
// Use quantized INT8 model instead of FP32
const session = await ort.InferenceSession.create(modelUri, {
    executionProviders: ['xnnpack'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: false, // Reduce memory allocation overhead
});
```

#### 3. **Frame Skipping Strategy**
```typescript
// Process every 2nd or 3rd frame for real-time feel
let frameCounter = 0;
const PROCESS_EVERY_N_FRAMES = 2;

if (frameCounter % PROCESS_EVERY_N_FRAMES === 0) {
    // Process this frame
}
frameCounter++;
```

#### 4. **Parallel Processing**
```typescript
// Use multiple inference sessions or workers
const sessionPool = [session1, session2, session3];
let currentSessionIndex = 0;

const runParallelInference = async (imageUri: string) => {
    const session = sessionPool[currentSessionIndex];
    currentSessionIndex = (currentSessionIndex + 1) % sessionPool.length;
    return session.run(feeds);
};
```

### Phase 3: Hardware-Specific Optimizations

#### 1. **iOS Metal Performance Shaders**
```typescript
// Use iOS-specific GPU acceleration
executionProviders: ['coreml', 'xnnpack']
```

#### 2. **Android NNAPI**
```typescript
// Use Android Neural Networks API
executionProviders: ['nnapi', 'xnnpack']
```

## Realistic Performance Expectations

### Current Hardware Limitations
- **Mobile CPU**: Limited compared to desktop
- **Memory Bandwidth**: Constrained on mobile
- **Thermal Throttling**: Sustained performance degrades

### Achievable Targets by Device Category

#### **High-End Devices (iPhone 14+, Samsung S23+)**
- **Optimized Implementation**: 15-20 FPS
- **With frame skipping**: 25 FPS apparent
- **With smaller model**: 25+ FPS

#### **Mid-Range Devices (iPhone 12, Samsung A54)**
- **Optimized Implementation**: 8-12 FPS
- **With frame skipping**: 15-20 FPS apparent

#### **Budget Devices**
- **Optimized Implementation**: 5-8 FPS
- **Not suitable for 25 FPS real-time**

## Implementation Recommendations

### Option 1: Immediate Improvements (Week 1)
```typescript
// Quick wins for 2-3x speedup
1. Remove all console.log in production
2. Reduce image quality to 0.3
3. Skip letterboxing (direct 640x640 resize)
4. Early exit in post-processing
5. Increase confidence threshold to 0.8
```

### Option 2: Significant Rewrite (Month 1)
```typescript
// Complete preprocessing overhaul
1. Direct camera buffer access
2. Native image processing
3. Quantized model
4. Hardware-specific optimizations
```

### Option 3: Hybrid Approach (Recommended)
```typescript
// Smart frame processing
1. Process every 2nd frame at full quality
2. Use motion detection to trigger processing
3. Interpolate results between frames
4. Background processing queue
```

## Conclusion

**Can you achieve 25 FPS with current implementation?** 
❌ **No** - Current pipeline is 4-10x too slow

**Can you achieve 25 FPS with optimizations?**
✅ **Yes, on high-end devices** with significant optimizations

**Recommended Approach:**
1. Start with Option 1 (quick wins) to get 8-12 FPS
2. Implement frame skipping for apparent 25 FPS
3. Consider Option 2 for true 25 FPS on flagship devices

**Reality Check:**
True 25 FPS real-time object detection on mobile requires significant engineering effort and may only work reliably on high-end hardware.
