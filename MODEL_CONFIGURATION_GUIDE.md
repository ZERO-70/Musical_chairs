# YOLOv8 ONNX Model Configuration Guide

## Model Specifications
- **Model File**: `yolov8n.onnx`
- **Model Type**: YOLOv8 Nano (object detection)
- **Input Format**: `[batch, channels, height, width]` = `[1, 3, 640, 640]`
- **Output Format**: `[batch, features, detections]` = `[1, 84, 8400]`
- **Classes**: 80 COCO classes (person = class 0)

## Critical Issues Encountered & Solutions

### 1. **🔥 MAJOR ISSUE: Output Tensor Format**
**Problem**: YOLOv8 ONNX model outputs `[1, 84, 8400]` but our code expected `[1, 8400, 84]`

**Symptoms**:
- Model loads successfully
- No detections found (returns 0 persons)
- No errors in console

**Solution**:
```python
# Check if we need to transpose the output (YOLOv8 format: [batch, 84, num_detections])
if len(output.shape) == 3 and output.shape[1] == 84:
    # Format: [batch, 84, num_detections] - need to transpose
    output = output.transpose(0, 2, 1)
```

### 2. **🔥 MAJOR ISSUE: Coordinate Conversion**
**Problem**: Bounding box coordinates were being double-scaled

**Symptoms**:
- Detections found but all bounding boxes show as `(0, 0) to (0, 0)`
- Confidence scores are correct

**Original (Incorrect) Code**:
```python
# Wrong: Double scaling
x1 = int((x_center - width / 2) * x_scale)
y1 = int((y_center - height / 2) * y_scale)
```

**Fixed Code**:
```python
# Correct: YOLOv8 coordinates are already normalized (0-1)
x1 = int((x_center - width / 2) * img_width)
y1 = int((y_center - height / 2) * img_height)
```

### 3. **Input Preprocessing Requirements**
**Correct Configuration**:
```python
def preprocess(self, image):
    # 1. Resize to model input size (640x640)
    resized = cv2.resize(image, (640, 640))
    
    # 2. Convert BGR to RGB (OpenCV uses BGR, model expects RGB)
    rgb_image = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    
    # 3. Normalize to 0-1 range
    normalized = rgb_image.astype(np.float32) / 255.0
    
    # 4. Change data layout from HWC to CHW
    transposed = np.transpose(normalized, (2, 0, 1))
    
    # 5. Add batch dimension [C, H, W] -> [1, C, H, W]
    input_tensor = np.expand_dims(transposed, axis=0)
    
    return input_tensor
```

## Model Output Structure Analysis

### Input Details
- **Name**: `"images"`
- **Shape**: `[1, 3, 640, 640]`
- **Data Type**: `float32`
- **Range**: `0.0 to 1.0` (normalized)

### Output Details
- **Name**: `"output0"`
- **Shape**: `[1, 84, 8400]`
- **Data Type**: `float32`
- **Structure**: 
  - **84 features** = 4 (bbox: x_center, y_center, width, height) + 80 (class scores)
  - **8400 detections** = Grid cells from different scales (80×80 + 40×40 + 20×20 = 8400)

### Detection Processing
```python
for detection in output[0]:  # After transpose: [8400, 84]
    # Bounding box (normalized 0-1)
    x_center, y_center, width, height = detection[:4]
    
    # Class scores (80 classes)
    class_scores = detection[4:]
    
    # Get class with highest confidence
    class_id = np.argmax(class_scores)
    confidence = class_scores[class_id]
    
    # Filter: person class (0) and confidence threshold
    if class_id == 0 and confidence >= threshold:
        # Convert to pixel coordinates
        x1 = int((x_center - width / 2) * img_width)
        y1 = int((y_center - height / 2) * img_height)
        x2 = int((x_center + width / 2) * img_width)
        y2 = int((y_center + height / 2) * img_height)
```

## Required Dependencies

### Python Packages
```bash
pip install opencv-python==4.10.0.84
pip install numpy==1.26.4
pip install onnxruntime==1.20.1
```

### System Requirements
- **Python**: 3.8+
- **Camera**: Webcam access for real-time detection
- **Display**: For OpenCV window display (X11/Wayland on Linux)

## Common Debugging Steps

### 1. **Verify Model Loading**
```python
session = ort.InferenceSession("yolov8n.onnx")
print(f"Input shape: {session.get_inputs()[0].shape}")
print(f"Output shape: {session.get_outputs()[0].shape}")
```

### 2. **Check Output Format**
```python
outputs = session.run(None, {input_name: input_tensor})
print(f"Output shape: {outputs[0].shape}")
# Should be [1, 84, 8400] for YOLOv8
```

### 3. **Verify Detection Count**
```python
# After postprocessing
detections_all = [d for d in all_detections if d['confidence'] >= 0.1]
person_detections = [d for d in detections_all if d['class_id'] == 0]
print(f"Total detections: {len(detections_all)}")
print(f"Person detections: {len(person_detections)}")
```

### 4. **Camera Issues**
```python
cap = cv2.VideoCapture(0)  # Try different indices: 0, 1, 2
if not cap.isOpened():
    print("Camera not accessible")
```

## Performance Considerations

### 1. **Model Size vs Speed**
- **YOLOv8n**: Fastest, least accurate (~8400 detections to process)
- **YOLOv8s/m/l/x**: Slower but more accurate

### 2. **Confidence Threshold**
- **0.5**: Good balance (recommended)
- **0.3**: More detections, more false positives
- **0.7**: Fewer detections, higher precision

### 3. **Image Resolution**
- **Model input**: Always 640×640 (resized automatically)
- **Camera input**: 640×480 recommended for real-time performance

## File Structure Summary
```
project/
├── yolov8n.onnx                 # Pre-trained model
├── person_detection.py          # Real-time camera detection
├── image_person_detection.py    # Static image detection  
├── debug_detection.py           # Debugging tool
├── requirements.txt             # Dependencies
└── img.jpg                      # Input image (any name starting with "img")
```

## Troubleshooting Checklist

- [ ] Model file exists and is valid ONNX format
- [ ] Output shape is `[1, 84, 8400]` (requires transpose)
- [ ] Coordinates are converted correctly (no double scaling)
- [ ] Input preprocessing follows exact order: resize → BGR2RGB → normalize → transpose → batch
- [ ] Camera index is correct (try 0, 1, 2)
- [ ] Confidence threshold is reasonable (0.3-0.7)
- [ ] Class filtering is correct (person = class 0)

## Expected Results
- **Real-time**: 20-30 FPS on modern laptop
- **Detection accuracy**: High for clearly visible persons
- **Typical detection count**: Varies by image content (our test: 83 persons detected)
